/**
 * « D'AUTRES IDÉES » SANS RELANCER L'AGENT — la recherche de suites en arrière-plan.
 *
 * Le bouton sous les suites d'une réponse ne dépose plus de demande dans le
 * champ : il demande au démon trois suites NOUVELLES, que celui-ci fait écrire
 * À PART, puis AJOUTE sous les existantes. Les règles pures (la demande, la
 * lecture de la sortie, la fusion bornée) vivent dans
 * `shared/src/suites-proposees.ts` ; ici, le vrai monde :
 *
 *  - LE MÊME MOTEUR ET LE MÊME MODÈLE QUE LA CARTE (`agent.run`), décision de
 *    l'utilisateur — pas le petit modèle de repli ;
 *  - SUR UN COMPTE QUI A DU QUOTA (`pickAccount`), comme tout travail ;
 *  - HORS DE LA CONVERSATION : aucun `sessionId`, aucun tour, aucune entrée de
 *    file, la carte ne bouge pas. Le moteur part d'un dossier temporaire vide,
 *    sans outils du démon, outils d'écriture fermés, borné (`PLAFOND_MS`) ;
 *  - UN SEUL CALCUL À LA FOIS PAR RÉPONSE : un second clic pendant la recherche
 *    reçoit « déjà en cours » ;
 *  - LES SUITES AJOUTÉES RESTENT, aux DEUX endroits qui les portent :
 *    `Message.suites` (la conversation) et `donnees.suites` des jalons du tour
 *    (le fil de la carte), diffusés à tous les appareils.
 *
 * Les tests ne paient pas de modèle : sous `NODE_TEST_CONTEXT`, seul un moteur
 * injecté (`remplacerLeMoteurDesIdees`) répond.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SUITES_MAX_APRES_AJOUTS,
  SUITES_PAR_RECHERCHE,
  ajouterDesSuites,
  demandeDeSuitesEnPlus,
  lireLesSuitesDuModele,
  type Agent,
  type SuiteProposee,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { applyAccountEnv, pickAccount } from './accounts.js';
import { adapterFor } from './engines/index.js';
import { completerDonneesDuJournal, entreeDuJournal, jalonsPortantDesSuites } from './journal-carte.js';

const PLAFOND_MS = 90_000;
const OUTILS_FERMES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task', 'Agent', 'WebFetch', 'WebSearch'];

export type ResultatDesAutresIdees = { ok: true; ajoutees: number } | { ok: false; raison: string; enCours?: boolean };

type MoteurDesIdees = (demande: string, agent: Agent) => Promise<string>;
let moteurInjecte: MoteurDesIdees | null = null;

/** Point d'injection des tests : un faux moteur qui rend un texte. `null` le retire. */
export function remplacerLeMoteurDesIdees(moteur: MoteurDesIdees | null): void {
  moteurInjecte = moteur;
}

/** Les réponses dont une recherche tourne en ce moment (clé : message, sinon entrée). */
const enCours = new Set<string>();

function suitesDesDonnees(donnees: string | undefined): SuiteProposee[] {
  if (!donnees) return [];
  try {
    const lu = JSON.parse(donnees) as { suites?: unknown };
    if (!Array.isArray(lu.suites)) return [];
    return lu.suites
      .map((s) => ({ titre: String((s as any)?.titre ?? '').trim(), description: String((s as any)?.description ?? '').trim() }))
      .filter((s) => s.titre);
  } catch {
    return [];
  }
}

/** Lance le moteur de la carte à part, sans session, et rend son texte. */
async function demanderAuMoteur(demande: string, agent: Agent): Promise<string> {
  if (moteurInjecte) return moteurInjecte(demande, agent);
  if (process.env.NODE_TEST_CONTEXT) throw new Error('aucun modèle n’est appelé pendant les tests');
  const engine = agent.run.engine;
  const compte = await pickAccount(engine).catch(() => null);
  if (!compte) throw new Error('aucun compte de ce moteur n’a de quota en ce moment');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-idees-'));
  let texte = '';
  let erreur: string | undefined;
  try {
    const handle = adapterFor(engine).run({
      cwd,
      prompt: demande,
      model: agent.run.model,
      fullAccess: false,
      role: 'task',
      disallowedTools: OUTILS_FERMES,
      env: applyAccountEnv(compte),
      plafondMs: PLAFOND_MS,
      onEvent: (event) => {
        if (event.kind === 'text' && event.text) texte += `${texte ? '\n\n' : ''}${event.text}`;
        if (event.kind === 'error' && event.error) erreur = event.error;
      },
    });
    const resultat = await handle.finished;
    if (!texte.trim()) throw new Error(resultat.error ?? erreur ?? 'le moteur n’a rien rendu');
    return texte;
  } finally {
    fs.rm(cwd, { recursive: true, force: true }, () => {});
  }
}

/**
 * CHERCHE TROIS SUITES DE PLUS pour une réponse, désignée par son message
 * (la conversation) ou par son jalon (le fil de la carte), et les ajoute.
 * Ne lève jamais : un refus se rend en phrase.
 */
export async function chercherDAutresIdees(cible: { messageId?: string; entreeId?: string }): Promise<ResultatDesAutresIdees> {
  const entree = cible.entreeId ? entreeDuJournal(cible.entreeId) : null;
  const messageId = cible.messageId ?? entree?.tourId;
  const message = messageId ? store.getMessage(messageId) : null;
  if (!message && !entree) return { ok: false, raison: 'Réponse introuvable.' };
  const cle = message?.id ?? entree!.id;
  if (enCours.has(cle)) return { ok: false, raison: 'Recherche déjà en cours.', enCours: true };

  const agentId = message?.agentId ?? entree?.agentId;
  const agent = agentId ? store.getAgent(agentId) : null;
  if (!agent) return { ok: false, raison: 'L’agent de cette réponse n’existe plus.' };
  const dejaVues = message?.suites?.length ? message.suites : suitesDesDonnees(entree?.donnees);
  if (dejaVues.length >= SUITES_MAX_APRES_AJOUTS) return { ok: false, raison: 'Assez d’idées pour cette réponse.' };
  const carte = store.getCard(agent.cardId ?? entree?.cardId ?? '');
  const demande = demandeDeSuitesEnPlus({
    titreDeLaCarte: carte?.title,
    descriptionDeLaCarte: carte?.description,
    reponse: message?.content || entree?.resultat || '',
    dejaVues,
    nombre: SUITES_PAR_RECHERCHE,
  });

  enCours.add(cle);
  const depart = Date.now();
  try {
    let texte: string;
    try {
      texte = await demanderAuMoteur(demande, agent);
    } catch (err) {
      const pourquoi = String((err as Error)?.message ?? err);
      log.warn(`d'autres idées : recherche tombée pour ${cle} (${pourquoi})`);
      return { ok: false, raison: `Recherche impossible : ${pourquoi}.` };
    }
    const nouvelles = lireLesSuitesDuModele(texte).slice(0, SUITES_PAR_RECHERCHE);
    if (!nouvelles.length) {
      log.warn(`d'autres idées : sortie illisible pour ${cle} (${texte.slice(0, 200)})`);
      return { ok: false, raison: 'Le moteur n’a rendu aucune idée lisible.' };
    }

    /* On relit l'état ACTUEL : la réponse a pu changer pendant la recherche. */
    let ajoutees = 0;
    const frais = message ? store.getMessage(message.id) : null;
    if (frais) {
      const fusion = ajouterDesSuites(frais.suites ?? [], nouvelles);
      ajoutees = Math.max(ajoutees, fusion.ajoutees.length);
      if (fusion.ajoutees.length) {
        const ecrit = store.saveMessage({ ...frais, suites: fusion.suites });
        bus.emit({ type: 'message.upsert', message: ecrit });
      }
    }
    const jalons = messageId ? jalonsPortantDesSuites(messageId) : [];
    if (entree && !jalons.some((j) => j.id === entree.id)) jalons.push(entree);
    for (const jalon of jalons) {
      const actuel = entreeDuJournal(jalon.id) ?? jalon;
      const fusion = ajouterDesSuites(suitesDesDonnees(actuel.donnees), nouvelles);
      ajoutees = Math.max(ajoutees, fusion.ajoutees.length);
      if (!fusion.ajoutees.length) continue;
      const enrichi = completerDonneesDuJournal(actuel.id, { suites: fusion.suites });
      if (enrichi) bus.emit({ type: 'journal.entree', entree: enrichi });
    }
    if (!ajoutees) return { ok: false, raison: 'Aucune idée nouvelle cette fois.' };
    log.info(`d'autres idées : ${ajoutees} suites ajoutées à ${cle} en ${Math.round((Date.now() - depart) / 1000)} s`);
    return { ok: true, ajoutees };
  } finally {
    enCours.delete(cle);
  }
}
