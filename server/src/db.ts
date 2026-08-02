import Database from 'better-sqlite3';
import { PATHS, ensureDirs } from './config.js';
import { log } from './logger.js';

export type DB = Database.Database;

let db: DB | null = null;

/**
 * Migrations NUMÉROTÉES, appliquées automatiquement au démarrage (PLAN §3).
 * On n'en réécrit jamais une : on en ajoute une nouvelle.
 */
const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'socle',
    sql: `
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE cards (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        column_key TEXT NOT NULL,
        position REAL NOT NULL,
        title TEXT NOT NULL,
        data TEXT NOT NULL,
        deployed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_cards_project ON cards(project_id, column_key, position);

      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        card_id TEXT,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        session_id TEXT,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_agents_project ON agents(project_id, status);

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_messages_agent ON messages(agent_id, created_at);

      CREATE TABLE queue (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        position REAL NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_queue_agent ON queue(agent_id, position);

      CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sha TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_attachments_project ON attachments(project_id, sha);

      CREATE TABLE usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT,
        card_id TEXT,
        agent_id TEXT,
        account TEXT,
        engine TEXT,
        tokens INTEGER DEFAULT 0,
        quota_share REAL DEFAULT 0,
        seconds REAL DEFAULT 0,
        mem_mb REAL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_usage_project ON usage(project_id, created_at);

      CREATE TABLE deploys (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        state TEXT NOT NULL,
        data TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      );

      CREATE TABLE capacity_samples (
        at INTEGER PRIMARY KEY,
        load_pct REAL NOT NULL,
        mem_used_mb REAL NOT NULL,
        running INTEGER NOT NULL
      );

      CREATE TABLE sessions (
        token TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        label TEXT
      );

      CREATE TABLE auth_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        at INTEGER NOT NULL,
        ok INTEGER NOT NULL
      );
      CREATE INDEX idx_attempts_ip ON auth_attempts(ip, at);

      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        engine TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 2,
    name: 'propositions-et-notifications',
    sql: `
      CREATE TABLE proposals (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        decision TEXT NOT NULL DEFAULT 'pending',
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        decided_at INTEGER
      );
      CREATE INDEX idx_proposals_message ON proposals(message_id);

      CREATE TABLE push_subs (
        endpoint TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 3,
    name: 'groupes-de-projets',
    sql: `
      CREATE TABLE project_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        rank REAL NOT NULL DEFAULT 100,
        collapsed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 4,
    name: 'preferences-utilisateur',
    sql: `
      CREATE TABLE preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 5,
    name: 'historique-des-quotas',
    sql: `
      CREATE TABLE quota_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account TEXT NOT NULL,
        at INTEGER NOT NULL,
        session_pct REAL,
        weekly_pct REAL
      );
      CREATE INDEX idx_quota_samples ON quota_samples(account, at);
    `,
  },
  {
    id: 6,
    name: 'couleur-des-groupes',
    sql: `ALTER TABLE project_groups ADD COLUMN color TEXT;`,
  },
];

export function openDb(): DB {
  if (db) return db;
  ensureDirs();
  const database = new Database(PATHS.db);
  // Mode « journal parallèle » : écritures sûres même en cas de coupure (PLAN §3).
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');

  database.exec('CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER)');
  const applied = new Set<number>(
    database.prepare('SELECT id FROM migrations').all().map((r: any) => r.id as number),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    const run = database.transaction(() => {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, migration.name, Date.now());
    });
    run();
    log.info(`migration ${migration.id} (${migration.name}) appliquée`);
  }

  db = database;
  return db;
}

export function getDb(): DB {
  return db ?? openDb();
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}
