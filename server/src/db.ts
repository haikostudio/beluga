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
  {
    id: 7,
    name: 'journal-des-amorces',
    sql: `
      CREATE TABLE amorce_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account TEXT NOT NULL,
        at INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        model TEXT,
        tokens INTEGER,
        jusqua INTEGER,
        error TEXT
      );
      CREATE INDEX idx_amorce_log ON amorce_log(at);
    `,
  },
  {
    id: 8,
    name: 'nom-du-projet-dans-la-consommation',
    // Le nom est recopié à l'écriture : un projet supprimé emportait le sien,
    // et sa consommation devenait une ligne anonyme dans les réglages.
    sql: `ALTER TABLE usage ADD COLUMN project_name TEXT;`,
  },
  {
    id: 9,
    name: 'journal-des-envois-au-cerveau',
    sql: `
      CREATE TABLE cerveau_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        project TEXT,
        ok INTEGER NOT NULL,
        files INTEGER,
        error TEXT
      );
      CREATE INDEX idx_cerveau_log ON cerveau_log(at);
    `,
  },
  {
    id: 10,
    name: 'resume-de-l-historique-des-quotas',
    // Passé quatorze jours, le détail des relevés est remplacé par une ligne
    // par jour et par heure : c'est tout ce dont le profil des heures creuses a
    // besoin, et cela tient dans quelques centaines de lignes par compte.
    sql: `
      CREATE TABLE quota_profile (
        account TEXT NOT NULL,
        jour TEXT NOT NULL,
        heure INTEGER NOT NULL,
        duree_ms REAL NOT NULL,
        consomme_pct REAL NOT NULL,
        PRIMARY KEY (account, jour, heure)
      );
      CREATE INDEX idx_quota_profile_jour ON quota_profile(jour);
    `,
  },
  {
    id: 11,
    name: 'part-de-quota-par-tache',
    // La part de quota consommée par une tâche, relevée sur son compte avant et
    // après le tour : la fenêtre de 5 h et la fenêtre de la semaine, séparément.
    // `quota_share` restait à 0 et ne distinguait pas les deux fenêtres.
    sql: `
      ALTER TABLE usage ADD COLUMN quota_5h REAL DEFAULT 0;
      ALTER TABLE usage ADD COLUMN quota_semaine REAL DEFAULT 0;
    `,
  },
  {
    id: 12,
    name: 'dictees-en-attente-de-destinataire',
    // Une phrase dictée dont on ne sait pas encore à quel projet elle s'adresse :
    // la question est posée, la phrase attend ici. Sans elle, un redémarrage
    // perdrait la demande entre la question et la réponse.
    sql: `
      CREATE TABLE dictees (
        id TEXT PRIMARY KEY,
        texte TEXT NOT NULL,
        project_id TEXT,
        candidats TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        reglee_a INTEGER
      );
      CREATE INDEX idx_dictees_question ON dictees(question_id);
      CREATE INDEX idx_dictees_attente ON dictees(reglee_a, created_at);
    `,
  },
  {
    id: 13,
    name: 'adresse-de-dev-unique',
    // Déployer ne se règle plus : ni environnements, ni rôles, ni commande de
    // publication, ni « se déploie sur envoi ». Il ne reste que l'adresse de
    // l'instance de dev à contrôler — on la reprend là où elle était rangée,
    // sinon un projet déjà réglé la perdrait en silence : d'abord l'adresse du
    // premier environnement, sinon l'ancien `deployUrl`.
    //
    // Et une publication restée « en attente d'accord » ne trouverait plus
    // personne pour trancher : elle est refermée en « arrêtée ».
    sql: `
      UPDATE projects
         SET data = json_set(
               data,
               '$.devUrl',
               COALESCE(json_extract(data, '$.environments[0].url'), json_extract(data, '$.deployUrl'))
             )
       WHERE COALESCE(json_extract(data, '$.environments[0].url'), json_extract(data, '$.deployUrl')) IS NOT NULL;

      UPDATE deploys
         SET state = 'stopped',
             data = json_set(json_remove(data, '$.attente'), '$.state', 'stopped')
       WHERE state = 'awaiting';
    `,
  },
  {
    id: 14,
    name: 'tokens-envoyes-et-recus',
    // `tokens` restait un total combiné : entrée et sortie séparées, à côté,
    // pour un total par agent. Les lignes déjà écrites gardent NULL ici — leur
    // seul total combiné reste valable, rien n'est recalculé.
    sql: `
      ALTER TABLE usage ADD COLUMN tokens_in INTEGER;
      ALTER TABLE usage ADD COLUMN tokens_out INTEGER;
    `,
  },
  {
    id: 15,
    name: 'detail-des-tours-envoyes-recus',
    // Le journal d'usage ne disait pas ce qui était RELU depuis le cache ni sur
    // quel modèle — donc impossible d'en chiffrer le coût. Ajout PUREMENT
    // additif, à côté de `tokens_in` / `tokens_out` (migration 14) : les
    // colonnes existantes, le quota et la facturation ne bougent pas, et les
    // tours déjà enregistrés gardent 0 (l'écran les montre alors sans détail
    // plutôt qu'avec un faux chiffre).
    sql: `
      ALTER TABLE usage ADD COLUMN input_tokens INTEGER DEFAULT 0;
      ALTER TABLE usage ADD COLUMN cached_tokens INTEGER DEFAULT 0;
      ALTER TABLE usage ADD COLUMN output_tokens INTEGER DEFAULT 0;
      ALTER TABLE usage ADD COLUMN model TEXT;
      CREATE INDEX idx_usage_agent ON usage(agent_id, created_at);
    `,
  },
  {
    id: 16,
    name: 'retrait-de-la-colonne-validee',
    // La colonne « Validé » n'existe plus : valider une carte lance son analyse
    // sur place. Les cartes qui y dormaient doivent être
    // reprises AVANT toute lecture — leur clé de colonne n'est plus reconnue et
    // la carte ne se relirait pas.
    //
    // Trois sorts, selon ce qui avait déjà été payé : une carte DÉJÀ chiffrée
    // part en « Planifié » (son analyse est là, elle n'attend que le
    // lancement) ; une carte dont l'analyse a échoué retombe dans la colonne
    // d'attente d'alors sans rien relancer — on ne repaie pas un chiffrage tout
    // seul, l'échec se lit toujours sur la carte ; une carte encore sans
    // chiffres y retombe en gardant sa validation (`analyseDemandee`).
    // La migration 18, plus bas, reprend ensuite ces cartes : « À faire » a
    // disparu à son tour.
    sql: `
      UPDATE cards
         SET column_key = 'planned',
             data = json_set(json_set(data, '$.column', 'planned'), '$.analyseDemandee', json('false'))
       WHERE column_key = 'validated'
         AND json_extract(data, '$.estimate') IS NOT NULL
         AND COALESCE(json_extract(data, '$.estimate.failed'), 0) = 0;

      UPDATE cards
         SET column_key = 'todo',
             data = json_set(json_set(data, '$.column', 'todo'), '$.analyseDemandee', json('false'))
       WHERE column_key = 'validated'
         AND json_extract(data, '$.estimate') IS NOT NULL;

      UPDATE cards
         SET column_key = 'todo',
             data = json_set(json_set(data, '$.column', 'todo'), '$.analyseDemandee', json('true'))
       WHERE column_key = 'validated';
    `,
  },
  {
    id: 17,
    name: 'colonnes-reelles-des-cartes',
    // La carte tenait dans une seule colonne fourre-tout `data`, en JSON : rien
    // ne pouvait être filtré, trié ni compté sans relire et décoder chaque
    // ligne. Les champs STABLES deviennent de vraies colonnes ; les listes
    // VARIABLES (étiquettes, pièces jointes) prennent leur table fille, liée à
    // la carte et effacée avec elle.
    //
    // Migration PUREMENT additive côté données : les valeurs sont RECOPIÉES
    // depuis le JSON, jamais recalculées. Le bloc `data` est ensuite allégé des
    // champs partis — il ne doit pas exister deux versions d'une même valeur —
    // et garde le vraiment libre : chiffrage, consommation, planification,
    // facturation, suivi GitHub.
    sql: `
      ALTER TABLE cards ADD COLUMN description TEXT;
      ALTER TABLE cards ADD COLUMN origin TEXT;
      ALTER TABLE cards ADD COLUMN agent_id TEXT;
      ALTER TABLE cards ADD COLUMN conversation_agent_id TEXT;
      ALTER TABLE cards ADD COLUMN analyse_demandee INTEGER;
      ALTER TABLE cards ADD COLUMN code_deja_enregistre INTEGER;
      ALTER TABLE cards ADD COLUMN hors_tache INTEGER;
      ALTER TABLE cards ADD COLUMN excluded_from_deploy INTEGER;
      ALTER TABLE cards ADD COLUMN done_at INTEGER;
      ALTER TABLE cards ADD COLUMN archived_at INTEGER;
      ALTER TABLE cards ADD COLUMN last_read_at INTEGER;
      ALTER TABLE cards ADD COLUMN run_engine TEXT;
      ALTER TABLE cards ADD COLUMN run_model TEXT;
      ALTER TABLE cards ADD COLUMN run_thinking TEXT;
      ALTER TABLE cards ADD COLUMN run_mode TEXT;

      CREATE TABLE card_labels (
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        label TEXT NOT NULL,
        PRIMARY KEY (card_id, position)
      );
      CREATE INDEX idx_card_labels_label ON card_labels(label);

      CREATE TABLE card_attachments (
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        path TEXT NOT NULL,
        PRIMARY KEY (card_id, position)
      );

      UPDATE cards
         SET description = COALESCE(json_extract(data, '$.description'), ''),
             origin = COALESCE(json_extract(data, '$.origin'), 'user'),
             agent_id = json_extract(data, '$.agentId'),
             conversation_agent_id = json_extract(data, '$.conversationAgentId'),
             analyse_demandee = COALESCE(json_extract(data, '$.analyseDemandee'), 0),
             code_deja_enregistre = COALESCE(json_extract(data, '$.codeDejaEnregistre'), 0),
             hors_tache = COALESCE(json_extract(data, '$.horsTache'), 0),
             excluded_from_deploy = COALESCE(json_extract(data, '$.excludedFromDeploy'), 0),
             done_at = json_extract(data, '$.doneAt'),
             archived_at = json_extract(data, '$.archivedAt'),
             last_read_at = json_extract(data, '$.lastReadAt'),
             deployed_at = COALESCE(deployed_at, json_extract(data, '$.deployedAt')),
             run_engine = COALESCE(json_extract(data, '$.run.engine'), 'claude'),
             run_model = json_extract(data, '$.run.model'),
             run_thinking = COALESCE(json_extract(data, '$.run.thinking'), 'none'),
             run_mode = COALESCE(json_extract(data, '$.run.mode'), 'direct');

      INSERT INTO card_labels (card_id, position, label)
      SELECT c.id, j.key, j.value
        FROM (SELECT id, data FROM cards WHERE json_type(data, '$.labels') = 'array') c,
             json_each(c.data, '$.labels') j
       WHERE j.value IS NOT NULL;

      INSERT INTO card_attachments (card_id, position, path)
      SELECT c.id, j.key, j.value
        FROM (SELECT id, data FROM cards WHERE json_type(data, '$.attachments') = 'array') c,
             json_each(c.data, '$.attachments') j
       WHERE j.value IS NOT NULL;

      UPDATE cards
         SET data = json_remove(
               data,
               '$.id', '$.projectId', '$.title', '$.description', '$.labels', '$.column',
               '$.position', '$.origin', '$.attachments', '$.run', '$.analyseDemandee',
               '$.codeDejaEnregistre', '$.horsTache', '$.excludedFromDeploy', '$.agentId',
               '$.conversationAgentId', '$.doneAt', '$.archivedAt', '$.lastReadAt',
               '$.deployedAt', '$.createdAt', '$.updatedAt'
             );

      CREATE INDEX idx_cards_agent ON cards(agent_id);
      CREATE INDEX idx_cards_lecture ON cards(project_id, last_read_at);
    `,
  },
  {
    id: 18,
    name: 'retrait-de-la-colonne-a-faire',
    // La colonne « À faire » n'existe plus : une carte NAÎT dans « Planifié » et
    // son chiffrage se lance sur place. Les cartes qui dormaient dans l'ancienne
    // colonne doivent être reprises AVANT toute lecture — leur clé n'est plus
    // reconnue, et la carte ne se relirait pas.
    //
    // Elles montent EN TÊTE de « Planifié » (les cartes se lisent par position
    // décroissante), dans leur ordre d'origine, sans rien perdre : ni leur date
    // de création, ni leur validation. Une carte encore marquée `analyseDemandee`
    // verra donc son chiffrage repris par le premier tour de boucle, là où il
    // s'était arrêté.
    //
    // Chaque carte garde sa position d'origine, décalée d'un même nombre :
    // l'ordre relatif est alors conservé À L'IDENTIQUE, et le repère reste dans
    // l'échelle du reste de la base (les positions sont des dates). Le décalage
    // est calculé par PROJET — juste ce qu'il faut pour passer au-dessus de la
    // dernière carte déjà planifiée, et rien de plus.
    //
    // Il se calcule d'ABORD, dans une table de passage : le lire au fil de
    // l'écriture le ferait porter sur des positions déjà modifiées.
    //
    // La migration 17 a sorti `column` et `position` du bloc `data` : seules les
    // VRAIES colonnes sont écrites ici, il n'y a plus de JSON à tenir à jour.
    sql: `
      CREATE TEMP TABLE reprise_a_faire AS
        SELECT c.id AS id,
               c.position + MAX(
                 0,
                 (SELECT COALESCE(MAX(p.position), 0)
                    FROM cards p
                   WHERE p.project_id = c.project_id AND p.column_key = 'planned')
                 + 1
                 - (SELECT COALESCE(MIN(t.position), 0)
                      FROM cards t
                     WHERE t.project_id = c.project_id AND t.column_key = 'todo')
               ) AS position
          FROM cards c
         WHERE c.column_key = 'todo';

      UPDATE cards
         SET position = (SELECT r.position FROM reprise_a_faire r WHERE r.id = cards.id),
             column_key = 'planned'
       WHERE column_key = 'todo';

      DROP TABLE reprise_a_faire;
    `,
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
