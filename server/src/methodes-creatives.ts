/**
 * LA BIBLIOTHÈQUE DE MÉTHODES DU MODE RÉALISATION, CÔTÉ DÉMON (24/10/2026).
 * Les règles (note, activation, contenu encadré, sources) sont PURES et vivent
 * dans `shared/src/methodes-creatives.ts` ; ici, on les applique aux tables de
 * la migration 139 (`methodes_creatives`, `methodes_versions`,
 * `methodes_usages`, `medias_avis`, `methodes_evaluations`).
 *
 * Deux portes seulement changent l'état, et chacune suit une RÉPONSE de
 * l'utilisateur relue dans la conversation (l'agent ne la fabrique pas) :
 *  - `deciderVersion` : « Activer » rend une version proposée active ;
 *  - `enregistrerAvis` : « Je garde » / « À refaire » sur un média fini écrit
 *    une évaluation pour chaque version qui l'a produit.
 */

import {
  noteDeMethode,
  statutsApresDecision,
  type DomaineDeMethode,
  type NoteDeMethode,
  type StatutDeVersion,
  type VerdictSurProduction,
} from '@beluga/shared';
import { getDb } from './db.js';
import * as store from './store.js';

export interface MethodeCreative {
  id: string;
  nom: string;
  domaine: DomaineDeMethode;
}

export interface VersionDeMethode {
  id: string;
  methodeId: string;
  numero: number;
  contenu: string;
  raison: string;
  source: string | null;
  statut: StatutDeVersion;
  questionId: string | null;
  agentId: string | null;
  cardId: string | null;
  proposeeLe: number;
  decideeLe: number | null;
}

function lireVersion(r: any): VersionDeMethode {
  return {
    id: r.id,
    methodeId: r.methode_id,
    numero: r.numero,
    contenu: r.contenu,
    raison: r.raison ?? '',
    source: r.source ?? null,
    statut: r.statut,
    questionId: r.question_id ?? null,
    agentId: r.agent_id ?? null,
    cardId: r.card_id ?? null,
    proposeeLe: r.proposee_le,
    decideeLe: r.decidee_le ?? null,
  };
}

/** Une méthode par son identifiant ou son nom (casse ignorée). */
export function methodeParNom(nomOuId: string): MethodeCreative | null {
  const r = getDb()
    .prepare(`SELECT id, nom, domaine FROM methodes_creatives WHERE id = ? OR lower(nom) = lower(?)`)
    .get(nomOuId.trim(), nomOuId.trim()) as any;
  return r ? { id: r.id, nom: r.nom, domaine: r.domaine } : null;
}

export function versionParId(id: string): VersionDeMethode | null {
  const r = getDb().prepare(`SELECT * FROM methodes_versions WHERE id = ?`).get(id);
  return r ? lireVersion(r) : null;
}

export function versionsDeLaMethode(methodeId: string): VersionDeMethode[] {
  return (getDb().prepare(`SELECT * FROM methodes_versions WHERE methode_id = ? ORDER BY numero`).all(methodeId) as any[]).map(lireVersion);
}

export function versionActive(methodeId: string): VersionDeMethode | null {
  const r = getDb().prepare(`SELECT * FROM methodes_versions WHERE methode_id = ? AND statut = 'active'`).get(methodeId);
  return r ? lireVersion(r) : null;
}

/** La note d'une version, tirée de ses seules évaluations. */
export function noteDeLaVersion(versionId: string): NoteDeMethode {
  const verdicts = (getDb().prepare(`SELECT verdict FROM methodes_evaluations WHERE version_id = ?`).all(versionId) as { verdict: VerdictSurProduction }[]).map((r) => r.verdict);
  return noteDeMethode(verdicts);
}

export interface MethodeEnService {
  methode: MethodeCreative;
  version: VersionDeMethode;
  note: NoteDeMethode;
}

/** Les méthodes qui ont une version active, la mieux notée d'abord. */
export function methodesEnService(): MethodeEnService[] {
  const lignes = getDb()
    .prepare(
      `SELECT m.id AS m_id, m.nom AS m_nom, m.domaine AS m_domaine, v.*
         FROM methodes_creatives m JOIN methodes_versions v ON v.methode_id = m.id AND v.statut = 'active'
        ORDER BY m.domaine, m.nom`,
    )
    .all() as any[];
  return lignes
    .map((r) => ({ methode: { id: r.m_id, nom: r.m_nom, domaine: r.m_domaine }, version: lireVersion(r), note: noteDeLaVersion(r.id) }))
    .sort((a, b) => b.note.note - a.note.note);
}

/** Les propositions qui attendent la réponse de l'utilisateur. */
export function versionsProposees(): (VersionDeMethode & { nom: string })[] {
  return (
    getDb()
      .prepare(`SELECT v.*, m.nom AS m_nom FROM methodes_versions v JOIN methodes_creatives m ON m.id = v.methode_id WHERE v.statut = 'proposee' ORDER BY v.proposee_le`)
      .all() as any[]
  ).map((r) => ({ ...lireVersion(r), nom: r.m_nom }));
}

/**
 * PROPOSE UNE VERSION : la méthode est créée au besoin, la version naît
 * « proposée » au numéro suivant. Elle ne sert à RIEN tant que
 * `deciderVersion` ne l'a pas activée.
 */
export function proposerVersion(e: {
  nom: string;
  domaine: DomaineDeMethode;
  contenu: string;
  raison: string;
  source?: string | null;
  agentId?: string | null;
  cardId?: string | null;
}): { methode: MethodeCreative; version: VersionDeMethode } {
  const db = getDb();
  return db.transaction(() => {
    let methode = methodeParNom(e.nom);
    if (!methode) {
      methode = { id: store.newId(), nom: e.nom.trim().slice(0, 80), domaine: e.domaine };
      db.prepare(`INSERT INTO methodes_creatives (id, nom, domaine, cree_le) VALUES (?, ?, ?, ?)`).run(methode.id, methode.nom, methode.domaine, Date.now());
    }
    const max = (db.prepare(`SELECT MAX(numero) AS n FROM methodes_versions WHERE methode_id = ?`).get(methode.id) as { n: number | null }).n ?? 0;
    const version: VersionDeMethode = {
      id: store.newId(),
      methodeId: methode.id,
      numero: max + 1,
      contenu: e.contenu,
      raison: e.raison,
      source: e.source ?? null,
      statut: 'proposee',
      questionId: null,
      agentId: e.agentId ?? null,
      cardId: e.cardId ?? null,
      proposeeLe: Date.now(),
      decideeLe: null,
    };
    db.prepare(
      `INSERT INTO methodes_versions (id, methode_id, numero, contenu, raison, source, statut, question_id, agent_id, card_id, proposee_le, decidee_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(version.id, version.methodeId, version.numero, version.contenu, version.raison, version.source, version.statut, null, version.agentId, version.cardId, version.proposeeLe, null);
    return { methode: methode!, version };
  })();
}

export function poserQuestionDeVersion(versionId: string, questionId: string): void {
  getDb().prepare(`UPDATE methodes_versions SET question_id = ? WHERE id = ? AND statut = 'proposee'`).run(questionId, versionId);
}

/** APPLIQUE LA RÉPONSE de l'utilisateur à une proposition. Rend la version relue. */
export function deciderVersion(versionId: string, accord: boolean): VersionDeMethode | null {
  const db = getDb();
  db.transaction(() => {
    const visee = versionParId(versionId);
    if (!visee) return;
    const changements = statutsApresDecision(versionsDeLaMethode(visee.methodeId), versionId, accord);
    const maintenant = Date.now();
    for (const c of changements) db.prepare(`UPDATE methodes_versions SET statut = ?, decidee_le = ? WHERE id = ?`).run(c.statut, maintenant, c.id);
  })();
  return versionParId(versionId);
}

/** Note qu'un média (un devis) est fabriqué selon ces versions. */
export function enregistrerUsages(mediaId: string, versionIds: readonly string[]): void {
  const ins = getDb().prepare(`INSERT OR IGNORE INTO methodes_usages (media_id, version_id) VALUES (?, ?)`);
  for (const v of versionIds) ins.run(mediaId, v);
}

export function versionsDuMedia(mediaId: string): (VersionDeMethode & { nom: string })[] {
  return (
    getDb()
      .prepare(
        `SELECT v.*, m.nom AS m_nom FROM methodes_usages u JOIN methodes_versions v ON v.id = u.version_id JOIN methodes_creatives m ON m.id = v.methode_id WHERE u.media_id = ? ORDER BY m.nom`,
      )
      .all(mediaId) as any[]
  ).map((r) => ({ ...lireVersion(r), nom: r.m_nom }));
}

export interface AvisDeMedia {
  mediaId: string;
  questionId: string;
  verdict: VerdictSurProduction | null;
  decideLe: number | null;
}

export function avisDuMedia(mediaId: string): AvisDeMedia | null {
  const r = getDb().prepare(`SELECT * FROM medias_avis WHERE media_id = ?`).get(mediaId) as any;
  return r ? { mediaId: r.media_id, questionId: r.question_id, verdict: r.verdict ?? null, decideLe: r.decide_le ?? null } : null;
}

export function poserQuestionDAvis(mediaId: string, questionId: string): void {
  getDb().prepare(`INSERT INTO medias_avis (media_id, question_id) VALUES (?, ?) ON CONFLICT(media_id) DO UPDATE SET question_id = excluded.question_id WHERE verdict IS NULL`).run(mediaId, questionId);
}

/**
 * LE VERDICT DE L'UTILISATEUR SUR UN MÉDIA FINI : il se garde une fois, et
 * écrit une évaluation pour CHAQUE version de méthode qui a produit ce média.
 */
export function enregistrerAvis(mediaId: string, cardId: string, verdict: VerdictSurProduction): void {
  const db = getDb();
  db.transaction(() => {
    const maintenant = Date.now();
    db.prepare(`UPDATE medias_avis SET verdict = ?, decide_le = ? WHERE media_id = ? AND verdict IS NULL`).run(verdict, maintenant, mediaId);
    const ins = db.prepare(`INSERT OR IGNORE INTO methodes_evaluations (version_id, media_id, card_id, verdict, le) VALUES (?, ?, ?, ?, ?)`);
    for (const v of versionsDuMedia(mediaId)) ins.run(v.id, mediaId, cardId, verdict, maintenant);
  })();
}
