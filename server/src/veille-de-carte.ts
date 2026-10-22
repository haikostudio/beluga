/**
 * LA VEILLE D'UNE CARTE — écriture, passages sans agent, reprise.
 *
 * Les règles pures vivent dans `shared/src/veille-de-carte.ts`. Ici :
 *
 *  1. POSER (`poserVeille`, outil `veille_poser` des agents de tâche et du
 *     marketing) : la recette est jugée, ESSAYÉE pour de vrai, puis enregistrée.
 *     Un essai en panne technique est refusé ; « pas encore » est le cas normal ;
 *     « déjà levé » aussi est refusé — l'agent poursuit au lieu d'attendre. La
 *     carte passe en PAUSE SUR PLACE (`suspendu` + `enPause`, le mécanisme du
 *     bouton « Suspendre », DEC-372) : elle reste en « En cours », l'agent garde
 *     sa session, et la fin de son tour ne la range pas (`carteApresFinDeTour`).
 *  2. LES PASSAGES (`tourneeDesVeilles`, chaque minute) rejouent la recette
 *     SANS MOTEUR NI QUOTA. Contrôle levé : la veille passe à « levée » et
 *     l'agent est relancé par un MESSAGE (`sendPrompt`) — le même chemin que
 *     « Reprendre », qui lève la pause et respecte la file sans quota. Une
 *     panne du contrôle ne lève rien et ne relance personne.
 *  3. L'ÉCHÉANCE : le passage qui la constate écrit « expirée » EN BASE et pose
 *     une vraie question dans le fil de l'agent — la cloche et le triangle la
 *     voient comme toute question (`decisionsEnAttente` ne lit jamais l'heure).
 *     La réponse est tranchée ici (`trancherLEcheance`) : prolonger, relancer,
 *     abandonner. Rien ne repart sans elle.
 *  4. LA FIN SANS BRUIT : une carte rangée, supprimée, déplacée, sortie de
 *     pause (message de l'utilisateur, Terminer, Arrêter) abandonne sa veille au
 *     passage suivant. Au redémarrage du démon, les veilles reprennent d'après
 *     `prochain_controle_a` relu en base.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AgentQuestion,
  CHOIX_D_ECHEANCE,
  COLONNE_DE_FIN_DE_TOUR,
  DELAI_PARCOURS_MS,
  DUREE_VEILLE_MAX_MS,
  Message,
  RAISON_SUSPENDU_EN_PAUSE,
  carteEnPause,
  choixDEcheance,
  colonneDeFinDUnAgentAttitre,
  echeanceDeVeille,
  issueDuVerdict,
  jugerVeille,
  messageDeBlocageLeve,
  messageDeRelanceApresEcheance,
  prochainControleDeVeille,
  questionDEcheance,
  raisonDeLaCarteEnVeille,
  recetteAffichable,
  resumeDeVeille,
  veilleDue,
  veilleEchue,
  bornerIntervalleDeVeille,
  type Card,
  type ControleDeVeille,
  type EtatVeille,
  type IssueDeControle,
  type RecetteDeVeille,
  type VeilleDeCarte,
  type VeilleListee,
} from '@beluga/shared';
import { estAgentAttitre } from './agent-attitre.js';
import { bus } from './bus.js';
import { getDb } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';
import { jouerRecette } from './surveillance.js';

/* ------------------------------------------------------------------ */
/* La table                                                             */
/* ------------------------------------------------------------------ */

interface LigneVeille {
  id: string;
  card_id: string;
  agent_id: string;
  raison: string;
  recette: string;
  intervalle_ms: number;
  echeance: number;
  etat: string;
  cree_a: number;
  prochain_controle_a: number;
  dernier_controle: string | null;
  question_message_id: string | null;
  termine_a?: number | null;
}

function depuisLigne(l: LigneVeille): VeilleDeCarte {
  let dernier: ControleDeVeille | undefined;
  try {
    dernier = l.dernier_controle ? (JSON.parse(l.dernier_controle) as ControleDeVeille) : undefined;
  } catch {
    dernier = undefined;
  }
  return {
    id: l.id,
    cardId: l.card_id,
    agentId: l.agent_id,
    raison: l.raison,
    recette: JSON.parse(l.recette) as RecetteDeVeille,
    intervalleMs: l.intervalle_ms,
    echeance: l.echeance,
    etat: l.etat as EtatVeille,
    creeA: l.cree_a,
    prochainControleA: l.prochain_controle_a,
    ...(dernier ? { dernierControle: dernier } : {}),
    ...(l.question_message_id ? { questionMessageId: l.question_message_id } : {}),
    ...(l.termine_a ? { termineA: l.termine_a } : {}),
  };
}

function ecrire(v: VeilleDeCarte): void {
  getDb()
    .prepare(
      `INSERT INTO veilles_de_carte (id, card_id, agent_id, raison, recette, intervalle_ms, echeance, etat, cree_a,
                                     prochain_controle_a, dernier_controle, question_message_id, termine_a)
       VALUES (@id, @card_id, @agent_id, @raison, @recette, @intervalle_ms, @echeance, @etat, @cree_a,
               @prochain_controle_a, @dernier_controle, @question_message_id, @termine_a)
       ON CONFLICT(id) DO UPDATE SET raison = excluded.raison, recette = excluded.recette,
         intervalle_ms = excluded.intervalle_ms, echeance = excluded.echeance, etat = excluded.etat,
         prochain_controle_a = excluded.prochain_controle_a, dernier_controle = excluded.dernier_controle,
         question_message_id = excluded.question_message_id,
         termine_a = CASE WHEN excluded.etat = 'en_cours' THEN NULL
                          ELSE COALESCE(veilles_de_carte.termine_a, excluded.termine_a) END`,
    )
    .run({
      id: v.id,
      card_id: v.cardId,
      agent_id: v.agentId,
      raison: v.raison,
      recette: JSON.stringify(v.recette),
      intervalle_ms: v.intervalleMs,
      echeance: v.echeance,
      etat: v.etat,
      cree_a: v.creeA,
      prochain_controle_a: v.prochainControleA,
      dernier_controle: v.dernierControle ? JSON.stringify(v.dernierControle) : null,
      question_message_id: v.questionMessageId ?? null,
      termine_a: v.etat === 'en_cours' ? null : v.termineA ?? Date.now(),
    });
  annoncerLesVeilles();
}

/** Le nombre de veilles qui courent : la tuile du service et la page ouverte s'en servent. */
export function compterLesVeillesActives(): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM veilles_de_carte WHERE etat = 'en_cours'`).get() as { n: number }).n;
}

/**
 * CHAQUE ÉCRITURE D'UNE VEILLE LE DIT AUX ÉCRANS, par un événement minuscule :
 * le compte des veilles actives (index partiel, aucune relecture de la table)
 * et l'heure. La page « Tâches récurrentes », si elle est ouverte, relit alors
 * sa liste ; fermée, elle ne coûte rien.
 */
function annoncerLesVeilles(): void {
  bus.emit({ type: 'veilles.compte', actives: compterLesVeillesActives(), a: Date.now() });
}

/** Au plus autant de lignes lues pour le service : l'historique ne fait que grandir. */
const VEILLES_LISTEES_MAX = 1000;

/**
 * LE SERVICE « TÂCHES RÉCURRENTES » : toutes les veilles, actives et terminées,
 * avec le titre et le projet de leur carte lus en base (une carte supprimée
 * depuis rend `null`). La recette part sans aucune valeur saisie.
 */
export function listerLesVeilles(): VeilleListee[] {
  const lignes = getDb()
    .prepare(
      `SELECT * FROM veilles_de_carte
        ORDER BY CASE WHEN etat = 'en_cours' THEN 0 ELSE 1 END, COALESCE(termine_a, cree_a) DESC
        LIMIT ?`,
    )
    .all(VEILLES_LISTEES_MAX) as LigneVeille[];
  return lignes.map((l) => {
    const v = depuisLigne(l);
    const carte = store.getCard(v.cardId);
    return {
      ...resumeDeVeille(v),
      cardId: v.cardId,
      projectId: carte?.projectId ?? null,
      titreCarte: carte?.title ?? null,
      intervalleMs: v.intervalleMs,
      creeA: v.creeA,
      ...(v.termineA ? { termineA: v.termineA } : {}),
      recette: recetteAffichable(v.recette),
    };
  });
}

export function lireVeille(id: string): VeilleDeCarte | null {
  const l = getDb().prepare('SELECT * FROM veilles_de_carte WHERE id = ?').get(id) as LigneVeille | undefined;
  return l ? depuisLigne(l) : null;
}

/** La veille qui court sur cette carte (en cours, ou échue et en attente de réponse). */
export function veilleDeLaCarte(cardId: string): VeilleDeCarte | null {
  const l = getDb()
    .prepare(
      `SELECT * FROM veilles_de_carte WHERE card_id = ? AND etat IN ('en_cours', 'expiree') ORDER BY cree_a DESC LIMIT 1`,
    )
    .get(cardId) as LigneVeille | undefined;
  return l ? depuisLigne(l) : null;
}

function veillesEnCours(): VeilleDeCarte[] {
  return (getDb().prepare(`SELECT * FROM veilles_de_carte WHERE etat = 'en_cours'`).all() as LigneVeille[]).map(depuisLigne);
}

/* ------------------------------------------------------------------ */
/* La carte                                                             */
/* ------------------------------------------------------------------ */

/** Réécrit le résumé de veille porté par la carte, et la phrase de sa pause. */
function porterSurLaCarte(cardId: string, veille: VeilleDeCarte | null, phrase?: string): Card | null {
  const card = store.getCard(cardId);
  if (!card) return null;
  const { veille: _ancienne, ...sansVeille } = card;
  const suivante: Card = {
    ...sansVeille,
    ...(veille ? { veille: resumeDeVeille(veille) } : {}),
    ...(phrase !== undefined && card.scheduling ? { scheduling: { ...card.scheduling, waitingReason: phrase } } : {}),
  } as Card;
  const ecrite = store.saveCard(suivante);
  bus.emit({ type: 'card.upsert', card: ecrite });
  return ecrite;
}

/**
 * LA PAUSE SUR PLACE, posée par la veille : les deux marques du bouton
 * « Suspendre » (`mettreLaCarteEnPause`), plus le résumé. La marque de vol
 * n'est PAS retirée : le tour de l'agent est encore en vol, c'est sa fin qui
 * l'éteindra en voyant la pause (`carteApresFinDeTour`).
 */
function mettreEnPausePourLaVeille(card: Card, veille: VeilleDeCarte): Card {
  const ecrite = store.saveCard({
    ...card,
    veille: resumeDeVeille(veille),
    scheduling: {
      ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
      suspendu: true,
      enPause: true,
      waitingReason: raisonDeLaCarteEnVeille(veille.raison),
      reprendreDesQuePossible: undefined,
    },
  });
  bus.emit({ type: 'card.upsert', card: ecrite });
  return ecrite;
}

/* ------------------------------------------------------------------ */
/* Jouer le contrôle                                                    */
/* ------------------------------------------------------------------ */

/** Les profils du navigateur d'essai vivent dans le dossier personnel de qui fait tourner le démon. */
export function dossierDuProfil(profil: string): string {
  return path.join(os.homedir(), '.dev-browser', 'v1', 'browsers', profil);
}

/** Le texte cherché, réduit comme la page : minuscules, espaces simples, une seule apostrophe. */
export function texteNormalise(texte: string): string {
  return texte.replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Une page lue dans un profil à la fois : le navigateur d'essai n'aime pas deux appels croisés. */
let fileDuProfil: Promise<unknown> = Promise.resolve();

/**
 * LIRE UNE PAGE CONNECTÉE, dans le profil du compte (`dev-browser -b`). Le
 * script est FABRIQUÉ ici à partir des seules étapes permises (aller, attendre,
 * vérifier un texte — `ACTIONS_AVEC_PROFIL`) ; chaque valeur y entre par
 * `JSON.stringify`, jamais recopiée telle quelle. Le texte se cherche dans le
 * contenu de la page, balises retirées : c'est la seule lecture fiable de ce
 * navigateur côté serveur.
 */
async function jouerDansLeProfil(veilleId: string, recette: RecetteDeVeille): Promise<{ etat: 'ok' | 'panne'; raison?: 'contenu' | 'parcours' | 'delai'; etape?: string; detail?: string }> {
  if (recette.recette.type !== 'parcours') return { etat: 'panne', raison: 'parcours', detail: 'un profil se lit par un parcours' };
  const lignes = [`const p = await browser.getPage(${JSON.stringify(`veille-${veilleId.slice(0, 8)}`)});`, 'let r = { ok: true };'];
  lignes.push(
    'const lire = async () => (await p.content()).replace(/<script[\\s\\S]*?<\\/script>/gi, " ").replace(/<style[\\s\\S]*?<\\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&#(\\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&quot;/g, "\\"").replace(/&apos;|&rsquo;/g, "\'").replace(/&amp;/g, "&").replace(/[\u2019]/g, "\'").replace(/\\s+/g, " ").toLowerCase();',
  );
  recette.recette.etapes.forEach((etape, i) => {
    const libelle = JSON.stringify(`${i + 1}. ${etape.action}`);
    if (etape.action === 'aller') lignes.push(`if (r.ok) await p.goto(${JSON.stringify(etape.url)}, { waitUntil: "domcontentloaded" });`);
    else if (etape.action === 'attendre') lignes.push(`if (r.ok) await new Promise((f) => setTimeout(f, ${Math.min(20_000, Math.max(0, etape.ms ?? 0))}));`);
    else if (etape.action === 'verifierTexte')
      lignes.push(
        `if (r.ok && !(await lire()).includes(${JSON.stringify(texteNormalise(etape.texte))})) r = { ok: false, etape: ${libelle}, detail: ${JSON.stringify(`« ${etape.texte} » absent de la page`)} };`,
      );
  });
  lignes.push('JSON.stringify(r)');
  const delai = Math.ceil(DELAI_PARCOURS_MS / 1000);
  const tour = fileDuProfil.then(
    () =>
      new Promise<{ etat: 'ok' | 'panne'; raison?: 'contenu' | 'parcours' | 'delai'; etape?: string; detail?: string }>((resolve) => {
        execFile(
          'dev-browser',
          ['--headless', '--quiet-page', '-b', recette.profil!, '-t', String(delai), '-e', lignes.join('\n')],
          { timeout: (delai + 15) * 1000, maxBuffer: 1_000_000 },
          (err, stdout, stderr) => {
            const ligne = String(stdout ?? '')
              .split('\n')
              .reverse()
              .find((l) => l.trim().startsWith('{'));
            if (ligne) {
              try {
                const r = JSON.parse(ligne) as { ok: boolean; etape?: string; detail?: string };
                return resolve(r.ok ? { etat: 'ok' } : { etat: 'panne', raison: 'contenu', etape: r.etape, detail: r.detail });
              } catch {
                /* sortie illisible : panne du contrôle ci-dessous */
              }
            }
            const coupe = (err as { killed?: boolean } | null)?.killed;
            resolve({
              etat: 'panne',
              raison: coupe ? 'delai' : 'parcours',
              detail: String(stderr || err?.message || 'aucune réponse du navigateur d’essai').split('\n')[0].slice(0, 200),
            });
          },
        );
      }),
  );
  fileDuProfil = tour.catch(() => undefined);
  return tour;
}

/** Joue le contrôle UNE fois, sans rien écrire : l'essai de l'agent comme le passage automatique. */
export async function jouerLeControle(veilleId: string, recette: RecetteDeVeille): Promise<ControleDeVeille & { dureeMs: number }> {
  const debut = Date.now();
  let verdict: { etat: 'ok' | 'panne'; raison?: string; etape?: string; detail?: string; code?: number };
  try {
    verdict = recette.profil ? await jouerDansLeProfil(veilleId, recette) : await jouerRecette(recette.url, recette.recette);
  } catch (err) {
    verdict = { etat: 'panne', raison: 'parcours', detail: String((err as Error)?.message ?? err).slice(0, 200) };
  }
  const issue: IssueDeControle = issueDuVerdict(verdict as { etat: 'ok' | 'panne'; raison?: 'contenu' }, recette.leveeSi);
  const detail = [verdict.etape, verdict.detail, verdict.code ? `code ${verdict.code}` : null, verdict.etat === 'panne' && verdict.raison !== 'contenu' ? verdict.raison : null]
    .filter(Boolean)
    .join(' — ')
    .slice(0, 300);
  return { a: Date.now(), issue, ...(detail ? { detail } : {}), dureeMs: Date.now() - debut };
}

/* ------------------------------------------------------------------ */
/* Poser                                                                */
/* ------------------------------------------------------------------ */

export type PoseDeVeille = { ok: true; texte: string; veille?: VeilleDeCarte } | { ok: false; texte: string };

/**
 * POSER UNE VEILLE (ou seulement l'essayer, `essai`). Refusée hors d'une carte
 * en « En cours » dont l'agent est le sien : une veille relance UN agent, celui
 * qui attend.
 */
export async function poserVeille(entree: { agentId: string; cardId?: string; args: Record<string, unknown>; maintenant?: number }): Promise<PoseDeVeille> {
  const { agentId, args } = entree;
  const card = entree.cardId ? store.getCard(entree.cardId) : null;
  if (!card) return { ok: false, texte: 'Une veille se pose sur la carte de ta tâche : cette conversation n’en a pas.' };
  if (card.agentId && card.agentId !== agentId)
    return { ok: false, texte: 'Cette carte a été reprise par un autre agent : la veille ne te relancerait pas.' };
  if (card.column !== 'running') return { ok: false, texte: 'Une veille se pose sur une carte en « En cours ».' };

  const avis = jugerVeille(args);
  if (!avis.ok) return { ok: false, texte: `Veille refusée : ${avis.raison}. Corrige et rappelle l’outil.` };
  if (avis.recette.profil && !fs.existsSync(dossierDuProfil(avis.recette.profil)))
    return {
      ok: false,
      texte: `Veille refusée : le profil « ${avis.recette.profil} » n’existe pas dans le navigateur d’essai. Connecte-toi d’abord avec ce profil (compétence dev-browser), puis rappelle l’outil.`,
    };

  const maintenant = entree.maintenant ?? Date.now();
  const id = store.newId();
  const essai = await jouerLeControle(id, avis.recette);
  const phraseEssai = `Essai : ${essai.issue === 'levee' ? 'BLOCAGE DÉJÀ LEVÉ' : essai.issue === 'pas-encore' ? 'pas encore (normal)' : 'PANNE DU CONTRÔLE'}${essai.detail ? ` — ${essai.detail}` : ''} (${essai.dureeMs} ms).`;
  if (args.essai === true) return { ok: true, texte: `${phraseEssai}\nRien n’est enregistré.` };
  if (essai.issue === 'panne')
    return {
      ok: false,
      texte: `${phraseEssai}\nVeille NON posée : le contrôle ne sait pas lire la page. Corrige la recette (adresse, étapes, profil) et rejoue avec « essai: true » jusqu’à obtenir « pas encore ».`,
    };
  if (essai.issue === 'levee')
    return { ok: false, texte: `${phraseEssai}\nVeille NON posée : ce qu’elle attendrait est déjà là. Poursuis la tâche maintenant.` };

  // UNE SEULE VEILLE ACTIVE PAR CARTE : la nouvelle remplace l'ancienne.
  const ancienne = veilleDeLaCarte(card.id);
  if (ancienne) ecrire({ ...ancienne, etat: 'abandonnee' });

  const intervalleMs = bornerIntervalleDeVeille(args.intervalleMinutes);
  const echeance = echeanceDeVeille(maintenant, args.dureeHeures);
  const veille: VeilleDeCarte = {
    id,
    cardId: card.id,
    agentId,
    raison: avis.raison,
    recette: avis.recette,
    intervalleMs,
    echeance,
    etat: 'en_cours',
    creeA: maintenant,
    prochainControleA: prochainControleDeVeille(maintenant, intervalleMs, echeance),
    dernierControle: { a: essai.a, issue: essai.issue, ...(essai.detail ? { detail: essai.detail } : {}) },
  };
  ecrire(veille);
  mettreEnPausePourLaVeille(card, veille);
  log.info(`veille posée sur la carte ${card.id} : « ${veille.raison} », toutes les ${Math.round(intervalleMs / 60_000)} min jusqu’au ${new Date(echeance).toISOString()}`);
  return {
    ok: true,
    veille,
    texte:
      `${phraseEssai}\nVEILLE POSÉE : « ${veille.raison} », contrôle toutes les ${Math.round(intervalleMs / 60_000)} min, ` +
      `échéance ${new Date(echeance).toISOString()}. La carte est en pause sur place : TERMINE TON TOUR MAINTENANT par une phrase courte ` +
      `qui dit ce qu’on attend. Tu seras relancé par un message dès que le contrôle passe ; à l’échéance, l’utilisateur choisira.`,
  };
}

/* ------------------------------------------------------------------ */
/* Les passages                                                         */
/* ------------------------------------------------------------------ */

/** Les veilles en plein passage : jamais deux passages de la même à la fois. */
const enPassage = new Set<string>();

/** Termine la veille sans relancer personne, et retire son résumé de la carte. */
function terminerSansBruit(veille: VeilleDeCarte, etat: EtatVeille, phrase?: string): void {
  ecrire({ ...veille, etat });
  const card = store.getCard(veille.cardId);
  if (card?.veille) porterSurLaCarte(card.id, null, phrase);
}

/**
 * LA VEILLE A-T-ELLE ENCORE UN SENS ? Sa carte existe, est en « En cours », en
 * pause, et toujours tenue par l'agent qui l'a posée. Sinon, quelqu'un a repris
 * la main — un message, « Terminer », « Arrêter », une suppression, un
 * déplacement — et la veille s'efface.
 */
function encoreValable(veille: VeilleDeCarte): boolean {
  const card = store.getCard(veille.cardId);
  if (!card || card.column !== 'running' || !carteEnPause(card.scheduling)) return false;
  if (card.agentId && card.agentId !== veille.agentId) return false;
  return !!store.getAgent(veille.agentId);
}

/** Relance l'agent par un message : le chemin de « Reprendre », file sans quota comprise. */
let relance = async (agentId: string, texte: string): Promise<void> => {
  const { sendPrompt } = await import('./runtime.js');
  await sendPrompt(agentId, texte);
};

async function relancerLAgent(agentId: string, texte: string): Promise<void> {
  await relance(agentId, texte);
}

/** Pour les tests seulement : observer la relance sans lancer de moteur. */
export function remplacerLaRelance(fn: (agentId: string, texte: string) => Promise<void>): void {
  relance = fn;
}

/** Un passage d'UNE veille, maintenant. Rend son état après le passage. */
export async function passerLaVeille(id: string, maintenant = Date.now()): Promise<VeilleDeCarte | null> {
  if (enPassage.has(id)) return lireVeille(id);
  enPassage.add(id);
  try {
    const veille = lireVeille(id);
    if (!veille || veille.etat !== 'en_cours') return veille;
    if (!encoreValable(veille)) {
      terminerSansBruit(veille, 'abandonnee');
      log.info(`veille ${id} abandonnée : sa carte n’est plus en pause sur place`);
      return lireVeille(id);
    }
    const controle = await jouerLeControle(veille.id, veille.recette);
    const dernierControle: ControleDeVeille = { a: controle.a, issue: controle.issue, ...(controle.detail ? { detail: controle.detail } : {}) };
    /* Le contrôle a pu durer : la carte a pu changer de main pendant ce temps. */
    const relue = lireVeille(id);
    if (!relue || relue.etat !== 'en_cours') return relue;
    if (!encoreValable(relue)) {
      terminerSansBruit(relue, 'abandonnee');
      return lireVeille(id);
    }

    if (controle.issue === 'levee') {
      const levee: VeilleDeCarte = { ...relue, etat: 'levee', dernierControle };
      ecrire(levee);
      porterSurLaCarte(relue.cardId, null);
      log.info(`veille ${id} levée : « ${relue.raison} » — l’agent ${relue.agentId} est relancé`);
      await relancerLAgent(relue.agentId, messageDeBlocageLeve(relue.raison)).catch((err) =>
        log.error(`veille ${id} : relance de l’agent impossible`, err),
      );
      return lireVeille(id);
    }

    if (veilleEchue(relue, maintenant)) {
      const expiree = poserLaQuestionDEcheance({ ...relue, etat: 'expiree', dernierControle }, maintenant);
      return expiree;
    }

    const suivante: VeilleDeCarte = {
      ...relue,
      dernierControle,
      prochainControleA: prochainControleDeVeille(maintenant, relue.intervalleMs, relue.echeance),
    };
    ecrire(suivante);
    porterSurLaCarte(relue.cardId, suivante);
    return suivante;
  } finally {
    enPassage.delete(id);
  }
}

/**
 * L'ÉCHÉANCE : « expirée » écrite EN BASE, et une vraie question dans le fil de
 * l'agent. C'est cette écriture que la cloche voit — son calcul est mémorisé
 * sur l'empreinte de la base et ne lit jamais l'heure.
 */
function poserLaQuestionDEcheance(veille: VeilleDeCarte, maintenant: number): VeilleDeCarte {
  const heures = Math.max(1, Math.round((veille.echeance - veille.creeA) / 3_600_000));
  const question = AgentQuestion.parse({
    id: store.newId(),
    question: questionDEcheance(veille.raison, heures),
    description: veille.dernierControle?.detail ? `Dernier contrôle : ${veille.dernierControle.detail}` : undefined,
    kind: 'single',
    options: CHOIX_D_ECHEANCE.map((c, i) => ({ id: `o${i}`, label: c.label, description: c.description })),
    allowFreeText: false,
    veille: veille.id,
  });
  const message = store.saveMessage(
    Message.parse({
      id: store.newId(),
      agentId: veille.agentId,
      role: 'assistant',
      content: `La veille « ${veille.raison} » est arrivée à échéance sans que son contrôle passe.`,
      questions: [question],
      createdAt: maintenant,
    }),
  );
  bus.emit({ type: 'message.upsert', message });
  const expiree: VeilleDeCarte = { ...veille, etat: 'expiree', questionMessageId: message.id };
  ecrire(expiree);
  porterSurLaCarte(veille.cardId, expiree, `Veille échue : ${veille.raison}. Répondez à la question pour la suite.`);
  bus.emit({ type: 'attention', ...store.signalAttention() });
  log.info(`veille ${veille.id} échue : la question est posée dans le fil de l’agent ${veille.agentId}`);
  return expiree;
}

/**
 * UNE VEILLE ÉCHUE DONT LA CARTE A ÉTÉ REPRISE AUTREMENT — un message à
 * l'agent, « Terminer », une suppression — n'attend plus rien : sa question se
 * ferme (annulée, jamais répondue à la place de l'utilisateur) et la veille
 * passe à « abandonnée ».
 */
function refermerLesEcheancesSansObjet(): void {
  const echues = (getDb().prepare(`SELECT * FROM veilles_de_carte WHERE etat = 'expiree'`).all() as LigneVeille[]).map(depuisLigne);
  for (const veille of echues) {
    if (encoreValable(veille)) continue;
    ecrire({ ...veille, etat: 'abandonnee' });
    const message = veille.questionMessageId ? store.getMessage(veille.questionMessageId) : null;
    if (message?.questions.some((q) => q.veille === veille.id && !q.answer && !q.cancelled)) {
      const fermee = store.saveMessage({
        ...message,
        questions: message.questions.map((q) => (q.veille === veille.id && !q.answer ? { ...q, cancelled: true, answeredAt: Date.now() } : q)),
      });
      bus.emit({ type: 'message.upsert', message: fermee });
      bus.emit({ type: 'attention', ...store.signalAttention() });
    }
    const card = store.getCard(veille.cardId);
    if (card?.veille) porterSurLaCarte(card.id, null);
  }
}

/** La tournée : chaque veille due, une fois. Rend le nombre de passages lancés. */
export async function tourneeDesVeilles(maintenant = Date.now()): Promise<number> {
  refermerLesEcheancesSansObjet();
  const dues = veillesEnCours().filter((v) => veilleDue(v, maintenant) || veilleEchue(v, maintenant) || !encoreValable(v));
  await Promise.all(
    dues.map((v) => passerLaVeille(v.id, maintenant).catch((err) => log.warn(`veille ${v.id} : passage impossible`, err))),
  );
  return dues.length;
}

const BATTEMENT_MS = 60_000;

/** Le battement des veilles : une minute, première tournée trente secondes après le démarrage. */
export function demarrerLesVeilles(): NodeJS.Timeout {
  const tour = () => void tourneeDesVeilles().catch((err) => log.warn('veilles : tournée impossible', err));
  setTimeout(tour, 30_000).unref?.();
  const minuteur = setInterval(tour, BATTEMENT_MS);
  minuteur.unref?.();
  return minuteur;
}

/* ------------------------------------------------------------------ */
/* Les gestes de l'utilisateur                                          */
/* ------------------------------------------------------------------ */

/**
 * « ARRÊTER LA VEILLE » : la veille s'efface, la carte reste en pause sur place
 * avec la phrase de « Suspendre » — c'est le prochain message qui relance.
 */
export function arreterLaVeille(cardId: string): { ok: boolean; raison?: string } {
  const veille = veilleDeLaCarte(cardId);
  if (!veille) return { ok: false, raison: 'Aucune veille ne court sur cette carte.' };
  terminerSansBruit(veille, 'abandonnee', RAISON_SUSPENDU_EN_PAUSE);
  return { ok: true };
}

/** « VÉRIFIER MAINTENANT » : un passage tout de suite, sans attendre son heure. */
export async function verifierLaVeilleMaintenant(cardId: string): Promise<{ ok: boolean; raison?: string; veille?: VeilleDeCarte | null }> {
  const veille = veilleDeLaCarte(cardId);
  if (!veille || veille.etat !== 'en_cours') return { ok: false, raison: 'Aucune veille ne court sur cette carte.' };
  return { ok: true, veille: await passerLaVeille(veille.id) };
}

/**
 * LA RÉPONSE À L'ÉCHÉANCE (`question.answer`, question marquée `veille`).
 * Prolonger : 48 h de plus, même recette et même rythme. Relancer : l'agent
 * reprend par un message. Abandonner : la carte se termine, comme « Terminer ».
 */
export async function trancherLEcheance(veilleId: string, reponse: string, maintenant = Date.now()): Promise<{ ok: boolean; raison?: string }> {
  const veille = lireVeille(veilleId);
  if (!veille || veille.etat !== 'expiree') return { ok: false, raison: 'Cette veille n’attend plus de réponse.' };
  const choix = choixDEcheance(reponse);
  if (!choix) return { ok: false, raison: 'Réponse non reconnue : prolonger, relancer ou abandonner.' };

  if (choix === 'prolonger') {
    const echeance = maintenant + DUREE_VEILLE_MAX_MS;
    const reprise: VeilleDeCarte = {
      ...veille,
      etat: 'en_cours',
      creeA: maintenant,
      echeance,
      prochainControleA: prochainControleDeVeille(maintenant, veille.intervalleMs, echeance),
      questionMessageId: undefined,
    };
    ecrire(reprise);
    porterSurLaCarte(veille.cardId, reprise, raisonDeLaCarteEnVeille(veille.raison));
    return { ok: true };
  }

  ecrire({ ...veille, etat: 'abandonnee' });
  if (choix === 'relancer') {
    porterSurLaCarte(veille.cardId, null);
    await relancerLAgent(veille.agentId, messageDeRelanceApresEcheance(veille.raison));
    return { ok: true };
  }

  const card = store.getCard(veille.cardId);
  if (!card) return { ok: true };
  const { veille: _v, ...sansVeille } = card;
  const colonne = estAgentAttitre(card.agentId) ? (colonneDeFinDUnAgentAttitre(COLONNE_DE_FIN_DE_TOUR) ?? 'archived') : COLONNE_DE_FIN_DE_TOUR;
  const terminee = store.saveCard({
    ...(sansVeille as Card),
    column: colonne,
    position: store.nextPosition(card.projectId, colonne),
    doneAt: maintenant,
    deployedAt: undefined,
    scheduling: {
      ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
      suspendu: false,
      enPause: undefined,
      waitingReason: undefined,
    },
    sansModification: `Veille abandonnée à l’échéance : ${veille.raison}.`,
  });
  bus.emit({ type: 'card.upsert', card: terminee });
  return { ok: true };
}
