import { randomUUID } from 'node:crypto';
import {
  DUREE_SYSTEME_TERMINE_MS,
  PROJET_DU_COFFRE,
  agentSystemeTermine,
  estUnReglageVide,
  misesEnProductionAAfficher,
  retenueParUneEdition,
} from '@beluga/shared';
import {
  Agent,
  Attachment,
  Card,
  CardComment,
  CarteRendue,
  carteNonLue,
  carteNonLueLaPlusRecente,
  peutRedevenirNonLue,
  instantDuRendu,
  carteDepuisLigne,
  colonnesDeLaCarte,
  type LigneCarte,
  ColumnKey,
  DecisionAttendue,
  DicteeEnAttente,
  ProjetJoignable,
  attentionParProjet,
  decisionsDuPremierEnvoi,
  sansDecisionsOrphelines,
  COLONNE_DE_FIN_DE_TOUR,
  decisionsAvecIssue,
  DeployRun,
  fusionnerPropositions,
  Message,
  RepriseDeCompte,
  ErreurDeTour,
  AgentQuestion,
  Project,
  ProjectGroup,
  QueuedPrompt,
  piecesApresModification,
  Settings,
  TaskProposal,
  cleDeSession,
  memeFilAutreCompte,
  cleNouveauDepart,
  colonneFermeLesQuestions,
  COLONNES_QUI_FERMENT_LES_QUESTIONS,
  decisionEnTexteLibre,
  questionEnTexteLibre,
  COLONNE_OU_PARAIT_LA_CARTE_MARKETING,
  LABELS_DE_CARTES_D_ATELIER,
  messageAttendUneReponse,
  type StatutAgent,
  rendusParProjet,
  type AgregatHoraire,
  DETAIL_RETENTION_JOURS,
  RESUME_RETENTION_JOURS,
  jourLocal,
  resumerReleves,
  JOURS_DE_TENDANCE,
  gesteDuParcours,
  gesteEnAttente,
  questionsSansReponse,
  TEXTE_DU_GESTE_ATTENDU,
  type MessageDuParcours,
  type IssueDeTache,
  type MesureDeMemoire,
  type MesureDeTache,
  LigneDuCarnet,
  CARTES_PAR_TRANCHE,
  CARTES_EN_ROUTE_PAR_PAQUET,
  debutsDesDemandes,
  type PremierMessageDeCarte,
  COLONNES_EN_ROUTE,
  type CurseurEnRoute,
  type OngletEnRoute,
  pilesEnRoute,
  type TotauxParColonne,
  definirIdentiteDInstallation,
} from '@beluga/shared';
import {
  HISTOIRE_DU_MOIS_MS,
  REFUS_SUPPRESSION_GROUPE_LOCAL,
  choisirGroupeLocal,
  idDuGroupeLocal,
  type EvenementDUsage,
} from '@beluga/shared';
import { getDb, getMeta, setMeta } from './db.js';
import { carnetDesLectures } from './connaissances.js';
import { log } from './logger.js';

export { getMeta as getMetaValue, setMeta as setMetaValue } from './db.js';

export const now = () => Date.now();
export const newId = () => randomUUID();

/* ------------------------------------------------------------------ */
/* Réglages                                                            */
/* ------------------------------------------------------------------ */

export function getSettings(): Settings {
  const raw = getMeta('settings');
  const base = Settings.parse({});
  if (!raw) return base;
  try {
    return Settings.parse({ ...base, ...JSON.parse(raw) });
  } catch {
    return base;
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const merged = Settings.parse({ ...getSettings(), ...patch });
  setMeta('settings', JSON.stringify(merged));
  // L'identité de l'installation se lit en mémoire partout dans le code : un
  // réglage enregistré vaut tout de suite, sans redémarrage.
  if (patch.installation) definirIdentiteDInstallation(merged.installation);
  return merged;
}

/* ------------------------------------------------------------------ */
/* Projets                                                             */
/* ------------------------------------------------------------------ */

export function listProjects(includeArchived = false): Project[] {
  const rows = getDb()
    .prepare(`SELECT data FROM projects ${includeArchived ? '' : 'WHERE archived = 0'}`)
    .all() as { data: string }[];
  // L'ordre est celui choisi à la main ; à rang égal, par nom.
  return rows
    .map((r) => Project.parse(JSON.parse(r.data)))
    .sort((a, b) => (a.rank ?? 1000) - (b.rank ?? 1000) || a.name.localeCompare(b.name));
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare('SELECT data FROM projects WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? Project.parse(JSON.parse(row.data)) : null;
}

export function getProjectByPath(p: string): Project | null {
  const row = getDb().prepare('SELECT data FROM projects WHERE path = ?').get(p) as { data: string } | undefined;
  return row ? Project.parse(JSON.parse(row.data)) : null;
}

export function saveProject(project: Project): Project {
  const value = Project.parse({ ...project, updatedAt: now() });
  getDb()
    .prepare(
      `INSERT INTO projects (id, name, path, archived, data, created_at, updated_at)
       VALUES (@id, @name, @path, @archived, @data, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, path = excluded.path,
         archived = excluded.archived, data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run({
      id: value.id,
      name: value.name,
      path: value.path,
      archived: value.archived ? 1 : 0,
      data: JSON.stringify(value),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    });
  return value;
}

/**
 * METTRE UN PROJET DE CÔTÉ — ou le remettre en service. C'est le SEUL geste qui
 * retire un projet de la colonne de gauche : rien n'est effacé, ni ses cartes,
 * ni ses conversations, ni ses pièces jointes, ni l'historique de ses mises en
 * ligne.
 *
 * Il n'existe plus d'effacement d'un projet depuis l'interface : le 22/09/2026,
 * le bouton « Effacer » des réglages a détruit d'un clic le projet HaikoDev
 * (94 cartes, 185 conversations), qu'il a fallu reconstruire depuis la
 * sauvegarde de nuit. La commande `project.delete` d'un ancien écran encore
 * ouvert aboutit donc ICI, elle aussi.
 */
export function mettreProjetDeCote(id: string, archived = true): Project | null {
  const project = getProject(id);
  if (!project) return null;
  return saveProject({ ...project, archived });
}

/* ------------------------------------------------------------------ */
/* Historique de consommation des comptes                              */
/* ------------------------------------------------------------------ */

/** Un relevé par compte, au plus un par quart d'heure : de quoi tracer une courbe. */
export function recordQuotaSample(
  account: string,
  sessionPct?: number,
  weeklyPct?: number,
  creditCents?: number,
): void {
  const recent = getDb()
    .prepare('SELECT at FROM quota_samples WHERE account = ? ORDER BY at DESC LIMIT 1')
    .get(account) as { at: number } | undefined;
  if (recent && now() - recent.at < 15 * 60 * 1000) return;

  getDb()
    .prepare(
      'INSERT INTO quota_samples (account, at, session_pct, weekly_pct, credit_cents) VALUES (?, ?, ?, ?, ?)',
    )
    .run(account, now(), sessionPct ?? null, weeklyPct ?? null, creditCents ?? null);

  // On garde quatorze jours de DÉTAIL : au-delà, la courbe n'apprend plus rien,
  // mais le rythme de chaque heure, lui, est retenu dans le résumé.
  compacterQuotaSamples();
}

/**
 * Le ménage des relevés : au-delà de quatorze jours, le détail est REMPLACÉ par
 * son résumé (une ligne par jour et par heure), jamais simplement effacé. Le
 * résumé, lui, tient deux mois — de quoi mesurer une habitude au lieu d'une
 * semaine particulière.
 *
 * Rejouable sans rien doubler : le relevé le plus récent passé sous le seuil
 * est GARDÉ comme point d'ancrage, et le compactage suivant repart de lui — ce
 * qui évite de perdre l'intervalle à cheval sur le seuil comme de le compter
 * deux fois.
 */
export function compacterQuotaSamples(maintenant = now()): void {
  const db = getDb();
  const seuil = maintenant - DETAIL_RETENTION_JOURS * 24 * 3600 * 1000;

  const comptes = db
    .prepare('SELECT DISTINCT account FROM quota_samples WHERE at < ?')
    .all(seuil) as { account: string }[];

  const ajout = db.prepare(
    `INSERT INTO quota_profile (account, jour, heure, duree_ms, consomme_pct) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account, jour, heure) DO UPDATE SET
       duree_ms = duree_ms + excluded.duree_ms,
       consomme_pct = consomme_pct + excluded.consomme_pct`,
  );

  db.transaction(() => {
    for (const { account } of comptes) {
      const rows = db
        .prepare('SELECT at, weekly_pct AS weekly, session_pct AS session FROM quota_samples WHERE account = ? AND at < ? ORDER BY at')
        .all(account, seuil) as { at: number; weekly: number | null; session: number | null }[];
      if (rows.length < 2) continue;

      const releves = rows.map((row) => ({ at: row.at, weekly: row.weekly ?? 0, session: row.session ?? 0 }));
      for (const tranche of resumerReleves(releves, 'weekly')) {
        ajout.run(account, tranche.jour, tranche.heure, tranche.dureeMs, tranche.consommePct);
      }

      // Tout part sauf l'ancre : le dernier relevé passé sous le seuil reste,
      // pour que l'intervalle qui le relie au suivant soit résumé la prochaine fois.
      const ancre = releves[releves.length - 1].at;
      db.prepare('DELETE FROM quota_samples WHERE account = ? AND at < ?').run(account, ancre);
    }

    db.prepare('DELETE FROM quota_profile WHERE jour < ?').run(
      jourLocal(maintenant - RESUME_RETENTION_JOURS * 24 * 3600 * 1000),
    );
  })();
}

/** Le résumé de chaque compte, tel que le calcul du profil le lit. */
export function quotaResume(): Record<string, AgregatHoraire[]> {
  const rows = getDb()
    .prepare('SELECT account, jour, heure, duree_ms AS dureeMs, consomme_pct AS consommePct FROM quota_profile ORDER BY jour, heure')
    .all() as (AgregatHoraire & { account: string })[];
  const out: Record<string, AgregatHoraire[]> = {};
  for (const row of rows) {
    (out[row.account] ??= []).push({
      jour: row.jour,
      heure: row.heure,
      dureeMs: row.dureeMs,
      consommePct: row.consommePct,
    });
  }
  return out;
}

export function quotaHistory(
  days = 7,
): Record<string, { at: number; session: number; weekly: number; credit?: number }[]> {
  const rows = getDb()
    .prepare(
      'SELECT account, at, session_pct AS session, weekly_pct AS weekly, credit_cents AS credit FROM quota_samples WHERE at > ? ORDER BY at',
    )
    .all(now() - days * 24 * 3600 * 1000) as {
    account: string;
    at: number;
    session: number;
    weekly: number;
    credit: number | null;
  }[];
  const out: Record<string, { at: number; session: number; weekly: number; credit?: number }[]> = {};
  for (const row of rows) {
    (out[row.account] ??= []).push({
      at: row.at,
      session: row.session ?? 0,
      weekly: row.weekly ?? 0,
      credit: typeof row.credit === 'number' ? row.credit : undefined,
    });
  }
  return out;
}

/** Le travail déjà mesuré ICI pour ce compte : durée et nombre de tours. */
export function usageDuCompte(account: string): { seconds: number; tours: number } {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(seconds), 0) AS seconds, COUNT(*) AS tours FROM usage WHERE account = ?')
    .get(account) as { seconds: number; tours: number } | undefined;
  return { seconds: row?.seconds ?? 0, tours: row?.tours ?? 0 };
}

/**
 * LES TOURS MESURÉS d'un compte sur les 35 derniers jours, en JETONS : c'est ce
 * que le fournisseur compte. La barre du mois de MiMo s'en sert (règle pure :
 * `shared/src/usage-mesure.ts`).
 */
export function evenementsDUsageDuCompte(compte: string, maintenant = now()): EvenementDUsage[] {
  const rows = getDb()
    .prepare('SELECT created_at AS at, tokens AS valeur FROM usage WHERE account = ? AND created_at > ? ORDER BY created_at')
    .all(compte, maintenant - HISTOIRE_DU_MOIS_MS) as { at: number; valeur: number | null }[];
  return rows.map((r) => ({ at: r.at, valeur: r.valeur ?? 0 }));
}

/* ------------------------------------------------------------------ */
/* Journal des amorces                                                 */
/* ------------------------------------------------------------------ */

export interface AmorceEntree {
  account: string;
  at: number;
  ok: boolean;
  model?: string;
  tokens?: number;
  jusqua?: number;
  error?: string;
}

/**
 * Chaque tentative d'amorçage laisse une ligne, réussie OU ratée : c'est ce
 * qui permet de vérifier depuis l'application que le serveur travaille bien
 * tout seul, sans aller ouvrir la base.
 */
export function recordAmorce(entree: AmorceEntree): void {
  getDb()
    .prepare('INSERT INTO amorce_log (account, at, ok, model, tokens, jusqua, error) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      entree.account,
      entree.at,
      entree.ok ? 1 : 0,
      entree.model ?? null,
      entree.tokens ?? null,
      entree.jusqua ?? null,
      entree.error ?? null,
    );
  // Quatorze jours, comme les relevés de quota : au-delà, plus personne ne regarde.
  getDb().prepare('DELETE FROM amorce_log WHERE at < ?').run(now() - 14 * 24 * 3600 * 1000);
}

/** La dernière tentative connue pour chaque compte, réussie ou non. */
export function dernieresAmorces(): Record<string, { at: number; ok: boolean; error?: string }> {
  const rows = getDb()
    .prepare(
      `SELECT account, at, ok, error FROM amorce_log
       WHERE at = (SELECT MAX(at) FROM amorce_log AS b WHERE b.account = amorce_log.account)`,
    )
    .all() as Record<string, any>[];
  const out: Record<string, { at: number; ok: boolean; error?: string }> = {};
  for (const row of rows) out[row.account] = { at: row.at, ok: !!row.ok, error: row.error ?? undefined };
  return out;
}

/** Les dernières amorces, la plus récente en tête. */
export function amorceHistory(limit = 40): AmorceEntree[] {
  const rows = getDb()
    .prepare('SELECT account, at, ok, model, tokens, jusqua, error FROM amorce_log ORDER BY at DESC LIMIT ?')
    .all(limit) as Record<string, any>[];
  return rows.map((row) => ({
    account: row.account,
    at: row.at,
    ok: !!row.ok,
    model: row.model ?? undefined,
    tokens: row.tokens ?? undefined,
    jusqua: row.jusqua ?? undefined,
    error: row.error ?? undefined,
  }));
}

/* ------------------------------------------------------------------ */
/* Préférences                                                         */
/* ------------------------------------------------------------------ */

/**
 * Tous les réglages d'affichage vivent EN BASE, pas dans le navigateur : on
 * retrouve exactement la même mise en page sur l'ordinateur et sur le
 * téléphone, et rien ne se perd en vidant un cache.
 */
export function readPreferences(): Record<string, unknown> {
  const rows = getDb().prepare('SELECT key, value FROM preferences').all() as { key: string; value: string }[];
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return out;
}

/** Un seul réglage, sans relire les milliers d'autres (la diffusion d'un `prefs.set`). */
export function readPreference(key: string): unknown {
  const row = getDb().prepare('SELECT value FROM preferences WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function writePreference(key: string, value: unknown): void {
  // Un brouillon vide se retire (`estUnReglageVide`) : il alourdissait le premier envoi de 280 Ko.
  if (value === undefined || value === null || estUnReglageVide(key, value)) {
    getDb().prepare('DELETE FROM preferences WHERE key = ?').run(key);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), now());
}

/* ------------------------------------------------------------------ */
/* Images déjà vues                                                    */
/* ------------------------------------------------------------------ */

/**
 * CE QUE CHAQUE COMPTE A DÉJÀ OUVERT EN GRAND (`capture_vues`).
 *
 * Par COMPTE, jamais en commun : l'œil d'une vignette dit « VOUS l'avez déjà
 * ouverte ». Et hors de `preferences`, dont chaque écriture rediffuse le bloc
 * entier à tous les écrans. L'écran ne demande que les clés de la bande qu'il
 * affiche : rien de tout cela ne part au premier envoi.
 */
export function capturesVues(userId: string, cles: readonly string[]): string[] {
  if (!cles.length) return [];
  const lignes = getDb()
    .prepare('SELECT cle FROM capture_vues WHERE user_id = ? AND cle IN (SELECT value FROM json_each(?))')
    .all(userId, JSON.stringify(cles)) as { cle: string }[];
  return lignes.map((ligne) => ligne.cle);
}

/** Retient ces images comme vues, et rend celles qui ne l'étaient PAS encore. */
export function marquerCapturesVues(userId: string, cles: readonly string[], at = now()): string[] {
  const poser = getDb().prepare('INSERT OR IGNORE INTO capture_vues (user_id, cle, vue_le) VALUES (?, ?, ?)');
  const nouvelles: string[] = [];
  getDb().transaction(() => {
    for (const cle of new Set(cles)) if (poser.run(userId, cle, at).changes) nouvelles.push(cle);
  })();
  return nouvelles;
}

/* ------------------------------------------------------------------ */
/* Dictées en attente d'un destinataire                                */
/* ------------------------------------------------------------------ */

/**
 * Une phrase dictée dont on ne sait pas encore à quel projet elle s'adresse.
 * Elle attend EN BASE, et pas en mémoire : entre la question et la réponse il
 * peut se passer des minutes, et un redémarrage perdrait la demande.
 */
export interface DicteeRangee extends DicteeEnAttente {
  id: string;
  agentId: string;
  messageId: string;
  questionId: string;
  regleeA?: number;
}

function lireDictee(row: Record<string, any>): DicteeRangee {
  let candidats: ProjetJoignable[] = [];
  try {
    candidats = JSON.parse(row.candidats);
  } catch {
    /* liste illisible : la question reste ouverte à la réponse libre */
  }
  return {
    id: row.id,
    texte: row.texte,
    projectId: row.project_id ?? undefined,
    candidats,
    agentId: row.agent_id,
    messageId: row.message_id,
    questionId: row.question_id,
    poseeA: row.created_at,
    regleeA: row.reglee_a ?? undefined,
  };
}

export function saveDictee(dictee: Omit<DicteeRangee, 'id' | 'poseeA'> & { id?: string }): DicteeRangee {
  const ligne: DicteeRangee = {
    ...dictee,
    id: dictee.id ?? newId(),
    poseeA: now(),
  };
  getDb()
    .prepare(
      `INSERT INTO dictees (id, texte, project_id, candidats, agent_id, message_id, question_id, created_at, reglee_a)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      ligne.id,
      ligne.texte,
      ligne.projectId ?? null,
      JSON.stringify(ligne.candidats ?? []),
      ligne.agentId,
      ligne.messageId,
      ligne.questionId,
      ligne.poseeA,
    );
  return ligne;
}

/** La dictée qui attendait CETTE question — s'il y en a une. */
export function dicteeDeLaQuestion(questionId: string): DicteeRangee | null {
  const row = getDb().prepare('SELECT * FROM dictees WHERE question_id = ?').get(questionId) as
    | Record<string, any>
    | undefined;
  return row ? lireDictee(row) : null;
}

/**
 * La dernière dictée encore sans réponse : c'est elle qu'une phrase dictée
 * juste après vient trancher, sans passer par l'écran.
 */
export function derniereDicteeEnAttente(): DicteeRangee | null {
  const row = getDb()
    .prepare('SELECT * FROM dictees WHERE reglee_a IS NULL ORDER BY created_at DESC LIMIT 1')
    .get() as Record<string, any> | undefined;
  return row ? lireDictee(row) : null;
}

export function marquerDicteeReglee(id: string): void {
  getDb().prepare('UPDATE dictees SET reglee_a = ? WHERE id = ?').run(now(), id);
}

/* ------------------------------------------------------------------ */
/* Groupes de projets                                                  */
/* ------------------------------------------------------------------ */

export function listGroups(): ProjectGroup[] {
  const rows = getDb()
    .prepare('SELECT id, name, rank, collapsed, color FROM project_groups ORDER BY rank, name')
    .all() as { id: string; name: string; rank: number; collapsed: number; color: string | null }[];
  return rows.map((r) =>
    ProjectGroup.parse({ ...r, collapsed: !!r.collapsed, color: r.color ?? undefined }),
  );
}

export function saveGroup(group: ProjectGroup): ProjectGroup {
  const value = ProjectGroup.parse(group);
  getDb()
    .prepare(
      `INSERT INTO project_groups (id, name, rank, collapsed, color, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, rank = excluded.rank,
         collapsed = excluded.collapsed, color = excluded.color`,
    )
    .run(value.id, value.name, value.rank, value.collapsed ? 1 : 0, value.color ?? null, now());
  return value;
}

export function deleteGroup(id: string): void {
  // Le groupe « Local » abrite l'espace de développement : il ne se supprime
  // pas, quel que soit le chemin (`shared/src/groupe-local.ts`).
  if (id === groupeLocalId()) throw new Error(REFUS_SUPPRESSION_GROUPE_LOCAL);
  const db = getDb();
  db.transaction(() => {
    // Les projets du groupe ne sont pas perdus : ils remontent hors groupe.
    for (const project of listProjects(true).filter((p) => p.groupId === id)) {
      saveProject({ ...project, groupId: undefined });
    }
    db.prepare('DELETE FROM project_groups WHERE id = ?').run(id);
  })();
}

/** Le groupe « Local » : celui où vit le projet `isSelf`, s'il en a un. */
export function groupeLocalId(): string | undefined {
  return idDuGroupeLocal(listProjects(true), listGroups());
}

/**
 * Garantit le groupe « Local » et y range l'espace de développement. Appelé au
 * démarrage, juste après `ensureSelfProject` ; idempotent : un groupe déjà
 * nommé « Local » est repris, jamais doublé.
 */
export function ensureLocalGroup(): ProjectGroup | undefined {
  const soi = listProjects(true).find((p) => p.isSelf && !p.archived);
  if (!soi) return undefined;
  const groupes = listGroups();
  const rangs = [
    ...groupes.map((g) => g.rank),
    ...listProjects().filter((p) => !p.groupId && !p.isSelf).map((p) => p.rank ?? 1000),
  ];
  const choix = choisirGroupeLocal(soi.groupId, groupes, rangs);
  if (choix.geste === 'garder') return groupes.find((g) => g.id === choix.id);
  const groupe =
    choix.geste === 'reprendre'
      ? groupes.find((g) => g.id === choix.id)!
      : saveGroup({ id: newId(), name: choix.nom, rank: choix.rang, collapsed: false });
  // Premier de son groupe : son rang passe sous celui de tous les membres.
  const membres = listProjects(true).filter((p) => p.groupId === groupe.id);
  const rang = membres.length ? Math.min(...membres.map((p) => p.rank ?? 1000)) - 10 : 0;
  saveProject({ ...soi, groupId: groupe.id, rank: rang });
  return groupe;
}

export function nextGroupRank(): number {
  const ranks = listGroups().map((g) => g.rank);
  return ranks.length ? Math.max(...ranks) + 10 : 10;
}

/* ------------------------------------------------------------------ */
/* Cartes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Les listes filles d'une carte — étiquettes, pièces jointes — vivent chacune
 * dans sa table, une ligne par valeur, rangées par `position`. On les relit
 * pour TOUT un projet en une seule requête : une par carte referait, en pire,
 * ce que le JSON faisait.
 */
function listesDeCartes(table: string, colonne: string, projectId?: string): Map<string, string[]> {
  const sql = `SELECT l.card_id AS cardId, l.${colonne} AS valeur
                 FROM ${table} l${projectId ? ' JOIN cards c ON c.id = l.card_id WHERE c.project_id = ?' : ''}
                ORDER BY l.card_id, l.position`;
  const requete = getDb().prepare(sql);
  const rows = (projectId ? requete.all(projectId) : requete.all()) as { cardId: string; valeur: string }[];
  const par = new Map<string, string[]>();
  for (const row of rows) {
    const liste = par.get(row.cardId);
    if (liste) liste.push(row.valeur);
    else par.set(row.cardId, [row.valeur]);
  }
  return par;
}

/**
 * Les mêmes listes, pour les SEULES cartes déjà lues. L'ordonnanceur relit à
 * chaque tick les cartes d'une colonne ou celles armées pour une reprise —
 * souvent aucune : relire alors les étiquettes et pièces jointes de tout le
 * projet (1 500 cartes pour Beluga) était un coût pur, vu dans les gels de
 * `data/logs/blocages.log` (`listesDeCartes < cartesArmeesPourReprise < tick`).
 */
function listesDesCartes(table: string, colonne: string, ids: readonly string[]): Map<string, string[]> {
  const par = new Map<string, string[]>();
  if (!ids.length) return par;
  const rows = getDb()
    .prepare(
      `SELECT card_id AS cardId, ${colonne} AS valeur FROM ${table}
        WHERE card_id IN (SELECT value FROM json_each(?))
        ORDER BY card_id, position`,
    )
    .all(JSON.stringify(ids)) as { cardId: string; valeur: string }[];
  for (const row of rows) {
    const liste = par.get(row.cardId);
    if (liste) liste.push(row.valeur);
    else par.set(row.cardId, [row.valeur]);
  }
  return par;
}

function listeDUneCarte(table: string, colonne: string, cardId: string): string[] {
  const rows = getDb()
    .prepare(`SELECT ${colonne} AS valeur FROM ${table} WHERE card_id = ? ORDER BY position`)
    .all(cardId) as { valeur: string }[];
  return rows.map((r) => r.valeur);
}

/**
 * UNE LIGNE ILLISIBLE NE COÛTE PLUS LE PROJET ENTIER. Chaque carte se relit
 * pour son compte : la ligne qui ne passe plus le modèle est ÉCARTÉE et DITE
 * dans le journal, au lieu de faire tomber la lecture de tout le projet.
 *
 * Sans ce filet, une seule carte restée sur une valeur qu'une migration vient
 * de retirer (le 27/08/2026 : une carte en « done » reposée par l'ancien
 * processus APRÈS la migration 42) casse `project.etat` à l'ouverture du
 * WebSocket et le tick de l'ordonnanceur : l'interface se charge, AUCUN projet
 * n'arrive, et le service redémarre en boucle. Une carte perdue de vue vaut
 * mieux qu'une application inaccessible — et le WARN dit laquelle rattraper.
 */
export function listCards(projectId: string): Card[] {
  const rows = getDb()
    .prepare('SELECT * FROM cards WHERE project_id = ? ORDER BY position DESC')
    .all(projectId) as LigneCarte[];
  const labels = listesDeCartes('card_labels', 'label', projectId);
  const attachments = listesDeCartes('card_attachments', 'path', projectId);
  const cartes: Card[] = [];
  for (const row of rows) {
    try {
      cartes.push(
        carteDepuisLigne(row, { labels: labels.get(row.id), attachments: attachments.get(row.id) }),
      );
    } catch (err: any) {
      log.warn(
        `carte illisible écartée : ${row.id} (projet ${projectId}, colonne « ${row.column_key} »)`,
        err?.message ?? err,
      );
    }
  }
  return cartes;
}

/**
 * LES CARTES DE L'AGENT MARKETING NE PARAISSENT NI SUR LE TABLEAU NI SUR « EN
 * ROUTE » TANT QU'ELLES NE SONT PAS EN TRAVAIL (`carteMarketingCachee`,
 * `shared/src/marketing.ts`) : rangées, elles se suivent dans l'outil
 * Marketing. Une carte en « En cours » — un agent y travaille, elle attend une
 * réponse, ou elle est en veille — paraît comme les autres. Écarté ICI, en
 * SQL, pour que les paquets et les compteurs de colonne disent ce que la liste
 * montre ; l'écran applique la même règle.
 *
 * (L'ancienne phrase « la cloche les garde » ne tenait pas : une carte rangée
 * en « Archivé » FERME ses questions, cloche comprise. C'est la fin de tour qui
 * retient désormais une carte de volet sur sa question — `questionEnTexteSurLaCarte`.)
 */
const SANS_MARKETING_SEUL = `(c.column_key = '${COLONNE_OU_PARAIT_LA_CARTE_MARKETING}' OR NOT EXISTS (SELECT 1 FROM card_labels ml WHERE ml.card_id = c.id AND ml.label IN (${LABELS_DE_CARTES_D_ATELIER.map((l) => `'${l.replace(/'/g, "''")}'`).join(', ')})))`;

/**
 * LES ÉTAPES D'UNE SUITE NE PARAISSENT PAS SEULES SUR LE TABLEAU DU PROJET : elles
 * se lisent DANS leur carte globale, dans l'ordre (`estEtapeDeSuite`,
 * `shared/src/suite-de-cartes.ts`). Écartées ici, en SQL, pour que les paquets
 * et les compteurs de colonne disent ce que la liste montre ; l'écran applique
 * la même règle aux cartes arrivées par diffusion. La page « Tableaux de bord »
 * les garde : elle range les cartes par famille (`cleDeFamille`).
 */
const SANS_MARKETING = `(${SANS_MARKETING_SEUL} AND c.rang_dans_la_suite IS NULL)`;

/**
 * LES ÉTAPES DES SUITES PRÉSENTES DANS UN PAQUET VOYAGENT AVEC LEUR CARTE
 * GLOBALE : elles ne sont dans aucun paquet de colonne (`SANS_MARKETING`), mais
 * le tableau les déplie sous elle (`PileDeCartes`). Elles ne comptent dans
 * aucun total.
 */
function avecLesEtapesDesSuites(rows: LigneCarte[]): LigneCarte[] {
  const tetes = rows.filter((row) => row.tete_de_suite === 1).map((row) => row.id);
  if (!tetes.length) return rows;
  const etapes = getDb()
    .prepare(`SELECT * FROM cards WHERE carte_mere_id IN (SELECT value FROM json_each(?)) AND rang_dans_la_suite IS NOT NULL`)
    .all(JSON.stringify(tetes)) as LigneCarte[];
  return [...rows, ...etapes];
}

/**
 * LA PREMIÈRE TRANCHE DE CHAQUE COLONNE, ET LE TOTAL RÉEL DE CHACUNE
 * (`shared/src/tranches-de-cartes.ts`). C'est ce qui part à l'ouverture d'un
 * projet, à la place de toutes ses cartes : un paquet de l'écran par colonne,
 * de la plus haute position à la plus basse — l'ordre du tableau. Les totaux
 * sont comptés en SQL, et comptent donc aussi une éventuelle ligne illisible
 * que la lecture aurait écartée : un compteur qui dit une carte de plus vaut
 * mieux qu'un compteur qui la cache.
 */
export function premiereTrancheDeCartes(
  projectId: string,
  parColonne: number = CARTES_PAR_TRANCHE,
): { cards: Card[]; totaux: TotauxParColonne } {
  const rows = getDb()
    .prepare(
      `SELECT * FROM (
         SELECT c.*, ROW_NUMBER() OVER (PARTITION BY column_key ORDER BY position DESC) AS rang
           FROM cards c WHERE project_id = ? AND ${SANS_MARKETING}
       ) WHERE rang <= ? ORDER BY position DESC`,
    )
    .all(projectId, parColonne) as (LigneCarte & { rang: number })[];
  const comptes = getDb()
    .prepare(`SELECT column_key AS colonne, COUNT(*) AS n FROM cards c WHERE project_id = ? AND ${SANS_MARKETING} GROUP BY column_key`)
    .all(projectId) as { colonne: string; n: number }[];
  const totaux: TotauxParColonne = {};
  for (const compte of comptes) totaux[compte.colonne] = compte.n;
  return { cards: cartesDepuisLignes(avecLesEtapesDesSuites(rows), projectId), totaux };
}

/**
 * LA TRANCHE SUIVANTE D'UNE COLONNE : les cartes SOUS une position donnée, par
 * paquet. Par position et non par rang : une carte créée ou déplacée entre
 * deux demandes ne décale rien, et rien n'arrive deux fois.
 */
/** La date de la carte modifiée le plus récemment, projet par projet. */
export function activiteDesProjets(): Record<string, number> {
  const rows = getDb()
    .prepare('SELECT project_id AS projectId, MAX(updated_at) AS at FROM cards GROUP BY project_id')
    .all() as { projectId: string; at: number }[];
  return Object.fromEntries(rows.map((row) => [row.projectId, row.at]));
}

export function trancheDeCartes(
  projectId: string,
  column: ColumnKey,
  avantPosition: number | undefined,
  limite: number = CARTES_PAR_TRANCHE,
): { cards: Card[]; total: number } {
  const rows = (
    avantPosition === undefined
      ? getDb()
          .prepare(`SELECT * FROM cards c WHERE project_id = ? AND column_key = ? AND ${SANS_MARKETING} ORDER BY position DESC LIMIT ?`)
          .all(projectId, column, limite)
      : getDb()
          .prepare(
            `SELECT * FROM cards c WHERE project_id = ? AND column_key = ? AND position < ? AND ${SANS_MARKETING} ORDER BY position DESC LIMIT ?`,
          )
          .all(projectId, column, avantPosition, limite)
  ) as LigneCarte[];
  const total = (
    getDb()
      .prepare(`SELECT COUNT(*) AS n FROM cards c WHERE project_id = ? AND column_key = ? AND ${SANS_MARKETING}`)
      .get(projectId, column) as { n: number }
  ).n;
  return { cards: cartesDepuisLignes(avecLesEtapesDesSuites(rows), projectId), total };
}

/** Une carte trouvée par la recherche : la carte, et son rang dans sa colonne (1 = en tête). */
export interface CarteTrouvee {
  card: Card;
  rang: number;
}

/**
 * RETROUVER UNE CARTE PAR SON TITRE, SANS TOUT FAIRE DESCENDRE. Le tableau ne
 * pose que des paquets de vingt (`trancheDeCartes`) : une carte archivée il y
 * a deux semaines est 181e de sa colonne, invisible sans faire défiler des
 * centaines de cartes. La recherche se fait ICI, en SQL sur le titre et la
 * description, et ne rend que les cartes trouvées — avec leur rang dans la
 * colonne pour qu'on sache où elles sont. Sans projet : tous les projets.
 * Les étapes d'une suite et les cartes rangées de l'atelier Marketing restent
 * hors du tableau, donc hors de la recherche (`SANS_MARKETING`).
 */
export function rechercherDesCartes(
  texte: string,
  options: { projectId?: string; colonnes?: readonly ColumnKey[]; limite?: number } = {},
): CarteTrouvee[] {
  const mots = texte
    .trim()
    .split(/\s+/)
    .filter((mot) => mot.length > 0)
    .slice(0, 8);
  if (!mots.length) return [];
  const motif = (mot: string) => `%${mot.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const conditions = [SANS_MARKETING];
  const valeurs: (string | number)[] = [];
  for (const mot of mots) {
    conditions.push(`(c.title LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')`);
    valeurs.push(motif(mot), motif(mot));
  }
  if (options.projectId) {
    conditions.push('c.project_id = ?');
    valeurs.push(options.projectId);
  }
  if (options.colonnes?.length) {
    conditions.push(`c.column_key IN (${options.colonnes.map(() => '?').join(', ')})`);
    valeurs.push(...options.colonnes);
  }
  const limite = Math.min(Math.max(options.limite ?? 20, 1), 50);
  const rows = getDb()
    .prepare(`SELECT * FROM cards c WHERE ${conditions.join(' AND ')} ORDER BY c.updated_at DESC LIMIT ?`)
    .all(...valeurs, limite) as LigneCarte[];
  const rang = getDb().prepare(
    `SELECT COUNT(*) AS n FROM cards c WHERE c.project_id = ? AND c.column_key = ? AND c.position > ? AND ${SANS_MARKETING}`,
  );
  const trouvees: CarteTrouvee[] = [];
  for (const row of rows) {
    const [card] = cartesDepuisLignes([row], row.project_id);
    if (!card) continue;
    trouvees.push({ card, rang: (rang.get(row.project_id, row.column_key, row.position) as { n: number }).n + 1 });
  }
  return trouvees;
}

/**
 * LA PAGE « EN ROUTE » (`shared/src/en-route.ts`) : une de ses trois colonnes
 * (`OngletEnRoute` : « Actifs », « Terminer », « Archiver »), avec les cartes de
 * tous les projets EN SERVICE (un projet mis de côté n'y paraît pas), dans l'ordre de `comparerDerniereAction`
 * — la même clé écrite en SQL : la DERNIÈRE ACTION (`updated_at`) d'abord. Par
 * paquet, sous la clé de la dernière FAMILLE reçue : une carte qui change de
 * place entre deux demandes ne décale rien. `restant` compte les familles qui
 * restent SOUS le dernier paquet.
 *
 * Une demande commune (mère + filles) y est UNE entrée (`pilesEnRoute`) : ses
 * filles déjà en ligne et sa mère rangée viennent avec elle dans la colonne
 * que la famille entière réclame (`placeDeLaFamille`).
 */
export function cartesEnRoute(
  apres: CurseurEnRoute | undefined,
  limite: number = CARTES_EN_ROUTE_PAR_PAQUET,
  onglet: OngletEnRoute = 'actif',
): { cards: Card[]; restant: number; curseur?: CurseurEnRoute } {
  return famillesParDerniereAction(onglet, apres, limite);
}

/**
 * LE PAQUET COMMUN AUX TROIS COLONNES, PAR FAMILLE (`pilesEnRoute` et
 * `placeDeLaFamille`, la même règle écrite en SQL).
 *
 *   1. `cand` : les familles qui ont une carte candidate — Demande ou Travail
 *      pour « Actifs », finie (À déployer ou Archivé) et pas rangée sur la
 *      page pour « Terminer » (index `idx_cards_a_terminer`), finie et rangée
 *      pour « Archiver » (`rangeeTableauDeBordAt`) ;
 *   2. `membres` : toutes les cartes de ces familles, la mère par sa clé, les
 *      filles par `carte_mere_id` (index `idx_cards_carte_mere`) ;
 *   3. `familles` : la clé de tri (dernière action de la plus récente carte
 *      affichée) et, par colonne, le nombre de cartes — la famille va dans la
 *      plus à gauche que ses cartes réclament.
 *
 * Le curseur `{updatedAt, id}` est celui d'une famille (`curseurApresPile`) ;
 * pour une carte seule, c'est exactement la clé de la carte. Chaque famille
 * du paquet arrive ENTIÈRE, même au-delà de la limite : elle ne se coupe
 * jamais entre deux paquets.
 */
function famillesParDerniereAction(
  onglet: OngletEnRoute,
  apres: CurseurEnRoute | undefined,
  limite: number,
): { cards: Card[]; restant: number; curseur?: CurseurEnRoute } {
  const enRoute = JSON.stringify(COLONNES_EN_ROUTE);
  const candidate =
    onglet === 'actif'
      ? `c.column_key IN (SELECT value FROM json_each(@enRoute))`
      : onglet === 'terminer'
        ? `c.column_key IN ('to_deploy', 'archived') AND c.rangee_tableau_de_bord_at IS NULL`
        : `c.column_key IN ('to_deploy', 'archived') AND c.rangee_tableau_de_bord_at IS NOT NULL`;
  const avec = `
    WITH cand AS (
      SELECT DISTINCT COALESCE(c.carte_mere_id, c.id) AS fam
        FROM cards c JOIN projects p ON p.id = c.project_id
       WHERE p.archived = 0 AND ${candidate} AND ${SANS_MARKETING_SEUL}
    ),
    membres AS (
      SELECT cand.fam, m.id, m.updated_at, m.column_key, m.deployed_at, m.project_id, m.rangee_tableau_de_bord_at
        FROM cand JOIN cards m ON m.id = cand.fam
      UNION ALL
      SELECT cand.fam, m.id, m.updated_at, m.column_key, m.deployed_at, m.project_id, m.rangee_tableau_de_bord_at
        FROM cand JOIN cards m ON m.carte_mere_id = cand.fam
    ),
    visibles AS (
      SELECT x.*, (x.column_key IN (SELECT value FROM json_each(@enRoute))) AS en_route,
             (x.column_key IN ('to_deploy', 'archived') AND x.rangee_tableau_de_bord_at IS NULL) AS a_terminer,
             (x.column_key IN ('to_deploy', 'archived') AND x.rangee_tableau_de_bord_at IS NOT NULL) AS archivee
        FROM membres x JOIN projects p ON p.id = x.project_id
       WHERE p.archived = 0
    ),
    familles AS (
      SELECT fam,
             MAX(CASE WHEN en_route OR a_terminer OR archivee OR id = fam THEN updated_at END) AS u,
             SUM(en_route) AS en_route,
             SUM(a_terminer) AS a_terminer
        FROM visibles GROUP BY fam
    )`;
  // `placeDeLaFamille` : la colonne la plus à gauche que la famille réclame.
  const garde =
    onglet === 'actif'
      ? 'en_route > 0'
      : onglet === 'terminer'
        ? 'en_route = 0 AND a_terminer > 0'
        : 'en_route = 0 AND a_terminer = 0';
  const sous = `(u < @u OR (u = @u AND fam < @id))`;
  const args = (k?: CurseurEnRoute) => ({ enRoute, ...(k ? { u: k.updatedAt, id: k.id } : {}) });
  const db = getDb();
  const familles = db
    .prepare(
      `${avec} SELECT fam, u FROM familles WHERE u IS NOT NULL AND ${garde} ${apres ? `AND ${sous}` : ''}
        ORDER BY u DESC, fam DESC LIMIT @limite`,
    )
    .all({ ...args(apres), limite }) as { fam: string; u: number }[];
  if (!familles.length) return { cards: [], restant: 0 };
  const cles = JSON.stringify(familles.map((f) => f.fam));
  // Deux lectures par index (la mère par sa clé, les filles par leur lien)
  // plutôt qu'un `OR` qui parcourrait toute la table.
  const lire = (lien: string) =>
    db
      .prepare(
        `SELECT c.* FROM cards c JOIN projects p ON p.id = c.project_id
          WHERE p.archived = 0 AND ${lien} IN (SELECT value FROM json_each(?))`,
      )
      .all(cles) as LigneCarte[];
  const rows = [...lire('c.id'), ...lire('c.carte_mere_id')];
  const parProjet = new Map<string, LigneCarte[]>();
  for (const row of rows) {
    const liste = parProjet.get(row.project_id);
    if (liste) liste.push(row);
    else parProjet.set(row.project_id, [row]);
  }
  const lues: Card[] = [];
  for (const [projectId, lignes] of parProjet) lues.push(...cartesDepuisLignes(lignes, projectId));
  // L'ordre de la page : famille par famille, la mère puis la dernière action.
  const rang = new Map(familles.map((f, i) => [f.fam, i]));
  const cards = pilesEnRoute(lues, onglet)
    .sort((a, b) => (rang.get(a.cle) ?? 0) - (rang.get(b.cle) ?? 0))
    .flatMap((pile) => pile.cartes);
  const derniere = familles[familles.length - 1];
  const curseur = { updatedAt: derniere.u, id: derniere.fam };
  const restant = (
    db
      .prepare(`${avec} SELECT COUNT(*) AS n FROM familles WHERE u IS NOT NULL AND ${garde} AND ${sous}`)
      .get(args(curseur)) as { n: number }
  ).n;
  return { cards, restant, curseur };
}

/**
 * LES CARTES MISES EN LIGNE RESTÉES EN « À DÉPLOYER » : une publication passée
 * sous la règle retirée « plus d'archivage automatique » (08/10/2026) les y a
 * laissées. Une carte qui ENTRE dans « À déployer » perd sa date (DEC-149) :
 * aucune autre ne peut y porter une date de mise en ligne.
 */
export function idsDesCartesEnLigneRestees(): string[] {
  return (
    getDb()
      .prepare(`SELECT id FROM cards WHERE column_key = 'to_deploy' AND deployed_at > 0`)
      .all() as { id: string }[]
  ).map((r) => r.id);
}

/**
 * LE DÉBUT DE LA DEMANDE de chaque carte d'un paquet de la page « En route »
 * (`debutsDesDemandes`, `shared/src/en-route.ts`) : le premier message écrit
 * par l'utilisateur dans la conversation de la carte. UNE requête pour tout le
 * paquet : les agents de la carte (`idx_agents_card`) et la conversation
 * rattachée (`conversationAgentId`), puis le premier message `user` de chacun
 * par `idx_messages_agent` — seul son `content` est extrait, jamais les étapes.
 */
export function debutsDesDemandesDesCartes(cards: readonly Card[]): Record<string, string> {
  if (!cards.length) return {};
  const rattachees = cards
    .filter((card) => card.conversationAgentId)
    .map((card) => [card.id, card.conversationAgentId]);
  const rows = getDb()
    .prepare(
      `WITH paires(carte, agent) AS (
         SELECT card_id, id FROM agents WHERE card_id IN (SELECT value FROM json_each(?))
         UNION
         SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)
       )
       SELECT p.carte AS carte, m.created_at AS creeA, json_extract(m.data, '$.content') AS contenu
         FROM paires p
         JOIN messages m ON m.id = (
           SELECT m2.id FROM messages m2
            WHERE m2.agent_id = p.agent AND m2.role = 'user'
            ORDER BY m2.created_at LIMIT 1
         )`,
    )
    .all(JSON.stringify(cards.map((card) => card.id)), JSON.stringify(rattachees)) as PremierMessageDeCarte[];
  return debutsDesDemandes(rows);
}

/**
 * Les agents utiles aux cartes de la page « En route » : ceux qui y
 * travaillent, et le dernier agent de chacune (sa liste de tâches se lit sur
 * la carte même une fois le tour fini).
 */
export function agentsDesCartes(cards: readonly Card[]): Agent[] {
  if (!cards.length) return [];
  const rows = getDb()
    .prepare(
      `SELECT data FROM agents
        WHERE id IN (SELECT value FROM json_each(?))
           OR (card_id IN (SELECT value FROM json_each(?)) AND status IN ('running', 'starting'))`,
    )
    .all(
      JSON.stringify(cards.map((card) => card.agentId).filter(Boolean)),
      JSON.stringify(cards.map((card) => card.id)),
    ) as { data: string }[];
  return rows.map((r) => Agent.parse(JSON.parse(r.data)));
}

/** Les lignes relues une à une, chacune protégée par le même filet que `listCards`. */
function cartesDepuisLignes(rows: LigneCarte[], projectId: string): Card[] {
  if (!rows.length) return [];
  const labels = listesDeCartes('card_labels', 'label', projectId);
  const attachments = listesDeCartes('card_attachments', 'path', projectId);
  const cartes: Card[] = [];
  for (const row of rows) {
    try {
      cartes.push(
        carteDepuisLigne(row, { labels: labels.get(row.id), attachments: attachments.get(row.id) }),
      );
    } catch (err: any) {
      log.warn(
        `carte illisible écartée : ${row.id} (projet ${projectId}, colonne « ${row.column_key} »)`,
        err?.message ?? err,
      );
    }
  }
  return cartes;
}

export function listCardsInColumn(projectId: string, column: ColumnKey): Card[] {
  const rows = getDb()
    .prepare('SELECT * FROM cards WHERE project_id = ? AND column_key = ? ORDER BY position DESC')
    .all(projectId, column) as LigneCarte[];
  const ids = rows.map((r) => r.id);
  const labels = listesDesCartes('card_labels', 'label', ids);
  const attachments = listesDesCartes('card_attachments', 'path', ids);
  const cartes: Card[] = [];
  for (const row of rows) {
    try {
      cartes.push(
        carteDepuisLigne(row, { labels: labels.get(row.id), attachments: attachments.get(row.id) }),
      );
    } catch (err: any) {
      log.warn(
        `carte illisible écartée : ${row.id} (projet ${projectId}, colonne « ${row.column_key} »)`,
        err?.message ?? err,
      );
    }
  }
  return cartes;
}

/**
 * LES CARTES ARMÉES POUR UNE REPRISE AUTOMATIQUE, dans un projet donné.
 *
 * L'ordonnanceur cherche, hors de « Planifié » et « En cours », les cartes
 * marquées `scheduling.reprendreDesQuePossible` — un lancement refusé faute de
 * quota qui doit repartir tout seul dès que la porte se rouvre. Ce marquage vit
 * dans le JSON résiduel de la carte : l'index partiel de la colonne générée
 * `a_reprise_armee` (migration 145) ne lit que les cartes qui la portent, le
 * `LIKE` reste derrière, et le tri fin (colonne, `suspendu`) reste en
 * JavaScript après coup.
 */
export function cartesArmeesPourReprise(projectId: string): Card[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM cards
        WHERE project_id = ? AND a_reprise_armee = 1 AND data LIKE '%reprendreDesQuePossible%'
        ORDER BY position DESC`,
    )
    .all(projectId) as LigneCarte[];
  const ids = rows.map((r) => r.id);
  const labels = listesDesCartes('card_labels', 'label', ids);
  const attachments = listesDesCartes('card_attachments', 'path', ids);
  const cartes: Card[] = [];
  for (const row of rows) {
    try {
      cartes.push(
        carteDepuisLigne(row, { labels: labels.get(row.id), attachments: attachments.get(row.id) }),
      );
    } catch (err: any) {
      log.warn(
        `carte illisible écartée : ${row.id} (projet ${projectId}, colonne « ${row.column_key} »)`,
        err?.message ?? err,
      );
    }
  }
  return cartes;
}

/**
 * LES CARTES QU'UN TOUR D'EXÉCUTION TENAIT ENCORE, tous projets confondus.
 *
 * La marque (`scheduling.tourEnVolDepuis`) vit dans le JSON résiduel de la
 * carte : on présélectionne en SQL sur son nom, puis on relit vraiment — le
 * `LIKE` dégrossit, il ne juge pas. Lue une seule fois, au démarrage du démon,
 * pour rendre honnêtes les tâches coupées en vol
 * (`shared/src/carte-interrompue.ts`).
 */
export function cartesEnVol(): Card[] {
  const rows = getDb()
    .prepare("SELECT * FROM cards WHERE data LIKE '%tourEnVolDepuis%'")
    .all() as LigneCarte[];
  return rows
    .map((row) =>
      carteDepuisLigne(row, {
        labels: listeDUneCarte('card_labels', 'label', row.id),
        attachments: listeDUneCarte('card_attachments', 'path', row.id),
      }),
    )
    .filter((carte) => !!carte.scheduling?.tourEnVolDepuis);
}

/**
 * TOUTES LES CARTES DE « TRAVAIL » ET DE « PLAN », tous projets confondus.
 *
 * Le balayage des cartes oubliées (`rangerLesCartesOubliees`) en a besoin sans
 * connaître les projets un par un : une carte bloquée l'est quel que soit le
 * projet ouvert à l'écran. La colonne est une VRAIE colonne SQL depuis la
 * migration 17 : la requête juge, elle ne dégrossit pas.
 *
 */
/**
 * LES SUITES D'ÉTAPES ENCORE OUVERTES — leur carte globale en « En cours » ou
 * en « À déployer » (`shared/src/suite-de-cartes.ts`). Relues au démarrage du
 * démon : une étape finie pendant qu'il était arrêté doit encore lancer la
 * suivante. Lecture par l'index partiel `idx_cards_tete_de_suite`.
 */
export function tetesDeSuiteOuvertes(): Card[] {
  const rows = getDb()
    .prepare("SELECT id FROM cards WHERE tete_de_suite = 1 AND column_key IN ('running', 'to_deploy')")
    .all() as { id: string }[];
  return rows.map((row) => getCard(row.id)).filter((carte): carte is Card => !!carte);
}

export function cartesEnCours(): Card[] {
  const rows = getDb()
    .prepare("SELECT * FROM cards WHERE column_key = 'running'")
    .all() as LigneCarte[];
  return rows.map((row) =>
    carteDepuisLigne(row, {
      labels: listeDUneCarte('card_labels', 'label', row.id),
      attachments: listeDUneCarte('card_attachments', 'path', row.id),
    }),
  );
}

/**
 * LES CARTES QUI PORTENT UNE DEMANDE DE PLAN ENCORE OUVERTE.
 *
 * `planDemandeA` vit dans le JSON résiduel de la carte : le `LIKE` dégrossit,
 * il ne juge pas — la lecture qui suit relit vraiment chaque carte. Sert au
 * balayage des étapes dont le tour est mort (`refermerLesEtapesSansTour`), qui
 * doit voir les cartes de TOUTES les colonnes : une demande de plan vit dans
 * « Planifié », pas dans « En cours ».
 */
export function cartesAvecDemandeDePlan(): Card[] {
  const rows = getDb()
    /* L'index partiel d'abord (migration 145), le `LIKE` derrière. */
    .prepare("SELECT * FROM cards WHERE a_plan_demande = 1 AND data LIKE '%\"planDemandeA\":%'")
    .all() as LigneCarte[];
  return rows
    .map((row) =>
      carteDepuisLigne(row, {
        labels: listeDUneCarte('card_labels', 'label', row.id),
        attachments: listeDUneCarte('card_attachments', 'path', row.id),
      }),
    )
    .filter((card) => !!card.parcours?.planDemandeA);
}

export function getCard(id: string): Card | null {
  const row = getDb().prepare('SELECT * FROM cards WHERE id = ?').get(id) as LigneCarte | undefined;
  if (!row) return null;
  return carteDepuisLigne(row, {
    labels: listeDUneCarte('card_labels', 'label', id),
    attachments: listeDUneCarte('card_attachments', 'path', id),
  });
}

/**
 * CE QUI VEUT SAVOIR QU'UNE CARTE A CHANGÉ DE COLONNE OU EST PASSÉE EN LIGNE.
 *
 * Une carte change de colonne à une dizaine d'endroits du démon (lancement,
 * fin de tour, arrêt, publication, glisser…) : les suivre un par un, c'est se
 * promettre d'en rater un. Ils passent TOUS par `saveCard` — c'est donc ici que
 * le passage se constate, une fois pour toutes. Un observateur qui tombe ne
 * fait JAMAIS échouer l'enregistrement : l'erreur est avalée, la carte est
 * écrite. Un observateur doit rester bref ; ce qui prend du temps se diffère.
 */
export type ObservateurDeCarte = (
  avant: { column: string; deployedAt?: number } | null,
  apres: Card,
  details?: DetailsDEnregistrement,
) => void;

/**
 * CE QUE L'ÉCRITURE DIT D'ELLE-MÊME AUX OBSERVATEURS. `retourSansTravail` : une
 * carte relancée revient dans « À déployer » parce que son cadrage n'a fait
 * que répondre — du dehors, elle n'a jamais quitté le lot, et rien n'y a été
 * terminé (`colonneApresReponseSansCadrage`).
 */
export interface DetailsDEnregistrement {
  retourSansTravail?: boolean;
}
const observateursDeCarte = new Set<ObservateurDeCarte>();

export function observerLesCartes(observateur: ObservateurDeCarte): () => void {
  observateursDeCarte.add(observateur);
  return () => observateursDeCarte.delete(observateur);
}

/**
 * L'EMPREINTE DU CONTENU D'UNE CARTE : tout, sauf `updatedAt` et `lastReadAt`.
 * Les clés sont triées, pour qu'un même contenu donne la même chaîne quel que
 * soit l'ordre dans lequel l'objet a été bâti.
 */
function empreinteDuContenu(card: Card): string {
  const trier = (valeur: unknown): unknown => {
    if (Array.isArray(valeur)) return valeur.map(trier);
    if (valeur && typeof valeur === 'object') {
      return Object.fromEntries(
        Object.keys(valeur as Record<string, unknown>)
          .filter((clef) => (valeur as Record<string, unknown>)[clef] !== undefined)
          .sort()
          .map((clef) => [clef, trier((valeur as Record<string, unknown>)[clef])]),
      );
    }
    return valeur;
  };
  /*
   * UN PASSAGE DE VEILLE N'EST PAS UNE ACTION SUR LA CARTE. Le résumé de veille
   * se réécrit à chaque contrôle (dernier passage, prochain) : sans ce retrait,
   * la carte remonterait en tête des tableaux de bord toutes les heures. Poser,
   * lever ou laisser expirer la veille, eux, comptent.
   */
  const veille = card.veille ? { id: card.veille.id, etat: card.veille.etat, raison: card.veille.raison, echeance: card.veille.echeance } : undefined;
  return JSON.stringify(trier({ ...card, veille, updatedAt: undefined, lastReadAt: undefined }));
}

export function saveCard(card: Card, options: { action?: boolean } & DetailsDEnregistrement = {}): Card {
  const db = getDb();
  const instant = now();
  // La photo d'avant : une clé primaire, rien de plus. Elle sert aux observateurs
  // ET à la règle « changer de colonne vaut lecture » juste en dessous, donc elle
  // est lue à chaque écriture.
  const avant = db.prepare('SELECT column_key, deployed_at, updated_at FROM cards WHERE id = ?').get(card.id) as
    | { column_key: string; deployed_at: number | null; updated_at: number }
    | undefined;
  /**
   * CHANGER DE COLONNE VAUT CONSULTATION.
   *
   * Déplacer une carte — à la main comme par le démon — remet son repère de
   * lecture à l'heure, ce qui éteint la pastille bleue et fait redescendre le
   * compteur du projet. La règle se pose ICI plutôt que dans la dizaine de
   * chemins qui rangent les cartes (lancement, fin de tour, archivage,
   * publication, retour en arrière…) : aucun d'eux ne peut l'oublier.
   *
   * Deux bornes : une carte ABSENTE de la base est une CRÉATION, pas un
   * déplacement, et rien n'y est touché ; un `lastReadAt` déjà PLUS RÉCENT que
   * l'instant présent (l'appelant a dit mieux) l'emporte.
   *
   * UNE EXCEPTION, ET UNE SEULE : LA CLÔTURE D'UN TRAVAIL RENDU.
   *
   * Depuis le retrait de la colonne « Rapport », un tour rendu range la carte
   * de « Travail » DIRECTEMENT dans « À déployer » — c'est le moment même où
   * le compte rendu arrive, et c'est précisément ce qu'on veut voir signalé.
   * La règle générale l'aurait éteint au passage. Ce chemin-là garde donc la
   * pastille : la carte reste non lue jusqu'à ce qu'on l'ouvre.
   *
   * C'est bien une transition, pas un drapeau d'appelant : le glissement à la
   * main de « Travail » vers « À déployer » est REFUSÉ
   * (`RAISON_RAPPORT_A_LA_MAIN`), donc ce passage ne peut venir que d'une
   * clôture — fin de tour, balayage des cartes oubliées, bouton « Terminer ».
   *
   * Tous les autres déplacements gardent la règle : l'archivage, la mise en
   * ligne, un retour en arrière, un glissement valent consultation.
   */
  const clotureDUnTravailRendu =
    avant?.column_key === 'running' && card.column === COLONNE_DE_FIN_DE_TOUR;
  const changeDeColonne = !!avant && avant.column_key !== card.column && !clotureDUnTravailRendu;
  const value = Card.parse({
    ...card,
    updatedAt: instant,
    lastReadAt: changeDeColonne ? Math.max(instant, card.lastReadAt ?? 0) : card.lastReadAt,
  });
  /* Une carte qui repart en Demande ou Travail perd son rangement de la page
     « Tableaux de bord » : finie de nouveau, elle reparaîtra dans « Terminer ».
     La clé disparaît (jamais `undefined` écrit) : la carte se relit à l'identique. */
  if ((COLONNES_EN_ROUTE as readonly string[]).includes(value.column) || value.rangeeTableauDeBordAt == null) {
    delete value.rangeeTableauDeBordAt;
  }
  /*
   * `updatedAt` EST LA DERNIÈRE ACTION SUR LA CARTE, PAS SA DERNIÈRE ÉCRITURE.
   *
   * La page « En route » range ses deux onglets sur cette date et l'affiche en
   * bas de chaque carte (`shared/src/en-route.ts`). Or ouvrir une carte
   * (`markCardRead`), tout marquer lu sur un projet, ou un balayage qui
   * réenregistre une carte sans rien y changer passent aussi par ici : sans
   * cette garde, LIRE une carte la faisait remonter en tête et remettait son
   * ancienneté à zéro. Quand rien d'autre que le repère de lecture n'a bougé,
   * l'ancienne date est donc gardée. `action` force la date : un message
   * envoyé dans le fil de la carte est une action sans rien changer à la carte
   * elle-même (`marquerUneAction`).
   */
  if (avant && !options.action) {
    const ancienne = getCard(card.id);
    if (ancienne && empreinteDuContenu(ancienne) === empreinteDuContenu(value)) value.updatedAt = avant.updated_at;
  }
  const colonnes = colonnesDeLaCarte(value);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at,
                          description, origin, agent_id, conversation_agent_id, analyse_demandee,
                          code_deja_enregistre, hors_tache, excluded_from_deploy, done_at, archived_at,
                          rangee_tableau_de_bord_at, last_read_at, run_engine, run_model, run_thinking, run_mode, carte_mere_id,
                          branche_choisie, branche_de_depart, tete_de_suite, rang_dans_la_suite, etape_finie_at,
                          depart_de_la_suite_at)
       VALUES (@id, @project_id, @column_key, @position, @title, @data, @deployed_at, @created_at, @updated_at,
               @description, @origin, @agent_id, @conversation_agent_id, @analyse_demandee,
               @code_deja_enregistre, @hors_tache, @excluded_from_deploy, @done_at, @archived_at,
               @rangee_tableau_de_bord_at, @last_read_at, @run_engine, @run_model, @run_thinking, @run_mode, @carte_mere_id,
               @branche_choisie, @branche_de_depart, @tete_de_suite, @rang_dans_la_suite, @etape_finie_at,
               @depart_de_la_suite_at)
       ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, column_key = excluded.column_key,
         position = excluded.position, title = excluded.title, data = excluded.data,
         deployed_at = excluded.deployed_at, updated_at = excluded.updated_at,
         description = excluded.description, origin = excluded.origin, agent_id = excluded.agent_id,
         conversation_agent_id = excluded.conversation_agent_id, analyse_demandee = excluded.analyse_demandee,
         code_deja_enregistre = excluded.code_deja_enregistre, hors_tache = excluded.hors_tache,
         excluded_from_deploy = excluded.excluded_from_deploy, done_at = excluded.done_at,
         archived_at = excluded.archived_at, rangee_tableau_de_bord_at = excluded.rangee_tableau_de_bord_at,
         last_read_at = excluded.last_read_at,
         run_engine = excluded.run_engine, run_model = excluded.run_model,
         run_thinking = excluded.run_thinking, run_mode = excluded.run_mode,
         carte_mere_id = excluded.carte_mere_id,
         branche_choisie = excluded.branche_choisie, branche_de_depart = excluded.branche_de_depart,
         tete_de_suite = excluded.tete_de_suite, rang_dans_la_suite = excluded.rang_dans_la_suite,
         etape_finie_at = excluded.etape_finie_at, depart_de_la_suite_at = excluded.depart_de_la_suite_at`,
    ).run(colonnes);
    ecrireListe('card_labels', 'label', value.id, value.labels);
    ecrireListe('card_attachments', 'path', value.id, value.attachments);
  })();
  if (
    observateursDeCarte.size &&
    (avant?.column_key !== value.column || (!avant?.deployed_at && value.deployedAt))
  ) {
    const photo = avant ? { column: avant.column_key, deployedAt: avant.deployed_at ?? undefined } : null;
    for (const observateur of observateursDeCarte) {
      try {
        observateur(photo, value, { retourSansTravail: options.retourSansTravail });
      } catch {
        /* un observateur en panne ne défait jamais l'enregistrement d'une carte */
      }
    }
  }
  return value;
}

/** Une liste fille se réécrit en entier : on efface, puis on repose dans l'ordre. */
function ecrireListe(table: string, colonne: string, cardId: string, valeurs: string[]): void {
  const db = getDb();
  db.prepare(`DELETE FROM ${table} WHERE card_id = ?`).run(cardId);
  const insert = db.prepare(`INSERT INTO ${table} (card_id, position, ${colonne}) VALUES (?, ?, ?)`);
  valeurs.forEach((valeur, index) => insert.run(cardId, index, valeur));
}

export function deleteCard(id: string): void {
  getDb().prepare('DELETE FROM cards WHERE id = ?').run(id);
}

/**
 * SUPPRIMER UNE CONVERSATION, C'EST SUPPRIMER TOUT CE QUI Y PEND.
 *
 * Retirer la seule ligne de l'agent laisserait derrière elle ses messages, sa
 * file d'attente et ses cartes proposées : autant de sources que
 * `decisionsEnAttente` ramasse encore, donc un chiffre sur la cloche qui
 * n'ouvre plus rien. On supprime donc dans l'ordre des dépendances, sans
 * compter sur le `ON DELETE CASCADE` — les clés étrangères ne mordent que si
 * `PRAGMA foreign_keys` est actif dans la connexion qui écrit.
 *
 * Les questions ENCORE OUVERTES se ferment AVANT l'appel
 * (`fermerLesQuestionsDeLAgent`) : c'est ce qui libère un tour resté suspendu
 * sur `ask_user`.
 */
export function deleteAgent(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM proposals WHERE message_id IN (SELECT id FROM messages WHERE agent_id = ?)').run(id);
  db.prepare('DELETE FROM queue WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM messages WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}

/**
 * UNE ACTION SANS CHANGEMENT DE CONTENU : un message envoyé dans le fil de la
 * carte. Seule sa date de dernière action bouge — la page « En route » la fait
 * remonter en tête. Rend la carte touchée, à diffuser par l'appelant.
 */
export function marquerUneAction(cardId: string): Card | null {
  const card = getCard(cardId);
  if (!card) return null;
  return saveCard(card, { action: true });
}

/** Le plus récent en premier : position = horodatage décroissant par défaut. */
/**
 * « J'ai lu. » Éteint la pastille de cette carte, et d'elle seule : passer sur
 * le projet ne prouve rien, ouvrir la conversation si.
 */
export function markCardRead(cardId: string, at = now()): Card | null {
  const card = getCard(cardId);
  if (!card) return null;
  return saveCard({ ...card, lastReadAt: at });
}

/**
 * « Marquer comme non lu. » Rallume la pastille d'un rendu déjà consulté, en
 * retirant le repère de lecture : la carte redevient « jamais consultée
 * depuis son rendu ». Sa date de dernière action ne bouge pas (l'empreinte du
 * contenu ignore `lastReadAt`), donc elle ne remonte pas dans « Tableaux de
 * bord ». Une carte sans rendu, rangée ou déjà non lue n'est pas touchée :
 * rend `null`, rien à diffuser.
 */
export function markCardUnread(cardId: string): Card | null {
  const card = getCard(cardId);
  if (!card) return null;
  if (!peutRedevenirNonLue({ colonne: card.column, renduA: card.renduA, luA: card.lastReadAt })) return null;
  return saveCard({ ...card, lastReadAt: undefined });
}

/**
 * « J'ai tout lu sur ce projet. » Le geste se fait depuis la liste des projets,
 * sans ouvrir chaque conversation : on repousse le repère de lecture de toutes
 * les cartes du projet à maintenant. Rend les cartes touchées.
 */
export function markProjectRead(projectId: string, at = now()): Card[] {
  const touchees: Card[] = [];
  for (const cardId of unreadCards(projectId)) {
    const carte = getCard(cardId);
    if (carte) touchees.push(saveCard({ ...carte, lastReadAt: at }));
  }
  return touchees;
}

/**
 * Les empreintes de commits déjà rattachées à une carte de ce projet. C'est ce
 * qui empêche de fabriquer deux fois une carte pour le même travail.
 */
export function shasCouverts(projectId: string): string[] {
  const out: string[] = [];
  for (const card of listCards(projectId)) {
    for (const commit of card.github?.commits ?? []) if (commit.sha) out.push(commit.sha);
  }
  return out;
}

/** Les branches déjà tenues par une carte de ce projet. */
export function branchesDeCartes(projectId: string): string[] {
  return listCards(projectId)
    .map((card) => card.github?.branch)
    .filter((branch): branch is string => !!branch);
}

export function nextPosition(projectId: string, column: ColumnKey): number {
  const row = getDb()
    .prepare('SELECT MAX(position) AS m FROM cards WHERE project_id = ? AND column_key = ?')
    .get(projectId, column) as { m: number | null };
  return Math.max(row.m ?? 0, now());
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

export function listAgents(projectId?: string): Agent[] {
  const rows = (
    projectId
      ? getDb().prepare('SELECT data FROM agents WHERE project_id = ? ORDER BY created_at DESC').all(projectId)
      : getDb().prepare('SELECT data FROM agents ORDER BY created_at DESC').all()
  ) as { data: string }[];
  return rows.map((r) => Agent.parse(JSON.parse(r.data)));
}

/**
 * LES AGENTS UTILES AU TABLEAU D'UN PROJET (`agentUtileAuTableau`,
 * `shared/src/tranches-de-cartes.ts`), filtrés EN SQL : ceux qui travaillent,
 * ceux qui portent une des cartes envoyées, ceux mis à jour depuis peu. Sur un
 * projet ancien, c'est une centaine d'agents relus au lieu de quinze cents —
 * et surtout quatre mégaoctets de JSON qui ne sont plus ni relus ni envoyés.
 */
export function agentsDuTableau(projectId: string, cardIds: readonly string[], depuis: number): Agent[] {
  const rows = getDb()
    .prepare(
      `SELECT data FROM agents
        WHERE project_id = ?
          AND (status IN ('running', 'starting')
               OR updated_at >= ?
               OR card_id IN (SELECT value FROM json_each(?)))
        ORDER BY created_at DESC`,
    )
    .all(projectId, depuis, JSON.stringify(cardIds)) as { data: string }[];
  return rows.map((r) => Agent.parse(JSON.parse(r.data)));
}

/**
 * LES AGENTS DU PREMIER ENVOI, tous projets confondus : ceux qui travaillent
 * et ceux qui viennent de finir (`agentUtileAuLancement`,
 * `shared/src/premier-envoi.ts`). Filtrés en SQL pour la même raison : relire
 * tous les agents du serveur à chaque connexion coûtait une seconde de
 * processeur pour en jeter 99 %.
 */
export function agentsActifsOuRecents(depuis: number): Agent[] {
  const rows = getDb()
    .prepare(
      `SELECT data FROM agents
        WHERE status IN ('running', 'starting') OR updated_at >= ?
        ORDER BY created_at DESC`,
    )
    .all(depuis) as { data: string }[];
  return rows.map((r) => Agent.parse(JSON.parse(r.data)));
}

/**
 * LES AGENTS QUI PORTENT UNE FILE (`reprendreLesFilesEnAttente`, passée
 * toutes les quinze secondes) : ceux-là seulement, jamais toute la table. Sur
 * un serveur au repos, `queue` est vide — la requête rend zéro ligne au lieu
 * de relire des milliers d'agents pour découvrir qu'aucun n'attend.
 */
export function agentsAvecFileEnAttente(): Agent[] {
  const rows = getDb()
    .prepare(`SELECT data FROM agents WHERE id IN (SELECT DISTINCT agent_id FROM queue)`)
    .all() as { data: string }[];
  return rows.map((r) => Agent.parse(JSON.parse(r.data)));
}

/**
 * LES AGENTS QUI RETIENNENT LA PUBLICATION D'UN PROJET (`agentsOccupes`,
 * `deploy.ts`, rejouée toutes les quinze secondes par le déploiement
 * automatique) : ceux qui démarrent ou tournent, et ceux qui gardent un tour
 * vivant — filtrés EN SQL, comme `agentsDeLaVeille`. `agentsOccupes` relisait
 * TOUS les agents du projet, deux fois de suite : 2 500 lignes passées au
 * modèle pour le projet de Beluga, soit l'essentiel des gels de 1,5 s du démon
 * mesurés le 12/10/2026 (`data/logs/blocages.log`). Le filtre en code
 * (`agentRetientLaPublication`) reste derrière : la base n'écarte QUE ce que la
 * règle aurait écarté.
 */
export function agentsQuiRetiennentLaPublication(projectId: string): Agent[] {
  const rows = getDb()
    .prepare(
      `SELECT data FROM agents
        WHERE project_id = ?
          AND (status IN ('running', 'starting')
               OR json_extract(data, '$.tourVivantDepuis') IS NOT NULL)`,
    )
    .all(projectId) as { data: string }[];
  return rows.map((r) => Agent.parse(JSON.parse(r.data)));
}

/**
 * LES AGENTS D'UN LOT DE CARTES « EN COURS » (`rangerLesCartesOubliees`,
 * passée toutes les quinze secondes) : ceux rattachés à l'une de ces cartes,
 * plus ceux que ces cartes reconnaissent comme les leurs (`card.agentId`) —
 * un vieil agent en échec peut ne plus porter `card_id` sans que la carte
 * l'ait oublié. Jamais toute la table pour quelques cartes réellement actives.
 */
export function agentsDesCartesEnCours(cardIds: readonly string[], agentIds: readonly string[]): Agent[] {
  if (!cardIds.length && !agentIds.length) return [];
  const rows = getDb()
    .prepare(
      `SELECT data FROM agents
        WHERE card_id IN (SELECT value FROM json_each(?))
           OR id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(cardIds), JSON.stringify(agentIds)) as { data: string }[];
  return rows.map((r) => Agent.parse(JSON.parse(r.data)));
}

/**
 * LES AGENTS QUE LA VEILLE DES TOURS BLOQUÉS DOIT JUGER
 * (`veilleDesToursBloques`, passée toutes les quinze secondes) : ceux au
 * travail, ceux que le démon suit encore en mémoire (`live`/`demarrant`,
 * passés par `idsSuivis`), ceux qui portent encore une marque de tour vivant
 * à éteindre — même retombés au repos —, et ceux dont un message est resté
 * marqué « en cours d'écriture » (`streaming`, colonne réelle indexée par
 * `idx_messages_streaming` — migration 49, jamais un `json_extract` sur toute
 * la table `messages`). Jamais toute la table `agents` pour juger une
 * poignée d'agents réellement concernés.
 */
export function agentsDeLaVeille(idsSuivis: readonly string[]): Agent[] {
  const rows = getDb()
    .prepare(
      `SELECT data FROM agents
        WHERE status IN ('running', 'starting')
           OR id IN (SELECT value FROM json_each(?))
           OR json_extract(data, '$.tourVivantDepuis') IS NOT NULL
           OR id IN (SELECT DISTINCT agent_id FROM messages WHERE streaming = 1)
        ORDER BY created_at DESC`,
    )
    .all(JSON.stringify(idsSuivis)) as { data: string }[];
  return rows.map((r) => Agent.parse(JSON.parse(r.data)));
}

export function getAgent(id: string): Agent | null {
  const row = getDb().prepare('SELECT data FROM agents WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? Agent.parse(JSON.parse(row.data)) : null;
}

export function getAgentByCard(cardId: string): Agent | null {
  const row = getDb()
    .prepare("SELECT data FROM agents WHERE card_id = ? AND role = 'task' ORDER BY created_at DESC LIMIT 1")
    .get(cardId) as { data: string } | undefined;
  return row ? Agent.parse(JSON.parse(row.data)) : null;
}

/**
 * L'agent de CADRAGE d'une carte, même quand un agent de tâche est venu après
 * lui : c'est lui qu'une relance après rapport rouvre (`rouvrirLeCadrage`).
 */
export function getCadrageAgentByCard(cardId: string): Agent | null {
  const row = getDb()
    .prepare("SELECT data FROM agents WHERE card_id = ? AND role = 'cadrage' ORDER BY created_at DESC LIMIT 1")
    .get(cardId) as { data: string } | undefined;
  return row ? Agent.parse(JSON.parse(row.data)) : null;
}

/**
 * Le dernier agent d'une carte, QUEL QUE SOIT son rôle. Une carte n'a d'agent
 * d'exécution qu'au lancement : avant cela, c'est son agent d'analyse qui parle,
 * et sa conversation doit malgré tout se suivre en direct.
 */
export function getLastAgentByCard(cardId: string): Agent | null {
  const row = getDb()
    .prepare('SELECT data FROM agents WHERE card_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(cardId) as { data: string } | undefined;
  return row ? Agent.parse(JSON.parse(row.data)) : null;
}

export function saveAgent(agent: Agent): Agent {
  const value = Agent.parse({ ...agent, updatedAt: now() });
  getDb()
    .prepare(
      `INSERT INTO agents (id, project_id, card_id, role, status, session_id, data, created_at, updated_at)
       VALUES (@id, @projectId, @cardId, @role, @status, @sessionId, @data, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, card_id = excluded.card_id, role = excluded.role,
         session_id = COALESCE(excluded.session_id, agents.session_id),
         data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run({
      id: value.id,
      projectId: value.projectId,
      cardId: value.cardId ?? null,
      role: value.role,
      status: value.status,
      sessionId: rawSessions(value.id),
      data: JSON.stringify(value),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    });
  return value;
}

/**
 * Chaque moteur a SA propre conversation, et chaque COMPTE son propre coffre :
 * reprendre une session Claude avec Codex n'a aucun sens, et reprendre sur un
 * autre compte un fil ouvert sur le premier n'en a pas davantage — le moteur
 * cherche la conversation dans le coffre du compte qui tourne, et ne l'y trouve
 * pas. La colonne garde donc un petit dictionnaire dont la clé est calculée par
 * `cleDeSession` (moteur, compte, et sous Codex le modèle qui a ouvert le fil),
 * tout en acceptant les DEUX formats d'avant : une simple chaîne, et un
 * dictionnaire dont les clés ne portaient pas encore le compte.
 */
function rawSessions(agentId: string): string | null {
  const row = getDb().prepare('SELECT session_id FROM agents WHERE id = ?').get(agentId) as
    | { session_id: string | null }
    | undefined;
  return row?.session_id ?? null;
}

/**
 * Les fils d'avant portaient une clé SANS compte. On la complète avec le compte
 * qui a réellement porté le dernier tour de l'agent (`Agent.account`) : c'est
 * lui qui détient le fil dans son coffre. Compte inconnu, la clé reste telle
 * quelle — donc jamais lue, donc jamais reprise à tort dans le mauvais coffre.
 */
function cleAvecCompte(cle: string, compte: string | undefined): string {
  if (cle.includes('#') || !compte) return cle;
  return `${cle}#${compte}`;
}

function readSessions(agentId: string): Record<string, string> {
  const row = getDb().prepare('SELECT session_id, role, data FROM agents WHERE id = ?').get(agentId) as
    | { session_id: string | null; data: string }
    | undefined;
  if (!row?.session_id) return {};
  const raw = row.session_id.trim();
  let compte: string | undefined;
  let run: { engine?: string; model?: string } = {};
  try {
    const data = JSON.parse(row.data) ?? {};
    compte = typeof data.account === 'string' ? data.account : undefined;
    run = data.run ?? {};
  } catch {
    /* agent illisible : on s'en tiendra aux clés telles quelles */
  }

  if (raw.startsWith('{')) {
    try {
      const sessions = JSON.parse(raw) as Record<string, string>;
      const avecCompte: Record<string, string> = {};
      for (const [cle, valeur] of Object.entries(sessions)) avecCompte[cleAvecCompte(cle, compte)] = valeur;
      return avecCompte;
    } catch {
      return {};
    }
  }
  // Ancien format : la session appartenait au moteur de l'agent. On la range
  // sous la clé d'aujourd'hui, réglages actuels et compte porteur compris.
  return { [cleDeSession(run.engine, run.model, compte)]: raw };
}

export function setSessionId(agentId: string, sessionId: string, cle: string): void {
  const sessions = { ...readSessions(agentId), [cle]: sessionId };
  getDb().prepare('UPDATE agents SET session_id = ? WHERE id = ?').run(JSON.stringify(sessions), agentId);
}

/** Cet agent a-t-il déjà ouvert un fil moteur, quel qu'il soit ? */
export function aUneSession(agentId: string): boolean {
  return Object.keys(readSessions(agentId)).length > 0;
}

export function getSessionId(agentId: string, cle: string): string | null {
  return readSessions(agentId)[cle] ?? null;
}

/**
 * Le fil ouvert sur un AUTRE compte, pour ce même moteur et ce même modèle.
 * Il n'est pas reprenable — le coffre qui le porte n'est pas celui qui tourne —,
 * mais son existence prouve qu'il y a un travail en cours à résumer, et non une
 * conversation à ouvrir de zéro.
 */
export function filSurUnAutreCompte(agentId: string, partMoteur: string, cleCourante: string): string | null {
  for (const [cle, valeur] of Object.entries(readSessions(agentId))) {
    if (cle !== cleCourante && memeFilAutreCompte(cle, partMoteur)) return valeur;
  }
  return null;
}

/**
 * Oublier les sessions de cet agent, tous moteurs confondus : le prochain
 * message repart d'une conversation vide côté moteur, et la mémoire du projet
 * y est renvoyée une fois, comme au premier tour.
 */
export function clearSessions(agentId: string): void {
  getDb().prepare('UPDATE agents SET session_id = NULL WHERE id = ?').run(agentId);
}

/** Oublie seulement le fil visé : les autres moteurs, modèles et comptes restent intacts. */
export function clearSession(agentId: string, cle: string): void {
  const sessions = readSessions(agentId);
  if (!(cle in sessions)) return;
  delete sessions[cle];
  getDb()
    .prepare('UPDATE agents SET session_id = ? WHERE id = ?')
    .run(Object.keys(sessions).length ? JSON.stringify(sessions) : null, agentId);
}

function listeMeta(cle: string): string[] {
  try {
    const raw = getMeta(cle);
    const valeurs = raw ? JSON.parse(raw) : [];
    return Array.isArray(valeurs) ? valeurs.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Les SUJETS que cet agent est allé chercher dans l'ANCIEN arbre de mémoire.
 * Donnée FIGÉE depuis le 13.09.2026 (son écrivain est parti avec l'arbre) :
 * elle ne sert plus qu'au lancement d'une carte cadrée avant cette date. Le
 * relevé vivant est `lecturesDeLaCarte` (`server/src/connaissances.ts`).
 */
export function sujetsMemoireDemandes(agentId: string): string[] {
  return listeMeta(`memoire.demandes.${agentId}`);
}

/* ------------------------------------------------------------------ */
/* Le carnet de mémoire d'une carte                                    */
/* ------------------------------------------------------------------ */

/**
 * LES LIGNES D'AVANT LE 13.09.2026. La table `memoire_carnet` était
 * l'enregistrement propre du carnet, du temps de l'ancien arbre de mémoire ;
 * plus rien n'y écrit. Elle reste LUE pour que les cartes d'avant gardent leur
 * historique. Le carnet vivant vient du relevé des lectures
 * (`carnetDesLectures`, `server/src/connaissances.ts`).
 */
type LigneDeCarnetSql = {
  id: string;
  card_id: string;
  agent_id: string | null;
  etape: string;
  tour_id: string | null;
  cle: string;
  genre: string;
  sujet: string;
  branche: string | null;
  portee: string;
  poids: number;
  at: number;
  en_contexte: number;
};

function versLigneDuCarnet(ligne: LigneDeCarnetSql): LigneDuCarnet {
  return LigneDuCarnet.parse({
    id: ligne.id,
    cardId: ligne.card_id,
    agentId: ligne.agent_id ?? undefined,
    etape: ligne.etape,
    tourId: ligne.tour_id ?? undefined,
    cle: ligne.cle,
    genre: ligne.genre,
    sujet: ligne.sujet,
    branche: ligne.branche ?? undefined,
    portee: ligne.portee,
    poids: ligne.poids,
    at: ligne.at,
    enContexte: ligne.en_contexte === 1,
  });
}

/**
 * LE CARNET ENTIER D'UNE CARTE : l'historique d'avant (`memoire_carnet`) puis
 * le relevé vivant, dans l'ordre des lectures. Une lecture faite AVANT le
 * dernier « repartir de zéro » de son agent ne s'affiche plus.
 */
export function carnetDeLaCarte(cardId: string): LigneDuCarnet[] {
  if (!cardId) return [];
  let anciennes: LigneDuCarnet[] = [];
  try {
    const lignes = getDb()
      .prepare('SELECT * FROM memoire_carnet WHERE card_id = ? ORDER BY at ASC, rowid ASC')
      .all(cardId) as LigneDeCarnetSql[];
    anciennes = lignes.map(versLigneDuCarnet);
  } catch {
    /* base partielle d'un contrôle : pas d'historique */
  }
  return [...anciennes, ...carnetDesLectures(cardId, nouveauDepart)].sort((x, y) => x.at - y.at);
}

/** « Repartir de zéro » vide l'historique d'avant ; le relevé vivant, lui, se masque par la date du nouveau départ (`carnetDeLaCarte`). */
export function viderLeCarnet(cardId: string): void {
  if (!cardId) return;
  try {
    getDb().prepare('DELETE FROM memoire_carnet WHERE card_id = ?').run(cardId);
  } catch {
    /* rien à vider */
  }
}

/**
 * L'empreinte de la carte que cet agent a déjà reçue. La description d'une
 * carte repartait à CHAQUE tour, exactement comme la mémoire du projet avant
 * elle : l'agent l'a déjà sous les yeux. On ne la renvoie donc que si elle a
 * réellement changé.
 */
export function carteVue(agentId: string): string {
  return getMeta(`carte.vue.${agentId}`) ?? '';
}

export function setCarteVue(agentId: string, empreinte: string): void {
  setMeta(`carte.vue.${agentId}`, empreinte);
}


/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

/**
 * DEUX MESSAGES DE LA MÊME MILLISECONDE GARDENT LEUR ORDRE D'ÉCRITURE.
 *
 * `createdAt` est une milliseconde, et le démon écrit parfois deux messages
 * coup sur coup — la demande de l'utilisateur puis, aussitôt, la raison d'un
 * tour refermé. Trié sur la seule date, le couple sortait dans un ordre
 * ARBITRAIRE : la réponse s'affichait AVANT la question qui l'avait provoquée,
 * et tout code qui lit « le dernier message » (l'annonce d'un blocage, la
 * question ouverte d'un tour) tombait sur le mauvais. Le numéro de ligne de la
 * base est, lui, strictement croissant à l'insertion : il départage.
 */
const ORDRE_DES_MESSAGES_DESC = 'ORDER BY created_at DESC, rowid DESC';

/**
 * LE NOMBRE DE MESSAGES D'UN AGENT, sans en relire un seul : l'index
 * `idx_messages_agent` suffit. Le filet de démarrage des cadrages jamais
 * partis comptait en relisant et validant TOUT le fil de chaque carte
 * (`listMessages(...).length`), 3 400 cartes durant (`blocages.log`, 28/10/2026).
 */
export function nombreDeMessages(agentId: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM messages WHERE agent_id = ?').get(agentId) as { n: number }).n;
}

/**
 * CET AGENT A-T-IL DÉJÀ UN MESSAGE ? Une seule ligne d'index, rien de lu.
 * `listMessages(id).length > 0` relisait, décodait et validait jusqu'à 400
 * messages par agent : passé sur toutes les cartes au démarrage, c'était
 * ~30 s de fil principal figé après chaque redémarrage (enquête des
 * décrochages, 28/10/2026).
 */
export function aDesMessages(agentId: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM messages WHERE agent_id = ? LIMIT 1').get(agentId);
}

export function listMessages(agentId: string, limit = 400): Message[] {
  const rows = getDb()
    .prepare(
      `SELECT id, data, rowid AS ligne FROM messages WHERE agent_id = ? ${ORDRE_DES_MESSAGES_DESC} LIMIT ?`,
    )
    .all(agentId, limit) as { id: string; data: string; ligne: number }[];
  /*
   * UN MESSAGE ILLISIBLE NE FAIT PLUS TOMBER LE DÉMON. Un enregistrement écrit
   * par une version antérieure du schéma se refuse au parse ; comme la reprise
   * après redémarrage lit les messages de TOUS les agents avant d'ouvrir le
   * port, la moindre exception ici coupait le service entier au démarrage — et
   * `Restart=always` rejouait la même erreur sans fin. On écarte la ligne en le
   * disant, comme pour les cartes : le reste de la conversation reste lisible.
   */
  const messages: { message: Message; ligne: number }[] = [];
  for (const row of rows) {
    try {
      messages.push({ message: Message.parse(JSON.parse(row.data)), ligne: row.ligne });
    } catch (err: any) {
      log.warn(
        `message illisible écarté : ${row.id} (agent ${agentId})`,
        err?.message ?? err,
      );
    }
  }
  return messages
    .sort((a, b) => a.message.createdAt - b.message.createdAt || a.ligne - b.ligne)
    .map((entree) => entree.message);
}

/**
 * LES MESSAGES DE CET AGENT ENCORE MARQUÉS « EN COURS D'ÉCRITURE ».
 *
 * `eteindreEcritureOrpheline` les cherchait dans les CINQ DERNIERS messages de
 * l'agent. Un orphelin plus ancien — cinq messages du 13 août 2026 sur un agent
 * qui a beaucoup parlé depuis — passait donc sous le radar POUR TOUJOURS :
 * jamais éteint, et pourtant ramené à chaque passage de quinze secondes par
 * `agentsDeLaVeille`, qui le voit toujours en écriture. Un filet qui repère un
 * dormeur sans jamais pouvoir le réveiller.
 *
 * La colonne réelle `streaming` (migration `index-message-en-ecriture`) et son
 * index PARTIEL rendent la question directe et sans coût : la fenêtre des cinq
 * derniers n'a plus lieu d'être. En pratique la réponse est vide, ou d'une
 * poignée de lignes.
 */
export function messagesEnEcriture(agentId: string): Message[] {
  const rows = getDb()
    .prepare(`SELECT id, data FROM messages WHERE agent_id = ? AND streaming = 1 ${ORDRE_DES_MESSAGES_DESC}`)
    .all(agentId) as { id: string; data: string }[];
  const messages: Message[] = [];
  for (const row of rows) {
    try {
      messages.push(Message.parse(JSON.parse(row.data)));
    } catch (err: any) {
      log.warn(`message en écriture illisible écarté : ${row.id} (agent ${agentId})`, err?.message ?? err);
    }
  }
  return messages;
}

/**
 * L'instant du dernier « repartir de zéro » sur cette conversation. Zéro quand
 * la conversation n'a jamais été coupée. Voir [[nouveau-depart]] : rien n'est
 * supprimé, ce repère ne fait que ranger l'ancien fil derrière un lien.
 */
export function nouveauDepart(agentId: string): number {
  const raw = getMeta(cleNouveauDepart(agentId));
  const at = raw ? Number(raw) : 0;
  return Number.isFinite(at) && at > 0 ? at : 0;
}

export function setNouveauDepart(agentId: string, at: number): void {
  setMeta(cleNouveauDepart(agentId), String(Math.round(at)));
}

/**
 * TOUT ce qui a transité pour une carte, dans l'ordre : analyses, exécutions et
 * relances. Une carte peut avoir eu plusieurs agents ; on ne perd jamais ce qui
 * s'est dit avec les précédents.
 */
/**
 * Ce qu'un projet attend de VOUS, DÉCISION PAR DÉCISION : les questions d'agent
 * sans réponse ET les cartes présentées à valider. Les deux réclament la même
 * chose — une décision — donc les deux allument le même signal.
 *
 * Chaque décision emporte l'ENDROIT où elle se prend : la conversation qui la
 * porte, et la carte concernée quand il y en a une. Sans cet endroit, la ligne
 * du projet annonçait un chiffre que rien à l'écran ne venait confirmer.
 *
 * Une décision dont la conversation a disparu est écartée : elle ne se prend
 * plus nulle part, et la compter serait exactement le chiffre introuvable qu'on
 * cherche à supprimer. Le décompte, lui, ne change pas de règle : il vit dans
 * `shared` et se teste seul.
 */
/**
 * Les tours COUPÉS PAR LA LIMITE D'UN COMPTE qui attendent encore de savoir sur
 * quel compte poursuivre. Sert deux fois : à allumer le triangle orange comme
 * n'importe quelle décision, et à prévenir quand un compte se libère enfin.
 *
 * Un choix déjà fait ferme la décision : le travail est reparti, il n'y a plus
 * rien à trancher.
 */
export interface RepriseEnAttente {
  projectId: string;
  agentId: string;
  cardId?: string;
  messageId: string;
  engine: string;
  compteEpuise: string;
  compteEpuiseLabel: string;
  poseeA: number;
}

/**
 * LES REPRISES DE COMPTE QUI ATTENDENT ENCORE UN CHOIX.
 *
 * Trois raisons d'écarter une ligne, et la troisième a longtemps manqué :
 * un compte a déjà été choisi, la décision a été abandonnée, ou LA CARTE A ÉTÉ
 * RANGÉE. Ce dernier garde-fou est le MÊME que celui des questions d'outil
 * (`colonneFermeLesQuestions`) : sans lui, un tour coupé par une limite de
 * quota laissait sa décision ouverte à vie, et la carte affichait « Répondre /
 * Annuler » des semaines après être passée « En production » — le défaut vu en
 * capture le 23/08/2026, deux cartes concernées sur ce serveur.
 */
export function reprisesDeCompteEnAttente(): RepriseEnAttente[] {
  /*
   * L'INDEX PARTIEL D'ABORD (migration 138) : la colonne générée ne marque que
   * les reprises encore ouvertes, une poignée de lignes. On n'en lit que la
   * reprise elle-même (`json_extract`), jamais le message entier — 86 Ko en
   * moyenne, étapes comprises. Avant, un `LIKE` balayait tous les messages
   * des conversations ouvertes à chaque calcul des décisions.
   */
  const rows = getDb()
    .prepare(
      `SELECT a.project_id AS projectId, a.id AS agentId, a.card_id AS cardId,
              m.id AS messageId, json_extract(m.data, '$.repriseCompte') AS reprise,
              m.created_at AS createdAt, c.column_key AS colonne
       FROM messages m
       JOIN agents a ON a.id = m.agent_id
       LEFT JOIN cards c ON c.id = a.card_id
       WHERE m.a_reprise_ouverte = 1
         AND (c.column_key IS NULL OR c.column_key NOT IN (${SQL_COLONNES_FERMEES}))`,
    )
    .all() as {
    projectId: string;
    agentId: string;
    cardId: string | null;
    messageId: string;
    reprise: string | null;
    createdAt: number;
    colonne: string | null;
  }[];

  const attentes: RepriseEnAttente[] = [];
  for (const row of rows) {
    if (colonneFermeLesQuestions(row.colonne ?? undefined)) continue;
    if (!row.reprise) continue;
    try {
      const reprise = RepriseDeCompte.parse(JSON.parse(row.reprise));
      if (reprise.choisi || reprise.abandonnee || reprise.consommeeA) continue;
      attentes.push({
        projectId: row.projectId,
        agentId: row.agentId,
        cardId: row.cardId ?? undefined,
        messageId: row.messageId,
        engine: reprise.engine,
        compteEpuise: reprise.compteEpuise,
        compteEpuiseLabel: reprise.compteEpuiseLabel,
        poseeA: row.createdAt,
      });
    } catch {
      /* reprise illisible : on l'ignore */
    }
  }
  return attentes;
}

/** Un tour coupé net par une erreur, qui attend encore un choix. */
export interface ErreurDeTourEnAttente {
  projectId: string;
  agentId: string;
  cardId?: string;
  messageId: string;
  cause: string;
  poseeA: number;
}

/**
 * LES ERREURS DE TOUR QUI ATTENDENT ENCORE UN CHOIX — même garde-fou que les
 * reprises de compte : un choix déjà fait, ou une carte déjà rangée, ferme la
 * décision pour de bon.
 */
export function erreursDeTourEnAttente(): ErreurDeTourEnAttente[] {
  // Même index partiel que les reprises de compte (migration 138), même lecture
  // de la seule erreur.
  const rows = getDb()
    .prepare(
      `SELECT a.project_id AS projectId, a.id AS agentId, a.card_id AS cardId,
              m.id AS messageId, json_extract(m.data, '$.erreurDeTour') AS erreur,
              m.created_at AS createdAt, c.column_key AS colonne
       FROM messages m
       JOIN agents a ON a.id = m.agent_id
       LEFT JOIN cards c ON c.id = a.card_id
       WHERE m.a_erreur_ouverte = 1
         AND (c.column_key IS NULL OR c.column_key NOT IN (${SQL_COLONNES_FERMEES}))`,
    )
    .all() as {
    projectId: string;
    agentId: string;
    cardId: string | null;
    messageId: string;
    erreur: string | null;
    createdAt: number;
    colonne: string | null;
  }[];

  const attentes: ErreurDeTourEnAttente[] = [];
  for (const row of rows) {
    if (colonneFermeLesQuestions(row.colonne ?? undefined)) continue;
    if (!row.erreur) continue;
    try {
      const erreur = ErreurDeTour.parse(JSON.parse(row.erreur));
      if (erreur.choix) continue;
      attentes.push({
        projectId: row.projectId,
        agentId: row.agentId,
        cardId: row.cardId ?? undefined,
        messageId: row.messageId,
        cause: erreur.cause,
        poseeA: row.createdAt,
      });
    } catch {
      /* erreur illisible : on l'ignore */
    }
  }
  return attentes;
}

/**
 * Le nom du projet et le titre de l'endroit (carte ou conversation), pour
 * l'affichage d'une décision — jamais pour trancher où elle se prend, ce que
 * fait déjà `decision-attendue.ts` côté partagé. Mis en cache le temps d'un
 * appel : plusieurs décisions partagent souvent le même projet ou la même
 * carte.
 */
function enrichisseurDeDecisions() {
  const projets = new Map<string, string | undefined>();
  const cartes = new Map<string, string | undefined>();
  const agents = new Map<string, string | undefined>();
  return {
    nomProjet(projectId: string): string | undefined {
      if (!projets.has(projectId)) {
        const row = getDb().prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as
          | { name?: string }
          | undefined;
        projets.set(projectId, row?.name);
      }
      return projets.get(projectId);
    },
    titreCarte(cardId: string): string | undefined {
      if (!cartes.has(cardId)) {
        const row = getDb().prepare('SELECT title FROM cards WHERE id = ?').get(cardId) as
          | { title?: string }
          | undefined;
        cartes.set(cardId, row?.title);
      }
      return cartes.get(cardId);
    },
    titreAgent(agentId: string): string | undefined {
      if (!agents.has(agentId)) {
        const raw = rawAgent(agentId);
        let titre: string | undefined;
        try {
          titre = raw ? (JSON.parse(raw).title as string | undefined) : undefined;
        } catch {
          titre = undefined;
        }
        agents.set(agentId, titre);
      }
      return agents.get(agentId);
    },
    lieuTitre(cardId?: string, agentId?: string): string | undefined {
      if (cardId) return this.titreCarte(cardId) ?? 'Carte';
      if (agentId) return this.titreAgent(agentId) ?? 'Conversation';
      return undefined;
    },
  };
}

/**
 * CETTE CARTE ATTEND-ELLE ENCORE UNE RÉPONSE À UNE QUESTION DE SON AGENT ?
 *
 * Volontairement PLUS ÉTROIT que `decisionsEnAttente` : on ne regarde QUE les
 * questions posées par l'outil `ask_user` dans le fil de cette carte. Ni les
 * cartes proposées, ni les incidents (tour coupé, compte à sec) — eux aussi
 * comptés comme « décisions » ailleurs, mais qui ne disent rien du travail :
 * un incident laisse déjà la carte là où on la relance, et le compter ici
 * bloquerait la carte pour toujours, le tour suivant voyant encore celui d'avant.
 *
 * Sert à un seul endroit : la fin de tour (`carteApresFinDeTour`), qui ne ferme
 * la carte que sur une réponse DÉFINITIVE.
 */
export function questionOuverteSurLaCarte(cardId: string): boolean {
  const rows = getDb()
    .prepare(
      `SELECT m.data AS data
       FROM messages m
       JOIN agents a ON a.id = m.agent_id
       WHERE a.card_id = ? AND m.a_questions = 1`,
    )
    .all(cardId) as { data: string }[];
  for (const row of rows) {
    try {
      if (messageAttendUneReponse(Message.parse(JSON.parse(row.data)))) return true;
    } catch {
      /* message illisible : on l'ignore */
    }
  }
  return false;
}

/**
 * LA DERNIÈRE PHRASE DE LA CARTE EST-ELLE UNE QUESTION ÉCRITE EN TEXTE ?
 *
 * Le dernier message de la carte, tous agents confondus — la même lecture que
 * la troisième source de la cloche (`decisionEnTexteLibre`). Elle ne sert qu'à
 * la fin de tour d'un AGENT DE VOLET : sa carte n'a pas de rapport à rendre,
 * et la ranger d'office sur « dites-moi quand… » faisait disparaître la
 * question avec elle (carte 176d3fc7, 20/10/2026).
 */
export function questionEnTexteSurLaCarte(cardId: string): boolean {
  const ligne = getDb()
    .prepare(
      `SELECT m.data AS data FROM messages m JOIN agents a ON a.id = m.agent_id
        WHERE a.card_id = ? ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1`,
    )
    .get(cardId) as { data: string } | undefined;
  if (!ligne) return false;
  try {
    return questionEnTexteLibre(Message.parse(JSON.parse(ligne.data))) !== null;
  } catch {
    return false;
  }
}

/**
 * LES CARTES QUI ATTENDENT UN GESTE DE VOUS.
 *
 * Une question posée par un agent allume un repère depuis toujours ; un GESTE
 * attendu — générer le plan, le valider, lancer — ne sortait pas du tiroir de
 * la carte. On rejoue donc, pour chaque carte des deux colonnes de gauche, la
 * MÊME règle que le bouton de l'écran (`gesteDuParcours`), et on retient ce
 * qui attend vraiment quelqu'un (`gesteEnAttente`, `shared`).
 *
 * DEUX BORNES QUI ÉVITENT D'Y PASSER LA JOURNÉE. On ne regarde que
 * « Planifié » : ailleurs, le geste du parcours est « Arrêter » ou « Terminer »,
 * qui ne se signalent pas (`GESTES_QUI_ATTENDENT`). Et une carte qui porte
 * DÉJÀ une décision ouverte est écartée : elle est comptée une fois, jamais
 * deux, et son repère garde la nature la plus urgente.
 */
function attentesDeGeste(dejaEnAttente: ReadonlySet<string>): DecisionAttendue[] {
  const enrichir = enrichisseurDeDecisions();
  const lignes = getDb()
    .prepare("SELECT * FROM cards WHERE column_key = 'planned'")
    .all() as LigneCarte[];
  const attentes: DecisionAttendue[] = [];
  for (const ligne of lignes) {
    if (dejaEnAttente.has(ligne.id)) continue;
    try {
      const carte = carteDepuisLigne(ligne);
      const conversation = carte.conversationAgentId ?? carte.agentId;
      const agent = conversation ? getAgent(conversation) : getDernierAgentDeLaCarte(carte.id);
      if (!agent) continue;
      const messages: MessageDuParcours[] = listMessages(agent.id).map((message) => ({
        role: message.role,
        content: message.content,
        at: message.createdAt,
        streaming: message.streaming,
        questions: message.questions,
        erreurDeTour: message.erreurDeTour,
        repriseCompte: message.repriseCompte,
      }));
      const tourEnCours = agent.status === 'running' || agent.status === 'starting';
      /*
       * LES QUESTIONS GARDÉES SUR LA CARTE par un cadrage sans témoin
       * (`questions-de-carte.ts`) : une QUESTION, qui allume le triangle de la
       * carte et de son projet et la cloche, comme une question de l'agent —
       * même si personne n'a encore ouvert la carte.
       */
      const enAttente = questionsSansReponse(carte.parcours?.comprehension);
      if (enAttente.length) {
        attentes.push({
          projectId: carte.projectId,
          agentId: agent.id,
          cardId: carte.id,
          genre: 'question',
          reglee: false,
          poseeA: carte.parcours?.comprehension?.at,
          source: 'question-de-carte',
          texte: enAttente[0].question,
          projectName: enrichir.nomProjet(carte.projectId),
          lieuTitre: enrichir.lieuTitre(carte.id, agent.id),
        });
        continue;
      }
      const etat = gesteDuParcours({
        colonne: carte.column,
        roleAgent: agent.role,
        tourEnCours,
        messages,
        parcours: carte.parcours,
        tourEnVolDepuis: carte.scheduling?.tourEnVolDepuis,
        tachesNonFaites: agent.todos?.unfinished,
        dernierTourEnEchec: agent.status === 'failed' || agent.status === 'stopped',
        codeDejaEnregistre: carte.codeDejaEnregistre,
        agentDeLaCarte: carte.agentId,
        agentDuPlan: agent.id,
      });
      const geste = gesteEnAttente({
        etat,
        tourEnCours,
        finDuTourA: agent.endedAt,
        luA: carte.lastReadAt,
      });
      if (!geste) continue;
      attentes.push({
        projectId: carte.projectId,
        agentId: agent.id,
        cardId: carte.id,
        genre: 'action',
        geste,
        reglee: false,
        /* L'attente date de l'instant où le tour s'est tu : c'est depuis là
           qu'elle dort, et c'est cet ordre que la cloche respecte. */
        poseeA: agent.endedAt,
        source: 'geste-de-parcours',
        texte: TEXTE_DU_GESTE_ATTENDU[geste],
        projectName: enrichir.nomProjet(carte.projectId),
        lieuTitre: enrichir.lieuTitre(carte.id, agent.id),
      });
    } catch {
      /* carte illisible : elle n'apprend rien de plus */
    }
  }
  return attentes;
}

/** Le dernier agent d'une carte, quand elle ne nomme aucune conversation. */
function getDernierAgentDeLaCarte(cardId: string) {
  const row = getDb()
    .prepare('SELECT data FROM agents WHERE card_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(cardId) as { data: string } | undefined;
  if (!row) return null;
  try {
    return Agent.parse(JSON.parse(row.data));
  } catch {
    return null;
  }
}

/**
 * LES COLONNES RANGÉES, ÉCRITES EN SQL — tirées de la même constante que
 * `colonneFermeLesQuestions`, pour que le filtre de la base et celui du code
 * ne puissent pas diverger. Le filtre en JS reste en place derrière : la base
 * ne fait qu'écarter AVANT lecture ce que le code aurait écarté APRÈS.
 *
 * Mesuré le 15/09/2026 sur le serveur : sans ce filtre, la source « question
 * en texte » relisait et validait le dernier message de 1 745 cartes, dont
 * 1 784 archivées — 110 Mo de JSON à chaque appel, 300 Ko avec.
 */
const SQL_COLONNES_FERMEES = COLONNES_QUI_FERMENT_LES_QUESTIONS.map((colonne) => `'${colonne}'`).join(', ');

/**
 * LE DERNIER CALCUL DES DÉCISIONS, TANT QUE LA BASE N'A PAS BOUGÉ.
 *
 * `decisionsEnAttente` coûtait 1,5 s de boucle d'événements bloquée par appel,
 * et la veille de quinze secondes l'appelait 2 + 2 × (projets en déploiement
 * automatique) fois de suite, sans rien écrire entre deux : le démon passait
 * un tiers de son temps là, et l'écran le voyait « déconnecté » (profil du
 * 15/09/2026 : retard de boucle p99 1,4 s, maximum 12,6 s).
 *
 * La clé est EXACTE, pas un délai : `total_changes()` compte chaque ligne
 * écrite par CETTE connexion, `data_version` change dès qu'une AUTRE connexion
 * (un script) valide une écriture. Toutes les sources du calcul sont en base,
 * et aucune de ses règles ne lit l'heure : même clé, même résultat. La
 * connexion elle-même fait partie de la clé (les tests en rouvrent une).
 */
let decisionsMemorisees: { base: unknown; cle: string; decisions: DecisionAttendue[] } | null = null;

function empreinteDeLaBase(): string {
  const db = getDb();
  const ecrites = db.prepare('SELECT total_changes() AS n').get() as { n: number };
  const version = db.pragma('data_version', { simple: true });
  return `${ecrites.n}:${String(version)}`;
}

export function decisionsEnAttente(): DecisionAttendue[] {
  const base = getDb();
  const cle = empreinteDeLaBase();
  if (decisionsMemorisees && decisionsMemorisees.base === base && decisionsMemorisees.cle === cle) {
    return [...decisionsMemorisees.decisions];
  }
  const decisions = calculerDecisionsEnAttente();
  decisionsMemorisees = { base, cle, decisions };
  return [...decisions];
}

function calculerDecisionsEnAttente(): DecisionAttendue[] {
  const decisions: DecisionAttendue[] = [];
  const enrichir = enrichisseurDeDecisions();

  /*
   * Un tour coupé par la limite d'un compte attend bien un choix — mais ce
   * n'est PAS une question posée par un agent. Le genre `incident` le range à
   * part : il reste dans la cloche, à l'endroit exact où le choix se prend, et
   * il n'allume plus le triangle orange d'une ligne de projet ni d'une carte.
   * Le triangle ne veut donc plus dire qu'une chose : quelqu'un vous a posé une
   * question (`shared/src/attention.ts`).
   */
  for (const attente of reprisesDeCompteEnAttente()) {
    decisions.push({
      projectId: attente.projectId,
      agentId: attente.agentId,
      cardId: attente.cardId,
      genre: 'incident',
      reglee: false,
      poseeA: attente.poseeA,
      messageId: attente.messageId,
      source: 'reprise-de-compte',
      texte: `Le compte « ${attente.compteEpuiseLabel} » a atteint sa limite : avec quel compte poursuivre ?`,
      projectName: enrichir.nomProjet(attente.projectId),
      lieuTitre: enrichir.lieuTitre(attente.cardId, attente.agentId),
    });
  }

  /*
   * Une erreur qui a coupé le travail net attend, elle aussi, un choix :
   * relancer, ignorer, ou arrêter. Même cloche — mais même genre `incident` que
   * la reprise de compte : rien ne vous a été DEMANDÉ, quelque chose est tombé.
   */
  for (const attente of erreursDeTourEnAttente()) {
    decisions.push({
      projectId: attente.projectId,
      agentId: attente.agentId,
      cardId: attente.cardId,
      genre: 'incident',
      reglee: false,
      poseeA: attente.poseeA,
      messageId: attente.messageId,
      source: 'erreur-de-tour',
      texte: `Une erreur a arrêté le travail : ${attente.cause}`,
      projectName: enrichir.nomProjet(attente.projectId),
      lieuTitre: enrichir.lieuTitre(attente.cardId, attente.agentId),
    });
  }

  const rows = getDb()
    .prepare(
      `SELECT a.project_id AS projectId, a.id AS agentId, a.card_id AS cardId,
              m.id AS messageId, json_extract(m.data, '$.questions') AS questions,
              m.created_at AS createdAt, c.column_key AS colonne
       FROM messages m
       JOIN agents a ON a.id = m.agent_id
       LEFT JOIN cards c ON c.id = a.card_id
       WHERE m.a_questions = 1
         AND (c.column_key IS NULL OR c.column_key NOT IN (${SQL_COLONNES_FERMEES}))`,
    )
    .all() as {
    projectId: string;
    agentId: string;
    cardId: string | null;
    messageId: string;
    // Les seules questions, jamais le message entier : 250 Ko au lieu de 7 Mo
    // sur ce serveur (23/10/2026), à chaque calcul des décisions.
    questions: string | null;
    createdAt: number;
    colonne: string | null;
  }[];
  const ListeDeQuestions = AgentQuestion.array();
  for (const row of rows) {
    /*
     * UNE CARTE RANGÉE N'ATTEND PLUS DE RÉPONSE. Le déplacement ferme désormais
     * les questions ouvertes (`fermeture-questions.ts`), mais celles posées
     * AVANT cette règle dorment encore en base : elles allumeraient un triangle
     * et un bouton « Répondre » sur une carte archivée ou déjà en production.
     * Le garde-fou est ici, à la lecture, exactement comme pour la question
     * écrite en texte ordinaire.
     */
    if (colonneFermeLesQuestions(row.colonne ?? undefined)) continue;
    try {
      const questions = row.questions ? ListeDeQuestions.parse(JSON.parse(row.questions)) : [];
      for (const question of questions) {
        decisions.push({
          projectId: row.projectId,
          agentId: row.agentId,
          cardId: row.cardId ?? undefined,
          genre: 'question',
          reglee: Boolean(question.answer) || question.cancelled,
          poseeA: row.createdAt,
          messageId: row.messageId,
          source: 'question-outil',
          texte: question.question,
          projectName: enrichir.nomProjet(row.projectId),
          lieuTitre: enrichir.lieuTitre(row.cardId ?? undefined, row.agentId),
        });
      }
    } catch {
      /* message illisible : on l'ignore */
    }
  }

  const propositions = getDb()
    .prepare(
      `SELECT p.id AS proposalId, p.project_id AS projectId, p.decision AS decision,
              p.created_at AS createdAt, p.message_id AS messageId,
              CASE WHEN json_valid(p.data) THEN json_extract(p.data, '$.title') END AS titre,
              a.id AS agentId, a.card_id AS cardId
       FROM proposals p
       JOIN messages m ON m.id = p.message_id
       JOIN agents a ON a.id = m.agent_id`,
    )
    .all() as {
    proposalId: string;
    projectId: string;
    decision: string;
    createdAt: number;
    /* Le seul titre, jamais la proposition entière : 1 400 JSON relus pour rien. */
    titre: string | null;
    messageId: string;
    agentId: string;
    cardId: string | null;
  }[];
  /*
   * Troisième source, et la plus sournoise : la question qu'un agent a écrite
   * en TEXTE ORDINAIRE au lieu d'appeler l'outil prévu. Le tour s'achève
   * normalement, rien n'est enregistré, et la carte reste en « En cours » sans
   * que rien ne dise qu'on attend une réponse.
   *
   * Trois garde-fous, tous nécessaires. On ne juge que le dernier message de
   * la CARTE, tous agents confondus : une carte passe souvent de main en main,
   * et le fil d'un ancien agent se fige sur sa dernière phrase — la question y
   * resterait la plus récente à jamais, alors qu'un agent suivant y a répondu
   * et fini le travail. On écarte ensuite les cartes RANGÉES (« Terminé »,
   * « À déployer », « Archivé ») : ce qui est mené au bout ne réclame plus
   * d'arbitrage. Et on s'en tient aux agents qui portent une CARTE : le chef
   * d'orchestre finit une réponse sur deux par « voulez-vous que… », et son fil
   * est déjà sous les yeux de qui l'a écrit. La règle elle-même vit dans
   * `shared`, donc elle se teste seule.
   */
  /*
   * PARTIR DES CARTES OUVERTES, PAS DES AGENTS (28/10/2026). L'ancienne forme
   * balayait les 5 500 agents et, pour chacun, relisait la ligne de chaque
   * message de sa carte pour en tirer l'identifiant : 40 ms à chaud, plus d'une
   * seconde quand ces pages étaient sorties du cache (gels de `blocages.log`).
   * Ici, une vingtaine de cartes ouvertes, et le dernier message de chacune
   * se trouve par l'index `idx_messages_agent` SEUL — son `rowid` y est déjà.
   */
  const derniers = getDb()
    .prepare(
      `WITH ouvertes AS (
         SELECT c.id AS cardId, c.column_key AS colonne,
                (SELECT m2.rowid FROM agents a2
                   JOIN messages m2 ON m2.agent_id = a2.id
                  WHERE a2.card_id = c.id
                  ORDER BY m2.created_at DESC, m2.rowid DESC LIMIT 1) AS dernier
           FROM cards c
          WHERE c.column_key NOT IN (${SQL_COLONNES_FERMEES})
       )
       SELECT a.project_id AS projectId, a.id AS agentId, o.cardId AS cardId,
              a.status AS statut, m.id AS messageId, m.data AS data,
              m.created_at AS createdAt, o.colonne AS colonne
       FROM ouvertes o
       JOIN messages m ON m.rowid = o.dernier
       JOIN agents a ON a.id = m.agent_id
       WHERE a.status NOT IN ('starting', 'running')`,
    )
    .all() as {
    projectId: string;
    agentId: string;
    cardId: string;
    statut: string;
    messageId: string;
    data: string;
    createdAt: number;
    colonne: string | null;
  }[];
  for (const dernier of derniers) {
    try {
      const message = Message.parse(JSON.parse(dernier.data));
      const question = decisionEnTexteLibre({
        statut: dernier.statut as StatutAgent,
        dernierMessage: message,
        colonne: dernier.colonne ?? undefined,
      });
      if (!question) continue;
      decisions.push({
        projectId: dernier.projectId,
        agentId: dernier.agentId,
        cardId: dernier.cardId,
        genre: 'question',
        reglee: false,
        poseeA: dernier.createdAt,
        messageId: dernier.messageId,
        source: 'question-en-texte',
        texte: question,
        projectName: enrichir.nomProjet(dernier.projectId),
        lieuTitre: enrichir.lieuTitre(dernier.cardId, dernier.agentId),
      });
    } catch {
      /* message illisible : on l'ignore */
    }
  }

  const propositionsVues = new Set<string>();
  for (const proposition of propositions) {
    propositionsVues.add(proposition.proposalId);
    const titre = typeof proposition.titre === 'string' ? proposition.titre : undefined;
    decisions.push({
      projectId: proposition.projectId,
      agentId: proposition.agentId,
      // La carte PROPOSÉE n'existe pas encore : ce qu'on note ici, c'est la
      // carte dans le fil de laquelle la proposition a été faite. Le chef
      // d'orchestre n'en a pas — sa proposition se voit donc sur sa
      // conversation, là où le bouton de validation attend.
      cardId: proposition.cardId ?? undefined,
      genre: 'validation',
      reglee: proposition.decision !== 'pending',
      poseeA: proposition.createdAt,
      messageId: proposition.messageId,
      source: 'carte-proposee',
      texte: titre ? `Carte proposée : ${titre}` : 'Une carte est proposée',
      projectName: enrichir.nomProjet(proposition.projectId),
      lieuTitre: enrichir.lieuTitre(proposition.cardId ?? undefined, proposition.agentId),
    });
  }

  /*
   * LE FILET : CE QUE L'ÉCRAN MONTRE À VALIDER COMPTE, D'OÙ QU'IL VIENNE.
   *
   * Une carte à valider s'affiche à partir du MESSAGE qui la porte ; le compte,
   * lui, se lisait dans la seule table des propositions. Deux sources, donc
   * deux occasions de diverger : une ligne écrite en retard, une ligne jamais
   * écrite, un message repris ailleurs — et le panneau attendait pendant que la
   * ligne du projet restait muette. On reprend donc ici les propositions
   * ENCORE EN ATTENTE portées par un message et absentes de la table. Le filtre
   * SQL est étroit (deux `LIKE` sur des propositions non tranchées, tenus par un
   * index partiel) : sur ce serveur, il ne ramène qu'une poignée de lignes.
   */
  const portees = getDb()
    .prepare(
      `SELECT a.project_id AS projectId, a.id AS agentId, a.card_id AS cardId,
              m.id AS messageId, m.data AS data, m.created_at AS createdAt
       FROM messages m
       JOIN agents a ON a.id = m.agent_id
       -- L'INDEX PARTIEL D'ABORD (migration 121) : la colonne générée porte
       -- ce même prédicat. Les deux LIKE restent derrière, pour que le
       -- résultat ne dépende jamais de l'index seul. Sans lui, ce filet
       -- balayait le texte de tous les messages à chaque calcul (418 ms).
       WHERE m.a_proposition_en_attente = 1
         AND m.data LIKE '%"proposals":[{%' AND m.data LIKE '%"decision":"pending"%'`,
    )
    .all() as {
    projectId: string;
    agentId: string;
    cardId: string | null;
    messageId: string;
    data: string;
    createdAt: number;
  }[];
  for (const porte of portees) {
    try {
      const message = Message.parse(JSON.parse(porte.data));
      for (const proposition of message.proposals) {
        if (proposition.decision !== 'pending') continue;
        if (propositionsVues.has(proposition.id)) continue;
        propositionsVues.add(proposition.id);
        decisions.push({
          projectId: porte.projectId,
          agentId: porte.agentId,
          cardId: porte.cardId ?? undefined,
          genre: 'validation',
          reglee: false,
          poseeA: porte.createdAt,
          messageId: porte.messageId,
          source: 'carte-proposee',
          texte: proposition.title ? `Carte proposée : ${proposition.title}` : 'Une carte est proposée',
          projectName: enrichir.nomProjet(porte.projectId),
          lieuTitre: enrichir.lieuTitre(porte.cardId ?? undefined, porte.agentId),
        });
      }
    } catch {
      /* message illisible : on l'ignore */
    }
  }

  /*
   * SIXIÈME SOURCE : LE GESTE QUE LE PARCOURS D'UNE CARTE ATTEND. Elle vient
   * en DERNIER, et pour une raison : elle a besoin de savoir quelles cartes
   * portent déjà une décision ouverte, pour ne pas les compter deux fois. Une
   * carte qui attend une réponse à une question n'attend pas, en plus, qu'on
   * génère son plan — c'est la même carte, et le même repère.
   */
  const cartesDejaEnAttente = new Set<string>();
  for (const decision of decisions) {
    if (!decision.reglee && decision.cardId) cartesDejaEnAttente.add(decision.cardId);
  }
  decisions.push(...attentesDeGeste(cartesDejaEnAttente));

  /*
   * LE FILTRE DES ALERTES ORPHELINES, POSÉ EN DERNIER — donc valable pour les
   * six sources ci-dessus, celles d'aujourd'hui comme celles de demain.
   *
   * Supprimer une carte n'efface QUE sa ligne (`deleteCard`) : les agents et
   * les messages de son fil restent en base, questions ouvertes comprises. Elles
   * allumaient encore un triangle sur le projet et un chiffre sur la cloche,
   * alors que le clic ne pouvait plus qu'annoncer « Cette tâche n'existe plus ».
   * La règle elle-même vit dans `shared/src/decision-attendue.ts`, donc elle se
   * teste seule ; ici on ne fait que lui donner ce qui existe encore.
   */
  const cartes = new Set(
    (getDb().prepare('SELECT id FROM cards').all() as { id: string }[]).map((row) => row.id),
  );
  const projets = new Set(
    (getDb().prepare('SELECT id FROM projects').all() as { id: string }[]).map((row) => row.id),
  );
  /*
   * LES CONVERSATIONS AUSSI DISPARAISSENT. Les cinq sources ci-dessus ne
   * ramènent pas toutes une décision par une jointure sur `agents` : une
   * reprise de compte et une erreur de tour sont lues ailleurs, et gardent
   * l'identifiant d'un agent qui a pu partir depuis (l'assistant d'une fiche de
   * sauvegarde s'en va avec sa fiche). Sans carte pour la rattraper, la
   * décision restait comptée pour toujours.
   */
  const agents = new Set(
    (getDb().prepare('SELECT id FROM agents').all() as { id: string }[]).map((row) => row.id),
  );
  /*
   * PUIS LE CRITÈRE D'ISSUE RÉELLE, juste derrière — l'orpheline répond « le
   * lieu existe-t-il ? », celui-ci répond « y a-t-il encore un geste à y
   * faire ? ». Une décision qui ne nomme pas le message où sa question se
   * tranche n'a rien à allumer : on ne saurait ni afficher ses boutons ni y
   * conduire au clic. La règle vit dans `shared/src/issue-de-decision.ts`.
   */
  return decisionsHorsProjet(decisionsAvecIssue(sansDecisionsOrphelines(decisions, { cartes, projets, agents })));
}

/**
 * LA DÉCISION D'UN AGENT PORTÉ PAR UN SERVICE (`agent.service`) N'EST SUR AUCUN
 * PROJET. Posée APRÈS le filtre des orphelines (qui vérifie le projet porteur) :
 * son projet est vidé — aucun triangle de projet ne s'allume —, le nom du
 * service le remplace dans la cloche, et le clic mène à l'écran du service.
 */
function decisionsHorsProjet(decisions: DecisionAttendue[]): DecisionAttendue[] {
  const services = new Map<string, { nom: string; adresse: string } | null>();
  const serviceDe = (agentId: string) => {
    if (!services.has(agentId)) {
      let service: { nom: string; adresse: string } | null = null;
      try {
        const raw = rawAgent(agentId);
        const lu = raw ? (JSON.parse(raw).service as { nom?: string; adresse?: string } | undefined) : undefined;
        if (lu?.nom && lu.adresse) service = { nom: lu.nom, adresse: lu.adresse };
      } catch {
        service = null;
      }
      services.set(agentId, service);
    }
    return services.get(agentId) ?? null;
  };
  return decisions.map((decision) => {
    const service = decision.agentId && !decision.cardId ? serviceDe(decision.agentId) : null;
    return service ? { ...decision, projectId: '', projectName: service.nom, url: `#${service.adresse}` } : decision;
  });
}

/**
 * Tout ce que l'interface a besoin de savoir sur l'attente, d'un seul tenant :
 * le compte par projet et l'endroit de chaque décision. Les deux partent
 * ENSEMBLE — un compte diffusé sans ses endroits laisserait la ligne du projet
 * s'allumer pendant que cartes et conversations restent muettes.
 */
export function signalAttention(
  connues?: DecisionAttendue[],
): { byProject: Record<string, number>; decisions: DecisionAttendue[] } {
  const decisions = connues ?? decisionsEnAttente();
  /*
   * Seules les décisions ENCORE OUVERTES partent sur le fil. Tout ce qui les
   * lit à l'écran passe déjà par `decisionsOuvertes` : les tranchées étaient
   * jetées à l'arrivée, après avoir pesé 236 Ko dans le premier envoi (708
   * entrées sur ce serveur). Le COMPTE par projet, lui, se fait toujours sur la
   * liste entière — il ne change pas d'un iota.
   */
  return { byProject: attentionParProjet(decisions), decisions: decisionsDuPremierEnvoi(decisions) };
}


/**
 * Les projets dont un agent a RENDU son travail sans qu'on l'ait encore lu.
 *
 * La roue qui tourne dit déjà « un agent travaille » ; c'est l'état d'après qui
 * manquait. On rapproche chaque carte de son dernier agent, et la règle — dans
 * `shared`, donc testable seule — tranche. Les cartes SYSTÈME n'y comptent
 * plus (06/10/2026) : finies, elles passent 24 heures dans « Archiver » sans
 * aucun signal — ni chiffre bleu, ni cloche, ni icône de l'application.
 */
export function projectsWithFinishedWork(): Record<string, number> {
  return rendusParProjet(etatDesCartesRendues());
}

/**
 * LES AGENTS SANS CARTE FINIS DEPUIS MOINS DE 24 HEURES, d'un projet qui existe
 * encore : leur carte violette dans « Archiver » des Tableaux de bord
 * (`agentSystemeTermine`). Lu par la colonne calculée `fini_a` et son index.
 */
export function agentsSystemeTermines(maintenant: number): Agent[] {
  const rows = getDb()
    .prepare(
      /* L'index partiel est NOMMÉ : laissé à lui-même, le planificateur passe
         par celui des cartes et relit le JSON de chaque agent sans carte
         (mesuré : 1,9 ms contre 0,07 ms sur 700 agents). */
      `SELECT a.data FROM agents a INDEXED BY idx_agents_sans_carte
        WHERE a.card_id IS NULL AND a.fini_a > ?
          AND EXISTS (SELECT 1 FROM projects p WHERE p.id = a.project_id)`,
    )
    .all(maintenant - DUREE_SYSTEME_TERMINE_MS) as { data: string }[];
  return rows.map((r) => Agent.parse(JSON.parse(r.data))).filter((agent) => agentSystemeTermine(agent, maintenant));
}

/**
 * LES MISES EN PRODUCTION QUI ONT LEUR CARTE VIOLETTE, tous projets confondus :
 * la dernière de chaque projet, si elle tourne ou si elle a fini depuis moins
 * de 24 heures. Une publication plus ancienne ne revient jamais : la suivante
 * l'a remplacée.
 */
export function productionsAAfficher(maintenant: number): DeployRun[] {
  const rows = getDb()
    .prepare(
      `SELECT d.data FROM deploys d
        WHERE d.cible = 'production'
          AND (d.state = 'running' OR COALESCE(d.ended_at, 0) > ?)
          AND NOT EXISTS (SELECT 1 FROM deploys n
                           WHERE n.cible = 'production' AND n.project_id = d.project_id AND n.started_at > d.started_at)
          AND EXISTS (SELECT 1 FROM projects p WHERE p.id = d.project_id)`,
    )
    .all(maintenant - DUREE_SYSTEME_TERMINE_MS) as { data: string }[];
  return misesEnProductionAAfficher(
    rows.map((r) => DeployRun.parse(JSON.parse(r.data))),
    maintenant,
  );
}

/**
 * Les cartes d'un projet dont la réponse n'a pas encore été lue. C'est ce que
 * le geste « marquer comme lu » de la liste des projets doit toucher — et rien
 * d'autre : réécrire toutes les cartes du projet pour ça serait un gâchis.
 */
export function unreadCards(projectId: string): string[] {
  return etatDesCartesRendues(projectId)
    .filter(carteNonLue)
    .map((entree) => entree.cardId);
}

/**
 * CE QUE LE BADGE BLEU OUVRE : la carte non lue la plus récemment rendue du
 * projet (ou du groupe). Les cartes Système n'y comptent plus (06/10/2026).
 */
export function lastUnread(projectIds: string[]): string | null {
  return carteNonLueLaPlusRecente(projectIds.flatMap((id) => etatDesCartesRendues(id)));
}

/**
 * Chaque carte avec l'instant de son dernier rendu, prête pour la règle
 * partagée. `renduA` fait foi (colonne générée `rendu_a`) ; une carte d'avant
 * ce champ se rabat sur son dernier agent, s'il a fini proprement.
 */
function etatDesCartesRendues(projectId?: string): CarteRendue[] {
  const sql = `SELECT c.id AS cardId, c.project_id AS projectId, c.column_key AS colonne,
              COALESCE(c.last_read_at, json_extract(c.data, '$.lastReadAt')) AS luA, c.rendu_a AS renduA,
              CASE WHEN c.rendu_a IS NULL THEN (SELECT a.data FROM agents a
                WHERE a.card_id = c.id ORDER BY a.created_at DESC LIMIT 1) END AS agent
         FROM cards c
        WHERE c.column_key <> 'archived'${projectId ? ' AND c.project_id = ?' : ''}`;
  const requete = getDb().prepare(sql);
  const rows = (projectId ? requete.all(projectId) : requete.all()) as {
    cardId: string;
    projectId: string;
    colonne: string;
    luA: number | null;
    renduA: number | null;
    agent: string | null;
  }[];

  const entrees: CarteRendue[] = [];
  for (const row of rows) {
    try {
      const agent = row.agent ? (JSON.parse(row.agent) as { status?: string; endedAt?: number }) : null;
      entrees.push({
        cardId: row.cardId,
        projectId: row.projectId,
        colonne: row.colonne,
        renduA: instantDuRendu({ renduA: row.renduA ?? undefined }, agent),
        luA: row.luA ?? undefined,
      });
    } catch {
      /* carte illisible : elle n'apprend rien de plus */
    }
  }
  return entrees;
}

/**
 * UN AGENT DE LA CARTE VIENT DE RENDRE SON TOUR. On écrit l'instant sur la
 * carte : c'est lui, comparé à la dernière consultation, qui allume la pastille
 * bleue — pour un cadrage et un plan comme pour une exécution. Rend la carte
 * écrite, ou `null` si l'agent n'a pas de carte.
 */
export function marquerRendu(agent: { cardId?: string }, at = now()): Card | null {
  if (!agent.cardId) return null;
  const carte = getCard(agent.cardId);
  if (!carte) return null;
  return saveCard({ ...carte, renduA: at });
}

function rawAgent(id: string): string | null {
  const row = getDb().prepare('SELECT data FROM agents WHERE id = ?').get(id) as { data: string } | undefined;
  return row?.data ?? null;
}

/** Le détail de ces questions : de quel projet, et ce qui est demandé. */
export function pendingQuestions(): { projectId: string; question: string }[] {
  const rows = getDb()
    .prepare(
      `SELECT a.project_id AS projectId, m.data AS data FROM messages m
       JOIN agents a ON a.id = m.agent_id
       WHERE m.a_questions = 1
       ORDER BY m.created_at DESC LIMIT 200`,
    )
    .all() as { projectId: string; data: string }[];
  const out: { projectId: string; question: string }[] = [];
  for (const row of rows) {
    try {
      const message = Message.parse(JSON.parse(row.data));
      for (const q of message.questions.filter((item) => !item.answer)) {
        out.push({ projectId: row.projectId, question: q.question });
      }
    } catch {
      /* message illisible : on l'ignore */
    }
  }
  return out;
}

export function listCardMessages(cardId: string, limit = 800): Message[] {
  const rows = getDb()
    .prepare(
      `SELECT m.data FROM messages m
       JOIN agents a ON a.id = m.agent_id
       WHERE a.card_id = ?
       ORDER BY m.created_at DESC LIMIT ?`,
    )
    .all(cardId, limit) as { data: string }[];
  return rows.map((r) => Message.parse(JSON.parse(r.data))).sort((a, b) => a.createdAt - b.createdAt);
}

export function getMessage(id: string): Message | null {
  const row = getDb().prepare('SELECT data FROM messages WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? Message.parse(JSON.parse(row.data)) : null;
}

/** Le message qui porte une proposition de carte (table `proposals`), pour la valider sans écran. */
export function messageDeLaProposition(proposalId: string): Message | null {
  const row = getDb().prepare('SELECT message_id AS id FROM proposals WHERE id = ?').get(proposalId) as { id: string } | undefined;
  return row ? getMessage(row.id) : null;
}

export function saveMessage(message: Message): Message {
  const value = Message.parse(message);
  getDb()
    .prepare(
      `INSERT INTO messages (id, agent_id, role, data, created_at, a_questions, streaming)
       VALUES (@id, @agentId, @role, @data, @createdAt, @aQuestions, @streaming)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, a_questions = excluded.a_questions,
         streaming = excluded.streaming`,
    )
    .run({
      id: value.id,
      agentId: value.agentId,
      role: value.role,
      data: JSON.stringify(value),
      createdAt: value.createdAt,
      aQuestions: value.questions.length > 0 ? 1 : 0,
      streaming: value.streaming ? 1 : 0,
    });
  return value;
}

/**
 * BORNE LE DISQUE : le texte entier de chaque tour (consigne système,
 * compétences, mémoire, passages, message courant) vit dans `sentContext` —
 * précieux pour le lecteur de prompts, mais lourd sur des milliers de tours.
 * Au-delà des `TOURS_CONTEXTE_CONSERVES` derniers tours d'un agent, le texte
 * est retiré et seuls les compteurs (`characters`) restent : le lecteur
 * affiche alors « texte non conservé » plutôt que du contenu inventé.
 */
export const TOURS_CONTEXTE_CONSERVES = 20;

export function purgerContexteEnvoyeAncien(agentId: string): void {
  const rows = getDb()
    .prepare(`SELECT id, data FROM messages WHERE agent_id = ? ${ORDRE_DES_MESSAGES_DESC}`)
    .all(agentId) as { id: string; data: string }[];
  let gardes = 0;
  for (const row of rows) {
    /*
     * UNE LIGNE DE BASE N'EST PAS UN OBJET DE CONFIANCE. On la relit telle
     * qu'elle a été écrite, parfois par une version PLUS ANCIENNE du modèle :
     * `passages` n'existait pas, un champ a pu changer de forme. Le schéma
     * (`Message.parse`) poserait ses valeurs par défaut, mais il n'est pas
     * appliqué ici — un simple `as Message` MENT donc sur ce qu'on tient
     * vraiment. Sans cette prudence, `sc.passages.map` levait une panne sur un
     * vieux fil (le chef d'orchestre, 400 messages), et la panne remontait
     * jusqu'au filet de fin de tour qui affichait « panne interne du serveur »
     * alors que le moteur, lui, tournait toujours.
     */
    let parsed: Message;
    try {
      parsed = JSON.parse(row.data) as Message;
    } catch {
      continue;
    }
    if (!parsed.sentContext) continue;
    gardes += 1;
    if (gardes <= TOURS_CONTEXTE_CONSERVES) continue;
    const sc = parsed.sentContext;
    const allege: Message = {
      ...parsed,
      sentContext: {
        ...sc,
        prompt: '',
        systemInstruction: { ...sc.systemInstruction, content: '' },
        blocks: (sc.blocks ?? []).map((b) => ({ ...b, text: undefined })),
        passages: (sc.passages ?? []).map((p) => ({ ...p, texte: '' })),
        consultationsMemoire: (sc.consultationsMemoire ?? []).map((consultation) => ({
          ...consultation,
          resultat: '',
        })),
      },
    };
    if (JSON.stringify(allege) === row.data) continue;
    getDb()
      .prepare('UPDATE messages SET data = ?, a_questions = ? WHERE id = ?')
      .run(JSON.stringify(allege), allege.questions.length > 0 ? 1 : 0, row.id);
  }
}

/* ------------------------------------------------------------------ */
/* File de demandes (PLAN §14)                                         */
/* ------------------------------------------------------------------ */

export const QUEUE_MAX = 10;

/**
 * COMBIEN DE DEMANDES EN FILE, sans en lire une seule. Les contrôles de
 * démarrage ne veulent qu'un nombre : `listQueue().length` relisait et
 * validait chaque entrée.
 */
export function compterFile(agentId: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM queue WHERE agent_id = ?').get(agentId) as { n: number }).n;
}

export function listQueue(agentId: string): QueuedPrompt[] {
  const rows = getDb()
    .prepare('SELECT data FROM queue WHERE agent_id = ? ORDER BY position')
    .all(agentId) as { data: string }[];
  return rows.map((r) => QueuedPrompt.parse(JSON.parse(r.data)));
}

/**
 * LES FILES QUI ATTENDENT UN QUOTA : celles qui portent une demande déjà écrite
 * (`messageId`), retombée en file faute de compte. Elles partent au premier
 * envoi, pour que le badge « En attente de quota » d'une carte se voie sans
 * ouvrir son fil (`shared/src/attente-de-quota.ts`).
 */
export function filesSansQuota(): { agentId: string; projectId: string; queue: QueuedPrompt[] }[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT q.agent_id AS agentId, a.project_id AS projectId
         FROM queue q JOIN agents a ON a.id = q.agent_id
        WHERE q.data LIKE '%"messageId":"%'`,
    )
    .all() as { agentId: string; projectId: string }[];
  return rows.map((row) => ({ ...row, queue: listQueue(row.agentId) }));
}

/**
 * Empile une demande. `messageId` nomme la bulle DÉJÀ écrite dans la
 * conversation, quand la demande a été enregistrée avant de retomber en file :
 * le tour qui la dépilera reprendra ce message au lieu d'en créer un second.
 *
 * `identite` porte ce qui distingue une demande INTERNE d'un message tapé : son
 * silence et son compte imposé. La file les perdait, et la reprise après
 * épuisement repartait sur le compte à sec en s'affichant comme si
 * l'utilisateur l'avait écrite (`QueuedPrompt`, `shared/src/models.ts`).
 */
export function enqueuePrompt(
  agentId: string,
  text: string,
  attachments: string[] = [],
  messageId?: string,
  identite: { silencieuse?: boolean; compteImpose?: string; poursuite?: boolean; repriseDe?: string } = {},
): QueuedPrompt | null {
  const current = listQueue(agentId);
  if (current.length >= QUEUE_MAX) return null;
  const item: QueuedPrompt = {
    id: newId(),
    agentId,
    text,
    attachments,
    position: current.length ? current[current.length - 1].position + 1 : 1,
    messageId,
    silencieuse: identite.silencieuse || undefined,
    compteImpose: identite.compteImpose,
    poursuite: identite.poursuite || undefined,
    repriseDe: identite.repriseDe,
    createdAt: now(),
  };
  getDb()
    .prepare('INSERT INTO queue (id, agent_id, position, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(item.id, agentId, item.position, JSON.stringify(item), item.createdAt);
  return item;
}

/**
 * Les canaux vivants qui déclarent modifier une demande en attente (id de la
 * demande → canaux). Tant qu'un canal la tient, elle est retenue sans délai.
 */
const canauxEnEdition = new Map<string, Set<object>>();

/** Un canal déclare (ou lève) la modification ; rend `true` si plus aucun canal ne la tient. */
export function tenirEditionParCanal(id: string, canal: object, actif: boolean): void {
  const tenus = canauxEnEdition.get(id) ?? new Set<object>();
  if (actif) tenus.add(canal);
  else tenus.delete(canal);
  if (tenus.size) canauxEnEdition.set(id, tenus);
  else canauxEnEdition.delete(id);
}

/**
 * Un canal se ferme : ses modifications ne sont plus tenues. Le repère de
 * chaque demande repart de MAINTENANT, pour que le délai laisse à l'écran le
 * temps de se reconnecter. Rend les agents dont la file doit être relue plus tard.
 */
export function lacherLesEditionsDuCanal(canal: object): string[] {
  const agents = new Set<string>();
  for (const [id, tenus] of [...canauxEnEdition]) {
    if (!tenus.delete(canal)) continue;
    if (!tenus.size) canauxEnEdition.delete(id);
    const row = getDb().prepare('SELECT agent_id, data FROM queue WHERE id = ?').get(id) as { agent_id: string; data: string } | undefined;
    if (!row) continue;
    const avant = QueuedPrompt.parse(JSON.parse(row.data));
    if (!avant.enEditionDepuis || tenus.size) continue;
    getDb().prepare('UPDATE queue SET data = ? WHERE id = ?').run(JSON.stringify({ ...avant, enEditionDepuis: now() }), id);
    agents.add(row.agent_id);
  }
  return [...agents];
}

export function dequeuePrompt(agentId: string): QueuedPrompt | null {
  const items = listQueue(agentId);
  if (!items.length) return null;
  const first = items[0];
  /* La demande de tête est ouverte dans la barre d'écriture : la file l'attend
     (`retenueParUneEdition`, shared/src/file-en-edition.ts). */
  if (retenueParUneEdition(first, now(), (canauxEnEdition.get(first.id)?.size ?? 0) > 0)) return null;
  getDb().prepare('DELETE FROM queue WHERE id = ?').run(first.id);
  return first;
}

/**
 * Vide la file d'un agent d'un coup. Arrêter une tâche à la main doit couper
 * AUSSI ce qui attendait derrière : sinon le tour suivant repartait tout seul
 * quelques secondes après l'arrêt, et le geste ne servait à rien.
 */
export function clearQueue(agentId: string): number {
  const info = getDb().prepare('DELETE FROM queue WHERE agent_id = ?').run(agentId);
  return Number(info.changes ?? 0);
}

/**
 * Modifier un message en attente : son texte, et — quand l'écran les donne —
 * les pièces qu'il porte après la modification. Sans liste, il garde les
 * siennes ; avec, une pièce encore citée par un tag du texte ne se perd pas
 * (`piecesApresModification`, `shared/src/pieces-message-en-attente.ts`). Tout
 * le reste de la demande (bulle déjà écrite, silence, compte imposé, reprise)
 * traverse la modification sans bouger.
 */
export function updateQueued(id: string, text: string, attachments?: string[]): QueuedPrompt | null {
  const row = getDb().prepare('SELECT data FROM queue WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  const avant = QueuedPrompt.parse(JSON.parse(row.data));
  const piecesDOrigine = avant.attachments
    .map((pieceId) => getAttachment(pieceId))
    .filter((piece): piece is Attachment => !!piece);
  const item = QueuedPrompt.parse({
    ...avant,
    text,
    attachments: piecesApresModification(avant.attachments, piecesDOrigine, text, attachments),
  });
  getDb().prepare('UPDATE queue SET data = ? WHERE id = ?').run(JSON.stringify(item), id);
  return item;
}

/**
 * Une demande en attente s'ouvre (`actif`) ou se referme dans la barre
 * d'écriture. Rend l'agent qui la porte, ou `null` si elle est déjà partie.
 */
export function marquerEditionEnFile(id: string, actif: boolean): string | null {
  const row = getDb().prepare('SELECT agent_id, data FROM queue WHERE id = ?').get(id) as { agent_id: string; data: string } | undefined;
  if (!row) return null;
  const avant = QueuedPrompt.parse(JSON.parse(row.data));
  if (!actif) canauxEnEdition.delete(id);
  const item = QueuedPrompt.parse({ ...avant, enEditionDepuis: actif ? now() : undefined });
  getDb().prepare('UPDATE queue SET data = ? WHERE id = ?').run(JSON.stringify(item), id);
  return row.agent_id;
}

/**
 * « ENVOYER MAINTENANT » : la demande passe en TÊTE de file, sans toucher au
 * rang des autres, et n'est plus retenue par une modification en cours — sinon
 * `dequeuePrompt` la laisserait attendre. Rend l'agent qui la porte, ou `null`
 * si elle est déjà partie (le geste est alors sans effet : un second clic ne
 * recoupe rien).
 */
export function agentDeLaDemandeEnFile(id: string): string | null {
  const row = getDb().prepare('SELECT agent_id FROM queue WHERE id = ?').get(id) as { agent_id: string } | undefined;
  return row?.agent_id ?? null;
}

export function remonterEnTete(id: string): string | null {
  const row = getDb().prepare('SELECT agent_id, data FROM queue WHERE id = ?').get(id) as { agent_id: string; data: string } | undefined;
  if (!row) return null;
  const avant = QueuedPrompt.parse(JSON.parse(row.data));
  const premiere = listQueue(row.agent_id)[0];
  const position = premiere && premiere.id !== id ? premiere.position - 1 : avant.position;
  canauxEnEdition.delete(id);
  const item = QueuedPrompt.parse({ ...avant, position, enEditionDepuis: undefined });
  getDb().prepare('UPDATE queue SET position = ?, data = ? WHERE id = ?').run(position, JSON.stringify(item), id);
  return row.agent_id;
}

export function removeQueued(id: string): string | null {
  const row = getDb().prepare('SELECT agent_id FROM queue WHERE id = ?').get(id) as { agent_id: string } | undefined;
  if (!row) return null;
  getDb().prepare('DELETE FROM queue WHERE id = ?').run(id);
  return row.agent_id;
}

/* ------------------------------------------------------------------ */
/* Propositions (PLAN §10 — la décision est mémorisée)                 */
/* ------------------------------------------------------------------ */

export function saveProposal(messageId: string, projectId: string, proposal: TaskProposal): void {
  getDb()
    .prepare(
      `INSERT INTO proposals (id, message_id, project_id, decision, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET decision = excluded.decision, data = excluded.data`,
    )
    .run(proposal.id, messageId, projectId, proposal.decision, JSON.stringify(proposal), now());
}

export function decideProposal(proposalId: string, decision: 'accepted' | 'refused' | 'integrated', cardId?: string): TaskProposal | null {
  const row = getDb().prepare('SELECT data FROM proposals WHERE id = ?').get(proposalId) as
    | { data: string }
    | undefined;
  if (!row) return null;
  const proposal = TaskProposal.parse({ ...JSON.parse(row.data), decision, cardId, decidedAt: now() });
  getDb()
    .prepare('UPDATE proposals SET decision = ?, data = ?, decided_at = ? WHERE id = ?')
    .run(decision, JSON.stringify(proposal), proposal.decidedAt, proposalId);
  return proposal;
}

export interface ReferenceProposition {
  messageId: string;
  proposalId: string;
}

export interface ResultatFusionPropositions {
  proposal: TaskProposal;
  messages: Message[];
  projectId: string;
  already?: boolean;
}

/**
 * Réunit plusieurs propositions dans UNE transaction : soit toutes les
 * sources deviennent « merged » et la nouvelle proposition existe, soit rien
 * ne change. Le tableau des cartes n'est jamais touché ici.
 */
export function mergePendingProposals(items: ReferenceProposition[]): ResultatFusionPropositions {
  const uniques = items.filter(
    (item, index, liste) =>
      liste.findIndex((autre) => autre.messageId === item.messageId && autre.proposalId === item.proposalId) === index,
  );
  if (uniques.length < 2) throw new Error('sélectionnez au moins deux propositions différentes');

  const db = getDb();
  return db.transaction(() => {
    const lignes = uniques.map((item) => {
      const ligne = db
        .prepare(
          `SELECT p.project_id AS projectId, p.message_id AS messageId, p.decision AS decision,
                  p.data AS proposalData, m.data AS messageData
             FROM proposals p JOIN messages m ON m.id = p.message_id
            WHERE p.id = ? AND p.message_id = ?`,
        )
        .get(item.proposalId, item.messageId) as
        | {
            projectId: string;
            messageId: string;
            decision: string;
            proposalData: string;
            messageData: string;
          }
        | undefined;
      if (!ligne) throw new Error('une proposition sélectionnée est introuvable');
      return { ...ligne, proposal: TaskProposal.parse(JSON.parse(ligne.proposalData)) };
    });

    const projets = new Set(lignes.map((ligne) => ligne.projectId));
    if (projets.size !== 1) throw new Error('les propositions doivent appartenir au même projet');
    const projectId = lignes[0].projectId;

    if (lignes.some((ligne) => ligne.decision !== 'pending' || ligne.proposal.decision !== 'pending')) {
      // Deux clics très rapprochés doivent rendre le même résultat, jamais une
      // seconde proposition. On ne considère rejouable que le même ensemble
      // déjà réuni vers une cible unique.
      const cibles = new Set(lignes.map((ligne) => ligne.proposal.mergedInto).filter(Boolean));
      const toutesFusionnees = lignes.every(
        (ligne) => ligne.decision === 'merged' && ligne.proposal.decision === 'merged' && ligne.proposal.mergedInto,
      );
      if (toutesFusionnees && cibles.size === 1) {
        const cible = [...cibles][0]!;
        const existante = db.prepare('SELECT project_id AS projectId, data FROM proposals WHERE id = ?').get(cible) as
          | { projectId: string; data: string }
          | undefined;
        if (existante?.projectId === projectId) {
          return { proposal: TaskProposal.parse(JSON.parse(existante.data)), messages: [], projectId, already: true };
        }
      }
      throw new Error('seules des propositions encore en attente peuvent être fusionnées');
    }

    const id = newId();
    const proposal = TaskProposal.parse(fusionnerPropositions(lignes.map((ligne) => ligne.proposal), id));
    const decidedAt = now();
    const sources = new Map(
      lignes.map((ligne) => [
        ligne.proposal.id,
        TaskProposal.parse({ ...ligne.proposal, decision: 'merged', mergedInto: id, decidedAt }),
      ]),
    );

    const messagesParId = new Map<string, Message>();
    for (const ligne of lignes) {
      if (!messagesParId.has(ligne.messageId)) {
        messagesParId.set(ligne.messageId, Message.parse(JSON.parse(ligne.messageData)));
      }
    }

    const messageCible = lignes[0].messageId;
    const messages = [...messagesParId.entries()].map(([messageId, message]) => {
      const propositions = message.proposals.map((courante) => sources.get(courante.id) ?? courante);
      if (messageId === messageCible) propositions.push(proposal);
      const miseAJour = Message.parse({ ...message, proposals: propositions });
      db.prepare('UPDATE messages SET data = ?, a_questions = ? WHERE id = ?').run(
        JSON.stringify(miseAJour),
        miseAJour.questions.length > 0 ? 1 : 0,
        messageId,
      );
      return miseAJour;
    });

    for (const source of sources.values()) {
      db.prepare('UPDATE proposals SET decision = ?, data = ?, decided_at = ? WHERE id = ?').run(
        'merged',
        JSON.stringify(source),
        decidedAt,
        source.id,
      );
    }
    db.prepare(
      `INSERT INTO proposals (id, message_id, project_id, decision, data, created_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    ).run(proposal.id, messageCible, projectId, JSON.stringify(proposal), decidedAt);

    return { proposal, messages, projectId };
  })();
}

/* ------------------------------------------------------------------ */
/* Pièces jointes                                                      */
/* ------------------------------------------------------------------ */

export function listAttachments(projectId: string): Attachment[] {
  const rows = getDb()
    .prepare('SELECT data FROM attachments WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as { data: string }[];
  return rows.map((r) => Attachment.parse(JSON.parse(r.data)));
}

/**
 * TOUS les alias déjà attribués, tous projets confondus. L'alias nomme le
 * fichier sur le disque et les projets partagent ce dossier : son unicité se
 * vérifie donc sur le dépôt entier, jamais sur un seul projet.
 */
export function aliasDesPiecesJointes(): Set<string> {
  const rows = getDb()
    .prepare("SELECT json_extract(data, '$.alias') AS alias FROM attachments WHERE json_extract(data, '$.alias') IS NOT NULL")
    .all() as { alias: string }[];
  return new Set(rows.map((r) => r.alias));
}

/**
 * LES PIÈCES DÉSIGNÉES PAR LEUR ALIAS, TOUS PROJETS CONFONDUS. L'alias est
 * unique sur tout le dépôt (`aliasDesPiecesJointes`) : c'est ce qui permet de
 * retrouver la pièce d'un tag collé depuis un autre projet. Les images du
 * coffre-fort ne se rendent jamais par ce chemin.
 */
export function attachmentsParAlias(alias: readonly string[]): Attachment[] {
  const voulus = [...new Set(alias.filter(Boolean))].slice(0, 50);
  if (!voulus.length) return [];
  const rows = getDb()
    .prepare(
      `SELECT data FROM attachments
        WHERE project_id != ? AND json_extract(data, '$.alias') IN (${voulus.map(() => '?').join(', ')})`,
    )
    .all(PROJET_DU_COFFRE, ...voulus) as { data: string }[];
  return rows.map((r) => Attachment.parse(JSON.parse(r.data)));
}

export function findAttachmentBySha(projectId: string, sha: string): Attachment | null {
  const row = getDb()
    .prepare('SELECT data FROM attachments WHERE project_id = ? AND sha = ? LIMIT 1')
    .get(projectId, sha) as { data: string } | undefined;
  return row ? Attachment.parse(JSON.parse(row.data)) : null;
}

export function getAttachment(id: string): Attachment | null {
  const row = getDb().prepare('SELECT data FROM attachments WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? Attachment.parse(JSON.parse(row.data)) : null;
}

/**
 * UNE PIÈCE JOINTE DÉSIGNÉE PAR UN AGENT : son identifiant, ou son ALIAS
 * (« #8dba », celui qu'affichent l'écran et les tags « [fichier: … #8dba] »).
 * Cas vécu le 25/10/2026 : le directeur artistique recevait les photos par
 * leur alias, l'outil n'acceptait que l'identifiant complet, et il finissait
 * par demander à l'utilisateur de les rejoindre. Le projet de la carte passe
 * d'abord ; les images du coffre-fort ne se désignent jamais ainsi. Réservé
 * aux outils des agents : les adresses de téléchargement restent sur l'id.
 */
export function pieceJointeDesignee(ref: unknown, projectId?: string): Attachment | null {
  const brut = typeof ref === 'string' ? ref.trim().replace(/^#/, '') : '';
  if (!brut || brut.length > 80) return null;
  const directe = getAttachment(brut);
  if (directe) return directe.projectId === PROJET_DU_COFFRE ? null : directe;
  const rows = getDb()
    .prepare("SELECT data FROM attachments WHERE project_id != ? AND json_extract(data, '$.alias') = ? ORDER BY created_at DESC")
    .all(PROJET_DU_COFFRE, brut) as { data: string }[];
  const pieces = rows.map((r) => Attachment.parse(JSON.parse(r.data)));
  return pieces.find((p) => p.projectId === projectId) ?? pieces[0] ?? null;
}

export function saveAttachment(attachment: Attachment): Attachment {
  getDb()
    .prepare('INSERT INTO attachments (id, project_id, sha, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(attachment.id, attachment.projectId, attachment.sha, JSON.stringify(attachment), attachment.createdAt);
  return attachment;
}

/**
 * RETIRE UNE PIÈCE JOINTE DU DÉPÔT (sa ligne seulement : le fichier est effacé
 * par l'appelant, qui sait où il vit). Réservé à ce qui a un PROPRIÉTAIRE
 * unique et vérifié — les images du coffre-fort (`server/src/coffre-fort.ts`),
 * les sons et exports d'une création du studio (`server/src/studio.ts`).
 */
export function supprimerPieceJointe(id: string): boolean {
  return getDb().prepare('DELETE FROM attachments WHERE id = ?').run(id).changes > 0;
}

/**
 * L'INSTANT D'APERÇU D'UNE VIDÉO. Seul champ d'une pièce jointe qui bouge après
 * son dépôt : tout le reste est figé par le contenu du fichier.
 *
 * `seconde: null` efface le choix — c'est le retour à l'aperçu automatique. Un
 * choix AUTOMATIQUE (`manuel: false`) ne remplace jamais un choix de la main :
 * la recherche du lecteur tourne chez chaque visiteur, et le premier arrivé ne
 * doit pas défaire ce que quelqu'un a désigné.
 */
export function ecrireApercuDePiece(id: string, seconde: number | null, manuel: boolean): Attachment | null {
  const piece = getAttachment(id);
  if (!piece) return null;
  if (!manuel && piece.apercuManuel) return piece;
  const suite = Attachment.parse({
    ...piece,
    apercuSeconde: seconde === null ? undefined : Math.max(0, seconde),
    apercuManuel: seconde === null ? undefined : manuel || undefined,
  });
  getDb().prepare('UPDATE attachments SET data = ? WHERE id = ?').run(JSON.stringify(suite), id);
  return suite;
}

/* ------------------------------------------------------------------ */
/* Commentaires de carte                                               */
/* ------------------------------------------------------------------ */

export function listCardComments(cardId: string): CardComment[] {
  const rows = getDb()
    .prepare('SELECT data FROM card_comments WHERE card_id = ? ORDER BY created_at ASC')
    .all(cardId) as { data: string }[];
  return rows.map((r) => CardComment.parse(JSON.parse(r.data)));
}

export function addCardComment(comment: CardComment): CardComment {
  const value = CardComment.parse(comment);
  getDb()
    .prepare('INSERT INTO card_comments (id, card_id, project_id, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(value.id, value.cardId, value.projectId, JSON.stringify(value), value.createdAt);
  return value;
}

export function deleteCardComment(id: string): void {
  getDb().prepare('DELETE FROM card_comments WHERE id = ?').run(id);
}

/* ------------------------------------------------------------------ */
/* Consommation réelle (PLAN §24)                                      */
/* ------------------------------------------------------------------ */

export interface UsageRow {
  projectId?: string;
  cardId?: string;
  agentId?: string;
  account?: string;
  engine?: string;
  tokens?: number;
  /** Tokens ENVOYÉS (entrée) réellement rendus par le moteur pour ce tour. */
  tokensIn?: number;
  /** Tokens REÇUS (sortie) réellement rendus par le moteur pour ce tour. */
  tokensOut?: number;
  quotaShare?: number;
  /** Part du quota de 5 heures consommée par la tâche (avant / après le tour). */
  quota5h?: number;
  /** Part du quota hebdomadaire consommée par la tâche (avant / après le tour). */
  quotaSemaine?: number;
  seconds?: number;
  /**
   * Le DÉTAIL du tour, tel que le moteur l'a rendu. `tokens` reste le total qui
   * sert aux totaux et à la facturation : ces trois nombres ne le remplacent
   * pas, ils disent seulement ce qui est parti et ce qui est revenu.
   */
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  /** Le modèle qui a porté le tour : sans lui, aucun coût ne peut être établi. */
  model?: string;
  /**
   * Ce qu'ont consommé les AIDES (sous-agents) du tour, à côté du principal.
   * Jamais compté dans `tokens` ni dans le quota : la hausse de quota mesurée
   * sur le compte les contient déjà, une seule fois.
   */
  aides?: { tokens: number; sortie: number; modeles: string[] };
}

export function recordUsage(row: UsageRow): void {
  // Le nom est figé À L'ÉCRITURE : supprimer un projet ne doit pas rendre sa
  // consommation anonyme dans les réglages.
  const nom = row.projectId
    ? ((getDb().prepare('SELECT name FROM projects WHERE id = ?').get(row.projectId) as { name?: string } | undefined)
        ?.name ?? null)
    : null;
  getDb()
    .prepare(
      `INSERT INTO usage (project_id, project_name, card_id, agent_id, account, engine, model, tokens, tokens_in, tokens_out, input_tokens, cached_tokens, output_tokens, quota_share, quota_5h, quota_semaine, seconds, aides_tokens, aides_sortie, aides_modeles, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.projectId ?? null,
      nom,
      row.cardId ?? null,
      row.agentId ?? null,
      row.account ?? null,
      row.engine ?? null,
      row.model ?? null,
      Math.round(row.tokens ?? 0),
      row.tokensIn !== undefined ? Math.round(row.tokensIn) : null,
      row.tokensOut !== undefined ? Math.round(row.tokensOut) : null,
      Math.round(row.inputTokens ?? 0),
      Math.round(row.cachedTokens ?? 0),
      Math.round(row.outputTokens ?? 0),
      row.quotaShare ?? 0,
      row.quota5h ?? 0,
      row.quotaSemaine ?? 0,
      row.seconds ?? 0,
      Math.round(row.aides?.tokens ?? 0),
      Math.round(row.aides?.sortie ?? 0),
      row.aides?.modeles.length ? row.aides.modeles.join(',') : null,
      now(),
    );
}

/** Tous les agents d'une carte, du plus ancien au plus récent. */
export function agentsDeLaCarte(cardId: string): Agent[] {
  return getDb()
    .prepare('SELECT data FROM agents WHERE card_id = ? ORDER BY created_at ASC')
    .all(cardId)
    .map((r: any) => Agent.parse(JSON.parse(r.data)));
}

/**
 * La part de quota (fenêtre de 5 h et semaine) qu'une carte a consommée en tout,
 * somme de toutes ses lignes de consommation. Une carte sans aucun relevé rend
 * deux zéros : c'est à l'appelant de ne rien afficher plutôt qu'un zéro
 * trompeur. Lecture seule — rien n'est écrit, aucune colonne ajoutée en base.
 */
export function usageQuotaByCard(cardId: string): { quota5h: number; quotaSemaine: number } {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(quota_5h), 0) AS quota5h,
              COALESCE(SUM(quota_semaine), 0) AS quotaSemaine
       FROM usage WHERE card_id = ?`,
    )
    .get(cardId) as { quota5h: number; quotaSemaine: number };
  return { quota5h: row.quota5h, quotaSemaine: row.quotaSemaine };
}

/**
 * Le NOM du projet vient de la base, pas de la liste affichée : un projet mis
 * de côté (ou simplement absent de la colonne de gauche) restait sans nom à
 * l'écran, et sept lignes « projet retiré » ne disaient plus rien.
 */
export function usageByProject(): {
  projectId: string;
  name?: string;
  tokens: number;
  seconds: number;
  tasks: number;
}[] {
  return getDb()
    .prepare(
      // Le projet vivant d'abord, sinon le nom figé au moment de la dépense.
      `SELECT u.project_id AS projectId,
              COALESCE(p.name, MAX(u.project_name)) AS name,
              SUM(u.tokens) AS tokens, SUM(u.seconds) AS seconds, COUNT(DISTINCT u.card_id) AS tasks
       FROM usage u LEFT JOIN projects p ON p.id = u.project_id
       GROUP BY u.project_id
       ORDER BY SUM(u.seconds) DESC`,
    )
    .all() as any;
}

/**
 * CE QUE LE CACHE DES MOTEURS A ÉPARGNÉ SUR LES DERNIERS JOURS, moteur par
 * moteur. Rien n'est calculé ici : on rend les deux sommes déjà écrites à la fin
 * de chaque tour — l'entrée facturée plein tarif (`input_tokens`, qui porte le
 * neuf ET ce qui a été écrit dans le cache) et l'entrée RELUE au cache. La part
 * elle-même est une règle pure (`partRelueAuCache`), pour être lisible sans base.
 */
export function entreesParMoteur(jours = 7): { engine?: string; frais: number; relu: number; tours: number }[] {
  const depuis = now() - Math.max(1, Math.round(jours)) * 24 * 60 * 60 * 1000;
  return getDb()
    .prepare(
      `SELECT engine, SUM(input_tokens) AS frais, SUM(cached_tokens) AS relu, COUNT(*) AS tours
       FROM usage WHERE created_at >= ? GROUP BY engine ORDER BY SUM(cached_tokens) DESC`,
    )
    .all(depuis)
    .map((ligne: any) => ({
      engine: ligne.engine ?? undefined,
      frais: ligne.frais ?? 0,
      relu: ligne.relu ?? 0,
      tours: ligne.tours ?? 0,
    }));
}

export function usageByMonth(): { month: string; tokens: number; seconds: number }[] {
  return getDb()
    .prepare(
      `SELECT strftime('%Y-%m', created_at/1000, 'unixepoch') AS month,
              SUM(tokens) AS tokens, SUM(seconds) AS seconds
       FROM usage GROUP BY month ORDER BY month DESC LIMIT 12`,
    )
    .all() as any;
}

/** Consommation mémoire moyenne mesurée d'un agent — sert au calcul des places libres (PLAN §27). */
export function averageAgentMemMb(): number | null {
  const row = getDb()
    .prepare('SELECT AVG(mem_mb) AS avg FROM usage WHERE mem_mb > 0')
    .get() as { avg: number | null };
  return row.avg ?? null;
}

export function recordAgentMem(agentId: string, memMb: number): void {
  getDb().prepare('UPDATE usage SET mem_mb = ? WHERE agent_id = ? AND mem_mb = 0').run(memMb, agentId);
}

/* ------------------------------------------------------------------ */
/* Publication                                                         */
/* ------------------------------------------------------------------ */

export function saveDeploy(run: DeployRun): DeployRun {
  const value = DeployRun.parse(run);
  getDb()
    .prepare(
      `INSERT INTO deploys (id, project_id, state, data, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, data = excluded.data, ended_at = excluded.ended_at`,
    )
    .run(value.id, value.projectId, value.state, JSON.stringify(value), value.startedAt, value.endedAt ?? null);
  return value;
}

export function getDeploy(id: string): DeployRun | null {
  const row = getDb().prepare('SELECT data FROM deploys WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? DeployRun.parse(JSON.parse(row.data)) : null;
}

export function latestDeploy(projectId: string): DeployRun | null {
  const row = getDb()
    .prepare('SELECT data FROM deploys WHERE project_id = ? ORDER BY started_at DESC LIMIT 1')
    .get(projectId) as { data: string } | undefined;
  return row ? DeployRun.parse(JSON.parse(row.data)) : null;
}

/**
 * Les dernières publications d'un projet, de la plus récente à la plus
 * ancienne. C'est là-dedans que la règle pure va chercher le dernier résultat
 * de CHAQUE environnement — vingt suffisent largement, et l'on ne relit pas
 * toute l'histoire du projet pour afficher trois lignes.
 */
export function recentDeploys(projectId: string, limit = 20): DeployRun[] {
  const rows = getDb()
    .prepare('SELECT data FROM deploys WHERE project_id = ? ORDER BY started_at DESC LIMIT ?')
    .all(projectId, limit) as { data: string }[];
  return rows.map((r) => DeployRun.parse(JSON.parse(r.data)));
}

/**
 * LA DERNIÈRE RÉUSSITE DE CHAQUE ÉTAPE DE PUBLICATION D'UN PROJET.
 *
 * L'écran ne garde qu'UNE publication par projet, toutes étapes confondues
 * (`deploys`) : la preuve d'un essai réussi du déploiement disparaissait donc
 * à la première mise en production, et inversement — le repère « Essai
 * réussi » de la page de réglage retombait à « Prêt à partir ». Cette lecture
 * donne l'instant de la dernière publication RÉUSSIE de chaque étape, sans
 * relire l'histoire du projet : une ligne par étape, sur les colonnes `state`
 * et `cible` (une publication sans étape est un déploiement).
 */
export function dernieresReussitesDePublication(projectId: string): Partial<Record<'dev' | 'production', number>> {
  const lignes = getDb()
    .prepare(
      `SELECT COALESCE(cible, 'dev') AS cible, MAX(COALESCE(ended_at, started_at)) AS le
       FROM deploys WHERE project_id = ? AND state = 'success' GROUP BY COALESCE(cible, 'dev')`,
    )
    .all(projectId) as { cible: string; le: number | null }[];
  const rendu: Partial<Record<'dev' | 'production', number>> = {};
  for (const ligne of lignes) {
    if ((ligne.cible === 'dev' || ligne.cible === 'production') && ligne.le) rendu[ligne.cible] = ligne.le;
  }
  return rendu;
}

/**
 * LA PUBLICATION DONT CET AGENT EST LE CONDUCTEUR.
 *
 * C'est le chemin inverse de `DeployRun.agentId` : on part d'une conversation
 * et on demande de quelle mise en ligne elle est le fil. Il sert au verrou du
 * tour — une publication TERMINÉE met son conducteur en posture d'explication
 * — et à la porte d'entrée du volet.
 */
export function deployDuConducteur(agentId: string): DeployRun | null {
  const row = getDb()
    .prepare(
      "SELECT data FROM deploys WHERE json_extract(data, '$.agentId') = ? ORDER BY started_at DESC LIMIT 1",
    )
    .get(agentId) as { data: string } | undefined;
  return row ? DeployRun.parse(JSON.parse(row.data)) : null;
}

/** La dernière publication RÉUSSIE : la seule qui dise ce qui est en ligne. */
export function lastSuccessfulDeploy(projectId: string): DeployRun | null {
  const row = getDb()
    .prepare("SELECT data FROM deploys WHERE project_id = ? AND state = 'success' ORDER BY started_at DESC LIMIT 1")
    .get(projectId) as { data: string } | undefined;
  return row ? DeployRun.parse(JSON.parse(row.data)) : null;
}

/**
 * LES PUBLICATIONS DONT UNE CARTE ÉCARTÉE ATTEND SON RATTRAPAGE (`prevu` ou
 * `attente-quota`, `shared/src/rattrapage-ecartee.ts`). Lu au démarrage et par
 * la veille : c'est ce qui fait survivre le rattrapage au redémarrage qui suit
 * la publication de Beluga elle-même.
 */
export function deploysAvecRattrapageEnAttente(depuis: number): DeployRun[] {
  const rows = getDb()
    .prepare(
      `SELECT data FROM deploys WHERE started_at >= ? AND EXISTS (
         SELECT 1 FROM json_each(json_extract(data, '$.taches')) t
         WHERE json_extract(t.value, '$.rattrapage.etat') IN ('prevu', 'attente-quota')
       ) ORDER BY started_at ASC`,
    )
    .all(depuis) as { data: string }[];
  return rows.map((r) => DeployRun.parse(JSON.parse(r.data)));
}

export function runningDeploys(): DeployRun[] {
  const rows = getDb().prepare("SELECT data FROM deploys WHERE state = 'running'").all() as { data: string }[];
  return rows.map((r) => DeployRun.parse(JSON.parse(r.data)));
}

/* ------------------------------------------------------------------ */
/* Capacité                                                            */
/* ------------------------------------------------------------------ */

export function recordCapacity(loadPct: number, memUsedMb: number, running: number): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO capacity_samples (at, load_pct, mem_used_mb, running) VALUES (?, ?, ?, ?)')
    .run(now(), loadPct, memUsedMb, running);
  getDb().prepare('DELETE FROM capacity_samples WHERE at < ?').run(now() - 26 * 3600 * 1000);
}

export function capacityHistory(): { at: number; loadPct: number; running: number }[] {
  return getDb()
    .prepare('SELECT at, load_pct AS loadPct, running FROM capacity_samples ORDER BY at')
    .all() as any;
}

/* ------------------------------------------------------------------ */
/* Télémétrie des tâches                                               */
/* ------------------------------------------------------------------ */

/**
 * UNE OUVERTURE DE MÉMOIRE, TELLE QU'ELLE S'EST PASSÉE.
 *
 * Toutes les ouvertures sont écrites, y compris celles où le tri n'a rien
 * changé : c'est le RENDEMENT du tri qu'on suit, et une moyenne calculée sur
 * les seules ouvertures rentables serait flatteuse et fausse.
 *
 * `sujet` est un NOM court, déjà ramené à un mot par `nomDeSujetMesure` : ce
 * qui entre ici ne doit jamais être une phrase de travail.
 */
export function recordMemoryConsultation(ligne: {
  projectId?: string;
  cardId?: string;
  agentId?: string;
  sujet: string;
  dureeMs: number;
  blocsDemandes: number;
  blocsRendus: number;
  signesEntiers: number;
  signesServis: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO memoire_consultation
         (project_id, card_id, agent_id, sujet, duree_ms, blocs_demandes, blocs_rendus,
          signes_entiers, signes_servis, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ligne.projectId ?? null,
      ligne.cardId ?? null,
      ligne.agentId ?? null,
      ligne.sujet.slice(0, 40),
      Math.max(0, Math.round(ligne.dureeMs)),
      Math.max(0, Math.round(ligne.blocsDemandes)),
      Math.max(0, Math.round(ligne.blocsRendus)),
      Math.max(0, Math.round(ligne.signesEntiers)),
      Math.max(0, Math.round(ligne.signesServis)),
      now(),
    );
}

/** Ce que cet agent est allé chercher dans la mémoire, tout compté. */
export function consultationsDeLAgent(agentId: string): MesureDeMemoire {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS ouvertures, COALESCE(SUM(duree_ms), 0) AS ms,
              COALESCE(SUM(blocs_demandes), 0) AS demandes, COALESCE(SUM(blocs_rendus), 0) AS rendus,
              COALESCE(SUM(signes_entiers), 0) AS entiers, COALESCE(SUM(signes_servis), 0) AS servis
       FROM memoire_consultation WHERE agent_id = ?`,
    )
    .get(agentId) as {
    ouvertures: number;
    ms: number;
    demandes: number;
    rendus: number;
    entiers: number;
    servis: number;
  };
  const sujets = getDb()
    .prepare(
      `SELECT sujet FROM memoire_consultation WHERE agent_id = ? GROUP BY sujet ORDER BY MIN(created_at)`,
    )
    .all(agentId) as { sujet: string }[];
  return {
    ouvertures: row.ouvertures,
    millisecondes: row.ms,
    sujets: sujets.map((s) => s.sujet),
    demandes: row.demandes,
    rendus: row.rendus,
    signesEntiers: row.entiers,
    signesServis: row.servis,
  };
}

/**
 * LA MESURE D'UN TOUR DE TÂCHE, ÉCRITE UNE FOIS LE TOUR FINI.
 *
 * Une carte reprise trois fois porte trois lignes : la lecture les additionne.
 * Écrire la seule dernière ferait passer une tâche reprise pour une tâche
 * courte, et c'est précisément ce qu'on cherche à mesurer.
 */
export function recordTelemetrieTache(ligne: {
  cardId: string;
  projectId?: string;
  agentId?: string;
  issue: IssueDeTache;
  tours: number;
  tokensEntree: number;
  tokensCache: number;
  tokensSortie: number;
  secondes: number;
  memoire: MesureDeMemoire;
  note: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO telemetrie_tache
         (card_id, project_id, agent_id, issue, tours, tokens_entree, tokens_cache, tokens_sortie,
          secondes, memoire_ouvertures, memoire_ms, memoire_sujets, memoire_demandes, memoire_rendus,
          memoire_signes_entiers, memoire_signes_servis, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ligne.cardId,
      ligne.projectId ?? null,
      ligne.agentId ?? null,
      ligne.issue,
      Math.max(0, Math.round(ligne.tours)),
      Math.max(0, Math.round(ligne.tokensEntree)),
      Math.max(0, Math.round(ligne.tokensCache)),
      Math.max(0, Math.round(ligne.tokensSortie)),
      Math.max(0, ligne.secondes),
      Math.max(0, Math.round(ligne.memoire.ouvertures)),
      Math.max(0, Math.round(ligne.memoire.millisecondes)),
      JSON.stringify(ligne.memoire.sujets.slice(0, 20)),
      Math.max(0, Math.round(ligne.memoire.demandes)),
      Math.max(0, Math.round(ligne.memoire.rendus)),
      Math.max(0, Math.round(ligne.memoire.signesEntiers)),
      Math.max(0, Math.round(ligne.memoire.signesServis)),
      Math.max(0, Math.min(100, Math.round(ligne.note))),
      now(),
    );
}

/**
 * LES TÂCHES MESURÉES DE LA FENÊTRE, une ligne par CARTE — les tours d'une même
 * carte sont additionnés, ses sujets de mémoire réunis sans doublon.
 *
 * L'ISSUE retenue est la PIRE des tours : une tâche qui a échoué puis été
 * reprise reste une tâche qui a échoué en route, et l'afficher « terminée »
 * effacerait le fait le plus utile de la ligne.
 */
export function telemetrieDesTaches(jours = JOURS_DE_TENDANCE, bornes?: { debut: number; fin: number }): MesureDeTache[] {
  /* Une période précise (page « Résumé ») l'emporte sur les « N derniers jours ». */
  const depuis = bornes ? bornes.debut : now() - Math.max(1, Math.round(jours)) * 24 * 60 * 60 * 1000;
  const jusqua = bornes ? bornes.fin : Number.MAX_SAFE_INTEGER;
  const lignes = getDb()
    .prepare(
      `SELECT card_id AS cardId, project_id AS projectId,
              SUM(tours) AS tours, SUM(tokens_entree) AS tokensEntree, SUM(tokens_cache) AS tokensCache,
              SUM(tokens_sortie) AS tokensSortie, SUM(secondes) AS secondes,
              SUM(memoire_ouvertures) AS ouvertures, SUM(memoire_ms) AS ms,
              SUM(memoire_demandes) AS demandes, SUM(memoire_rendus) AS rendus,
              SUM(memoire_signes_entiers) AS entiers, SUM(memoire_signes_servis) AS servis,
              MAX(created_at) AS at,
              MIN(CASE issue WHEN 'echec' THEN 0 WHEN 'interrompue' THEN 1 ELSE 2 END) AS rang
       FROM telemetrie_tache WHERE created_at >= ? AND created_at <= ?
       GROUP BY card_id ORDER BY at DESC`,
    )
    .all(depuis, jusqua) as any[];
  const sujetsParCarte = getDb()
    .prepare(
      `SELECT card_id AS cardId, memoire_sujets AS sujets FROM telemetrie_tache
       WHERE created_at >= ? AND created_at <= ? ORDER BY created_at ASC`,
    )
    .all(depuis, jusqua) as { cardId: string; sujets: string | null }[];
  const reunis = new Map<string, string[]>();
  for (const ligne of sujetsParCarte) {
    let liste: string[] = [];
    try {
      const brut = ligne.sujets ? JSON.parse(ligne.sujets) : [];
      if (Array.isArray(brut)) liste = brut.filter((s) => typeof s === 'string');
    } catch {
      liste = [];
    }
    reunis.set(ligne.cardId, [...new Set([...(reunis.get(ligne.cardId) ?? []), ...liste])]);
  }
  return lignes.map((ligne) => ({
    cardId: ligne.cardId,
    issue: (ligne.rang === 0 ? 'echec' : ligne.rang === 1 ? 'interrompue' : 'terminee') as IssueDeTache,
    tours: ligne.tours ?? 0,
    tokensEntree: ligne.tokensEntree ?? 0,
    tokensCache: ligne.tokensCache ?? 0,
    tokensSortie: ligne.tokensSortie ?? 0,
    secondes: ligne.secondes ?? 0,
    memoire: {
      ouvertures: ligne.ouvertures ?? 0,
      millisecondes: ligne.ms ?? 0,
      sujets: reunis.get(ligne.cardId) ?? [],
      demandes: ligne.demandes ?? 0,
      rendus: ligne.rendus ?? 0,
      signesEntiers: ligne.entiers ?? 0,
      signesServis: ligne.servis ?? 0,
    },
    at: ligne.at ?? 0,
  }));
}
