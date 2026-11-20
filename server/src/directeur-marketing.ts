/**
 * LE DIRECTEUR MARKETING, CÔTÉ DÉMON : un agent de service par compte, sa conversation unique, ses
 * notifications et ses routines.
 *
 * Il hérite des droits de son compte (`interlocuteur.ts`) : un accès tiers n'obtient rien par lui qu'il
 * ne verrait pas à l'écran. Il est porté par un projet (la base l'exige) sans y paraître (`agent.service`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Agent,
  SERVICE_DU_DIRECTEUR,
  TITRE_DU_DIRECTEUR,
  ROUTINES_DU_DIRECTEUR,
  apercuDuMessage,
  blocDeBienvenue,
  contexteDeLaPage,
  decisionDeNotification,
  demandeDeRoutine,
  estDansLaReserve,
  estLaNuit,
  routineAPresent,
  bilanDeLaRonde,
  cleDuRoleDuChef,
  demandeDuPointDeMarque,
  lireRoleDuChef,
  marquesARelancer,
  memoireCommunicationJointe,
  titreDuChef,
  type CompteUtilisateur,
  type FaitDeCommunication,
  type MarqueALaRonde,
  type NiveauDeChef,
  type RoleDuChef,
  type RoutineDuDirecteur,
  LIBELLES_DES_POINTS,
  LIBELLES_DE_STRATEGIE,
  rubriquesManquantes,
  cleDuChefDeCampagne,
  titreProvisoireDeCampagne,
} from '@beluga/shared';
import { bus } from './bus.js';
import { getDb, getMeta, setMeta } from './db.js';
import { noterLInterlocuteur } from './interlocuteur.js';
import { log } from './logger.js';
import * as store from './store.js';

type Compte = Pick<CompteUtilisateur, 'id' | 'role' | 'projets'>;

const cleAgent = (compteId: string) => `communication.directeur.${compteId}`;
const cleCompte = (agentId: string) => `communication.directeur.compte.${agentId}`;
const cleContexte = (agentId: string) => `communication.directeur.contexte.${agentId}`;
const cleReglages = (compteId: string) => `communication.directeur.reglages.${compteId}`;
const cleNotifie = (agentId: string) => `communication.directeur.notifie.${agentId}`;
const cleLu = (agentId: string) => `communication.directeur.lu.${agentId}`;
const cleRoutines = (agentId: string) => `communication.directeur.routines.${agentId}`;
const cleReport = (agentId: string) => `communication.directeur.report.${agentId}`;
const clePointDuJour = (agentId: string) => `communication.directeur.point.${agentId}`;

export function estDirecteur(agent: Pick<Agent, 'service'> | null | undefined): boolean {
  return agent?.service?.id === SERVICE_DU_DIRECTEUR;
}

export function estAgentDirecteur(agentId: string): boolean {
  return estDirecteur(store.getAgent(agentId));
}

/** Le compte à qui appartient ce directeur : lui seul le voit. */
export function compteDuDirecteur(agentId: string): string | null {
  return getMeta(cleCompte(agentId));
}

function projetPorteur(): string {
  const projets = store.listProjects();
  const projet = projets.find((p) => p.isSelf) ?? projets[0];
  if (!projet) throw new Error('aucun projet pour porter le directeur : créez d’abord un projet');
  return projet.id;
}

/** Son atelier : hors de tout dépôt, il ne touche pas au code d'un projet. */
function atelier(compteId: string): string {
  const dossier = path.join(os.homedir(), '.beluga', 'atelier-directeur', compteId.replace(/[^\w-]/g, '_'));
  fs.mkdirSync(dossier, { recursive: true });
  return dossier;
}

/** LE DIRECTEUR DE CE COMPTE, créé à la première ouverture ; il lui écrit alors son mot d'accueil, sans moteur. */
export async function directeurDuCompte(compte: Compte): Promise<Agent> {
  const retenuId = getMeta(cleAgent(compte.id));
  const retenu = retenuId ? store.getAgent(retenuId) : null;
  if (retenu && estDirecteur(retenu)) return retenu;
  const agent = store.saveAgent({
    ...Agent.parse({
      id: store.newId(),
      projectId: projetPorteur(),
      role: 'task',
      title: TITRE_DU_DIRECTEUR,
      workdir: atelier(compte.id),
      run: { engine: 'claude' },
      status: 'idle',
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
    service: { id: SERVICE_DU_DIRECTEUR, nom: 'Communication', adresse: 'communication' },
  });
  setMeta(cleAgent(compte.id), agent.id);
  setMeta(cleCompte(agent.id), compte.id);
  noterLInterlocuteur({ agentId: agent.id }, compte as CompteUtilisateur);
  bus.emit({ type: 'agent.upsert', agent });
  try {
    const { listerLesMarques, lireMedias } = await import('./communication.js');
    const { marques, comptesRelies } = listerLesMarques(compte);
    const notees = marques.map((m) => ({ ...m, medias: lireMedias(m.id, compte).medias.length }));
    const prete = [...notees].sort((a, b) => b.medias + b.accords - (a.medias + a.accords))[0] ?? null;
    poserMessage(agent.id, blocDeBienvenue({ marques: marques.length, comptesRelies, marquePrete: prete ? { id: prete.id, nom: prete.nom, accords: prete.accords, medias: prete.medias } : null }), { sansNotification: true });
  } catch (err) {
    log.warn('directeur : mot d’accueil non posé', err);
  }
  return agent;
}

/* ------------------------------------------------------------------ */
/* Les chefs de marque et de projet (03/11/2026)                        */
/* ------------------------------------------------------------------ */

const cleChefDeMarque = (compteId: string, marqueId: string) => `communication.chef.marque.${compteId}.${marqueId}`;
/** La clé du chef de marque retenu, pour qui lit son état sans le faire naître (Communication 2). */
export const cleChefDeMarqueDuCompte = cleChefDeMarque;
const cleChefDeProjet = (compteId: string, projetId: string) => `communication.chef.projet.${compteId}.${projetId}`;

/** Le rôle d'un chef de marque ou de projet ; `null` pour le chef général (le directeur du compte) ou un autre agent. */
export function roleDuChef(agentId: string): RoleDuChef | null {
  return lireRoleDuChef(getMeta(cleDuRoleDuChef(agentId)));
}

/** La marque de ce compte, si elle lui est ouverte : un chef ne naît que sur une marque visible. */
async function marqueOuverte(compte: Compte, marqueId: string) {
  const { listerLesMarques } = await import('./communication.js');
  const marque = listerLesMarques(compte).marques.find((m) => m.id === marqueId);
  if (!marque) throw new Error('marque introuvable, ou fermée à ce compte');
  return marque;
}

function retenu(cle: string): Agent | null {
  const id = getMeta(cle);
  const agent = id ? store.getAgent(id) : null;
  return agent && estDirecteur(agent) ? agent : null;
}

/** Un chef naît comme le directeur : un agent de service, son atelier, son compte, son mot d'accueil sans moteur. */
function naitreUnChef(compte: Compte, role: RoleDuChef, projetPorteurId: string, nom: string, accueil: string | null): Agent {
  const agent = store.saveAgent({
    ...Agent.parse({
      id: store.newId(),
      /* PORTÉ PAR SON PROJET : sa mémoire (`memoire`, geste « proposer ») s'écrit dans la portée de ce projet. */
      projectId: projetPorteurId,
      role: 'task',
      title: titreDuChef(role.niveau, nom),
      /* Un atelier à lui : deux chefs du même compte ne se partagent pas un dossier de moteur. */
      workdir: atelier(`${compte.id}-${role.niveau}-${role.campagneId ?? role.projetId ?? role.marqueId}`),
      run: { engine: 'claude' },
      status: 'idle',
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
    service: {
      id: SERVICE_DU_DIRECTEUR,
      nom: 'Communication',
      adresse: role.niveau === 'campagne' ? `communication/${role.marqueId}/campagnes/${role.campagneId}` : `communication/${role.marqueId}`,
    },
  });
  setMeta(cleDuRoleDuChef(agent.id), JSON.stringify(role));
  setMeta(cleCompte(agent.id), compte.id);
  noterLInterlocuteur({ agentId: agent.id }, compte as CompteUtilisateur);
  bus.emit({ type: 'agent.upsert', agent });
  if (accueil) poserMessage(agent.id, accueil, { sansNotification: true });
  return agent;
}

/** LE CHEF D'UNE MARQUE, créé à la première ouverture de la marque. */
export async function chefDeMarque(compte: Compte, marqueId: string): Promise<Agent> {
  const deja = retenu(cleChefDeMarque(compte.id, marqueId));
  if (deja) return deja;
  const marque = await marqueOuverte(compte, marqueId);
  const porteur = marque.projets[0]?.id ?? projetPorteur();
  const accueil = '```directeur\n' + JSON.stringify({ etiquette: 'BIENVENUE', titre: `Je m’occupe de ${marque.nom}`, texte: `Je mène la communication de ${marque.nom}${marque.projets.length > 1 ? ` et de ses ${marque.projets.length} projets` : ''} : sa démarche, ses campagnes, et le travail que je confie à chaque chef de projet. Je reviens vers vous quand il y a du neuf.`, actions: [{ libelle: 'Où en est la marque ?', dire: 'Où en est la marque, et que me conseillez-vous ?', principal: true }] }) + '\n```';
  const agent = naitreUnChef(compte, { niveau: 'marque', compteId: compte.id, marqueId }, porteur, marque.nom, accueil);
  setMeta(cleChefDeMarque(compte.id, marqueId), agent.id);
  return agent;
}

/** LE CHEF D'UN PROJET, en coulisse, créé à la première ouverture de son fil ou au premier travail confié. */
export async function chefDeProjet(compte: Compte, marqueId: string, projetId: string): Promise<Agent> {
  const deja = retenu(cleChefDeProjet(compte.id, projetId));
  if (deja) return deja;
  const marque = await marqueOuverte(compte, marqueId);
  const projet = marque.projets.find((p) => p.id === projetId);
  if (!projet) throw new Error('ce projet n’appartient pas à cette marque');
  const accueil = '```directeur\n' + JSON.stringify({ etiquette: 'EN COULISSE', titre: `Je gère la communication de ${projet.nom}`, texte: `Je prépare les médias, les publications, les réponses et les chiffres de ${projet.nom}, pour le chef de ${marque.nom}. Tout ce que je prépare attend votre clic.` }) + '\n```';
  const agent = naitreUnChef(compte, { niveau: 'projet', compteId: compte.id, marqueId, projetId }, projetId, projet.nom, accueil);
  setMeta(cleChefDeProjet(compte.id, projetId), agent.id);
  return agent;
}

/* ------------------------------------------------------------------ */
/* L'agent d'une campagne (10/11/2026)                                  */
/* ------------------------------------------------------------------ */

/**
 * L'AGENT D'UNE CAMPAGNE (décision de l'utilisateur, 10/11/2026) : UNE conversation par campagne, qui est sa page dans
 * Communication. Il naît au premier message d'une campagne neuve (sans mot d'accueil : le message de la personne part
 * aussitôt), ou à la première ouverture d'une campagne plus ancienne — alors avec un mot d'accueil SANS MOTEUR.
 */
export async function chefDeCampagne(compte: Compte, marqueId: string, campagneId: string, options: { accueil?: boolean } = {}): Promise<Agent> {
  const deja = retenu(cleDuChefDeCampagne(campagneId));
  if (deja) return deja;
  const marque = await marqueOuverte(compte, marqueId);
  const campagne = getDb().prepare('SELECT titre FROM communication_campagnes WHERE id = ? AND marque_id = ? AND supprime_le IS NULL').get(campagneId, marqueId) as { titre: string } | undefined;
  if (!campagne) throw new Error('campagne introuvable');
  const porteur = marque.projets[0]?.id ?? projetPorteur();
  const accueil =
    options.accueil === false
      ? null
      : `Je suis l’agent de la campagne **${campagne.titre}**. Je reprends tout ce qui a déjà été décidé — vous le voyez dans le volet de droite.\n\nDites-moi ce que vous voulez changer ou compléter : je vous pose mes questions une à une, avec mon conseil, avant de toucher au programme.`;
  const agent = naitreUnChef(compte, { niveau: 'campagne', compteId: compte.id, marqueId, campagneId }, porteur, campagne.titre, accueil);
  setMeta(cleDuChefDeCampagne(campagneId), agent.id);
  /* SA MÉMOIRE COMMUNICATION : celle des projets de sa marque. */
  noterLesProjetsDuChef(agent.id, marque.projets.map((p) => p.id));
  await relireLaMemoire(agent.id);
  return agent;
}

/** LE CONTEXTE DU MESSAGE D'UN CHEF, campagne comprise : ce que l'écran envoie avec chaque message de la personne. */
export async function contexteDuChefAvecSaCampagne(agent: Pick<Agent, 'id' | 'service' | 'title'>): Promise<string | undefined> {
  const base = contexteDuDirecteur(agent);
  const role = roleDuChef(agent.id);
  if (role?.niveau !== 'campagne' || !role.campagneId) return base;
  const { contexteDeLaCampagnePourSonAgent } = await import('./communication.js');
  return [base, contexteDeLaCampagnePourSonAgent(role.campagneId)].filter(Boolean).join('\n\n') || undefined;
}

/**
 * CRÉER UNE CAMPAGNE PAR SON PREMIER MESSAGE (« Nouvelle campagne » de Communication) : la campagne naît « en
 * préparation » avec un titre provisoire, son agent naît, et le message de la personne lui part aussitôt — une vraie
 * bulle de la conversation, pas un tour silencieux : il pourra poser ses questions.
 */
export async function creerCampagneAvecSonAgent(compte: Compte, marqueId: string, texte: unknown, pieces?: unknown, reseaux?: unknown): Promise<{ campagneId: string; agentId: string }> {
  const message = String(texte ?? '').trim().slice(0, 8000);
  if (!message) throw new Error('Décrivez la campagne que vous voulez mener.');
  /* LES RÉSEAUX SE CHOISISSENT AU DÉBUT DE CHAQUE CAMPAGNE (12/11/2026 : l'étape « Réseaux » a disparu) : l'écran les
     demande avant le premier message, et ils partent avec la campagne — l'agent les lit dans sa fiche. */
  const vises = Array.isArray(reseaux) ? [...new Set(reseaux.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).map((r) => r.trim()))] : [];
  const c = await import('./communication.js');
  const campagne = c.ecrireCampagne({ marqueId, titre: titreProvisoireDeCampagne(message), statut: 'preparation', ...(vises.length ? { reseaux: vises } : {}) }, compte);
  const agent = await chefDeCampagne(compte, marqueId, campagne.id, { accueil: false });
  if (process.env.BELUGA_AGENT_DE_CAMPAGNE_SANS_MOTEUR === '1') {
    /* LES CONTRÔLES (démon jetable) : la bulle de la personne se pose, aucun moteur ne part. */
    const bulle = store.saveMessage({ id: store.newId(), agentId: agent.id, role: 'user', content: message, createdAt: store.now() } as never);
    bus.emit({ type: 'message.upsert', message: bulle });
  } else {
    const { sendPrompt } = await import('./runtime.js');
    const context = await contexteDuChefAvecSaCampagne(agent);
    const attachments = Array.isArray(pieces) ? pieces.filter((x): x is string => typeof x === 'string') : undefined;
    void sendPrompt(agent.id, message, { template: 'none', ...(attachments?.length ? { attachments } : {}), ...(context ? { context } : {}) }).catch((err) =>
      log.error('agent de campagne : premier message non parti', err),
    );
  }
  return { campagneId: campagne.id, agentId: agent.id };
}

/** Le dernier message lisible d'un chef : son aperçu et sa date, pour la liste de l'équipe. */
function dernierMot(agentId: string | null): { texte: string; at: number } | null {
  if (!agentId) return null;
  const dernier = store.listMessages(agentId, 8).filter(estUnMessageDuDirecteur).pop();
  if (!dernier) return null;
  const { titre, corps } = apercuDuMessage(dernier.content);
  return { texte: [titre, corps].filter(Boolean).join(' — ').slice(0, 160), at: dernier.createdAt };
}

const occupe = (a: Agent | null) => !!a && (a.status === 'running' || a.status === 'starting' || !!a.attendReponse);

export interface LigneDeChef {
  niveau: Exclude<NiveauDeChef, 'general'>;
  marqueId: string;
  projetId?: string;
  nom: string;
  agentId: string | null;
  auTravail: boolean;
  attendReponse: boolean;
  dernier: { texte: string; at: number } | null;
}

/** L'ÉQUIPE D'UN COMPTE, lue sans moteur : un chef par marque, ou (avec `marqueId`) un chef par projet de la marque. */
export async function equipeDesChefs(compte: Compte, marqueId?: string): Promise<LigneDeChef[]> {
  const { listerLesMarques } = await import('./communication.js');
  const marques = listerLesMarques(compte).marques;
  const ligne = (niveau: LigneDeChef['niveau'], mId: string, nom: string, agent: Agent | null, projetId?: string): LigneDeChef => ({
    niveau,
    marqueId: mId,
    ...(projetId ? { projetId } : {}),
    nom,
    agentId: agent?.id ?? null,
    auTravail: !!agent && (agent.status === 'running' || agent.status === 'starting'),
    attendReponse: !!agent?.attendReponse,
    dernier: dernierMot(agent?.id ?? null),
  });
  if (!marqueId) return marques.map((m) => ligne('marque', m.id, m.nom, retenu(cleChefDeMarque(compte.id, m.id))));
  const marque = marques.find((m) => m.id === marqueId);
  if (!marque) throw new Error('marque introuvable, ou fermée à ce compte');
  return marque.projets.map((p) => ligne('projet', marque.id, p.nom, retenu(cleChefDeProjet(compte.id, p.id)), p.id));
}

/** UN TRAVAIL CONFIÉ À UN CHEF, par son chef : un tour silencieux, jamais une bulle de l'utilisateur. */
async function confier(cible: Agent, consigne: string, de: string): Promise<void> {
  if (occupe(cible)) throw new Error('ce chef travaille déjà, ou attend une réponse : réessaie plus tard');
  const { sendPrompt } = await import('./runtime.js');
  void sendPrompt(cible.id, `Travail confié par ${de} : ${consigne.trim().slice(0, 1200)}\nPrépare-le, puis dis en un message court ce qui est prêt et ce qui attend une décision.`, {
    template: 'none',
    silent: true,
    context: contexteDuChef(cible, 'le travail confié par ton chef'),
  }).catch((err) => log.warn('chef : travail confié non parti', err));
}

/* ------------------------------------------------------------------ */
/* La mémoire communication jointe                                      */
/* ------------------------------------------------------------------ */

/** Les projets dont un chef lit la mémoire communication : le sien, ceux de sa marque, ou tous ceux du compte. */
function projetsDuChef(agentId: string): string[] {
  const role = roleDuChef(agentId);
  if (role?.niveau === 'projet' && role.projetId) return [role.projetId];
  const lu = getMeta(cleProjetsDuChef(agentId));
  try {
    const ids = JSON.parse(lu ?? '[]');
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string').slice(0, 30) : [];
  } catch {
    return [];
  }
}
const cleProjetsDuChef = (agentId: string) => `communication.chef.projets.${agentId}`;

/** Retient les projets que lit un chef de marque ou le chef général : relus à chaque ouverture de l'espace. */
export function noterLesProjetsDuChef(agentId: string, projets: readonly string[]): void {
  setMeta(cleProjetsDuChef(agentId), JSON.stringify([...new Set(projets)].slice(0, 30)));
}

async function memoireDuChef(agentId: string): Promise<string | undefined> {
  const projets = projetsDuChef(agentId);
  if (!projets.length) return undefined;
  try {
    const { unitesDeLaPortee } = await import('./connaissances.js');
    const faits: FaitDeCommunication[] = projets.flatMap((p) => {
      const nom = store.getProject(p)?.name ?? p;
      return unitesDeLaPortee(p).map((u) => ({ id: u.id, titre: u.titre, resume: u.resume, sujets: u.sujets, importance: u.importance, modifieLe: u.modifieLe, projet: nom }));
    });
    return memoireCommunicationJointe(faits);
  } catch (err) {
    log.debug('chef : mémoire communication non lue', err);
    return undefined;
  }
}

/** Ce que chaque message d'un chef emporte : qui il est, la page ouverte, et sa mémoire communication. */
function contexteDuChef(agent: Pick<Agent, 'id' | 'title'>, page?: string): string | undefined {
  const role = roleDuChef(agent.id);
  const qui = role ? `Tu es : ${agent.title}.` : undefined;
  const memoire = memoiresEnCache.get(agent.id);
  return [qui, contexteDeLaPage(page ?? getMeta(cleContexte(agent.id))), memoire].filter(Boolean).join('\n\n') || undefined;
}

/* La mémoire se lit en base (asynchrone) : relue à chaque contexte posé, gardée pour le message qui suit. */
const memoiresEnCache = new Map<string, string | undefined>();
async function relireLaMemoire(agentId: string): Promise<void> {
  memoiresEnCache.set(agentId, await memoireDuChef(agentId));
}

/** Écrit un message du directeur sans passer par le moteur : un fait, jamais un avis. */
function poserMessage(agentId: string, contenu: string, options: { sansNotification?: boolean } = {}): void {
  const message = store.saveMessage({ id: store.newId(), agentId, role: 'assistant', content: contenu, createdAt: store.now() } as never);
  bus.emit({ type: 'message.upsert', message });
  if (options.sansNotification) setMeta(cleNotifie(agentId), message.id);
  else void notifierDuMessage(agentId);
}

/* ------------------------------------------------------------------ */
/* Le contexte de la page                                               */
/* ------------------------------------------------------------------ */

/** La page ouverte, posée par l'écran : elle accompagne le prochain message, sans jamais devenir une bulle. */
export function poserLeContexte(agentId: string, contexte: unknown): void {
  setMeta(cleContexte(agentId), String(contexte ?? '').slice(0, 400));
  void relireLaMemoire(agentId);
}

/** LE CONTEXTE DU MESSAGE D'UN CHEF : la page ouverte, son rôle et sa mémoire communication — jamais une bulle. */
export function contexteDuDirecteur(agent: Pick<Agent, 'id' | 'service' | 'title'>): string | undefined {
  if (!estDirecteur(agent)) return undefined;
  return contexteDuChef(agent);
}

/* ------------------------------------------------------------------ */
/* Les réglages et les non-lus                                          */
/* ------------------------------------------------------------------ */

export interface ReglagesDuDirecteur {
  sourdine: boolean;
  routines: boolean;
}

export function lireReglages(compteId: string): ReglagesDuDirecteur {
  try {
    return { sourdine: false, routines: true, ...(JSON.parse(getMeta(cleReglages(compteId)) ?? '{}') as Partial<ReglagesDuDirecteur>) };
  } catch {
    return { sourdine: false, routines: true };
  }
}

export function ecrireReglages(compteId: string, recu: Partial<ReglagesDuDirecteur>): ReglagesDuDirecteur {
  const suite = { ...lireReglages(compteId), ...(typeof recu.sourdine === 'boolean' ? { sourdine: recu.sourdine } : {}), ...(typeof recu.routines === 'boolean' ? { routines: recu.routines } : {}) };
  setMeta(cleReglages(compteId), JSON.stringify(suite));
  return suite;
}

const estUnMessageDuDirecteur = (m: { role: string; content?: string; streaming?: boolean }) => m.role === 'assistant' && !!m.content?.trim() && !m.streaming && !/^\s*RIEN À SIGNALER\.?\s*$/i.test(m.content ?? '');

export function nonLusDuCompte(compteId: string): number {
  const agentId = getMeta(cleAgent(compteId));
  if (!agentId) return 0;
  const lu = Number(getMeta(cleLu(agentId)) ?? 0);
  return store.listMessages(agentId, 100).filter((m) => estUnMessageDuDirecteur(m) && m.createdAt > lu).length;
}

export function marquerLu(compteId: string, maintenant = Date.now(), chefId?: string): void {
  /* Un chef de marque ou de projet se lit aussi : seulement s'il appartient à ce compte. */
  const agentId = chefId && compteDuDirecteur(chefId) === compteId ? chefId : getMeta(cleAgent(compteId));
  if (!agentId) return;
  setMeta(cleLu(agentId), String(maintenant));
  bus.emit({ type: 'communication.nonLus', pour: compteId, nonLus: 0 });
}

/* ------------------------------------------------------------------ */
/* Chaque message fait sonner le téléphone                              */
/* ------------------------------------------------------------------ */

async function envoyer(compteId: string, titre: string, corps: string, adresse = 'communication'): Promise<void> {
  const { sendPush } = await import('./push.js');
  /* Une étiquette par marque : la notification d'une marque remplace la précédente, sans écraser celle d'une autre. */
  await sendPush({ title: titre, body: corps, tag: adresse === 'communication' ? 'directeur-marketing' : `directeur-${adresse}`, motif: 'directeur', url: `/#${adresse}` }, compteId);
}

async function notifierDuMessage(agentId: string, maintenant = new Date()): Promise<void> {
  const compteId = compteDuDirecteur(agentId);
  const agent = store.getAgent(agentId);
  if (!compteId || !agent) return;
  const dernier = store.listMessages(agentId, 5).filter(estUnMessageDuDirecteur).pop();
  if (!dernier || getMeta(cleNotifie(agentId)) === dernier.id) return;
  setMeta(cleNotifie(agentId), dernier.id);
  /* PAS DE RAFALE (03/11/2026) : un chef de projet travaille en coulisse et ne sonne jamais, sauf s'il pose une
     question ; un chef de marque sonne pour sa marque — un résumé par marque, jamais un message par agent. */
  const role = roleDuChef(agentId);
  if ((role?.niveau === 'projet' || role?.niveau === 'campagne') && !agent.attendReponse) return;
  bus.emit({ type: 'communication.nonLus', pour: compteId, nonLus: nonLusDuCompte(compteId) });
  const decision = decisionDeNotification({ sourdine: lireReglages(compteId).sourdine, heure: maintenant.getHours(), questionPosee: !!agent.attendReponse });
  const apercu = apercuDuMessage(dernier.content);
  const titre = role ? `${agent.title} · ${apercu.titre}` : apercu.titre;
  const corps = apercu.corps;
  const adresse = role?.niveau === 'campagne' ? `communication/${role.marqueId}/campagnes/${role.campagneId}` : role ? `communication/${role.marqueId}` : undefined;
  if (decision === 'envoyer') await envoyer(compteId, titre, corps, adresse);
  else if (decision === 'reporter') {
    const attente = lireReport(agentId);
    attente.push(titre);
    setMeta(cleReport(agentId), JSON.stringify(attente.slice(-20)));
  }
}

function lireReport(agentId: string): string[] {
  try {
    const lu = JSON.parse(getMeta(cleReport(agentId)) ?? '[]');
    return Array.isArray(lu) ? lu : [];
  } catch {
    return [];
  }
}

/** Au réveil, ce qui est arrivé la nuit part en une seule notification. */
async function viderLesReports(maintenant = new Date()): Promise<void> {
  if (estLaNuit(maintenant.getHours())) return;
  for (const agent of lesDirecteurs()) {
    const attente = lireReport(agent.id);
    if (!attente.length) continue;
    setMeta(cleReport(agent.id), '[]');
    const compteId = compteDuDirecteur(agent.id);
    if (!compteId || lireReglages(compteId).sourdine) continue;
    await envoyer(compteId, attente.length > 1 ? `${attente.length} messages de votre directeur` : attente[0]!, attente.slice(0, 3).join(' · ')).catch((err) => log.debug('directeur : notification du réveil refusée', err));
  }
}

function lesDirecteurs(): Agent[] {
  const lignes = getDb().prepare("SELECT value FROM meta WHERE key LIKE 'communication.directeur.compte.%'").all() as { value: string }[];
  /* LES CHEFS DE MARQUE ET DE PROJET notent aussi leur compte : un compte ne compte qu'un chef général. */
  const agents = new Map<string, Agent>();
  for (const { value } of lignes) {
    const id = getMeta(cleAgent(value));
    const agent = id ? store.getAgent(id) : null;
    if (agent && estDirecteur(agent)) agents.set(agent.id, agent);
  }
  return [...agents.values()];
}

/* ------------------------------------------------------------------ */
/* Les routines                                                         */
/* ------------------------------------------------------------------ */

const lundi = (d: Date) => {
  const copie = new Date(d);
  copie.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${copie.getFullYear()}-${copie.getMonth() + 1}-${copie.getDate()}`;
};

function lireRoutines(agentId: string): Record<string, string> {
  try {
    return JSON.parse(getMeta(cleRoutines(agentId)) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * CE QUI A BOUGÉ DEPUIS LE DERNIER POINT DU JOUR, par marque, lu en base sans moteur : les cartes livrées,
 * les publications parties, les messages reçus, les visites des dernières 24 h face aux 24 h d'avant.
 * Rend le compte et une phrase courte, jointe à la demande du point du jour.
 */
/** CE QUI A BOUGÉ SUR UN GROUPE DE PROJETS (une marque, ou un seul projet), en faits courts. */
async function faitsDesProjets(ids: string[], depuis: number, maintenant: number): Promise<string[]> {
  if (!ids.length) return [];
  const { visitesParJour } = await import('./communication.js');
  const db = getDb();
  const marques_ = ids.map(() => '?').join(',');
  const livrees = ids.flatMap((p) => store.listCards(p)).filter((c) => c.column !== 'planned' && c.column !== 'running' && c.updatedAt > depuis).length;
  const parties = (db.prepare(`SELECT COUNT(*) AS n FROM marketing_publications p JOIN marketing_contenus c ON c.id = p.contenu_id WHERE c.project_id IN (${marques_}) AND p.etat = 'publie' AND p.publie_le > ?`).get(...ids, depuis) as { n: number }).n;
  const recus = (db.prepare(`SELECT COUNT(*) AS n FROM marketing_messages WHERE project_id IN (${marques_}) AND sortant = 0 AND instant > ?`).get(...ids, depuis) as { n: number }).n;
  const somme = (de: number, a: number) => [...visitesParJour(ids, de, a).values()].reduce((x, y) => x + y, 0);
  const jour = 24 * 3600_000;
  const visites = somme(maintenant - jour, maintenant);
  const avant = somme(maintenant - 2 * jour, maintenant - jour);
  const visitesBougent = Math.max(visites, avant) >= 10 && Math.abs(visites - avant) >= Math.max(5, avant * 0.2);
  return [
    livrees ? `${livrees} carte(s) livrée(s)` : '',
    parties ? `${parties} publication(s) partie(s)` : '',
    recus ? `${recus} message(s) ou commentaire(s) reçu(s)` : '',
    visitesBougent ? `visites du site ${visites} sur 24 h contre ${avant} la veille` : '',
  ].filter(Boolean);
}

/**
 * CE QUI A BOUGÉ DEPUIS LE DERNIER POINT DU JOUR, par marque et par projet, lu en base sans moteur : les cartes
 * livrées, les publications parties, les messages reçus, les visites des dernières 24 h face aux 24 h d'avant.
 */
async function nouveautesParMarque(marques: { id: string; nom: string; etape: unknown; projets: { id: string; nom: string }[] }[], depuis: number, maintenant: number): Promise<MarqueALaRonde[]> {
  const sortie: MarqueALaRonde[] = [];
  for (const m of marques) {
    const ids = m.projets.map((p) => p.id);
    if (!ids.length) continue;
    const faits = await faitsDesProjets(ids, depuis, maintenant);
    const projets = ids.length > 1 ? await Promise.all(m.projets.map(async (p) => ({ projetId: p.id, nom: p.nom, faits: await faitsDesProjets([p.id], depuis, maintenant) }))) : [{ projetId: m.projets[0]!.id, nom: m.projets[0]!.nom, faits }];
    sortie.push({ marqueId: m.id, nom: m.nom, faits, demarcheEnCours: m.etape !== null && m.etape !== undefined, projets });
  }
  return sortie;
}

/** Le résumé de toutes les marques : le compte et une phrase courte, jointe à la demande du point du jour. */
function resumeDesNouveautes(parMarque: readonly MarqueALaRonde[]): { nombre: number; apercu: string } {
  const avec = parMarque.filter((m) => m.faits.length);
  return { nombre: avec.reduce((n, m) => n + m.faits.length, 0), apercu: avec.slice(0, 6).map((m) => `${m.nom} : ${m.faits.join(', ')}`).join(' ; ') };
}

/** Ce qui décide si une routine a de quoi agir, pour ce compte. Tout se lit en base : rien ne part au moteur ici. */
async function situation(compte: Compte, maintenant: Date, depuisLePoint = maintenant.getTime() - 24 * 3600_000) {
  const { listerLesMarques, contenusAVenir } = await import('./communication.js');
  const { listerMessages } = await import('./publication-sociale.js');
  const { marques, comptesRelies } = listerLesMarques(compte);
  const ids = marques.flatMap((m) => m.projets.map((p) => p.id));
  const messages = ids.flatMap((p) => listerMessages(p));
  const sansBrouillon = messages.filter((m) => !m.sortant && !m.brouillon && !m.lu && !messages.some((r) => r.sortant && r.fil === m.fil && r.instant > m.instant)).length;
  const lignes = getDb()
    .prepare(`SELECT source_ref, sorti_de_reserve_le, etape FROM marketing_contenus WHERE project_id IN (${ids.map(() => '?').join(',') || "''"})`)
    .all(...ids) as { source_ref: string | null; sorti_de_reserve_le: number | null; etape: string }[];
  const reserve = lignes.filter((l) => estDansLaReserve({ sourceRef: l.source_ref, sortiDeReserveLe: l.sorti_de_reserve_le, etape: l.etape })).length;
  const rapports = ids.filter((p) => getDb().prepare('SELECT 1 FROM marketing_espaces WHERE project_id = ? AND rapport IS NOT NULL').get(p)).length;
  const parMarque = await nouveautesParMarque(marques, depuisLePoint, maintenant.getTime());
  const nouveautes = resumeDesNouveautes(parMarque);
  return {
    parMarque,
    nouveautes: nouveautes.nombre,
    apercuDesNouveautes: nouveautes.apercu,
    demarchesEnCours: marques.filter((m) => m.etape !== null).length,
    jourDeLaSemaine: (maintenant.getDay() + 6) % 7,
    heure: maintenant.getHours(),
    marques: marques.length,
    comptesRelies,
    messagesSansBrouillon: sansBrouillon,
    creneauxVides: contenusAVenir(ids, 7) < 3 ? 1 : 0,
    reserve,
    rapports,
  };
}

/** LE TOUR DES ROUTINES : une seule à la fois par directeur, jamais s'il travaille, s'il attend une réponse, ou la nuit. */
export async function tourDesRoutines(maintenant = new Date()): Promise<RoutineDuDirecteur[]> {
  const lancees: RoutineDuDirecteur[] = [];
  await viderLesReports(maintenant);
  const { compteParId } = await import('./comptes.js');
  for (const agent of lesDirecteurs()) {
    const compteId = compteDuDirecteur(agent.id);
    const compte = compteId ? compteParId(compteId) : null;
    if (!compte || !compte.actif || !lireReglages(compte.id).routines) continue;
    if (agent.status === 'running' || agent.status === 'starting' || agent.attendReponse) continue;
    const deja = lireRoutines(agent.id);
    const cles = { semaine: lundi(maintenant), jour: `${maintenant.getFullYear()}-${maintenant.getMonth() + 1}-${maintenant.getDate()}` };
    const dernierPoint = Number(getMeta(clePointDuJour(agent.id)) ?? 0);
    const etat = await situation(compte, maintenant, Math.max(dernierPoint, maintenant.getTime() - 3 * 24 * 3600_000));
    const routine = routineAPresent(etat, deja, cles);
    if (!routine) continue;
    /* L'ÉTAT ANTI-DOUBLON S'ÉCRIT AVANT LE DÉPART : une panne n'en fait pas partir une seconde. Une routine de fond
     * (hors réponses) note aussi le jour (`passage`) : le point du jour ne la double pas le même jour. */
    setMeta(cleRoutines(agent.id), JSON.stringify({ ...deja, [routine]: routine === 'reponses' || routine === 'journee' ? cles.jour : cles.semaine, ...(routine === 'reponses' ? {} : { passage: cles.jour }) }));
    if (routine === 'journee') setMeta(clePointDuJour(agent.id), String(maintenant.getTime()));
    /* LE POINT DU JOUR DESCEND EN CASCADE (03/11/2026) : le chef général relance les chefs de marque qui ont du neuf,
       chacun confie à ses chefs de projet ce qui demande un travail. Le général ne repasse pas par le moteur : son
       mot dit, sans rien coûter, qui il a relancé. Sans aucun chef à relancer, il fait lui-même son point. */
    if (routine === 'journee') {
      const relancees = await rondeEnCascade(compte, etat.parMarque);
      if (relancees.length) {
        const mot = bilanDeLaRonde(relancees);
        if (mot) poserMessage(agent.id, mot, { sansNotification: true });
        lancees.push(routine);
        continue;
      }
    }
    const { sendPrompt } = await import('./runtime.js');
    void sendPrompt(agent.id, demandeDeRoutine(routine, routine === 'journee' ? etat.apercuDesNouveautes : undefined), { template: 'none', silent: true, context: contexteDeLaPage('la routine du directeur') }).catch((err) => log.warn(`directeur : routine ${routine} non partie`, err?.message ?? err));
    lancees.push(routine);
  }
  return lancees;
}


/**
 * LA RONDE EN CASCADE : réveille les chefs de marque retenus par `marquesARelancer` (du neuf ou une démarche, pas
 * déjà au travail, plafond), d'un tour silencieux chacun. Les chefs naissent à la demande. Rend les marques relancées.
 */
async function rondeEnCascade(compte: Compte, parMarque: readonly MarqueALaRonde[]): Promise<MarqueALaRonde[]> {
  const notees = parMarque.map((m) => ({ ...m, chefOccupe: occupe(retenu(cleChefDeMarque(compte.id, m.marqueId))) }));
  const retenues = marquesARelancer(notees);
  if (!retenues.length) return [];
  const { sendPrompt } = await import('./runtime.js');
  const parties: MarqueALaRonde[] = [];
  for (const m of retenues) {
    try {
      const chef = await chefDeMarque(compte, m.marqueId);
      noterLesProjetsDuChef(chef.id, (m.projets ?? []).map((p) => p.projetId));
      await relireLaMemoire(chef.id);
      void sendPrompt(chef.id, demandeDuPointDeMarque(m), { template: 'none', silent: true, context: contexteDuChef(chef, 'la routine du chef de marque') }).catch((err) => log.warn(`chef de ${m.nom} : point du jour non parti`, err));
      parties.push(m);
    } catch (err) {
      log.warn(`chef de ${m.nom} : non relancé`, err);
    }
  }
  return parties;
}

/* ------------------------------------------------------------------ */
/* Le démarrage                                                         */
/* ------------------------------------------------------------------ */

const INTERVALLE_ROUTINES_MS = 15 * 60_000;

export function demarrerLeDirecteur(): NodeJS.Timeout {
  /* CHAQUE MESSAGE RENDU FAIT SONNER LE TÉLÉPHONE : à la fin du tour, jamais pendant qu'il s'écrit. */
  bus.subscribe((event) => {
    if (event.type !== 'agent.upsert' || !estDirecteur(event.agent)) return;
    if (event.agent.status === 'running' || event.agent.status === 'starting') return;
    void notifierDuMessage(event.agent.id).catch((err) => log.debug('directeur : notification non partie', err));
  });
  const minuteur = setInterval(() => {
    void tourDesRoutines().catch((err) => log.warn('directeur : tour des routines en échec', err));
  }, INTERVALLE_ROUTINES_MS);
  minuteur.unref?.();
  return minuteur;
}

/* ------------------------------------------------------------------ */
/* L'outil                                                              */
/* ------------------------------------------------------------------ */

export const OUTIL_COMMUNICATION = {
  name: 'communication',
  description: [
    "LES CHEFS (trois niveaux : général, marque, projet) : chefs (sans « marque » : un chef par marque, sa dernière parole ; avec « marque » : un chef par projet) ; confier (« marque », « projet » facultatif, « consigne » : réveille ce chef d'un tour silencieux pour qu'il prépare ce travail — le général confie à un chef de marque, un chef de marque à ses chefs de projet).",
    "L'ESPACE COMMUNICATION, réservé au directeur marketing, avec les droits de la personne qui lui parle. « action » : marques (la liste, avec l'étape de sa démarche, ce qui attend, projets) ; etat (« marque » : sa démarche — compte relié, analyse, objectifs, campagnes —, ses chiffres sur 30 jours, ce qui attend, ses publications récentes) ; objectifs (« marque » : ses objectifs, ce qu'ils ont atteint, leurs campagnes) ; objectif (« marque », « id » facultatif pour modifier, « titre », « mesure » visites|clics|vues|abonnes|publications, « cible » nombre, « echeance » AAAA-MM-JJ, « pourquoi » une phrase sur la rentabilité, « statut » propose|actif|atteint|abandonne — un objectif neuf est PROPOSÉ, la personne le retient d'un clic, bouton geste « objectif.valider ») ; medias (« marque » : ses médias, avec l'identifiant de pièce à citer dans un bloc) ; reserve (« marque » : les annonces en réserve) ; sortir_reserve (« id » : fait entrer une annonce dans le circuit, à valider) ; campagnes (« marque ») ; campagne (« marque », « id » facultatif pour modifier, « titre », « objectifId » (l'objectif de la marque qu'elle sert), « objectif », et LES HUIT POINTS DE SA FICHE : « typesMedias » (video|image|carrousel|texte|story|article), « quantiteMedias » + « rythme », « public » (qui on veut toucher), « reseaux », « debut » + « fin » AAAA-MM-JJ, « objectifChiffre » + « mesure » visites|clics|vues, « message » + « ton », « appelAction » ; « strategie » : un objet dont chaque clé est une rubrique de la stratégie (idee, parcours, angles, concurrence, preuves, budget, indicateurs) et chaque valeur un texte Markdown court — une rubrique donnée remplace l'ancienne ; « statut » preparation|en_cours|terminee — rend les points et les rubriques encore manquants) ; esquisse (AGENT D'UNE CAMPAGNE seulement, « consigne » : la description de l'image — dessine gratuitement l'idée de la campagne dans ta discussion, sans attendre ; la dernière devient l'image de la campagne et ne va jamais dans Médias) ; contenu_campagne (« id » du contenu, « campagne », « declinaisonDe » facultatif : l'id de la publication dont celle-ci est la version pour un AUTRE réseau — même post, même jour ; sans lui, la version d'un même titre le même jour est reconnue seule) ; lier_media (« id » du contenu, « piece » ; pour un CARROUSEL, « pieces » : TOUTES ses images, dans l'ordre — une seule n'en ferait qu'une image ; une nouvelle version d'un visuel déjà lié le remplace, à sa place) — ces deux-là sont REFUSÉS tant que la fiche de la campagne n'a pas ses huit points ; regroupements (les regroupements de projets à proposer). Aucune de ces actions ne dépense, ne publie ni ne répond.",
  ].join(' '),
  inputSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: [
          'marques', 'etat', 'medias', 'reserve', 'sortir_reserve', 'objectifs', 'objectif', 'campagnes', 'campagne', 'esquisse', 'contenu_campagne', 'lier_media', 'regroupements', 'chefs', 'confier',
        ],
      },
      marque: { type: 'string', description: 'Le nom ou l’identifiant de la marque' },
      projet: { type: 'string', description: 'Le nom ou l’identifiant d’un projet de la marque (action « confier » à un chef de projet)' },
      consigne: { type: 'string', description: 'Ce que le chef doit préparer (action « confier ») ; l’image à dessiner (action « esquisse »)' },
      id: { type: 'string' },
      campagne: { type: 'string' },
      piece: { type: 'string' },
      declinaisonDe: { type: 'string', description: 'L’id de la publication dont celle-ci est la version pour un autre réseau (action « contenu_campagne »)' },
      pieces: { type: 'array', items: { type: 'string' }, description: 'Les images d’un carrousel, dans l’ordre (action « lier_media »)' },
      titre: { type: 'string' },
      objectif: { type: 'string' },
      objectifId: { type: 'string' },
      objectifChiffre: { type: 'number' },
      cible: { type: 'number', description: 'Le nombre visé par un OBJECTIF (action « objectif »)' },
      public: { type: 'string', description: 'La cible d’une CAMPAGNE : qui on veut toucher (action « campagne »)' },
      echeance: { type: 'string' },
      pourquoi: { type: 'string' },
      mesure: { type: 'string', enum: ['visites', 'clics', 'vues', 'abonnes', 'publications'] },
      reseaux: { type: 'array', items: { type: 'string' } },
      debut: { type: 'string' },
      fin: { type: 'string' },
      typesMedias: { type: 'array', items: { type: 'string' }, description: 'Les genres de médias de la campagne : video, image, carrousel, texte, story, article' },
      quantiteMedias: { type: 'number', description: 'Combien de médias en tout' },
      rythme: { type: 'string', description: 'Le rythme de publication, ex. « 2 par semaine »' },
      message: { type: 'string', description: 'Le message clé de la campagne' },
      ton: { type: 'string', description: 'Le ton : complice, expert, chaleureux…' },
      appelAction: { type: 'string', description: 'L’appel à l’action : ce que la cible doit faire' },
      strategie: {
        type: 'object',
        description: 'La stratégie de la campagne, par rubrique (texte Markdown court chacune) : idee, parcours, angles, concurrence, preuves, budget, indicateurs',
        properties: Object.fromEntries(Object.entries(LIBELLES_DE_STRATEGIE).map(([cle, libelle]) => [cle, { type: 'string', description: libelle }])),
      },
      statut: { type: 'string', enum: ['preparation', 'en_cours', 'terminee', 'propose', 'actif', 'atteint', 'abandonne'] },
    },
  },
} as const;

/** L'outil « communication ». Le compte retenu borne tout : c'est celui du directeur, jamais un compte choisi par l'agent. */
export async function outilCommunication(ctx: { agentId: string }, args: Record<string, any>): Promise<{ ok: boolean; text: string }> {
  const c = await import('./communication.js');
  const { compteParId } = await import('./comptes.js');
  const compteId = compteDuDirecteur(ctx.agentId);
  const compte = compteId ? compteParId(compteId) : null;
  if (!compte) return { ok: false, text: 'Cet outil est réservé au directeur marketing d’un compte.' };
  const action = String(args.action ?? '');
  /* UN CHEF DE MARQUE OU DE PROJET RESTE DANS SA MARQUE : sans nom, c'est la sienne ; une autre lui est refusée. */
  const role = roleDuChef(ctx.agentId);
  const trouverMarque = () => {
    const voulu = String(args.marque ?? role?.marqueId ?? '').trim().toLowerCase();
    const liste = c.listerLesMarques(compte).marques.filter((m) => !role || m.id === role.marqueId);
    return liste.find((m) => m.id === voulu) ?? liste.find((m) => m.nom.toLowerCase() === voulu) ?? liste.find((m) => m.nom.toLowerCase().includes(voulu) && voulu) ?? null;
  };
  try {
    switch (action) {
      case 'marques': {
        const { marques, propositions, comptesRelies } = c.listerLesMarques(compte);
        return {
          ok: true,
          text: JSON.stringify({ comptesRelies, marques: marques.map((m) => ({ id: m.id, nom: m.nom, etapeEnCours: m.etape, avancementDeLaDemarche: m.avancement, aValider: m.accords, messagesNonLus: m.messages, projets: m.projets.map((p) => p.nom) })), regroupementsAProposer: propositions }),
        };
      }
      case 'etat': {
        const m = trouverMarque();
        if (!m) return { ok: false, text: 'Dis quelle marque : « marque », son nom.' };
        const a = await c.lireAccueil(m.id, compte, 30);
        return {
          ok: true,
          text: JSON.stringify({
            demarche: a.demarche,
            objectifsRetenus: a.objectifs,
            objectifsProposes: a.objectifsProposes,
            chiffres30Jours: a.tuiles,
            comptesRelies: a.comptesRelies,
            aUnBilan: a.aUnBilan,
            aValider: a.attente.map((x) => ({ id: x.id, titre: x.titre, canal: x.canal, date: x.datePrevue, apercu: x.apercu?.attachmentId ?? null })),
            mediasManquants: a.manquants,
            dernieresPublications: a.publications.map((p) => ({ id: p.id, titre: p.titre, canal: p.canal, chiffres: p.chiffres })),
          }),
        };
      }
      case 'medias': {
        const m = trouverMarque();
        if (!m) return { ok: false, text: 'Dis quelle marque : « marque », son nom.' };
        const lus = c.lireMedias(m.id, compte);
        return {
          ok: true,
          text: JSON.stringify({ totaux: lus.totaux, manquants: lus.manquants, medias: lus.medias.slice(0, 60).map((x) => ({ cle: x.cle, nom: x.nom, genre: x.genre, piece: x.afficheId ?? x.attachmentId, etat: x.etat, version: x.numeroDeVersion, format: x.format })) }),
        };
      }
      case 'reserve': {
        const m = trouverMarque();
        if (!m) return { ok: false, text: 'Dis quelle marque : « marque », son nom.' };
        return { ok: true, text: JSON.stringify(c.lireReserve(m.id, compte).contenus.slice(0, 30).map((x) => ({ id: x.id, titre: x.titre, texte: x.texte.slice(0, 300) }))) };
      }
      case 'sortir_reserve':
        c.sortirDeLaReserve(args.id, compte);
        return { ok: true, text: 'L’annonce entre dans le circuit, à valider par la personne.' };
      case 'objectifs': {
        const m = trouverMarque();
        if (!m) return { ok: false, text: 'Dis quelle marque : « marque », son nom.' };
        return { ok: true, text: JSON.stringify(c.lireObjectifs(m.id, compte)) };
      }
      case 'objectif': {
        const m = trouverMarque();
        if (!m) return { ok: false, text: 'Dis quelle marque : « marque », son nom.' };
        /* LE STATUT D'UN OBJECTIF SE DIT PAR « statut » ; un statut de campagne n'a rien à faire ici. */
        const statut = ['propose', 'actif', 'atteint', 'abandonne'].includes(String(args.statut)) ? args.statut : undefined;
        const ecrit = c.ecrireObjectif({ ...args, statut, marqueId: m.id }, compte);
        return { ok: true, text: `Objectif enregistré : ${ecrit.id} (${ecrit.statut}).${ecrit.statut === 'propose' ? ` Propose-le dans un bloc avec le bouton geste « objectif.valider », id « ${ecrit.id} » : la personne le retient d'un clic.` : ''}` };
      }
      case 'campagnes': {
        const m = trouverMarque();
        if (!m) return { ok: false, text: 'Dis quelle marque : « marque », son nom.' };
        return { ok: true, text: JSON.stringify(c.lireCampagnes(m.id, compte).campagnes) };
      }
      case 'campagne': {
        const m = trouverMarque();
        if (!m) return { ok: false, text: 'Dis quelle marque : « marque », son nom.' };
        const statut = ['preparation', 'en_cours', 'terminee'].includes(String(args.statut)) ? args.statut : undefined;
        /* L'AGENT D'UNE CAMPAGNE n'écrit que SA campagne : son « id » est le sien, quoi qu'il passe. */
        const id = role?.niveau === 'campagne' ? role.campagneId : args.id;
        /* « cible » est un NOMBRE pour un objectif : la cible d'une campagne (qui toucher) passe par « public ». */
        const ecrite = c.ecrireCampagne({ ...args, id, cible: args.public ?? (typeof args.cible === 'string' ? args.cible : undefined), statut, marqueId: m.id }, compte);
        const { manquants, verrouillee } = c.etatDeLaFiche(ecrite);
        const strategieExigee = c.campagneMeneeParSonAgent(ecrite.id);
        const rubriques = strategieExigee ? rubriquesManquantes(ecrite.strategie) : [];
        const suite = manquants.length
          ? ` Points encore à trancher, dans l'ordre : ${manquants.map((p) => LIBELLES_DES_POINTS[p].toLowerCase()).join(', ')}${rubriques.length ? ` ; puis la stratégie : ${rubriques.map((r) => LIBELLES_DE_STRATEGIE[r].toLowerCase()).join(', ')}` : ''}. Pose le suivant avec ask_user, ton conseil en premier « (recommandé) » — rien ne se prépare avant.`
          : rubriques.length
            ? ` La fiche a ses huit points. Rubriques de la stratégie encore à trancher, dans l'ordre : ${rubriques.map((r) => `${r} (${LIBELLES_DE_STRATEGIE[r].toLowerCase()})`).join(', ')}. Pose la suivante avec ask_user, ton conseil en premier « (recommandé) » — aucune publication avant.`
            : verrouillee
              ? ' La fiche est complète et figée : la fabrication des médias a commencé.'
              : strategieExigee
                ? ' La fiche et la stratégie sont complètes : tu peux préparer le programme.'
                : ' La fiche est complète : tu peux préparer ses contenus.';
        return { ok: true, text: `Campagne enregistrée : ${ecrite.id}. Ouvre-la avec le chemin « ${m.id}/campagnes/${ecrite.id} ».${suite}` };
      }
      case 'esquisse': {
        /* L'ESQUISSE (10/11/2026) : réservée à l'agent d'une campagne, pour SA campagne ; gratuite, et sans attendre. */
        if (role?.niveau !== 'campagne' || !role.campagneId) return { ok: false, text: 'L’esquisse est réservée à l’agent d’une campagne, pendant sa conception.' };
        const ligne = getDb().prepare('SELECT titre FROM communication_campagnes WHERE id = ? AND supprime_le IS NULL').get(role.campagneId) as { titre: string } | undefined;
        if (!ligne) return { ok: false, text: 'Ta campagne est introuvable ou à la corbeille : aucune esquisse.' };
        const { dessinerUneEsquisse } = await import('./esquisses-de-campagne.js');
        return dessinerUneEsquisse({ agentId: ctx.agentId, campagneId: role.campagneId, titreDeCampagne: ligne.titre, consigne: String(args.consigne ?? '') });
      }
      case 'contenu_campagne': {
        const refus = c.refusTantQueLaFicheManque(args.campagne);
        if (refus) return { ok: false, text: refus };
        c.rattacherContenuACampagne(args.id, args.campagne, compte, args.declinaisonDe);
        return { ok: true, text: args.declinaisonDe ? 'Publication rattachée à la campagne, comme déclinaison de ' + String(args.declinaisonDe) + ' : la médiathèque les montre en une vignette.' : 'Publication rattachée à la campagne.' };
      }
      case 'lier_media': {
        const refus = c.refusTantQueLaFicheManque(c.campagneDuContenu(args.id));
        if (refus) return { ok: false, text: refus };
        const pieces = Array.isArray(args.pieces) && args.pieces.length ? args.pieces : args.piece;
        c.lierMediaAuContenu(args.id, pieces, compte);
        return {
          ok: true,
          text: Array.isArray(pieces) && pieces.length > 1 ? `${pieces.length} visuels liés à la publication, dans cet ordre : c’est son carrousel.` : 'Média lié à la publication : c’est son aperçu désormais. Une nouvelle version d’un visuel déjà lié l’a remplacé.',
        };
      }
      case 'regroupements':
        return { ok: true, text: JSON.stringify(c.propositionsDeRegroupement(compte)) };
      case 'chefs': {
        const m = args.marque || role ? trouverMarque() : null;
        if ((args.marque || role) && !m) return { ok: false, text: 'Marque introuvable.' };
        const equipe = await equipeDesChefs(compte, m?.id);
        return { ok: true, text: JSON.stringify(equipe.map((x) => ({ niveau: x.niveau, nom: x.nom, marque: x.marqueId, projet: x.projetId ?? null, existe: !!x.agentId, auTravail: x.auTravail, attendUneReponse: x.attendReponse, derniereParole: x.dernier?.texte ?? null }))) };
      }
      case 'confier': {
        if (role?.niveau === 'projet') return { ok: false, text: 'Un chef de projet ne confie rien : il prépare lui-même, puis le dit à son chef de marque.' };
        if (role?.niveau === 'campagne') return { ok: false, text: 'L’agent d’une campagne ne confie rien : il mène sa campagne lui-même, avec la personne.' };
        const consigne = String(args.consigne ?? '').trim();
        if (!consigne) return { ok: false, text: 'Dis ce que le chef doit préparer : « consigne ».' };
        const m = trouverMarque();
        if (!m) return { ok: false, text: 'Dis quelle marque : « marque », son nom.' };
        const voulu = String(args.projet ?? '').trim().toLowerCase();
        if (!voulu) {
          if (role) return { ok: false, text: 'Tu es déjà le chef de cette marque : confie à un chef de projet (« projet »).' };
          const chef = await chefDeMarque(compte, m.id);
          noterLesProjetsDuChef(chef.id, m.projets.map((p) => p.id));
          await relireLaMemoire(chef.id);
          await confier(chef, consigne, 'le chef général');
          return { ok: true, text: `Travail confié au chef de ${m.nom} : il le prépare dans la conversation de la marque.` };
        }
        const projet = m.projets.find((p) => p.id === voulu) ?? m.projets.find((p) => p.nom.toLowerCase() === voulu) ?? m.projets.find((p) => p.nom.toLowerCase().includes(voulu));
        if (!projet) return { ok: false, text: `Aucun projet « ${args.projet} » dans ${m.nom}. Ses projets : ${m.projets.map((p) => p.nom).join(', ')}.` };
        const chef = await chefDeProjet(compte, m.id, projet.id);
        await relireLaMemoire(chef.id);
        await confier(chef, consigne, role ? `le chef de ${m.nom}` : 'le chef général');
        return { ok: true, text: `Travail confié au chef du projet ${projet.nom} : son fil se lit depuis la conversation de ${m.nom}.` };
      }
      default:
        return { ok: false, text: `Action inconnue : ${action || '(vide)'}.` };
    }
  } catch (err: any) {
    return { ok: false, text: err?.message ?? String(err) };
  }
}

