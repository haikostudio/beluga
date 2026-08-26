import { randomUUID } from 'node:crypto';
import {
  Agent,
  Attachment,
  Card,
  CarteRendue,
  carteNonLue,
  carteDepuisLigne,
  colonnesDeLaCarte,
  type LigneCarte,
  ColumnKey,
  DecisionAttendue,
  DicteeEnAttente,
  ProjetJoignable,
  attentionParProjet,
  decisionsDuPremierEnvoi,
  DeployRun,
  fusionnerPropositions,
  Message,
  PassageRetrouve,
  Project,
  ProjectGroup,
  QueuedPrompt,
  Settings,
  TaskProposal,
  cleDeSession,
  memeFilAutreCompte,
  cleNouveauDepart,
  colonneFermeLesQuestions,
  decisionEnTexteLibre,
  type StatutAgent,
  rendusParProjet,
  type AgregatHoraire,
  DETAIL_RETENTION_JOURS,
  RESUME_RETENTION_JOURS,
  jourLocal,
  resumerReleves,
  planEnAttente,
  JOURS_DE_TENDANCE,
  type IssueDeTache,
  type MesureDeMemoire,
  type MesureDeTache,
} from '@haikodev/shared';
import { getDb, getMeta, setMeta } from './db.js';

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

export function deleteProject(id: string): void {
  const db = getDb();
  db.transaction(() => {
    const agentIds = (db.prepare('SELECT id FROM agents WHERE project_id = ?').all(id) as { id: string }[]).map(
      (r) => r.id,
    );
    for (const agentId of agentIds) {
      db.prepare('DELETE FROM messages WHERE agent_id = ?').run(agentId);
      db.prepare('DELETE FROM queue WHERE agent_id = ?').run(agentId);
    }
    db.prepare('DELETE FROM agents WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM cards WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM attachments WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM deploys WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  })();
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
/* Journal des envois au cerveau                                       */
/* ------------------------------------------------------------------ */

export interface CerveauEntree {
  /** L'instant du PASSAGE : toutes les lignes d'un même passage le partagent. */
  at: number;
  /** Le projet concerné ; absent quand le passage entier a échoué (clé manquante…). */
  project?: string;
  ok: boolean;
  /** Combien de fichiers sont réellement partis pour ce projet. */
  files?: number;
  error?: string;
}

/**
 * Une ligne par tentative, réussie OU ratée, comme pour l'amorçage : c'est ce
 * qui permet de dire depuis l'application quand le dernier envoi a réussi, et
 * pourquoi le précédent a échoué.
 */
export function recordCerveau(entree: CerveauEntree): void {
  getDb()
    .prepare('INSERT INTO cerveau_log (at, project, ok, files, error) VALUES (?, ?, ?, ?, ?)')
    .run(entree.at, entree.project ?? null, entree.ok ? 1 : 0, entree.files ?? null, entree.error ?? null);
  // Quatorze jours, comme le journal des amorces.
  getDb().prepare('DELETE FROM cerveau_log WHERE at < ?').run(now() - 14 * 24 * 3600 * 1000);
}

/** Les dernières tentatives d'envoi, la plus récente en tête. */
export function cerveauHistory(limit = 60): CerveauEntree[] {
  const rows = getDb()
    .prepare('SELECT at, project, ok, files, error FROM cerveau_log ORDER BY at DESC LIMIT ?')
    .all(limit) as Record<string, any>[];
  return rows.map((row) => ({
    at: row.at,
    project: row.project ?? undefined,
    ok: !!row.ok,
    files: row.files ?? undefined,
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

export function writePreference(key: string, value: unknown): void {
  if (value === undefined || value === null) {
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
  const db = getDb();
  db.transaction(() => {
    // Les projets du groupe ne sont pas perdus : ils remontent hors groupe.
    for (const project of listProjects(true).filter((p) => p.groupId === id)) {
      saveProject({ ...project, groupId: undefined });
    }
    db.prepare('DELETE FROM project_groups WHERE id = ?').run(id);
  })();
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

function listeDUneCarte(table: string, colonne: string, cardId: string): string[] {
  const rows = getDb()
    .prepare(`SELECT ${colonne} AS valeur FROM ${table} WHERE card_id = ? ORDER BY position`)
    .all(cardId) as { valeur: string }[];
  return rows.map((r) => r.valeur);
}

export function listCards(projectId: string): Card[] {
  const rows = getDb()
    .prepare('SELECT * FROM cards WHERE project_id = ? ORDER BY position DESC')
    .all(projectId) as LigneCarte[];
  const labels = listesDeCartes('card_labels', 'label', projectId);
  const attachments = listesDeCartes('card_attachments', 'path', projectId);
  return rows.map((row) =>
    carteDepuisLigne(row, { labels: labels.get(row.id), attachments: attachments.get(row.id) }),
  );
}

export function listCardsInColumn(projectId: string, column: ColumnKey): Card[] {
  return listCards(projectId).filter((c) => c.column === column);
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
 * TOUTES LES CARTES DE « EN COURS », tous projets confondus.
 *
 * Le balayage des cartes oubliées (`rangerLesCartesOubliees`) en a besoin sans
 * connaître les projets un par un : une carte bloquée l'est quel que soit le
 * projet ouvert à l'écran. La colonne est une VRAIE colonne SQL depuis la
 * migration 17 : la requête juge, elle ne dégrossit pas.
 */
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

export function getCard(id: string): Card | null {
  const row = getDb().prepare('SELECT * FROM cards WHERE id = ?').get(id) as LigneCarte | undefined;
  if (!row) return null;
  return carteDepuisLigne(row, {
    labels: listeDUneCarte('card_labels', 'label', id),
    attachments: listeDUneCarte('card_attachments', 'path', id),
  });
}

export function saveCard(card: Card): Card {
  const value = Card.parse({ ...card, updatedAt: now() });
  const db = getDb();
  const colonnes = colonnesDeLaCarte(value);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at,
                          description, origin, agent_id, conversation_agent_id, analyse_demandee,
                          code_deja_enregistre, hors_tache, excluded_from_deploy, done_at, archived_at,
                          last_read_at, run_engine, run_model, run_thinking, run_mode)
       VALUES (@id, @project_id, @column_key, @position, @title, @data, @deployed_at, @created_at, @updated_at,
               @description, @origin, @agent_id, @conversation_agent_id, @analyse_demandee,
               @code_deja_enregistre, @hors_tache, @excluded_from_deploy, @done_at, @archived_at,
               @last_read_at, @run_engine, @run_model, @run_thinking, @run_mode)
       ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, column_key = excluded.column_key,
         position = excluded.position, title = excluded.title, data = excluded.data,
         deployed_at = excluded.deployed_at, updated_at = excluded.updated_at,
         description = excluded.description, origin = excluded.origin, agent_id = excluded.agent_id,
         conversation_agent_id = excluded.conversation_agent_id, analyse_demandee = excluded.analyse_demandee,
         code_deja_enregistre = excluded.code_deja_enregistre, hors_tache = excluded.hors_tache,
         excluded_from_deploy = excluded.excluded_from_deploy, done_at = excluded.done_at,
         archived_at = excluded.archived_at, last_read_at = excluded.last_read_at,
         run_engine = excluded.run_engine, run_model = excluded.run_model,
         run_thinking = excluded.run_thinking, run_mode = excluded.run_mode`,
    ).run(colonnes);
    ecrireListe('card_labels', 'label', value.id, value.labels);
    ecrireListe('card_attachments', 'path', value.id, value.attachments);
  })();
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
 * « J'ai ouvert ce projet. » Éteint le point bleu de travail terminé sans
 * réécrire une seule carte : contrairement à `markProjectRead`, aucune carte
 * ne change de repère de lecture — seule la ligne de la colonne de gauche
 * cesse de le signaler, jusqu'à ce qu'un nouveau travail soit rendu.
 */
export function markProjectVisited(projectId: string, at = now()): Project | null {
  const projet = getProject(projectId);
  if (!projet) return null;
  return saveProject({ ...projet, lastVisitedAt: at });
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

export function getOrchestrator(projectId: string): Agent | null {
  const row = getDb()
    .prepare("SELECT data FROM agents WHERE project_id = ? AND role = 'orchestrator' LIMIT 1")
    .get(projectId) as { data: string } | undefined;
  return row ? Agent.parse(JSON.parse(row.data)) : null;
}

export function saveAgent(agent: Agent): Agent {
  const value = Agent.parse({ ...agent, updatedAt: now() });
  getDb()
    .prepare(
      `INSERT INTO agents (id, project_id, card_id, role, status, session_id, data, created_at, updated_at)
       VALUES (@id, @projectId, @cardId, @role, @status, @sessionId, @data, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, card_id = excluded.card_id,
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
 * Les faits de la mémoire que cet agent a DÉJÀ dans son contexte, par leur
 * empreinte courte. Sert à ne lui renvoyer que les faits nouveaux au lieu de
 * recoller l'index entier à chaque message. On retient l'empreinte et non un
 * décompte : un fait rangé sous son sujet ne s'ajoute pas forcément à la fin.
 */
export function memorySeen(agentId: string): string[] {
  return listeMeta(`memoire.vue.${agentId}`);
}

export function setMemorySeen(agentId: string, empreintes: string[]): void {
  setMeta(`memoire.vue.${agentId}`, JSON.stringify([...new Set(empreintes)]));
}

/**
 * Les SUJETS (faits, règles, contrôles) déjà servis en entier à cet agent dans
 * cette session. Un sujet pèse des milliers de signes : le resservir parce que
 * l'agent le redemande paie deux fois le même contexte. La clé porte l'empreinte
 * du contenu — un sujet qui a changé depuis repart, lui.
 */
export function sujetsMemoireServis(agentId: string): string[] {
  return listeMeta(`memoire.sujets.${agentId}`);
}

export function marquerSujetsMemoireServis(agentId: string, cles: string[]): void {
  if (!cles.length) return;
  const deja = sujetsMemoireServis(agentId);
  setMeta(`memoire.sujets.${agentId}`, JSON.stringify([...new Set([...deja, ...cles])].slice(-40)));
  // La trace DURABLE, à part : la liste ci-dessus s'efface à chaque session
  // neuve (sinon une reprise serait privée d'une mémoire qu'elle n'a plus).
  // Le parcours d'une tâche, lui, doit pouvoir dire des mois plus tard ce que
  // l'agent est allé chercher : on garde donc les NOMS de sujets, sans leur
  // empreinte, dans une clé que rien n'efface.
  const noms = cles.map((cle) => cle.split(':')[1]).filter(Boolean);
  if (!noms.length) return;
  const vus = listeMeta(`memoire.demandes.${agentId}`);
  setMeta(`memoire.demandes.${agentId}`, JSON.stringify([...new Set([...vus, ...noms])].slice(-20)));
}

/** Les SUJETS que cet agent est allé chercher, sur toute sa vie. */
export function sujetsMemoireDemandes(agentId: string): string[] {
  return listeMeta(`memoire.demandes.${agentId}`);
}

/**
 * LES PASSAGES DE DOCUMENTATION remontés à un agent, du temps où une recherche
 * en remontait. Trace DURABLE, en LECTURE SEULE désormais : plus rien ne
 * l'alimente depuis que la mémoire est un arbre qu'on ouvre par son nom, mais
 * le parcours d'une carte de juillet doit continuer de montrer ce que son agent
 * était allé chercher. On ne réécrit pas l'histoire d'une conversation.
 */
export function passagesRetrouves(agentId: string): PassageRetrouve[] {
  const brut = getMeta(`memoire.passages.${agentId}`);
  if (!brut) return [];
  try {
    const liste = JSON.parse(brut);
    return Array.isArray(liste) ? liste.map((p) => PassageRetrouve.parse(p)) : [];
  } catch {
    return [];
  }
}

/** Une session neuve repart d'un contexte vide : plus rien n'est « déjà servi ». */
export function oublierMemoireServie(agentId: string): void {
  setMeta(`memoire.vue.${agentId}`, '[]');
  setMeta(`memoire.sujets.${agentId}`, '[]');
  // `memoire.demandes.<agent>` n'est PAS touché : c'est la trace de ce qui a
  // été lu, pas de ce que l'agent a encore sous les yeux.
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

export function listMessages(agentId: string, limit = 400): Message[] {
  const rows = getDb()
    .prepare('SELECT data FROM messages WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(agentId, limit) as { data: string }[];
  return rows
    .map((r) => Message.parse(JSON.parse(r.data)))
    .sort((a, b) => a.createdAt - b.createdAt);
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
  const rows = getDb()
    .prepare(
      `SELECT a.project_id AS projectId, a.id AS agentId, a.card_id AS cardId,
              m.id AS messageId, m.data AS data, m.created_at AS createdAt,
              c.column_key AS colonne
       FROM messages m
       JOIN agents a ON a.id = m.agent_id
       LEFT JOIN cards c ON c.id = a.card_id
       WHERE m.data LIKE '%"repriseCompte":{%'`,
    )
    .all() as {
    projectId: string;
    agentId: string;
    cardId: string | null;
    messageId: string;
    data: string;
    createdAt: number;
    colonne: string | null;
  }[];

  const attentes: RepriseEnAttente[] = [];
  for (const row of rows) {
    if (colonneFermeLesQuestions(row.colonne ?? undefined)) continue;
    try {
      const message = Message.parse(JSON.parse(row.data));
      const reprise = message.repriseCompte;
      if (!reprise || reprise.choisi || reprise.abandonnee) continue;
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
      /* message illisible : on l'ignore */
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
  const rows = getDb()
    .prepare(
      `SELECT a.project_id AS projectId, a.id AS agentId, a.card_id AS cardId,
              m.id AS messageId, m.data AS data, m.created_at AS createdAt,
              c.column_key AS colonne
       FROM messages m
       JOIN agents a ON a.id = m.agent_id
       LEFT JOIN cards c ON c.id = a.card_id
       WHERE m.data LIKE '%"erreurDeTour":{%'`,
    )
    .all() as {
    projectId: string;
    agentId: string;
    cardId: string | null;
    messageId: string;
    data: string;
    createdAt: number;
    colonne: string | null;
  }[];

  const attentes: ErreurDeTourEnAttente[] = [];
  for (const row of rows) {
    if (colonneFermeLesQuestions(row.colonne ?? undefined)) continue;
    try {
      const message = Message.parse(JSON.parse(row.data));
      const erreur = message.erreurDeTour;
      if (!erreur || erreur.choix) continue;
      attentes.push({
        projectId: row.projectId,
        agentId: row.agentId,
        cardId: row.cardId ?? undefined,
        messageId: row.messageId,
        cause: erreur.cause,
        poseeA: row.createdAt,
      });
    } catch {
      /* message illisible : on l'ignore */
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

export function decisionsEnAttente(): DecisionAttendue[] {
  const decisions: DecisionAttendue[] = [];
  const enrichir = enrichisseurDeDecisions();

  /*
   * Un tour coupé par la limite d'un compte attend un choix au même titre
   * qu'une question : il allume donc le même triangle orange, à l'endroit où le
   * choix se prend — la conversation, et la carte quand il y en a une.
   */
  for (const attente of reprisesDeCompteEnAttente()) {
    decisions.push({
      projectId: attente.projectId,
      agentId: attente.agentId,
      cardId: attente.cardId,
      genre: 'question',
      reglee: false,
      poseeA: attente.poseeA,
      texte: `Le compte « ${attente.compteEpuiseLabel} » a atteint sa limite : avec quel compte poursuivre ?`,
      projectName: enrichir.nomProjet(attente.projectId),
      lieuTitre: enrichir.lieuTitre(attente.cardId, attente.agentId),
    });
  }

  /*
   * Une erreur qui a coupé le travail net attend, elle aussi, un choix :
   * relancer, ignorer, ou arrêter. Même triangle orange, même cloche.
   */
  for (const attente of erreursDeTourEnAttente()) {
    decisions.push({
      projectId: attente.projectId,
      agentId: attente.agentId,
      cardId: attente.cardId,
      genre: 'question',
      reglee: false,
      poseeA: attente.poseeA,
      texte: `Une erreur a arrêté le travail : ${attente.cause}`,
      projectName: enrichir.nomProjet(attente.projectId),
      lieuTitre: enrichir.lieuTitre(attente.cardId, attente.agentId),
    });
  }

  const rows = getDb()
    .prepare(
      `SELECT a.project_id AS projectId, a.id AS agentId, a.card_id AS cardId,
              m.data AS data, m.created_at AS createdAt, c.column_key AS colonne
       FROM messages m
       JOIN agents a ON a.id = m.agent_id
       LEFT JOIN cards c ON c.id = a.card_id
       WHERE m.a_questions = 1`,
    )
    .all() as {
    projectId: string;
    agentId: string;
    cardId: string | null;
    data: string;
    createdAt: number;
    colonne: string | null;
  }[];
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
      const message = Message.parse(JSON.parse(row.data));
      for (const question of message.questions) {
        decisions.push({
          projectId: row.projectId,
          agentId: row.agentId,
          cardId: row.cardId ?? undefined,
          genre: 'question',
          reglee: Boolean(question.answer) || question.cancelled,
          poseeA: row.createdAt,
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
              p.created_at AS createdAt, p.data AS data, a.id AS agentId, a.card_id AS cardId
       FROM proposals p
       JOIN messages m ON m.id = p.message_id
       JOIN agents a ON a.id = m.agent_id`,
    )
    .all() as {
    proposalId: string;
    projectId: string;
    decision: string;
    createdAt: number;
    data: string;
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
  const derniers = getDb()
    .prepare(
      `SELECT a.project_id AS projectId, a.id AS agentId, a.card_id AS cardId,
              a.status AS statut, m.data AS data, m.created_at AS createdAt,
              c.column_key AS colonne
       FROM agents a
       JOIN messages m ON m.agent_id = a.id
       LEFT JOIN cards c ON c.id = a.card_id
       WHERE a.card_id IS NOT NULL
         AND m.id = (
           SELECT m2.id FROM messages m2
           JOIN agents a2 ON a2.id = m2.agent_id
           WHERE a2.card_id = a.card_id
           ORDER BY m2.created_at DESC, m2.rowid DESC LIMIT 1
         )`,
    )
    .all() as {
    projectId: string;
    agentId: string;
    cardId: string;
    statut: string;
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
    let titre: string | undefined;
    try {
      titre = JSON.parse(proposition.data).title as string | undefined;
    } catch {
      titre = undefined;
    }
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
   * SQL est étroit (deux `LIKE` sur des propositions non tranchées) : sur ce
   * serveur, il ne ramène qu'une poignée de lignes.
   */
  const portees = getDb()
    .prepare(
      `SELECT a.project_id AS projectId, a.id AS agentId, a.card_id AS cardId,
              m.data AS data, m.created_at AS createdAt
       FROM messages m
       JOIN agents a ON a.id = m.agent_id
       WHERE m.data LIKE '%"proposals":[{%' AND m.data LIKE '%"decision":"pending"%'`,
    )
    .all() as {
    projectId: string;
    agentId: string;
    cardId: string | null;
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
          texte: proposition.title ? `Carte proposée : ${proposition.title}` : 'Une carte est proposée',
          projectName: enrichir.nomProjet(porte.projectId),
          lieuTitre: enrichir.lieuTitre(porte.cardId ?? undefined, porte.agentId),
        });
      }
    } catch {
      /* message illisible : on l'ignore */
    }
  }

  return decisions;
}

/** Le compte par projet — ce que porte le triangle de la colonne de gauche. */
export function projectsNeedingAttention(): Record<string, number> {
  return attentionParProjet(decisionsEnAttente());
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
 * Les projets où un PLAN attend encore une décision — un fil de mode plan dont
 * le dernier message rédigé porte `plan: true`. On ne regarde que les agents
 * qui ont écrit au moins un plan un jour (`LIKE '%"plan":true%'`, filtre bon
 * marché), puis on rejoue `planEnAttente` sur leurs messages : lui seul sait
 * si ce plan est encore le DERNIER mot du fil, ou déjà dépassé.
 */
export function projetsAvecPlanEnAttente(): Record<string, boolean> {
  const agentsAvecPlan = getDb()
    .prepare(
      `SELECT DISTINCT a.id AS agentId, a.project_id AS projectId
       FROM agents a
       JOIN messages m ON m.agent_id = a.id
       WHERE m.data LIKE '%"plan":true%'`,
    )
    .all() as { agentId: string; projectId: string }[];

  const parProjet: Record<string, boolean> = {};
  for (const { agentId, projectId } of agentsAvecPlan) {
    if (parProjet[projectId]) continue;
    const messages = messagesPourPlan(agentId);
    if (planEnAttente(messages)) parProjet[projectId] = true;
  }
  return parProjet;
}

/** L'événement complet, prêt à diffuser : `{ type: 'plans', ...signalPlans() }`. */
export function signalPlans(): { byProject: Record<string, boolean> } {
  return { byProject: projetsAvecPlanEnAttente() };
}

function messagesPourPlan(agentId: string): { plan?: boolean; content?: string }[] {
  const rows = getDb()
    .prepare(`SELECT data FROM messages WHERE agent_id = ? ORDER BY created_at ASC, rowid ASC`)
    .all(agentId) as { data: string }[];
  return rows.map((row) => {
    try {
      const message = Message.parse(JSON.parse(row.data));
      return { plan: message.plan, content: message.content };
    } catch {
      return { plan: false, content: '' };
    }
  });
}

/**
 * Les projets dont un agent a RENDU son travail sans qu'on l'ait encore lu.
 *
 * La roue qui tourne dit déjà « un agent travaille » ; c'est l'état d'après qui
 * manquait. On rapproche chaque carte de son dernier agent, et la règle — dans
 * `shared`, donc testable seule — tranche.
 */
export function projectsWithFinishedWork(): Record<string, number> {
  return rendusParProjet(etatDesCartesRendues());
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

/** Chaque carte rapprochée de son dernier agent, prête pour la règle partagée. */
function etatDesCartesRendues(projectId?: string): CarteRendue[] {
  /*
   * Le repère de lecture et l'agent de conversation sont désormais de VRAIES
   * colonnes : plus besoin de décoder la carte entière pour les lire. On garde
   * le bloc libre en repli, pour une ligne posée par un outil extérieur qui
   * n'aurait renseigné que lui.
   */
  const sql = `SELECT c.id AS cardId, c.project_id AS projectId, c.column_key AS colonne,
              c.last_read_at AS luA, c.conversation_agent_id AS agentConversation, c.data AS reste,
              (SELECT a.data FROM agents a
                WHERE a.card_id = c.id ORDER BY a.created_at DESC LIMIT 1) AS agent
         FROM cards c
        WHERE c.column_key <> 'archived'${projectId ? ' AND c.project_id = ?' : ''}`;
  const requete = getDb().prepare(sql);
  const rows = (projectId ? requete.all(projectId) : requete.all()) as {
    cardId: string;
    projectId: string;
    colonne: string;
    luA: number | null;
    agentConversation: string | null;
    reste: string;
    agent: string | null;
  }[];

  // Une visite du projet (`markProjectVisited`) éteint le point bleu SANS
  // réécrire les cartes : on relève donc, pour chaque projet touché, la borne
  // de visite et on la compare à la dernière lecture connue de chaque carte —
  // rien d'autre n'utilise cette fonction que le calcul du point bleu.
  const visites = new Map<string, number>();
  const visiteDe = (id: string): number => {
    let v = visites.get(id);
    if (v === undefined) {
      v = getProject(id)?.lastVisitedAt ?? 0;
      visites.set(id, v);
    }
    return v;
  };

  const entrees: CarteRendue[] = [];
  for (const row of rows) {
    try {
      const reste = JSON.parse(row.reste) as { lastReadAt?: number; conversationAgentId?: string };
      /*
       * Une carte fabriquée pour du travail hors tâche n'a pas d'agent à elle :
       * sa conversation est celle de l'agent qui a codé.
       */
      const conversation = row.agentConversation ?? reste.conversationAgentId;
      const brut = row.agent ?? (conversation ? rawAgent(conversation) : null);
      const agent = brut ? Agent.parse(JSON.parse(brut)) : null;
      entrees.push({
        cardId: row.cardId,
        projectId: row.projectId,
        colonne: row.colonne,
        agentStatut: agent?.status,
        agentFiniA: agent?.endedAt,
        luA: Math.max(row.luA ?? reste.lastReadAt ?? 0, visiteDe(row.projectId)) || undefined,
      });
    } catch {
      /* carte illisible : elle n'apprend rien de plus */
    }
  }
  return entrees;
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

export function saveMessage(message: Message): Message {
  const value = Message.parse(message);
  getDb()
    .prepare(
      `INSERT INTO messages (id, agent_id, role, data, created_at, a_questions)
       VALUES (@id, @agentId, @role, @data, @createdAt, @aQuestions)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, a_questions = excluded.a_questions`,
    )
    .run({
      id: value.id,
      agentId: value.agentId,
      role: value.role,
      data: JSON.stringify(value),
      createdAt: value.createdAt,
      aQuestions: value.questions.length > 0 ? 1 : 0,
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
    .prepare(`SELECT id, data FROM messages WHERE agent_id = ? ORDER BY created_at DESC`)
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

export function listQueue(agentId: string): QueuedPrompt[] {
  const rows = getDb()
    .prepare('SELECT data FROM queue WHERE agent_id = ? ORDER BY position')
    .all(agentId) as { data: string }[];
  return rows.map((r) => QueuedPrompt.parse(JSON.parse(r.data)));
}

export function enqueuePrompt(agentId: string, text: string, attachments: string[] = []): QueuedPrompt | null {
  const current = listQueue(agentId);
  if (current.length >= QUEUE_MAX) return null;
  const item: QueuedPrompt = {
    id: newId(),
    agentId,
    text,
    attachments,
    position: current.length ? current[current.length - 1].position + 1 : 1,
    createdAt: now(),
  };
  getDb()
    .prepare('INSERT INTO queue (id, agent_id, position, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(item.id, agentId, item.position, JSON.stringify(item), item.createdAt);
  return item;
}

export function dequeuePrompt(agentId: string): QueuedPrompt | null {
  const items = listQueue(agentId);
  if (!items.length) return null;
  const first = items[0];
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

export function updateQueued(id: string, text: string): QueuedPrompt | null {
  const row = getDb().prepare('SELECT data FROM queue WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  const item = QueuedPrompt.parse({ ...JSON.parse(row.data), text });
  getDb().prepare('UPDATE queue SET data = ? WHERE id = ?').run(JSON.stringify(item), id);
  return item;
}

export function removeQueued(id: string): string | null {
  const row = getDb().prepare('SELECT agent_id FROM queue WHERE id = ?').get(id) as { agent_id: string } | undefined;
  if (!row) return null;
  getDb().prepare('DELETE FROM queue WHERE id = ?').run(id);
  return row.agent_id;
}

export function reorderQueue(agentId: string, ids: string[]): void {
  const db = getDb();
  db.transaction(() => {
    ids.forEach((id, index) => {
      const row = db.prepare('SELECT data FROM queue WHERE id = ? AND agent_id = ?').get(id, agentId) as
        | { data: string }
        | undefined;
      if (!row) return;
      const item = QueuedPrompt.parse({ ...JSON.parse(row.data), position: index + 1 });
      db.prepare('UPDATE queue SET position = ?, data = ? WHERE id = ?').run(index + 1, JSON.stringify(item), id);
    });
  })();
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

export function decideProposal(proposalId: string, decision: 'accepted' | 'refused', cardId?: string): TaskProposal | null {
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

export function saveAttachment(attachment: Attachment): Attachment {
  getDb()
    .prepare('INSERT INTO attachments (id, project_id, sha, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(attachment.id, attachment.projectId, attachment.sha, JSON.stringify(attachment), attachment.createdAt);
  return attachment;
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
}

/** Un tour réellement envoyé, tel qu'il est ressorti pour l'historique. */
export interface UsageTurnRow {
  at: number;
  engine?: string;
  model?: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  tokens: number;
  seconds: number;
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
      `INSERT INTO usage (project_id, project_name, card_id, agent_id, account, engine, model, tokens, tokens_in, tokens_out, input_tokens, cached_tokens, output_tokens, quota_share, quota_5h, quota_semaine, seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      now(),
    );
}

/**
 * L'HISTORIQUE DES TOURS D'UN AGENT, du plus ancien au plus récent : une ligne
 * par tour réellement parti, telle qu'elle a été écrite à la fin du tour. Rien
 * n'est recalculé ni complété ici — un tour ancien, écrit avant que le détail
 * ne soit rangé, ressort simplement avec ses zéros.
 *
 * La limite protège l'affichage d'une carte très longue : ce sont les tours les
 * plus RÉCENTS qui sont gardés, puis remis dans l'ordre du temps.
 */
export function usageByAgent(agentId: string, limit = 200): UsageTurnRow[] {
  const lignes = getDb()
    .prepare(
      `SELECT created_at AS at, engine, model, tokens, input_tokens AS inputTokens,
              cached_tokens AS cachedTokens, output_tokens AS outputTokens, seconds
       FROM usage WHERE agent_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(agentId, limit) as any[];
  return lignes
    .map((ligne) => ({
      at: ligne.at,
      engine: ligne.engine ?? undefined,
      model: ligne.model ?? undefined,
      inputTokens: ligne.inputTokens ?? 0,
      cachedTokens: ligne.cachedTokens ?? 0,
      outputTokens: ligne.outputTokens ?? 0,
      tokens: ligne.tokens ?? 0,
      seconds: ligne.seconds ?? 0,
    }))
    .reverse();
}

/**
 * LE TOUR D'UN AGENT QUI COUVRE UN INSTANT DONNÉ.
 *
 * Le tour du chef d'orchestre qui a produit une carte n'a pas de `cardId` : il
 * vit dans sa conversation. On le retrouve par son agent et par l'heure de la
 * proposition — la ligne d'usage est écrite à la FIN du tour, donc le bon tour
 * est le PREMIER dont l'écriture suit la proposition. Rien de trouvé rend un
 * tableau vide : le parcours dira alors que la mesure n'est pas rattachée,
 * plutôt que d'en inventer une.
 */
export function usageTourCouvrant(agentId: string, instant: number): UsageTurnRow[] {
  const ligne = getDb()
    .prepare(
      `SELECT created_at AS at, engine, model, tokens, input_tokens AS inputTokens,
              cached_tokens AS cachedTokens, output_tokens AS outputTokens, seconds
       FROM usage WHERE agent_id = ? AND created_at >= ?
       ORDER BY created_at ASC, id ASC LIMIT 1`,
    )
    .get(agentId, instant) as any;
  if (!ligne) return [];
  return [
    {
      at: ligne.at,
      engine: ligne.engine ?? undefined,
      model: ligne.model ?? undefined,
      inputTokens: ligne.inputTokens ?? 0,
      cachedTokens: ligne.cachedTokens ?? 0,
      outputTokens: ligne.outputTokens ?? 0,
      tokens: ligne.tokens ?? 0,
      seconds: ligne.seconds ?? 0,
    },
  ];
}

/** Tous les agents d'une carte, du plus ancien au plus récent. */
export function agentsDeLaCarte(cardId: string): Agent[] {
  return getDb()
    .prepare('SELECT data FROM agents WHERE card_id = ? ORDER BY created_at ASC')
    .all(cardId)
    .map((r: any) => Agent.parse(JSON.parse(r.data)));
}

/**
 * Pour une carte, les totaux ENVOYÉS / REÇUS cumulés par agent — chef compris.
 * Ne compte que les tours où la séparation a été mesurée (`tokens_in` /
 * `tokens_out` non NULL) : une ligne ancienne, sans séparation, ne fausse pas
 * la somme en comptant comme zéro.
 */
export function usageTokensByCardAndAgent(cardId: string): {
  agentId: string;
  tokensIn: number;
  tokensOut: number;
}[] {
  return getDb()
    .prepare(
      `SELECT agent_id AS agentId, SUM(tokens_in) AS tokensIn, SUM(tokens_out) AS tokensOut
       FROM usage
       WHERE card_id = ? AND agent_id IS NOT NULL AND tokens_in IS NOT NULL AND tokens_out IS NOT NULL
       GROUP BY agent_id`,
    )
    .all(cardId) as any;
}

/**
 * Pour une carte, les deux parts de quota consommées jour par jour : la fenêtre
 * de 5 heures et la fenêtre de la semaine, sommées par date. C'est ce que
 * ressortira plus tard le tableau de bord — ici, cela sert surtout à prouver que
 * les deux chiffres sont bien rangés et regroupables.
 */
export function usageQuotaByCardAndDay(cardId: string): {
  day: string;
  quota5h: number;
  quotaSemaine: number;
}[] {
  return getDb()
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') AS day,
              SUM(quota_5h) AS quota5h, SUM(quota_semaine) AS quotaSemaine
       FROM usage WHERE card_id = ?
       GROUP BY day ORDER BY day`,
    )
    .all(cardId) as any;
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

/**
 * La consommation JOUR PAR JOUR, tous moteurs confondus, pour la courbe du
 * tableau de bord. Un jour par ligne (heure locale du serveur), les plus
 * récents d'abord ; on rend au plus `days` jours. Le tri final revient à la
 * page, qui dessine du plus ancien au plus récent.
 */
export function usageByDay(days = 30): { day: string; tokens: number; seconds: number; tasks: number }[] {
  return getDb()
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') AS day,
              SUM(tokens) AS tokens, SUM(seconds) AS seconds, COUNT(DISTINCT card_id) AS tasks
       FROM usage GROUP BY day ORDER BY day DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.round(days))) as any;
}

/**
 * L'HISTORIQUE DES TÂCHES EXÉCUTÉES : une ligne par TOUR réellement parti
 * (`recordUsage` écrit une ligne à la fin de chaque tour d'agent), la plus
 * récente d'abord. `inputTokens` / `outputTokens` sont le DÉTAIL réel du
 * tour tel que le moteur l'a rendu — jamais une estimation. Le titre de la
 * carte se raccroche côté appelant, comme pour les autres vues d'usage.
 */
export function usageHistorique(limit = 30): {
  cardId: string;
  at: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
}[] {
  return getDb()
    .prepare(
      `SELECT card_id AS cardId, created_at AS at, input_tokens AS inputTokens,
              output_tokens AS outputTokens, tokens
       FROM usage WHERE card_id IS NOT NULL
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.round(limit))) as any;
}

/* ------------------------------------------------------------------ */
/* CE QUE LE TRI DE LA MÉMOIRE ÉCONOMISE                               */
/* ------------------------------------------------------------------ */

/**
 * UNE OUVERTURE DE MÉMOIRE, ET CE QU'ELLE A ÉVITÉ D'ENVOYER.
 *
 * Les deux poids sont en SIGNES et tous deux MESURÉS : `entiers` est la
 * longueur du texte qui serait parti sans le tri, `servis` celle du texte
 * réellement parti. On n'écrit rien quand le tri n'a rien changé — une ligne
 * à zéro d'économie n'apprend rien et remplit la table pour rien.
 */
export function recordMemoryEconomy(ligne: {
  projectId?: string;
  cardId?: string;
  agentId?: string;
  entiers: number;
  servis: number;
}): void {
  if (ligne.entiers <= ligne.servis) return;
  getDb()
    .prepare(
      `INSERT INTO memoire_economie (project_id, card_id, agent_id, signes_entiers, signes_servis, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ligne.projectId ?? null,
      ligne.cardId ?? null,
      ligne.agentId ?? null,
      Math.max(0, Math.round(ligne.entiers)),
      Math.max(0, Math.round(ligne.servis)),
      now(),
    );
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

/** La dernière publication RÉUSSIE : la seule qui dise ce qui est en ligne. */
export function lastSuccessfulDeploy(projectId: string): DeployRun | null {
  const row = getDb()
    .prepare("SELECT data FROM deploys WHERE project_id = ? AND state = 'success' ORDER BY started_at DESC LIMIT 1")
    .get(projectId) as { data: string } | undefined;
  return row ? DeployRun.parse(JSON.parse(row.data)) : null;
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
export function telemetrieDesTaches(jours = JOURS_DE_TENDANCE): MesureDeTache[] {
  const depuis = now() - Math.max(1, Math.round(jours)) * 24 * 60 * 60 * 1000;
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
       FROM telemetrie_tache WHERE created_at >= ?
       GROUP BY card_id ORDER BY at DESC`,
    )
    .all(depuis) as any[];
  const sujetsParCarte = getDb()
    .prepare(
      `SELECT card_id AS cardId, memoire_sujets AS sujets FROM telemetrie_tache
       WHERE created_at >= ? ORDER BY created_at ASC`,
    )
    .all(depuis) as { cardId: string; sujets: string | null }[];
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
