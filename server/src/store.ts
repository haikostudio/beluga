import { randomUUID } from 'node:crypto';
import {
  Agent,
  Attachment,
  Card,
  ColumnKey,
  DeployRun,
  Message,
  Project,
  QueuedPrompt,
  Settings,
  TaskProposal,
} from '@haikodev/shared';
import { getDb, getMeta, setMeta } from './db.js';

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
 * Codex n'a aucun sens. La colonne garde un petit dictionnaire par moteur, tout
 * en acceptant l'ancien format (une simple chaîne).
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
  // Ancien format : la session appartenait au moteur de l'agent.
  try {
    const engine = JSON.parse(row.data)?.run?.engine ?? 'claude';
    return { [engine]: raw };
  } catch {
    return { claude: raw };
  }
}

export function setSessionId(agentId: string, sessionId: string, engine = 'claude'): void {
  const sessions = { ...readSessions(agentId), [engine]: sessionId };
  getDb().prepare('UPDATE agents SET session_id = ? WHERE id = ?').run(JSON.stringify(sessions), agentId);
}

export function getSessionId(agentId: string, engine = 'claude'): string | null {
  return readSessions(agentId)[engine] ?? null;
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
  getDb()
    .prepare(
      `INSERT INTO usage (project_id, card_id, agent_id, account, engine, tokens, quota_share, seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.projectId ?? null,
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

export function usageByProject(): { projectId: string; tokens: number; seconds: number; tasks: number }[] {
  return getDb()
    .prepare(
      `SELECT project_id AS projectId, SUM(tokens) AS tokens, SUM(seconds) AS seconds, COUNT(DISTINCT card_id) AS tasks
       FROM usage GROUP BY project_id`,
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
