import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  Agent,
  type Card,
  ETIQUETTE_AJOUT_DE_MOTEUR,
  FicheMoteurZ,
  activationPermise,
  cleDuMoteurDansLeCoffre,
  etatDeLaCarteDAjout,
  titreDeLAjout,
  jugerDeclaration,
  poserLesMoteursAjoutes,
  verdictDEpreuve,
  type ConstatDEpreuve,
  type DeclarationDeMoteur,
  type FicheMoteur,
} from '@beluga/shared';
import { getDb, getMeta, setMeta } from './db.js';
import { bus } from './bus.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import * as store from './store.js';
import { cleDUnCompteDuMoteur, declarerCleDeMoteur, listAllAccountRecords, refreshQuotas, retirerCompte } from './accounts.js';
import { listEngines } from './engines/index.js';
import {
  adaptateurDeFiche,
  environnementAnthropique,
  environnementOpenAI,
  modelesDeLaFiche,
  sonderLaFiche,
} from './engines/ajoutes.js';
import { demarrerRelaisChat } from './engines/relais-chat.js';
import { rangerLaCarte } from './deplacement-carte.js';
import { listerAcces } from './coffre-fort.js';

/**
 * LES MOTEURS AJOUTÉS — la réserve en base, l'épreuve, l'activation, le retrait.
 *
 * Un fournisseur compatible Anthropic ou OpenAI devient un moteur de
 * l'application SANS une ligne de code : l'agent « Ajouter un moteur »
 * (Réglages › Comptes) le déclare (`essai`), l'éprouve par un VRAI tour dans
 * un dossier jetable, puis l'active. L'activation est refusée tant que
 * l'épreuve n'est pas verte : l'utilisateur craignait, à raison, que chaque API
 * ait ses manières et que Beluga Build lise mal ses réponses — on ne le croit
 * donc que sur pièce.
 */

/* ------------------------------------------------------------------ */
/* La réserve                                                          */
/* ------------------------------------------------------------------ */

export function listerFiches(): FicheMoteur[] {
  try {
    const lignes = getDb().prepare('SELECT data FROM moteurs_ajoutes ORDER BY maj_le').all() as { data: string }[];
    return lignes.flatMap((ligne) => {
      const lue = FicheMoteurZ.safeParse(JSON.parse(ligne.data));
      return lue.success ? [lue.data] : [];
    });
  } catch (err: any) {
    // Base d'avant la migration : aucun moteur ajouté, jamais une panne.
    log.warn('moteurs ajoutés illisibles', err?.message ?? err);
    return [];
  }
}

export function ficheEnBase(id: string): FicheMoteur | undefined {
  return listerFiches().find((f) => f.id === id);
}

function ecrire(fiche: FicheMoteur): FicheMoteur {
  getDb()
    .prepare('INSERT INTO moteurs_ajoutes (id, data, maj_le) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, maj_le = excluded.maj_le')
    .run(fiche.id, JSON.stringify(fiche), Date.now());
  return fiche;
}

/**
 * POSE LES FICHES DANS LE REGISTRE DU PROCESSUS, et les diffuse. Appelé au
 * démarrage puis après chaque changement : c'est ce qui fait apparaître (ou
 * disparaître) un moteur dans tous les menus, sans redémarrer.
 */
export function chargerLesMoteursAjoutes(diffuser = false): FicheMoteur[] {
  const fiches = listerFiches();
  poserLesMoteursAjoutes(fiches);
  if (diffuser) bus.emit({ type: 'moteurs.ajoutes', fiches });
  return fiches;
}

async function apresChangement(): Promise<void> {
  chargerLesMoteursAjoutes(true);
  try {
    bus.emit({ type: 'engines', engines: await listEngines(true) });
    const quotas = await refreshQuotas(true);
    bus.emit({ type: 'quotas', quotas });
  } catch (err: any) {
    log.warn('moteurs ajoutés : catalogue ou quotas non relus', err?.message ?? err);
  }
}

/* ------------------------------------------------------------------ */
/* Déclarer                                                            */
/* ------------------------------------------------------------------ */

export function declarerMoteur(
  entree: DeclarationDeMoteur,
  carteId?: string,
): { ok: true; fiche: FicheMoteur } | { ok: false; raison: string } {
  const existantes = listerFiches();
  const verdict = jugerDeclaration(entree, existantes, Date.now());
  if ('refus' in verdict) return { ok: false, raison: verdict.refus };
  // Une fiche redéclarée garde sa carte ; celle de l'agent qui déclare passe devant.
  const ancienne = existantes.find((f) => f.id === verdict.fiche.id);
  const fiche = ecrire({ ...verdict.fiche, ...(carteId || ancienne?.carteId ? { carteId: carteId || ancienne?.carteId } : {}) });
  chargerLesMoteursAjoutes(true);
  suivreLaCarteDuMoteur(fiche.id);
  return { ok: true, fiche };
}

/* ------------------------------------------------------------------ */
/* Éprouver                                                            */
/* ------------------------------------------------------------------ */

/** Les clés éprouvées, gardées le temps que l'agent active le moteur. */
const clesEprouvees = new Map<string, string>();

const PLAFOND_EPREUVE_MS = 180_000;

/**
 * UN VRAI TOUR, DANS UN DOSSIER JETABLE. L'outil de la famille est lancé sur
 * un dossier temporaire qui ne contient qu'un fichier : il doit le lire avec
 * un outil, rendre le mot qu'il contient, et s'arrêter seul. Jamais le dépôt
 * de Beluga Build ni la copie d'une carte : l'épreuve ne doit rien toucher.
 */
export async function eprouverMoteur(id: string, cle: string): Promise<{ ok: boolean; resume: string; fiche?: FicheMoteur }> {
  let fiche = ficheEnBase(id);
  if (!fiche) return { ok: false, resume: 'aucune fiche à ce nom : déclare-la d’abord' };
  if (fiche.statut === 'retire') return { ok: false, resume: 'ce moteur a été retiré : redéclare-le' };
  const secret = cle.trim();
  if (!secret) return { ok: false, resume: "il faut la clé d'accès pour l'épreuve" };
  // Le format « chat » passe par le relais local : il doit écouter avant le tour.
  await demarrerRelaisChat().catch((err) => log.warn('relais chat indisponible', err?.message ?? err));

  const constat: ConstatDEpreuve = {
    cleAcceptee: false,
    formatReconnu: true,
    outilUtilise: false,
    reponseJuste: false,
    finPropre: false,
    modelesLus: fiche.urlDesModeles ? false : null,
    usageLu: false,
  };

  try {
    const sonde = await sonderLaFiche(fiche, secret);
    constat.cleAcceptee = sonde.ok;
    constat.formatReconnu = !sonde.formatInconnu;
    constat.cleRefusee = sonde.ok ? false : sonde.cleRefusee;
    if (!sonde.ok) constat.erreur = sonde.erreur;
    // Le format DÉTECTÉ est retenu sur la fiche : les tours suivants le suivent.
    if (sonde.api && sonde.api !== (fiche.api ?? 'responses')) fiche = ecrire({ ...fiche, api: sonde.api });
    else if (sonde.api === 'responses' && fiche.api === undefined) fiche = ecrire({ ...fiche, api: 'responses' });
  } catch (err: any) {
    constat.erreur = err?.message ?? String(err);
    constat.cleRefusee = false;
  }
  if (fiche.urlDesModeles) {
    try {
      constat.modelesLus = (await modelesDeLaFiche(fiche, secret)).length > 0;
    } catch (err: any) {
      constat.erreur ??= err?.message ?? String(err);
    }
  }
  if (constat.cleAcceptee) Object.assign(constat, await tourDEpreuve(fiche, secret));

  const verdict = verdictDEpreuve(constat);
  const epreuvee = ecrire({
    ...fiche,
    epreuve: {
      ok: verdict.ok,
      at: Date.now(),
      resume: verdict.resume,
      constat: {
        cleAcceptee: constat.cleAcceptee,
        ...(constat.cleRefusee !== undefined ? { cleRefusee: constat.cleRefusee } : {}),
        formatReconnu: constat.formatReconnu,
        outilUtilise: constat.outilUtilise,
        reponseJuste: constat.reponseJuste,
      },
    },
  });
  if (verdict.ok) clesEprouvees.set(fiche.id, secret);
  chargerLesMoteursAjoutes(true);
  suivreLaCarteDuMoteur(fiche.id);
  log.info(`moteur ajouté ${fiche.id} : ${verdict.resume}`);
  return { ok: verdict.ok, resume: verdict.resume, fiche: epreuvee };
}

async function tourDEpreuve(
  fiche: FicheMoteur,
  cle: string,
): Promise<Pick<ConstatDEpreuve, 'outilUtilise' | 'reponseJuste' | 'finPropre' | 'usageLu' | 'erreur'>> {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-epreuve-moteur-'));
  const dossier = path.join(racine, 'travail');
  const coffre = path.join(racine, 'coffre');
  fs.mkdirSync(dossier, { recursive: true });
  fs.mkdirSync(coffre, { recursive: true });
  const mot = `beluga-${crypto.randomBytes(3).toString('hex')}`;
  fs.writeFileSync(path.join(dossier, 'note.txt'), `Le mot secret est ${mot}.\n`);

  const env = fiche.famille === 'anthropic' ? environnementAnthropique(fiche, cle, coffre) : environnementOpenAI(fiche, cle, coffre);
  let texte = '';
  let outilUtilise = false;
  let usageLu = false;
  let coupe = false;
  try {
    const handle = adaptateurDeFiche({ ...fiche, statut: 'essai' }).run({
      cwd: dossier,
      prompt: 'Lis le fichier note.txt avec un outil, puis réponds uniquement par le mot secret qu’il contient, sans rien ajouter.',
      model: fiche.modeleParDefaut,
      fullAccess: true,
      env,
      onEvent: (event) => {
        if (event.kind === 'text' && typeof (event as any).text === 'string') texte += (event as any).text;
        if (event.kind === 'step') outilUtilise = true;
        if (event.kind === 'usage') usageLu = true;
      },
    });
    const minuteur = setTimeout(() => {
      coupe = true;
      handle.stop();
    }, PLAFOND_EPREUVE_MS);
    const fin = await handle.finished.finally(() => clearTimeout(minuteur));
    return {
      outilUtilise,
      reponseJuste: texte.includes(mot),
      finPropre: fin.ok && !coupe,
      usageLu,
      erreur: coupe ? `aucune fin au bout de ${PLAFOND_EPREUVE_MS / 1000} s` : fin.error,
    };
  } catch (err: any) {
    return { outilUtilise, reponseJuste: false, finPropre: false, usageLu, erreur: err?.message ?? String(err) };
  } finally {
    fs.rm(racine, { recursive: true, force: true }, () => {});
  }
}

/* ------------------------------------------------------------------ */
/* Activer                                                             */
/* ------------------------------------------------------------------ */

/**
 * ACTIVER : REFUSÉ tant que la dernière épreuve n'est pas verte. Le premier
 * compte naît avec la clé éprouvée ; les suivants s'ajoutent depuis les
 * comptes, comme pour MiMo ou Cursor.
 */
export async function activerMoteur(
  id: string,
  opts: { cle?: string; nomDuCompte?: string } = {},
): Promise<{ ok: boolean; raison: string }> {
  const fiche = ficheEnBase(id);
  const permis = activationPermise(fiche);
  if (!permis.ok) return { ok: false, raison: permis.raison };
  const active = ecrire({ ...(fiche as FicheMoteur), statut: 'actif' });
  chargerLesMoteursAjoutes(true);

  const cle = (opts.cle ?? '').trim() || clesEprouvees.get(active.id) || '';
  const dejaUnCompte = listAllAccountRecords().some((a) => a.engine === active.id);
  let compte = '';
  if (cle && !dejaUnCompte) {
    const rendu = await declarerCleDeMoteur(active.id, opts.nomDuCompte?.trim() || `${active.nomCourt} — compte principal`, cle);
    compte = rendu.ok
      ? ` Le compte « ${rendu.account?.label} » est créé avec la clé éprouvée.`
      : ` Le compte n’a pas pu être créé (${rendu.erreur}) : l’utilisateur ajoutera la clé depuis les comptes.`;
  } else if (!cle && !dejaUnCompte) {
    compte = ' Aucune clé retenue : l’utilisateur ajoutera la clé depuis les comptes.';
  }
  clesEprouvees.delete(active.id);
  await apresChangement();
  suivreLaCarteDuMoteur(active.id);
  return { ok: true, raison: `« ${active.label} » est actif : il apparaît dans les menus de moteurs et dans les comptes.${compte}` };
}

/**
 * LE GESTE DE L'ÉCRAN : « Réessayer l'essai » (ou « Reconnecter ») sur la
 * ligne d'un moteur ajouté. La clé collée — ou, à défaut, celle retenue par la
 * dernière épreuve, celle d'un compte du moteur, ou celle du fournisseur au
 * coffre (`cleDuMoteurDansLeCoffre`) — est éprouvée ; une
 * épreuve verte active le moteur et son premier compte naît avec cette clé.
 * La clé n'est jamais écrite ailleurs que dans le compte.
 */
export async function eprouverDepuisLesReglages(
  id: string,
  cleCollee?: string,
): Promise<{ ok: boolean; resume: string; actif?: boolean }> {
  const fiche = ficheEnBase(id);
  if (!fiche) return { ok: false, resume: 'ce moteur n’existe plus' };
  let auCoffre: string | undefined;
  try {
    auCoffre = cleDuMoteurDansLeCoffre(listerAcces(), fiche);
  } catch {
    auCoffre = undefined; // coffre illisible : on s'en passe
  }
  const cle = (cleCollee ?? '').trim() || clesEprouvees.get(id) || cleDUnCompteDuMoteur(id) || auCoffre || '';
  if (!cle) return { ok: false, resume: 'Collez la clé d’accès du fournisseur pour lancer l’essai.' };
  const epreuve = await eprouverMoteur(id, cle);
  if (!epreuve.ok) return { ok: false, resume: epreuve.resume };
  const activation = await activerMoteur(id, { cle });
  return activation.ok
    ? { ok: true, resume: `${epreuve.resume} ${activation.raison}`, actif: true }
    : { ok: false, resume: activation.raison };
}

/* ------------------------------------------------------------------ */
/* Retirer                                                             */
/* ------------------------------------------------------------------ */

/**
 * RETIRER UN MOTEUR AJOUTÉ. Refusé si un agent travaille dessus. Sinon ses
 * comptes quittent l'application, et tout ce qui le portait — projets,
 * cartes, agents au repos — retombe sur Claude, avec la raison dans la
 * réponse : une carte ne doit jamais partir sur un moteur qui n'existe plus.
 */
export async function retirerMoteur(
  id: string,
  opts: { agentsAuTravail: readonly string[]; comptesOccupes: readonly string[] },
): Promise<{ ok: boolean; erreur?: string; texte?: string }> {
  const fiche = ficheEnBase(id);
  if (!fiche || fiche.statut === 'retire') return { ok: false, erreur: 'ce moteur n’existe plus' };
  const occupe = opts.agentsAuTravail.some((agentId) => store.getAgent(agentId)?.run.engine === id);
  if (occupe) return { ok: false, erreur: `un agent travaille avec ${fiche.nomCourt} en ce moment` };

  for (const compte of listAllAccountRecords().filter((a) => a.engine === id)) {
    const rendu = retirerCompte(compte.id, { comptesOccupes: opts.comptesOccupes, memeLeDernier: true });
    if (!rendu.ok) return { ok: false, erreur: rendu.erreur };
  }
  ecrire({ ...fiche, statut: 'retire' });
  suivreLaCarteDuMoteur(fiche.id);

  let cartes = 0;
  for (const projet of store.listProjects(true)) {
    if (projet.defaultEngine === id) bus.emit({ type: 'project.upsert', project: store.saveProject({ ...projet, defaultEngine: 'claude' }) });
    for (const carte of store.listCards(projet.id)) {
      if (carte.run.engine !== id || carte.id === fiche.carteId) continue;
      bus.emit({ type: 'card.upsert', card: store.saveCard({ ...carte, run: { ...carte.run, engine: 'claude', model: undefined, thinking: 'none' } }) });
      cartes += 1;
    }
  }
  for (const agent of store.listAgents()) {
    if (agent.run.engine !== id) continue;
    bus.emit({ type: 'agent.upsert', agent: store.saveAgent({ ...agent, run: { ...agent.run, engine: 'claude', model: undefined, thinking: 'none' } }) });
  }
  await apresChangement();
  return {
    ok: true,
    texte: cartes
      ? `${fiche.label} est retiré. ${cartes} carte(s) qui l’utilisaient passent sur Claude.`
      : `${fiche.label} est retiré.`,
  };
}

/* ------------------------------------------------------------------ */
/* L'agent « Ajouter un moteur »                                       */
/* ------------------------------------------------------------------ */

const CLE_AGENT = 'moteurs.agent';

/**
 * Le projet qui porte l'agent : celui de Beluga Build lui-même, puisque
 * l'ajout d'un moteur change l'application ; à défaut, le premier projet.
 */
function projetDeLAgent(): string | null {
  const projets = store.listProjects();
  const beluga = projets.find((p) => path.resolve(p.path) === path.resolve(CONFIG.depotDuDemon));
  return (beluga ?? projets[0])?.id ?? null;
}

/**
 * Le dossier de travail de l'agent : HORS de tout dépôt, pour qu'il ne lise
 * ni ne modifie le code d'un projet — il étudie une documentation en ligne.
 */
function atelier(): string {
  const dossier = path.join(CONFIG.homeDir || os.homedir(), '.beluga', 'atelier-moteurs');
  fs.mkdirSync(dossier, { recursive: true });
  return dossier;
}

export function estAgentAjoutDeMoteur(agent: Pick<Agent, 'ajoutDeMoteur'> | null | undefined): boolean {
  return Boolean(agent?.ajoutDeMoteur);
}

/* ------------------------------------------------------------------ */
/* La carte de chaque ajout                                            */
/* ------------------------------------------------------------------ */

/**
 * Les colonnes que le suivi a le droit de QUITTER : jamais « À déployer » ni
 * « Archivé », qui ne se rouvrent que sur geste humain (MEM-0339).
 */
const COLONNES_SUIVIES = new Set(['planned', 'running']);

function agentAuTravail(agentId: string | undefined): boolean {
  const agent = agentId ? store.getAgent(agentId) : null;
  return Boolean(agent && (agent.status === 'running' || agent.status === 'starting' || agent.tourVivantDepuis !== undefined));
}

/** Pose la colonne et la phrase de la carte d'après l'état réel. */
function poserLEtat(carteId: string, fiche: FicheMoteur | undefined, auTravail?: boolean): void {
  const carte = store.getCard(carteId);
  if (!carte || !COLONNES_SUIVIES.has(carte.column)) return;
  const etat = etatDeLaCarteDAjout(fiche, auTravail ?? agentAuTravail(carte.agentId));
  const titre = fiche ? titreDeLAjout(fiche) : carte.title;
  const scheduling = carte.scheduling ?? { asap: false, attempts: 0, restarts: 0 };
  let neuve: Card;
  if (etat.colonne === 'archived') {
    // Même rangement que les autres cartes d'agents du démon (`rangerCarteDAgent`).
    const rangee = rangerLaCarte({ ...carte, title: titre }, 'archived');
    neuve = store.saveCard({
      ...rangee,
      doneAt: rangee.doneAt ?? Date.now(),
      scheduling: { ...(rangee.scheduling ?? scheduling), tourEnVolDepuis: undefined, waitingReason: undefined },
      sansModification: etat.phrase,
    });
  } else {
    neuve = store.saveCard({
      ...carte,
      title: titre,
      ...(carte.column !== 'running' ? { column: 'running', position: store.nextPosition(carte.projectId, 'running') } : {}),
      scheduling: { ...scheduling, tourEnVolDepuis: undefined, waitingReason: etat.phrase },
    });
  }
  bus.emit({ type: 'card.upsert', card: neuve });
}

/** LE SUIVI D'UNE FICHE : sa carte dit où en est la demande. */
export function suivreLaCarteDuMoteur(id: string): void {
  const fiche = ficheEnBase(id);
  if (!fiche?.carteId) return;
  try {
    poserLEtat(fiche.carteId, fiche);
  } catch (err: any) {
    log.warn(`carte du moteur ${id} non suivie`, err?.message ?? err);
  }
}

/**
 * Le suivi depuis l'AGENT : `true` quand on vient de lui écrire (la carte
 * passe en « En cours » AVANT que le tour démarre), `false` à la fin de son
 * tour (son statut dit encore « au travail » à cet instant).
 */
export function suivreLaCarteDeLAgent(agentId: string, auTravail?: boolean): void {
  const agent = store.getAgent(agentId);
  if (!agent?.cardId) return;
  const fiche = listerFiches().find((f) => f.carteId === agent.cardId);
  try {
    poserLEtat(agent.cardId, fiche, auTravail);
  } catch (err: any) {
    log.warn(`carte de l’ajout ${agent.cardId} non suivie`, err?.message ?? err);
  }
}

/**
 * CHAQUE AJOUT A SA CARTE. Posée au premier message écrit à l'agent (le tiroir
 * qu'on ouvre puis referme sans rien dire ne laisse rien au tableau), dans le
 * projet de Beluga Build, directement en « En cours ». « Autre moteur » repart
 * d'un agent neuf, donc d'une carte neuve : l'ancienne reste, avec sa
 * conversation. Rend l'identifiant de la carte.
 */
export async function carteDeLAjout(agentId: string, premierMessage?: string): Promise<string | null> {
  const agent = store.getAgent(agentId);
  if (!agent || !estAgentAjoutDeMoteur(agent)) return null;
  if (agent.cardId && store.getCard(agent.cardId)) return agent.cardId;
  // Chargé à l'appel : le module des outils passe lui-même par celui-ci.
  const { createCard } = await import('./tools.js');
  const nee = createCard(agent.projectId, {
    title: titreDeLAjout(undefined, premierMessage),
    description:
      'Conversation avec l’agent « Ajouter un LLM » (Réglages › Comptes et quotas) : il étudie le fournisseur, l’essaie pour de vrai, puis l’ajoute. Cette carte suit l’état de la demande toute seule.',
    labels: [ETIQUETTE_AJOUT_DE_MOTEUR],
    origin: 'agent',
    cadrage: true,
  });
  const carte = store.saveCard({
    ...nee,
    column: 'running',
    position: store.nextPosition(agent.projectId, 'running'),
    agentId: agent.id,
  });
  bus.emit({ type: 'card.upsert', card: carte });
  bus.emit({ type: 'agent.upsert', agent: store.saveAgent({ ...agent, cardId: carte.id }) });
  poserLEtat(carte.id, undefined);
  return carte.id;
}

/**
 * RATTRAPAGE — les fiches nées avant les cartes (Gemini, le 28/09/2026)
 * reçoivent la leur, rattachée à l'agent du tiroir s'il n'en porte pas déjà
 * une : sa conversation devient celle de la carte.
 */
export async function rattraperLesCartesDesMoteurs(): Promise<void> {
  try {
    for (const fiche of listerFiches()) {
      if (fiche.statut === 'retire') continue;
      if (fiche.carteId && store.getCard(fiche.carteId)) continue;
      const retenuId = getMeta(CLE_AGENT);
      const retenu = retenuId ? store.getAgent(retenuId) : null;
      let agentId = retenu && estAgentAjoutDeMoteur(retenu) && !retenu.cardId ? retenu.id : null;
      if (!agentId) {
        const neuf = creerAgentDAjout();
        if (!neuf) return;
        agentId = neuf.id;
      }
      const carteId = await carteDeLAjout(agentId, fiche.label);
      if (!carteId) continue;
      ecrire({ ...fiche, carteId });
      chargerLesMoteursAjoutes(true);
      suivreLaCarteDuMoteur(fiche.id);
      log.info(`moteur ajouté ${fiche.id} : carte ${carteId} posée au tableau`);
    }
  } catch (err: any) {
    log.warn('cartes des moteurs ajoutés non rattrapées', err?.message ?? err);
  }
}

/**
 * L'AGENT DU TIROIR, gardé d'une ouverture à l'autre (`meta` de la base) : la
 * conversation se retrouve tiroir refermé, page rechargée, démon redémarré.
 * `neuf` repart d'un agent vierge — pour étudier un autre fournisseur.
 */
export function agentAjoutDeMoteur(neuf = false): Agent | null {
  const retenuId = neuf ? null : getMeta(CLE_AGENT);
  const retenu = retenuId ? store.getAgent(retenuId) : null;
  if (retenu && estAgentAjoutDeMoteur(retenu)) return retenu;
  const agent = creerAgentDAjout();
  if (agent) setMeta(CLE_AGENT, agent.id);
  return agent;
}

function creerAgentDAjout(): Agent | null {
  const projectId = projetDeLAgent();
  if (!projectId) return null;
  const agent = store.saveAgent({
    ...Agent.parse({
      id: store.newId(),
      projectId,
      role: 'deploy',
      title: 'Ajouter un moteur',
      workdir: atelier(),
      run: { engine: 'claude', thinking: 'none' },
      status: 'idle',
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
    ajoutDeMoteur: true,
  });
  bus.emit({ type: 'agent.upsert', agent });
  return agent;
}
