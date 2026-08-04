import { randomUUID } from 'node:crypto';
import {
  Agent,
  Attachment,
  Card,
  CarteRendue,
  carteNonLue,
  ColumnKey,
  DecisionAttendue,
  attentionParProjet,
  DeployRun,
  Message,
  Project,
  ProjectGroup,
  QueuedPrompt,
  Settings,
  TaskProposal,
  cleDeSession,
  cleNouveauDepart,
  rendusParProjet,
  type AgregatHoraire,
  DETAIL_RETENTION_JOURS,
  RESUME_RETENTION_JOURS,
  jourLocal,
  resumerReleves,
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
export function recordQuotaSample(account: string, sessionPct?: number, weeklyPct?: number): void {
  const recent = getDb()
    .prepare('SELECT at FROM quota_samples WHERE account = ? ORDER BY at DESC LIMIT 1')
    .get(account) as { at: number } | undefined;
  if (recent && now() - recent.at < 15 * 60 * 1000) return;

  getDb()
    .prepare('INSERT INTO quota_samples (account, at, session_pct, weekly_pct) VALUES (?, ?, ?, ?)')
    .run(account, now(), sessionPct ?? null, weeklyPct ?? null);

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

export function quotaHistory(days = 7): Record<string, { at: number; session: number; weekly: number }[]> {
  const rows = getDb()
    .prepare(
      'SELECT account, at, session_pct AS session, weekly_pct AS weekly FROM quota_samples WHERE at > ? ORDER BY at',
    )
    .all(now() - days * 24 * 3600 * 1000) as { account: string; at: number; session: number; weekly: number }[];
  const out: Record<string, { at: number; session: number; weekly: number }[]> = {};
  for (const row of rows) {
    (out[row.account] ??= []).push({ at: row.at, session: row.session ?? 0, weekly: row.weekly ?? 0 });
  }
  return out;
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

export function listCards(projectId: string): Card[] {
  const rows = getDb()
    .prepare('SELECT data FROM cards WHERE project_id = ? ORDER BY position DESC')
    .all(projectId) as { data: string }[];
  return rows.map((r) => Card.parse(JSON.parse(r.data)));
}

export function listCardsInColumn(projectId: string, column: ColumnKey): Card[] {
  return listCards(projectId).filter((c) => c.column === column);
}

export function getCard(id: string): Card | null {
  const row = getDb().prepare('SELECT data FROM cards WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? Card.parse(JSON.parse(row.data)) : null;
}

export function saveCard(card: Card): Card {
  const value = Card.parse({ ...card, updatedAt: now() });
  getDb()
    .prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at)
       VALUES (@id, @projectId, @column, @position, @title, @data, @deployedAt, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, column_key = excluded.column_key,
         position = excluded.position, title = excluded.title, data = excluded.data,
         deployed_at = excluded.deployed_at, updated_at = excluded.updated_at`,
    )
    .run({
      id: value.id,
      projectId: value.projectId,
      column: value.column,
      position: value.position,
      title: value.title,
      data: JSON.stringify(value),
      deployedAt: value.deployedAt ?? null,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    });
  return value;
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
 * Chaque moteur a SA propre conversation : reprendre une session Claude avec
 * Codex n'a aucun sens. La colonne garde un petit dictionnaire dont la clé est
 * calculée par `cleDeSession` (moteur, et sous Codex le modèle qui a ouvert le
 * fil), tout en acceptant l'ancien format (une simple chaîne).
 */
function rawSessions(agentId: string): string | null {
  const row = getDb().prepare('SELECT session_id FROM agents WHERE id = ?').get(agentId) as
    | { session_id: string | null }
    | undefined;
  return row?.session_id ?? null;
}

function readSessions(agentId: string): Record<string, string> {
  const row = getDb().prepare('SELECT session_id, role, data FROM agents WHERE id = ?').get(agentId) as
    | { session_id: string | null; data: string }
    | undefined;
  if (!row?.session_id) return {};
  const raw = row.session_id.trim();
  if (raw.startsWith('{')) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  // Ancien format : la session appartenait au moteur de l'agent. On la range
  // sous la clé d'aujourd'hui, réglages actuels compris.
  try {
    const run = JSON.parse(row.data)?.run ?? {};
    return { [cleDeSession(run.engine, run.model)]: raw };
  } catch {
    return { claude: raw };
  }
}

export function setSessionId(agentId: string, sessionId: string, cle = 'claude'): void {
  const sessions = { ...readSessions(agentId), [cle]: sessionId };
  getDb().prepare('UPDATE agents SET session_id = ? WHERE id = ?').run(JSON.stringify(sessions), agentId);
}

export function getSessionId(agentId: string, cle = 'claude'): string | null {
  return readSessions(agentId)[cle] ?? null;
}

/**
 * Oublier les sessions de cet agent, tous moteurs confondus : le prochain
 * message repart d'une conversation vide côté moteur, et la mémoire du projet
 * y est renvoyée une fois, comme au premier tour.
 */
export function clearSessions(agentId: string): void {
  getDb().prepare('UPDATE agents SET session_id = NULL WHERE id = ?').run(agentId);
}

/**
 * Combien de faits de la mémoire du projet cet agent a DÉJÀ dans son contexte.
 * Sert à ne lui renvoyer que les faits nouveaux au lieu de recoller la mémoire
 * entière à chaque message.
 */
export function memorySeen(agentId: string): number {
  const raw = getMeta(`memoire.vue.${agentId}`);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function setMemorySeen(agentId: string, facts: number): void {
  setMeta(`memoire.vue.${agentId}`, String(Math.max(0, Math.round(facts))));
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

export function deleteAgent(id: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE agent_id = ?').run(id);
    db.prepare('DELETE FROM queue WHERE agent_id = ?').run(id);
    db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  })();
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
export function decisionsEnAttente(): DecisionAttendue[] {
  const decisions: DecisionAttendue[] = [];

  const rows = getDb()
    .prepare(
      `SELECT a.project_id AS projectId, a.id AS agentId, a.card_id AS cardId,
              m.data AS data, m.created_at AS createdAt
       FROM messages m
       JOIN agents a ON a.id = m.agent_id
       WHERE m.data LIKE '%"questions":[{%'`,
    )
    .all() as {
    projectId: string;
    agentId: string;
    cardId: string | null;
    data: string;
    createdAt: number;
  }[];
  for (const row of rows) {
    try {
      const message = Message.parse(JSON.parse(row.data));
      for (const question of message.questions) {
        decisions.push({
          projectId: row.projectId,
          agentId: row.agentId,
          cardId: row.cardId ?? undefined,
          genre: 'question',
          reglee: Boolean(question.answer),
          poseeA: row.createdAt,
        });
      }
    } catch {
      /* message illisible : on l'ignore */
    }
  }

  const propositions = getDb()
    .prepare(
      `SELECT p.project_id AS projectId, p.decision AS decision, p.created_at AS createdAt,
              a.id AS agentId, a.card_id AS cardId
       FROM proposals p
       JOIN messages m ON m.id = p.message_id
       JOIN agents a ON a.id = m.agent_id`,
    )
    .all() as {
    projectId: string;
    decision: string;
    createdAt: number;
    agentId: string;
    cardId: string | null;
  }[];
  for (const proposition of propositions) {
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
    });
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
export function signalAttention(): { byProject: Record<string, number>; decisions: DecisionAttendue[] } {
  const decisions = decisionsEnAttente();
  return { byProject: attentionParProjet(decisions), decisions };
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
  const sql = `SELECT c.id AS cardId, c.project_id AS projectId, c.column_key AS colonne, c.data AS carte,
              (SELECT a.data FROM agents a
                WHERE a.card_id = c.id ORDER BY a.created_at DESC LIMIT 1) AS agent
         FROM cards c
        WHERE c.column_key <> 'archived'${projectId ? ' AND c.project_id = ?' : ''}`;
  const requete = getDb().prepare(sql);
  const rows = (projectId ? requete.all(projectId) : requete.all()) as {
    cardId: string;
    projectId: string;
    colonne: string;
    carte: string;
    agent: string | null;
  }[];

  const entrees: CarteRendue[] = [];
  for (const row of rows) {
    try {
      const carte = Card.parse(JSON.parse(row.carte));
      /*
       * Une carte fabriquée pour du travail hors tâche n'a pas d'agent à elle :
       * sa conversation est celle de l'agent qui a codé.
       */
      const brut = row.agent ?? (carte.conversationAgentId ? rawAgent(carte.conversationAgentId) : null);
      const agent = brut ? Agent.parse(JSON.parse(brut)) : null;
      entrees.push({
        cardId: row.cardId,
        projectId: row.projectId,
        colonne: row.colonne,
        agentStatut: agent?.status,
        agentFiniA: agent?.endedAt,
        luA: carte.lastReadAt,
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
       WHERE m.data LIKE '%"questions":[{%'
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

/** Les propositions d'agents qui n'ont encore reçu ni oui ni non. */
export function pendingProposals(projectId?: string): { projectId: string; title: string }[] {
  const rows = (
    projectId
      ? getDb()
          .prepare("SELECT project_id AS projectId, data FROM proposals WHERE decision = 'pending' AND project_id = ?")
          .all(projectId)
      : getDb().prepare("SELECT project_id AS projectId, data FROM proposals WHERE decision = 'pending'").all()
  ) as { projectId: string; data: string }[];
  const out: { projectId: string; title: string }[] = [];
  for (const row of rows) {
    try {
      out.push({ projectId: row.projectId, title: String(JSON.parse(row.data).title ?? '') });
    } catch {
      /* proposition illisible : on l'ignore */
    }
  }
  return out.filter((item) => item.title);
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
      `INSERT INTO messages (id, agent_id, role, data, created_at)
       VALUES (@id, @agentId, @role, @data, @createdAt)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    )
    .run({
      id: value.id,
      agentId: value.agentId,
      role: value.role,
      data: JSON.stringify(value),
      createdAt: value.createdAt,
    });
  return value;
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
  quotaShare?: number;
  seconds?: number;
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
      `INSERT INTO usage (project_id, project_name, card_id, agent_id, account, engine, tokens, quota_share, seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.projectId ?? null,
      nom,
      row.cardId ?? null,
      row.agentId ?? null,
      row.account ?? null,
      row.engine ?? null,
      Math.round(row.tokens ?? 0),
      row.quotaShare ?? 0,
      row.seconds ?? 0,
      now(),
    );
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
       ORDER BY SUM(u.tokens) DESC`,
    )
    .all() as any;
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
