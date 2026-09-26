import Database from 'better-sqlite3';
import { RAISON_DEJA_LIVRE } from '@beluga/shared';
import { PATHS, ensureDirs } from './config.js';
import { log } from './logger.js';
import { passerLaBaseAuxBackups } from './passage-backups.js';
import { sauvegarderLAncienneMemoire } from './sauvegarde-ancienne-memoire.js';
import path from 'node:path';

/**
 * L'ANCIENNE phrase du travail déjà livré, gardée ici et NULLE PART ailleurs :
 * une migration répare le passé, elle a donc besoin du texte d'hier, mot pour
 * mot. La phrase d'aujourd'hui, elle, vient de la règle (`RAISON_DEJA_LIVRE`) —
 * jamais recopiée, sinon les deux se mettraient un jour à diverger en silence.
 */
const ANCIENNE_PHRASE_DEJA_LIVRE =
  'Rien à changer : le travail demandé était déjà livré et enregistré. La carte est rangée sans nouveau code.';

/** Une chaîne posée telle quelle dans une requête SQL, apostrophes comprises. */
function litteralSql(texte: string): string {
  return `'${texte.replace(/'/g, "''")}'`;
}

export type DB = Database.Database;

let db: DB | null = null;

/**
 * Migrations NUMÉROTÉES, appliquées automatiquement au démarrage (PLAN §3).
 * On n'en réécrit jamais une : on en ajoute une nouvelle.
 */
export const MIGRATIONS: {
  id: number;
  name: string;
  sql: string;
  /*
   * UNE MIGRATION QUI RÉPARE DES DONNÉES NE S'APPLIQUE QU'À UNE BASE QUI LES A.
   * Le schéma vient des migrations d'avant, mais un contrôle peut monter une
   * base PARTIELLE — juste les tables qu'il juge. Une réparation lancée là-dessus
   * tombait sur « no such table », et faisait échouer un test qui n'a rien à voir.
   * Nommer la table attendue REPORTE la migration au lieu de la faire échouer :
   * non inscrite, elle se rejouera dès que la table sera là.
   *
   * ON NOMME TOUTES LES TABLES TOUCHÉES, PAS SEULEMENT LA PRINCIPALE. Une
   * migration qui nettoie une carte touche aussi ses étiquettes, ses agents et
   * leur file d'attente : n'en garder qu'une laissait passer la migration sur
   * une base partielle, qui tombait ensuite sur la DEUXIÈME table — et le
   * report ne servait plus à rien. La liste entière se déclare donc ici.
   */
  siTable?: string | string[];
}[] = [
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
  {
    id: 19,
    name: 'passages-de-documentation',
    // L'INDEX DE RECHERCHE de la documentation d'un projet : un passage par
    // section (ou par règle), avec son EMPREINTE sémantique calculée sur le
    // serveur — aucune clé facturée à l'appel.
    //
    // Deux tables, pour que la réindexation reste INCRÉMENTALE : `doc_fichiers`
    // retient l'empreinte du contenu de chaque fichier déjà lu, `doc_passages`
    // porte les morceaux. Un fichier inchangé n'est ni relu ni recalculé ; un
    // fichier modifié voit SES passages remplacés, jamais ceux des autres.
    //
    // Rien d'irremplaçable ici : l'index se reconstruit entièrement depuis le
    // dépôt. Il peut donc être vidé sans perte, et l'est à chaque changement de
    // version du découpage.
    sql: `
      CREATE TABLE doc_fichiers (
        project_id TEXT NOT NULL,
        chemin TEXT NOT NULL,
        empreinte TEXT NOT NULL,
        indexe_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, chemin)
      );

      CREATE TABLE doc_passages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source TEXT NOT NULL,
        titre TEXT NOT NULL,
        sujet TEXT NOT NULL,
        priorite INTEGER NOT NULL DEFAULT 0,
        texte TEXT NOT NULL,
        empreinte TEXT NOT NULL,
        signes INTEGER NOT NULL,
        maj_at INTEGER NOT NULL
      );
      CREATE INDEX idx_doc_passages_projet ON doc_passages(project_id);
      CREATE INDEX idx_doc_passages_source ON doc_passages(project_id, source);
    `,
  },
  {
    id: 20,
    name: 'liberer-les-cartes-bloquees-a-deployer',
    // LE BOGUE DU « TOUT DÉPLOYER » MUET.
    //
    // Le lot de « À déployer » écarte les cartes qui portent déjà une date de
    // mise en ligne (`deployableCards`). Rien n'effaçait cette date quand une
    // carte REVENAIT dans la colonne — repassée à la main depuis « En
    // production », ou retravaillée puis reposée là. Elle était alors écartée
    // de TOUS les lots suivants : le bouton annonçait « (0) », s'éteignait, et
    // le clic ne partait nulle part.
    //
    // La règle est réparée à la source (`dateDeMiseEnLignePerimee`, branchée
    // sur les deux chemins de déplacement) ; ici on libère les cartes déjà
    // prises au piège. Une carte POSÉE dans « À déployer » attend d'être
    // déployée : sa date d'avant n'a plus cours. Les colonnes « En production »
    // et « Archivé » gardent la leur, qui est la trace de leur mise en ligne.
    sql: `
      UPDATE cards SET deployed_at = NULL
      WHERE column_key = 'to_deploy' AND deployed_at IS NOT NULL;
    `,
  },
  {
    id: 21,
    name: 'cles-api-externes',
    // LA PORTE D'ENTRÉE DES SERVICES EXTÉRIEURS.
    //
    // Une clé par service, nommée et datée, pour poser une carte depuis le
    // dehors sans ouvrir l'interface. Le SECRET n'est pas rangé ici : seule son
    // empreinte l'est, avec les premiers signes gardés en clair pour reconnaître
    // la clé dans la liste. Révoquer, c'est DATER la révocation — la ligne
    // reste, pour que l'histoire des cartes créées ne s'efface pas avec elle.
    sql: `
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        nom TEXT NOT NULL,
        apercu TEXT NOT NULL,
        empreinte TEXT NOT NULL UNIQUE,
        creee_le INTEGER NOT NULL,
        revoquee_le INTEGER,
        dernier_usage_le INTEGER,
        cartes_creees INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_empreinte ON api_keys(empreinte);
    `,
  },
  {
    id: 22,
    name: 'procedure-de-deploiement-des-projets-existants',
    // LA PROCÉDURE DE DÉPLOIEMENT DEVIENT UNE CHOSE QU'ON DÉFINIT.
    //
    // Un projet neuf n'arrive plus avec un déploiement tout fait : tant que sa
    // procédure est vide, la colonne « À déployer » propose de l'INITIER au
    // lieu de partir. Les projets DÉJÀ inscrits, eux, ne doivent rien perdre :
    // on leur pose le marqueur « constaté », qui veut dire « garde le déroulé
    // d'avant » (Beluga Build, sinon le service système, sinon le dossier servi).
    //
    // Seuls les projets qui n'ont rien de rangé là sont touchés : une clé déjà
    // écrite est la décision de quelqu'un, on ne l'écrase pas.
    sql: `
      UPDATE projects
      SET data = json_set(data, '$.deploiement', json('{"constate":true}'))
      WHERE json_extract(data, '$.deploiement') IS NULL;
    `,
  },
  {
    id: 23,
    name: 'refermer-les-listes-de-taches-des-tours-finis',
    // LES LISTES QUI NE SE TERMINAIENT JAMAIS.
    //
    // Une ligne de la liste de tâches restait « en cours » après la fin du
    // tour : le moteur ne renvoie pas toujours une dernière mise à jour, et le
    // démon n'arrêtait que son chronomètre, pas son ÉTAT. Des cartes closes
    // depuis des semaines affichent donc encore « 4/5 faites » avec un rond
    // orange sur la dernière ligne.
    //
    // La règle est réparée à la source (`cloturerLesTaches`, branchée sur tous
    // les chemins de fin de tour) ; ici on referme ce qui est DÉJÀ figé, avec
    // exactement la même lecture : un tour qui a rendu une réponse coche la
    // ligne qui tournait (marquée `closedByTurnEnd` : c'est le démon qui coche,
    // pas l'agent), un tour muet la dit « non faite », et une ligne jamais
    // commencée est « non faite » dans les deux cas.
    //
    // Seuls les messages DÉJÀ figés sont touchés (`streaming` faux) : un tour
    // encore en écriture au moment de la migration garde sa liste vivante.
    sql: `
      UPDATE messages
      SET data = json_set(
        data,
        '$.todos',
        (
          SELECT json_group_array(json(
            CASE json_extract(t.value, '$.state')
              WHEN 'running' THEN
                CASE WHEN length(trim(coalesce(json_extract(messages.data, '$.content'), ''))) > 0
                  THEN json_set(
                         json_set(
                           json_set(t.value, '$.state', 'done'),
                           '$.endedAt',
                           coalesce(
                             json_extract(t.value, '$.endedAt'),
                             messages.created_at + coalesce(json_extract(messages.data, '$.durationMs'), 0)
                           )
                         ),
                         '$.closedByTurnEnd',
                         json('true')
                       )
                  ELSE json_set(t.value, '$.state', 'unfinished')
                END
              WHEN 'todo' THEN json_set(t.value, '$.state', 'unfinished')
              ELSE t.value
            END
          ))
          FROM json_each(messages.data, '$.todos') AS t
        )
      )
      WHERE coalesce(json_extract(data, '$.streaming'), 0) IN (0, 'false')
        AND EXISTS (
          SELECT 1 FROM json_each(messages.data, '$.todos') AS t
          WHERE json_extract(t.value, '$.state') IN ('running', 'todo')
        );
    `,
  },
  {
    id: 24,
    name: 'refaire-le-decompte-de-taches-porte-par-les-agents',
    siTable: ['agents', 'messages'],
    // LE MÊME TRAVAIL, DEUX DÉCOMPTES QUI NE DISENT PAS PAREIL.
    //
    // Les étapes vivent sur les messages ; le décroché du TABLEAU, lui, lit un
    // résumé posé sur l'agent (`agent.todos`), qui n'était rafraîchi qu'à
    // l'arrivée d'une liste du moteur. La clôture du tour refermait donc la
    // liste dans la conversation sans jamais toucher ce résumé : la carte
    // gardait « 4/5 faites » à vie, y compris une fois passée en « À déployer ».
    //
    // La règle est réparée à la source (`poserLaProgression`, branchée sur tous
    // les chemins de fin de tour) ; ici on refait le décompte DÉJÀ figé, depuis
    // la dernière liste connue de l'agent — celle que la migration 23 vient de
    // refermer, donc avec exactement la même lecture. Les étapes non menées à
    // bout sont comptées à part, pour que la carte les dise.
    //
    // Seuls les agents AU REPOS sont touchés : celui qui travaille encore verra
    // son décompte remis à jour par sa prochaine liste, et rien ne doit passer
    // devant.
    sql: `
      UPDATE agents
      SET data = json_set(
        json_set(
          json_set(agents.data, '$.todos.done', (
            SELECT count(*) FROM json_each(m.data, '$.todos') AS t
            WHERE json_extract(t.value, '$.state') = 'done'
          )),
          '$.todos.total', (SELECT count(*) FROM json_each(m.data, '$.todos') AS t)
        ),
        '$.todos.unfinished', (
          SELECT count(*) FROM json_each(m.data, '$.todos') AS t
          WHERE json_extract(t.value, '$.state') = 'unfinished'
        )
      )
      FROM (
        SELECT agent_id, data,
               row_number() OVER (PARTITION BY agent_id ORDER BY created_at DESC, id DESC) AS rang
        FROM messages
        WHERE json_array_length(coalesce(json_extract(data, '$.todos'), '[]')) > 0
      ) AS m
      WHERE m.agent_id = agents.id
        AND m.rang = 1
        AND agents.status NOT IN ('running', 'starting')
        AND json_extract(agents.data, '$.todos') IS NOT NULL;
    `,
  },
  {
    id: 25,
    name: 'reecrire-la-phrase-du-travail-deja-livre',
    siTable: 'cards',
    // « RIEN À CHANGER » SUR UN TRAVAIL BEL ET BIEN FAIT.
    //
    // La phrase posée sur une carte dont le code avait déjà été livré lors d'un
    // tour précédent commençait par « Rien à changer ». Affichée en encadré
    // JAUNE, à côté de la coche du travail rendu, elle se lisait comme
    // l'inverse de ce qui s'était passé : l'utilisateur voyait « rien n'a été
    // fait » sur une carte dont les fichiers étaient enregistrés et fusionnés.
    //
    // La phrase est réparée à la source (`RAISON_DEJA_LIVRE`,
    // `shared/src/suivi-colonne.ts`) et son ton d'affichage aussi
    // (`natureDeLaMention`). Ici on réécrit celles DÉJÀ posées en base : sans
    // cela, les cartes d'hier garderaient à jamais l'ancien texte, et le
    // resteraient en jaune faute d'être reconnues.
    //
    // Comme toute migration de RÉPARATION, elle nomme la table qu'elle attend
    // et ne touche QUE l'ancienne phrase, mot pour mot.
    sql: `
      UPDATE cards
      SET data = json_set(data, '$.sansModification', ${litteralSql(RAISON_DEJA_LIVRE)})
      WHERE json_extract(data, '$.sansModification') = ${litteralSql(ANCIENNE_PHRASE_DEJA_LIVRE)};
    `,
  },
  {
    id: 26,
    name: 'credit-cursor-dans-les-releves',
    siTable: 'quota_samples',
    // La courbe du volet ne savait tracer que des POURCENTAGES de fenêtre.
    // Cursor n'en a pas : sa dépense se lit en centimes. On ajoute la colonne
    // sans toucher aux relevés existants (NULL = pas de montant ce jour-là).
    sql: `
      ALTER TABLE quota_samples ADD COLUMN credit_cents INTEGER;
    `,
  },
  {
    id: 27,
    name: 'vecteurs-de-sens-dans-la-recherche',
    siTable: 'doc_passages',
    // LA RECHERCHE PASSE DU HACHAGE DE MOTS AU VRAI SENS (façon RAG).
    //
    // L'« empreinte » d'origine était calculée sur place, par hachage des
    // racines des mots : deux textes qui disent la même chose avec d'AUTRES mots
    // n'avaient rien en commun. On range désormais, à côté d'elle, le VECTEUR
    // rendu par un modèle de vectorisation — et le NOM de ce modèle, car un
    // vecteur venu d'un autre modèle n'est pas comparable et sera refait.
    //
    // Le vecteur est rangé en BLOB (des flottants 32 bits bout à bout) : trois
    // fois moins de place qu'en texte, et surtout aucune analyse de JSON à
    // chaque recherche, où l'on relit des milliers de passages.
    //
    // L'empreinte de mots RESTE : c'est le repli quand la clé manque ou que
    // l'index n'est pas encore vectorisé. Les colonnes sont donc ajoutées,
    // jamais substituées, et l'index existant continue de servir tel quel.
    sql: `
      ALTER TABLE doc_passages ADD COLUMN vecteur BLOB;
      ALTER TABLE doc_passages ADD COLUMN modele TEXT;
      CREATE INDEX idx_doc_passages_modele ON doc_passages(project_id, modele);
    `,
  },
  {
    id: 28,
    name: 'retirer-le-message-duplique-avec-la-raison-d-attente',
    siTable: 'cards',
    // LE MÊME AVERTISSEMENT NE S'AFFICHE PLUS DEUX FOIS SUR UNE CARTE.
    //
    // Une carte RETENUE (dépôt non consultable, travail hors copie, tour sans
    // issue…) recevait la MÊME phrase dans deux champs distincts :
    // `sansModification` (encadré orange en triangle) et
    // `scheduling.waitingReason` (pied de carte, icône horloge, texte tronqué).
    // La carte l'affichait donc deux fois, à moitié coupée en bas, et cette
    // phrase n'apparaît nulle part dans la conversation puisqu'elle décrit un
    // constat du serveur, pas une réponse de l'agent.
    //
    // Réparé à la source dans `carteApresFinDeTour` et
    // `rangerLesCartesOubliees` (`server/src/deplacement-carte.ts`) : une
    // raison RETENUE ne vit plus que dans `waitingReason`. Ici on nettoie les
    // cartes DÉJÀ posées en base avec le doublon, en ne touchant que celles où
    // les deux champs portent EXACTEMENT le même texte.
    //
    // ON RETIRE LE CHAMP (`json_remove`), on ne l'écrit pas à `null`
    // (`json_set(…, json('null'))`) : le modèle le déclare `z.string()
    // .optional()` (`shared/src/models.ts`), qui accepte l'ABSENCE et refuse
    // `null`. Un `null` posé ici faisait échouer `carteDepuisLigne` sur ces
    // cartes, donc `listCards` en entier — et avec elle TOUT le tableau, les
    // conversations et la boucle d'ordonnancement, qui n'affichaient plus que
    // des silhouettes. Règle générale : un champ optionnel se RETIRE.
    sql: `
      UPDATE cards
      SET data = json_remove(data, '$.sansModification')
      WHERE json_extract(data, '$.sansModification') IS NOT NULL
        AND json_extract(data, '$.scheduling.waitingReason') IS NOT NULL
        AND json_extract(data, '$.sansModification') = json_extract(data, '$.scheduling.waitingReason');
    `,
  },
  {
    id: 29,
    name: 'retirer-les-sansmodification-a-null',
    siTable: 'cards',
    // L'APPLICATION NE MONTRAIT PLUS QUE DES SILHOUETTES.
    //
    // La migration 28, dans sa première écriture, posait `json('null')` au lieu
    // de RETIRER le champ : quatre cartes se sont retrouvées avec un
    // `sansModification` à `null` là où le modèle attend une chaîne ou RIEN
    // (`z.string().optional()`, `shared/src/models.ts`). `carteDepuisLigne`
    // refusait donc ces lignes, et comme `listCards` lit ses cartes d'un seul
    // `map`, UNE carte invalide faisait tomber la liste ENTIÈRE : plus de
    // tableau, plus de tâches, plus de conversation, et la boucle
    // d'ordonnancement en échec toutes les quinze secondes.
    //
    // La 28 est réparée à la source, mais elle est DÉJÀ passée sur les bases
    // existantes et ne se rejouera pas. Celle-ci les rattrape. On vise le TYPE
    // JSON du champ, jamais `json_extract(…) IS NOT NULL` : sur un null JSON,
    // `json_extract` rend précisément SQL NULL, et le test manquerait sa cible.
    sql: `
      UPDATE cards
      SET data = json_remove(data, '$.sansModification')
      WHERE json_type(data, '$.sansModification') = 'null';
    `,
  },
  {
    id: 30,
    name: 'compteurs-des-competences',
    // L'USAGE RÉEL DU POOL DE COMPÉTENCES.
    //
    // Quatre compteurs par fiche, et rien d'autre : servie (partie dans le
    // contexte d'un agent), aidée / inutile (ce que l'agent en a dit), et
    // contredite (une carte a démenti ce qu'elle affirme). C'est de ces quatre
    // nombres que sort la confiance d'une fiche
    // (`shared/src/confiance-competence.ts`), donc le fait qu'elle soit servie,
    // reprise ou dépréciée.
    //
    // Ils vivent EN BASE, jamais dans le fichier : une fiche est un document que
    // l'utilisateur peut réécrire à la main, ses statistiques n'ont rien à y
    // faire — et un pool versionné n'a pas à changer à chaque lecture.
    sql: `
      CREATE TABLE IF NOT EXISTS competence_stats (
        nom TEXT PRIMARY KEY,
        servie INTEGER NOT NULL DEFAULT 0,
        aidee INTEGER NOT NULL DEFAULT 0,
        inutile INTEGER NOT NULL DEFAULT 0,
        contredite INTEGER NOT NULL DEFAULT 0,
        dernier_service INTEGER,
        maj_at INTEGER
      );
    `,
  },
  {
    id: 31,
    name: 'coffre-fort-des-identifiants',
    // UN SEUL ENDROIT POUR TOUS LES IDENTIFIANTS.
    //
    // Une fiche par accès : son nom, son type, le projet auquel elle est
    // rattachée (vide = Beluga Build lui-même) et ses champs, rangés en JSON parce
    // qu'ils DÉPENDENT du type — une clé d'API n'a pas de port, un accès SSH
    // n'a pas d'adresse web. Des colonnes fixes auraient obligé à toucher au
    // schéma à chaque nouveau type.
    //
    // Le projet est effacé, pas la fiche, quand un projet disparaît
    // (ON DELETE SET NULL) : l'accès reste retrouvable au lieu de s'évaporer
    // avec le projet qui l'utilisait.
    sql: `
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        nom TEXT NOT NULL,
        type TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        champs TEXT NOT NULL DEFAULT '{}',
        note TEXT NOT NULL DEFAULT '',
        cree_le INTEGER NOT NULL,
        modifie_le INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_secrets_projet ON secrets(project_id);
    `,
  },
  {
    id: 32,
    name: 'raccourci-taille-mtime-doc-fichiers',
    siTable: 'doc_fichiers',
    // NE PLUS RELIRE LES 770 FICHIERS À CHAQUE MESSAGE.
    //
    // `doc_fichiers` ne portait que l'empreinte du CONTENU — pour la connaître
    // il fallait donc lire le fichier en entier et le hacher, à chaque appel,
    // même quand rien n'a bougé. La taille et la date de modification du
    // fichier suffisent à savoir « rien n'a changé » sans le lire : un
    // `statSync` (quelques millisecondes pour tout le projet) remplace la
    // lecture + le SHA-1 (des dizaines de millisecondes).
    //
    // `version` retient le VERSION_INDEX appliqué à l'empreinte : un
    // changement de découpage doit forcer la relecture complète, le raccourci
    // par taille/date ne doit pas le court-circuiter.
    sql: `
      ALTER TABLE doc_fichiers ADD COLUMN taille INTEGER NOT NULL DEFAULT -1;
      ALTER TABLE doc_fichiers ADD COLUMN mtime INTEGER NOT NULL DEFAULT -1;
      ALTER TABLE doc_fichiers ADD COLUMN version TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    id: 33,
    name: 'retrait-de-la-recherche-par-le-sens',
    // LA MÉMOIRE EST UN ARBRE, PLUS UN INDEX DE RECHERCHE.
    //
    // Ces deux tables portaient les milliers de passages découpés dans la
    // documentation et le code de chaque projet, et leurs vecteurs de sens.
    // Plus rien ne les lit : la mémoire se navigue par les NOMS de ses fichiers
    // (`shared/src/arbre-memoire.ts`). Les laisser en place, c'est garder des
    // dizaines de mégaoctets qu'aucune requête ne rouvrira, et faire croire au
    // prochain lecteur qu'un index vit encore quelque part.
    //
    // Les migrations qui les ont créées restent dans cette liste : une base
    // déjà en service les a appliquées, et l'histoire d'un schéma ne se réécrit
    // pas. C'est celle-ci qui range derrière elles.
    sql: `
      DROP TABLE IF EXISTS doc_passages;
      DROP TABLE IF EXISTS doc_fichiers;
    `,
  },
  {
    id: 34,
    name: 'economie-du-tri-de-la-memoire',
    // CE QUE LE TRI DE LA MÉMOIRE ÉCONOMISE, CARTE PAR CARTE.
    //
    // Un sujet nommé sur une carte n'est plus servi au poids de son fichier
    // mais au poids de la demande (`shared/src/extrait-regles.ts`). L'économie
    // était ANNONCÉE — 95 % sur un sujet d'essai — jamais SUIVIE dans la vraie
    // vie : personne ne savait ce qu'elle valait sur un mois de travail réel.
    //
    // Une ligne par ouverture de mémoire, avec les deux poids MESURÉS : ce qui
    // serait parti sans le tri, ce qui est parti. Rien d'estimé, rien de
    // moyenné : la conversion en jetons puis en part de quota se fait à la
    // lecture, à partir de ces signes-là.
    //
    // `card_id` peut être vide : une conversation interroge la mémoire elle
    // aussi, et sa ligne compte dans le total sans se rattacher à une carte.
    sql: `
      CREATE TABLE IF NOT EXISTS memoire_economie (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT,
        card_id TEXT,
        agent_id TEXT,
        signes_entiers INTEGER NOT NULL,
        signes_servis INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memoire_economie_date ON memoire_economie(created_at);
      CREATE INDEX IF NOT EXISTS idx_memoire_economie_carte ON memoire_economie(card_id);
    `,
  },
  {
    id: 35,
    name: 'index-signal-attention',
    // LE SIGNAL D'ATTENTION NE RELIT PLUS TOUTE LA TABLE.
    //
    // `decisionsEnAttente()` et `pendingQuestions()` filtraient avec
    // `data LIKE '%"questions":[{%'` : un LIKE ouvert par `%` ignore tout index
    // et force SQLite à lire la colonne `data` de CHAQUE message. Mesuré sur
    // 5 339 messages (90 Mo de `data`) : 105 à 124 ms par appel, pour 118 lignes
    // retenues — et ce filtre est rejoué à chaque ouverture de canal.
    //
    // `a_questions` porte le même verdict qu'avant (`data` contient
    // `"questions":[{`), posé une fois pour toutes par ce backfill puis tenu à
    // jour par les écritures de `store.ts`. L'index partiel ne porte que sur
    // les lignes à 1 : la table reste presque entièrement `a_questions = 0`.
    sql: `
      ALTER TABLE messages ADD COLUMN a_questions INTEGER NOT NULL DEFAULT 0;
      UPDATE messages SET a_questions = 1 WHERE data LIKE '%"questions":[{%';
      CREATE INDEX idx_messages_a_questions ON messages(a_questions) WHERE a_questions = 1;
    `,
  },
  {
    id: 36,
    name: 'telemetrie-des-taches',
    // LA TÉLÉMÉTRIE COMPLÈTE D'UNE TÂCHE, EN DEUX TABLES.
    //
    // Trois grandeurs vivaient chacune dans son coin — les jetons dans `usage`,
    // le tri de la mémoire dans `memoire_economie`, la durée dans la carte — et
    // aucune ne se lisait à côté des autres. Personne ne pouvait donc répondre à
    // « pourquoi cette tâche a-t-elle pris cinquante minutes ? ».
    //
    // `memoire_consultation` : UNE LIGNE PAR OUVERTURE de `project_memory`,
    // TOUTES les ouvertures, y compris celles où le tri n'a rien changé —
    // c'est justement le rendement du tri qu'on veut suivre. Elle ne remplace
    // pas `memoire_economie`, qui garde son mois d'historique et ses règles à
    // elle : ajouter ici des lignes à économie nulle aurait changé sous les
    // yeux du lecteur des pourcentages déjà affichés.
    //
    // `telemetrie_tache` : UNE LIGNE PAR TOUR TERMINÉ d'un agent de tâche. Une
    // carte reprise trois fois porte trois lignes, que la lecture additionne :
    // c'est la seule façon d'avoir la mesure du travail RÉEL et non celle du
    // dernier tour.
    //
    // AUCUN CONTENU N'ENTRE ICI : des nombres, un identifiant, et les NOMS des
    // sujets de mémoire ouverts. Jamais un texte de fait, jamais une demande.
    sql: `
      CREATE TABLE IF NOT EXISTS memoire_consultation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT,
        card_id TEXT,
        agent_id TEXT,
        sujet TEXT NOT NULL,
        duree_ms INTEGER NOT NULL,
        blocs_demandes INTEGER NOT NULL,
        blocs_rendus INTEGER NOT NULL,
        signes_entiers INTEGER NOT NULL,
        signes_servis INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memoire_consultation_agent ON memoire_consultation(agent_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_memoire_consultation_carte ON memoire_consultation(card_id);

      CREATE TABLE IF NOT EXISTS telemetrie_tache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id TEXT NOT NULL,
        project_id TEXT,
        agent_id TEXT,
        issue TEXT NOT NULL,
        tours INTEGER NOT NULL DEFAULT 0,
        tokens_entree INTEGER NOT NULL DEFAULT 0,
        tokens_cache INTEGER NOT NULL DEFAULT 0,
        tokens_sortie INTEGER NOT NULL DEFAULT 0,
        secondes REAL NOT NULL DEFAULT 0,
        memoire_ouvertures INTEGER NOT NULL DEFAULT 0,
        memoire_ms INTEGER NOT NULL DEFAULT 0,
        memoire_sujets TEXT,
        memoire_demandes INTEGER NOT NULL DEFAULT 0,
        memoire_rendus INTEGER NOT NULL DEFAULT 0,
        memoire_signes_entiers INTEGER NOT NULL DEFAULT 0,
        memoire_signes_servis INTEGER NOT NULL DEFAULT 0,
        note INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_telemetrie_date ON telemetrie_tache(created_at);
      CREATE INDEX IF NOT EXISTS idx_telemetrie_carte ON telemetrie_tache(card_id);
    `,
  },
  {
    id: 37,
    name: 'retrait-de-la-colonne-en-production',
    // Comme toute migration de RÉPARATION, elle nomme la table qu'elle attend :
    // une base montée pour un contrôle ciblé n'a pas forcément `cards`, et la
    // migration doit se REPORTER plutôt que d'échouer.
    siTable: 'cards',
    // LA COLONNE « EN PRODUCTION » N'EXISTE PLUS.
    //
    // Elle racontait la production par ses CARTES : celles qui avaient été
    // déployées s'y empilaient, et il fallait les lire une à une pour deviner
    // ce qui tournait chez le client. Ce n'était pas la bonne question — ce
    // qu'on veut savoir, c'est QUELLE version est en ligne et de combien le
    // dépôt l'a dépassée (`shared/src/etat-production.ts`).
    //
    // Le DÉPLOIEMENT range désormais ses cartes directement en « Archivé », et
    // c'est lui qui les clôt. Les cartes qui dormaient dans l'ancienne colonne
    // doivent être reprises AVANT toute lecture : leur clé n'est plus reconnue
    // par le modèle, et la carte ne se relirait pas.
    //
    // Elles gardent leur position d'origine : l'ordre relatif à l'intérieur du
    // paquet est conservé, et les cartes déjà archivées ne bougent pas. Rien
    // n'est perdu — ni la date de mise en ligne, ni le rattachement à la
    // publication qui les a embarquées, qui vit dans `deploys`, pas ici.
    sql: `
      UPDATE cards SET column_key = 'archived' WHERE column_key = 'in_production';
    `,
  },
  {
    id: 38,
    name: 'commentaires-de-carte',
    // DES NOTES LIBRES SUR UNE CARTE, chacune avec ses pièces jointes. Une
    // ligne par commentaire, jamais réécrite : contrairement à `card_labels` et
    // `card_attachments` (des listes plates, remplacées en bloc à chaque
    // enregistrement de la carte), un commentaire s'ajoute et se retire seul,
    // sans toucher aux autres — le bloc `data` porte donc son texte et les
    // identifiants des pièces jointes déjà déposées dans la table `attachments`
    // existante (même mécanisme de téléversement et de téléchargement que les
    // conversations, pas de second stockage de fichiers).
    sql: `
      CREATE TABLE card_comments (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_card_comments_card ON card_comments(card_id, created_at);
    `,
  },
  {
    id: 39,
    name: 'backups-des-sites',
    // LES BACKUPS DES SITES EN PRODUCTION. Deux tables : les SITES à
    // sauvegarder (un projet de ce serveur ou un site extérieur, avec ses accès
    // base et fichiers) et les POINTS de sauvegarde déjà pris (un par passage,
    // avec son poids et son issue). Le bloc `data` porte la fiche entière — les
    // accès d'un site changent de forme selon son moteur, une colonne par champ
    // se paierait d'une migration à chaque nouveau type. Les colonnes sorties du
    // bloc sont celles qu'on TRIE ou qu'on FILTRE : jamais deux vérités, elles
    // sont réécrites depuis le bloc à chaque enregistrement.
    //
    // RÉÉCRITE POUR UNE BASE NEUVE. Une base d'avant le 10.09.2026 a déjà ces
    // deux tables sous leur ancien nom : `passerLaBaseAuxBackups`
    // (`passage-backups.ts`), joué AVANT les migrations, les renomme et inscrit
    // ce nom-ci au registre — cette migration ne se rejoue donc pas sur elle.
    sql: `
      CREATE TABLE backup_sites (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        nom TEXT NOT NULL,
        actif INTEGER NOT NULL DEFAULT 1,
        data TEXT NOT NULL,
        cree_le INTEGER NOT NULL,
        modifie_le INTEGER NOT NULL
      );
      CREATE TABLE backup_points (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL REFERENCES backup_sites(id) ON DELETE CASCADE,
        debut INTEGER NOT NULL,
        statut TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX idx_backup_points_site ON backup_points(site_id, debut DESC);
    `,
  },
  {
    id: 40,
    name: 'sites-surveilles',
    // LA SURVEILLANCE DES SITES : une ligne par adresse, et son ÉTAT ACTUEL,
    // rien de plus. Pas de table de mesures : la carte le dit en toutes lettres,
    // on ne garde ni journal ni historique de disponibilité — seulement de quoi
    // répondre à « est-ce debout, maintenant ? » et allumer la pastille du menu.
    // Les règles (ce qui fait une panne, ce qui bascule) vivent dans
    // `shared/src/surveillance.ts`.
    sql: `
      CREATE TABLE sites_surveilles (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        nom TEXT NOT NULL,
        etat TEXT NOT NULL DEFAULT 'inconnu',
        code INTEGER,
        raison TEXT,
        verifie_le INTEGER NOT NULL DEFAULT 0,
        depuis INTEGER NOT NULL DEFAULT 0,
        derniere_panne INTEGER NOT NULL DEFAULT 0,
        cree_le INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX idx_sites_surveilles_url ON sites_surveilles(url);
    `,
  },
  {
    id: 41,
    name: 'role-chef-d-orchestre-devenu-cadrage',
    siTable: 'agents',
    // LE CHEF D'ORCHESTRE EST PARTI, SES AGENTS SONT RESTÉS.
    //
    // Le rôle « orchestrator » a été retiré du code et de `AgentRole` avec le
    // chef d'orchestre, mais RIEN n'a réparé les lignes déjà écrites. Or
    // `listAgents()` relit chaque ligne au travers du modèle : une seule ligne
    // portant l'ancien rôle faisait donc JETER la lecture ENTIÈRE — et avec
    // elle « arrêter tous les agents », qui commence par cette liste. Un rôle
    // disparu du code n'est pas un détail d'archive : il coupe une commande
    // vivante.
    //
    // Le successeur du chef est l'agent de CADRAGE : c'est lui qui reprend la
    // demande libre et propose une carte. On y range donc ces tours anciens,
    // dans la colonne `role` ET dans le JSON relu par le modèle — les deux, ou
    // la lecture retomberait sur l'ancienne valeur. Le rôle de cadrage ne
    // déplace aucune carte : rien ne bouge sur le tableau.
    sql: `
      UPDATE agents
      SET role = 'cadrage',
          data = json_set(data, '$.role', 'cadrage')
      WHERE role = 'orchestrator'
         OR json_extract(data, '$.role') = 'orchestrator';
    `,
  },
  {
    id: 42,
    name: 'fusion-colonne-terminee-dans-a-deployer',
    siTable: 'cards',
    // LA COLONNE « TERMINÉ » N'EXISTE PLUS.
    //
    // Une carte dont l'agent a rendu tombait en « Terminé », en attendant un
    // geste de lot (« Tout déployer ») pour rejoindre « À déployer ». Cette
    // étape n'ajoutait rien : le travail rendu EST du travail à déployer, la
    // fusion des deux colonnes le dit directement (`shared/src/columns.ts`,
    // `shared/src/suivi-colonne.ts`). Les cartes qui dormaient dans l'ancienne
    // colonne sont reprises ici, même mécanique que la migration 37 pour
    // « en production » : la clé n'est plus reconnue par le modèle, la carte
    // ne se relirait pas sans ce rattrapage. Position et historique inchangés.
    sql: `
      UPDATE cards SET column_key = 'to_deploy' WHERE column_key = 'done';
    `,
  },
  {
    id: 43,
    name: 'nettoyer-carte-tache-oubliee-e165f7a1',
    siTable: ['cards', 'card_comments', 'card_attachments', 'card_labels', 'queue', 'messages', 'agents'],
    // CARTE DE TÂCHE OUBLIÉE, PERDUE DANS L'INTERFACE.
    //
    // Une carte de décision attendue (colonne « Planifié ») qui n'a jamais reçu
    // de réponse et n'a pas sa place en production. Suppression complète : la
    // carte elle-même ET tout ce qui s'y rattache (commentaires, pièces jointes,
    // étiquettes, agents qui travaillaient dessus, leurs messages en queue).
    //
    // À noter : le script `scripts/nettoyer-carte.mjs` peut faire le même travail
    // manuellement, mais cette migration l'exécute automatiquement au redémarrage.
    sql: `
      DELETE FROM card_comments WHERE card_id = 'e165f7a1-69f3-4fc2-b3bb-5ab4178cd71c';
      DELETE FROM card_attachments WHERE card_id = 'e165f7a1-69f3-4fc2-b3bb-5ab4178cd71c';
      DELETE FROM card_labels WHERE card_id = 'e165f7a1-69f3-4fc2-b3bb-5ab4178cd71c';
      DELETE FROM queue WHERE agent_id IN (
        SELECT id FROM agents WHERE card_id = 'e165f7a1-69f3-4fc2-b3bb-5ab4178cd71c'
      );
      DELETE FROM messages WHERE agent_id IN (
        SELECT id FROM agents WHERE card_id = 'e165f7a1-69f3-4fc2-b3bb-5ab4178cd71c'
      );
      DELETE FROM agents WHERE card_id = 'e165f7a1-69f3-4fc2-b3bb-5ab4178cd71c';
      DELETE FROM cards WHERE id = 'e165f7a1-69f3-4fc2-b3bb-5ab4178cd71c';
    `,
  },
  {
    id: 44,
    name: 'table-des-notes',
    // LES NOTES DEVIENNENT UN OBJET À ELLES.
    //
    // Une note était une CARTE rangée en colonne « Notes » : tout l'attirail
    // d'une tâche (agent, moteur, chiffrage, branche, position) pour ne jamais
    // s'en servir, et rien de ce qu'on attend d'une note — échéance,
    // importance, recherche, vue à travers les projets. Les règles vivent dans
    // `shared/src/notes.ts`, le travail dans `server/src/notes.ts`.
    sql: `
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        titre TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        echeance INTEGER,
        importance TEXT NOT NULL DEFAULT 'aucune',
        pieces_jointes TEXT NOT NULL DEFAULT '[]',
        cree_le INTEGER NOT NULL,
        modifie_le INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_projet ON notes(project_id, modifie_le);
    `,
  },
  {
    id: 45,
    name: 'reprise-des-notes-de-la-colonne',
    siTable: ['cards', 'notes', 'card_attachments', 'card_labels', 'card_comments'],
    // LA COLONNE « NOTES » DU TABLEAU N'EXISTE PLUS (`shared/src/columns.ts`).
    //
    // Ses cartes rejoignent la table `notes` : le titre et la description
    // restent, les dates aussi, les pièces jointes sont recopiées telles
    // quelles (`card_attachments` garde des IDENTIFIANTS de pièces jointes dans
    // sa colonne `path`). Ce qu'une carte ne portait pas prend son défaut :
    // échéance absente, importance « aucune ». Le projet est celui de la carte
    // — il n'y a rien à deviner.
    //
    // Les cartes reprises sont ENSUITE supprimées, elles et ce qui s'y
    // accroche : leur clé de colonne n'est plus reconnue par le modèle, elles
    // ne se reliraient pas et resteraient invisibles à tout jamais.
    sql: `
      INSERT INTO notes (id, project_id, titre, description, echeance, importance, pieces_jointes, cree_le, modifie_le)
      SELECT
        c.id,
        c.project_id,
        c.title,
        COALESCE(json_extract(c.data, '$.description'), ''),
        NULL,
        'aucune',
        COALESCE(
          (SELECT json_group_array(a.path) FROM card_attachments a WHERE a.card_id = c.id),
          '[]'
        ),
        c.created_at,
        c.updated_at
      FROM cards c
      WHERE c.column_key = 'notes'
        AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.id = c.id);

      DELETE FROM card_comments WHERE card_id IN (SELECT id FROM cards WHERE column_key = 'notes');
      DELETE FROM card_attachments WHERE card_id IN (SELECT id FROM cards WHERE column_key = 'notes');
      DELETE FROM card_labels WHERE card_id IN (SELECT id FROM cards WHERE column_key = 'notes');
      DELETE FROM cards WHERE column_key = 'notes';
    `,
  },
  {
    id: 46,
    name: 'journal-de-carte',
    // LE JOURNAL PERMANENT D'UNE CARTE — UNE LIGNE PAR ÉVÉNEMENT DE SA VIE.
    //
    // Ce qu'un agent avait réellement fait ne se lisait qu'en morceaux, et
    // chaque morceau mourait avec son tour : les étapes et la liste de tâches
    // sur UN message, les ouvertures de mémoire sur UNE photographie de
    // contexte, et le cadrage — porté par un AUTRE agent que l'exécution —
    // relié à rien. Cette table accumule TOUT, sur toute la vie de la carte :
    // les requêtes (outil, paramètres, texte exact rendu, durée), les points de
    // travail et les jalons, chacun avec sa PHASE (cadrage, recadrage,
    // exécution, rapport).
    //
    // Elle n'est jamais mise à jour ni réordonnée : on n'AJOUTE qu'à la fin, et
    // le RANG fait l'ordre — deux entrées de la même milliseconde resteraient
    // sinon interchangeables. Les règles vivent dans
    // `shared/src/journal-carte.ts`, le travail dans `server/src/journal-carte.ts`.
    sql: `
      CREATE TABLE IF NOT EXISTS card_journal (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        rang INTEGER NOT NULL,
        phase TEXT NOT NULL,
        nature TEXT NOT NULL,
        at INTEGER NOT NULL,
        agent_id TEXT,
        agent_role TEXT,
        tour_id TEXT,
        libelle TEXT NOT NULL DEFAULT '',
        outil TEXT,
        params TEXT,
        resultat TEXT,
        reussie INTEGER,
        duree_ms INTEGER,
        etat TEXT,
        donnees TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_card_journal_carte ON card_journal(card_id, rang);
      CREATE INDEX IF NOT EXISTS idx_card_journal_date ON card_journal(at);
    `,
  },
  {
    id: 47,
    name: 'carnet-de-memoire',
    // LE CARNET DE MÉMOIRE D'UNE CARTE — UNE LIGNE PAR MORCEAU SERVI, AVEC SON ÉTAPE.
    //
    // Ce qui avait été servi à un agent ne vivait que dans une clé de méta PAR
    // AGENT, effacée à chaque session neuve : impossible de dire, après coup,
    // ce que la carte avait ouvert pendant sa compréhension ou son travail.
    // Cette table le garde pour toute la vie de la carte : la clé du morceau,
    // son sujet, sa branche, sa portée, son poids, l'ÉTAPE du parcours et le
    // tour. `project_memory` la lit avant de répondre (un morceau encore en
    // contexte est rappelé avec son étape, jamais renvoyé) et chaque point du
    // flux y lit ce que la mémoire lui a apporté. Les règles vivent dans
    // `shared/src/carnet-memoire.ts`.
    sql: `
      CREATE TABLE IF NOT EXISTS memoire_carnet (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        agent_id TEXT,
        etape TEXT NOT NULL,
        tour_id TEXT,
        cle TEXT NOT NULL,
        genre TEXT NOT NULL DEFAULT '',
        sujet TEXT NOT NULL DEFAULT '',
        branche TEXT,
        portee TEXT NOT NULL DEFAULT 'projet',
        poids INTEGER NOT NULL DEFAULT 0,
        at INTEGER NOT NULL,
        en_contexte INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_memoire_carnet_carte ON memoire_carnet(card_id, at);
      CREATE INDEX IF NOT EXISTS idx_memoire_carnet_agent ON memoire_carnet(agent_id);
    `,
  },
  {
    id: 48,
    name: 'purger-les-fiches-de-backup-d-essai',
    siTable: ['backup_sites', 'backup_points', 'agents', 'messages', 'queue', 'proposals'],
    // LES FICHES DE SAUVEGARDE NÉES D'UN ESSAI, ET LEUR LONGUE TRAÎNE.
    //
    // Vingt-quatre fiches « Boutique » / « Boutique hors ligne » dormaient dans
    // la base servie, créées entre le 01/09/2026 et le 06/09/2026 par un essai
    // qui n'était pas isolé de la base réelle. Elles pointaient toutes un
    // dossier temporaire (`/tmp/site-a-sauvegarder-…`) disparu depuis : le
    // passage de nuit les sauvegardait donc en boucle, échouait, et convoquait
    // au bout de trois échecs un assistant de relecture — un agent, une
    // conversation, et une question posée à l'utilisateur sur une fiche qui
    // n'aurait jamais dû exister. D'où les décisions attendues qui ne menaient
    // nulle part.
    //
    // Le CRITÈRE est le chemin temporaire, jamais le nom : une vraie fiche
    // nommée « Boutique » resterait donc en place. Un dossier `/tmp` n'est pas
    // un site à sauvegarder, sur aucune machine.
    //
    // On supprime dans l'ordre des dépendances — points, puis file, messages,
    // propositions et agents des assistants, puis les fiches — et jamais sur la
    // foi du `ON DELETE CASCADE` : les clés étrangères ne mordent que si
    // `PRAGMA foreign_keys` est actif dans la connexion qui écrit.
    //
    // Le même travail se refait à la demande, fiche par fiche, avec
    // `node scripts/nettoyer-fiches-backup.mjs`. La porte d'entrée, elle, est
    // fermée par `scripts/verif-tests-isoles.mjs`.
    // La sélection est répétée à chaque ordre plutôt que gardée dans une table
    // temporaire : le contrôle `migrations-tables-declarees` lit les tables
    // touchées par une migration, et une table de travail y passerait pour une
    // table du schéma jamais déclarée.
    sql: `
      DELETE FROM backup_points WHERE site_id IN (
        SELECT id FROM backup_sites WHERE data LIKE '%/tmp/site-a-sauvegarder-%'
      );

      DELETE FROM proposals WHERE message_id IN (
        SELECT id FROM messages WHERE agent_id IN (
          SELECT json_extract(data, '$.assistantId') FROM backup_sites
          WHERE data LIKE '%/tmp/site-a-sauvegarder-%'
        )
      );
      DELETE FROM queue WHERE agent_id IN (
        SELECT json_extract(data, '$.assistantId') FROM backup_sites
        WHERE data LIKE '%/tmp/site-a-sauvegarder-%'
      );
      DELETE FROM messages WHERE agent_id IN (
        SELECT json_extract(data, '$.assistantId') FROM backup_sites
        WHERE data LIKE '%/tmp/site-a-sauvegarder-%'
      );
      DELETE FROM agents WHERE id IN (
        SELECT json_extract(data, '$.assistantId') FROM backup_sites
        WHERE data LIKE '%/tmp/site-a-sauvegarder-%'
      );

      DELETE FROM backup_sites WHERE data LIKE '%/tmp/site-a-sauvegarder-%';
    `,
  },
  {
    id: 49,
    name: 'index-message-en-ecriture',
    siTable: 'messages',
    // LA VEILLE DES TOURS BLOQUÉS NE RELIT PLUS TOUS LES MESSAGES POUR EN
    // TROUVER UN SEUL.
    //
    // `eteindreEcritureOrpheline` doit repérer, à chaque passage de quinze
    // secondes, un message resté marqué « en cours d'écriture » sur un agent
    // déjà au repos. Sans colonne dédiée, la seule façon de le savoir était de
    // parcourir `data` en JSON — mesuré à 305 ms sur 8 366 messages, PIRE que
    // la lecture intégrale de la table `agents` que cette même carte retire
    // par ailleurs. Même recette que `a_questions` (migration 35) : une
    // colonne réelle, backfillée une fois, tenue à jour par `saveMessage`, et
    // un index PARTIEL qui ne porte que sur les lignes à 1 — en pratique
    // aucune ou une poignée, jamais la table entière.
    sql: `
      ALTER TABLE messages ADD COLUMN streaming INTEGER NOT NULL DEFAULT 0;
      UPDATE messages SET streaming = 1 WHERE data LIKE '%"streaming":true%';
      CREATE INDEX idx_messages_streaming ON messages(streaming) WHERE streaming = 1;
    `,
  },
  {
    id: 50,
    name: 'retirer-le-journal-des-envois-au-cerveau',
    // L'envoi nocturne de la mémoire vers le cerveau n'existe plus : ni
    // planification, ni clé, ni commandes de protocole. Son journal n'a donc
    // plus personne pour l'écrire ni pour le lire, et une table qui dort est
    // une table qu'on croira un jour utile. `IF EXISTS` parce qu'une base
    // neuve n'a jamais eu la migration 9 sous cette forme.
    sql: `
      DROP INDEX IF EXISTS idx_cerveau_log;
      DROP TABLE IF EXISTS cerveau_log;
    `,
  },
  {
    id: 51,
    name: 'comptes-avec-role-et-portee',
    siTable: ['meta', 'sessions'],
    // BELUGA CESSE D'ÊTRE UNE APPLICATION À UN SEUL UTILISATEUR.
    //
    // L'accès reposait sur un secret UNIQUE rangé dans `meta` (`auth.user`,
    // `auth.salt`, `auth.hash`) : tout ce qui passait la porte voyait tout. Il
    // y a désormais de vrais comptes, chacun avec son rôle et — pour un client —
    // la liste des projets qu'il a le droit de voir.
    //
    // Le compte existant est REPORTÉ tel quel comme premier administrateur :
    // même identifiant, même sel, même empreinte. Rien à retaper, et les
    // sessions déjà ouvertes survivent — leur `user_id` est renseigné dans la
    // foulée, puisqu'à cet instant il n'existe qu'un seul compte.
    //
    // `meta` n'est PAS vidé : l'ancien chemin reste lu en secours le temps
    // d'une version, au cas où cette migration devrait être défaite.
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        identifiant TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        nom_affiche TEXT NOT NULL DEFAULT '',
        salt TEXT NOT NULL,
        hash TEXT NOT NULL,
        actif INTEGER NOT NULL DEFAULT 1,
        cree_le INTEGER NOT NULL,
        derniere_entree INTEGER
      );
      CREATE INDEX idx_users_role ON users(role, actif);

      CREATE TABLE user_projects (
        user_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        PRIMARY KEY (user_id, project_id)
      );

      ALTER TABLE sessions ADD COLUMN user_id TEXT;

      INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le)
      SELECT
        'admin-premier',
        (SELECT value FROM meta WHERE key = 'auth.user'),
        'admin',
        'Haiko',
        (SELECT value FROM meta WHERE key = 'auth.salt'),
        (SELECT value FROM meta WHERE key = 'auth.hash'),
        1,
        strftime('%s','now') * 1000
      WHERE (SELECT value FROM meta WHERE key = 'auth.user') IS NOT NULL;

      UPDATE sessions SET user_id = 'admin-premier'
      WHERE user_id IS NULL
        AND EXISTS (SELECT 1 FROM users WHERE id = 'admin-premier');
    `,
  },
  {
    id: 52,
    name: 'demandes-des-clients',
    // LES DEMANDES DES CLIENTS SONT UN SECOND DOMAINE, À CÔTÉ DES CARTES.
    //
    // Une demande n'est pas une carte : ni agent, ni moteur, ni branche, ni
    // colonne du tableau. Elle peut être TRANSFORMÉE en carte — `carte_id`
    // garde alors le lien — mais elle vit sans.
    //
    // Comme ailleurs dans cette base, les colonnes SORTIES du bloc `data` sont
    // celles qu'on trie ou qu'on filtre : projet, colonne, rang, dates. Le
    // reste (importance, pièces jointes) voyage en JSON.
    sql: `
      CREATE TABLE demandes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        auteur_id TEXT NOT NULL,
        colonne TEXT NOT NULL,
        rang REAL NOT NULL,
        titre TEXT NOT NULL,
        carte_id TEXT,
        data TEXT NOT NULL,
        creee_le INTEGER NOT NULL,
        derniere_activite INTEGER NOT NULL
      );
      CREATE INDEX idx_demandes_projet ON demandes(project_id, colonne, rang);
      CREATE INDEX idx_demandes_auteur ON demandes(auteur_id, derniere_activite);

      CREATE TABLE demande_messages (
        id TEXT PRIMARY KEY,
        demande_id TEXT NOT NULL,
        auteur_id TEXT NOT NULL,
        data TEXT NOT NULL,
        cree_le INTEGER NOT NULL
      );
      CREATE INDEX idx_demande_messages ON demande_messages(demande_id, cree_le);

      CREATE TABLE demande_fichiers (
        attachment_id TEXT NOT NULL,
        demande_id TEXT NOT NULL,
        message_id TEXT,
        genre TEXT NOT NULL,
        cree_le INTEGER NOT NULL,
        PRIMARY KEY (attachment_id, demande_id)
      );
      CREATE INDEX idx_demande_fichiers ON demande_fichiers(demande_id, cree_le);

      CREATE TABLE fil_messages (
        id TEXT PRIMARY KEY,
        fil_id TEXT NOT NULL,
        auteur_id TEXT NOT NULL,
        data TEXT NOT NULL,
        cree_le INTEGER NOT NULL,
        lu_le INTEGER
      );
      CREATE INDEX idx_fil_messages ON fil_messages(fil_id, cree_le);
    `,
  },
  {
    id: 53,
    name: 'demandes-echeance-activite-lectures',
    /*
     * GARDÉE PAR LES TROIS TABLES QU'ELLE TOUCHE. Sans ce garde, elle partirait
     * sur une base partielle (celle d'un essai qui rejoue les migrations depuis
     * un état ancien) et tomberait sur « no such table » — et l'échec
     * emporterait l'ouverture de la base, donc des contrôles sans rapport.
     */
    siTable: ['demandes', 'push_subs', 'users'],
    // DEUX COLONNES RÉELLES, ET PAS UNE DE PLUS.
    //
    // `echeance` et `archivee_le` SORTENT du bloc `data` parce que ce sont les
    // seules sur lesquelles on trie et on filtre en SQL. Le type, les
    // étiquettes, les cases à cocher et la livraison annoncée restent dans le
    // bloc : sans cette discipline, chaque idée neuve coûterait une migration.
    //
    // `demande_activite` est la SOURCE UNIQUE de trois choses : l'historique du
    // tiroir, le compteur de non-lus et les courriels du matin.
    //
    // `demande_lectures` dit jusqu'où CHAQUE compte a lu CHAQUE demande : le
    // même chiffre de non-lus ne peut pas servir à Haiko et au client.
    //
    // `push_subs.user_id` : sans propriétaire, une alerte destinée à un client
    // partait aussi sur le téléphone de Haiko. Les abonnements déjà en base
    // n'ont pas de propriétaire connu — ils sont RETIRÉS plutôt que rattachés
    // au hasard : le navigateur en redemande un au prochain passage, et rien
    // ne part entre-temps à la mauvaise personne.
    sql: `
      ALTER TABLE demandes ADD COLUMN echeance INTEGER;
      ALTER TABLE demandes ADD COLUMN archivee_le INTEGER;
      CREATE INDEX idx_demandes_echeance ON demandes(project_id, echeance);
      CREATE INDEX idx_demandes_archivees ON demandes(project_id, archivee_le);

      CREATE TABLE demande_activite (
        id TEXT PRIMARY KEY,
        demande_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        auteur_id TEXT NOT NULL,
        genre TEXT NOT NULL,
        data TEXT NOT NULL,
        cree_le INTEGER NOT NULL
      );
      CREATE INDEX idx_demande_activite ON demande_activite(demande_id, cree_le);
      CREATE INDEX idx_demande_activite_projet ON demande_activite(project_id, cree_le);

      CREATE TABLE demande_lectures (
        demande_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        lu_jusqu_a INTEGER NOT NULL,
        PRIMARY KEY (demande_id, user_id)
      );

      DELETE FROM push_subs;
      ALTER TABLE push_subs ADD COLUMN user_id TEXT;
      CREATE INDEX idx_push_subs_user ON push_subs(user_id);

      ALTER TABLE users ADD COLUMN courriel TEXT;
    `,
  },
  {
    id: 54,
    name: 'vitrine-liee-et-depot-sans-donnees-sensibles',
    siTable: 'projects',
    /*
     * DEUX RÉGLAGES POSÉS UNE FOIS, SUR LES PROJETS QUI EXISTENT DÉJÀ. Le code ne
     * lit que les réglages (`depotSansDonneesSensibles`, `vitrineLiee`) ; cette
     * migration se contente de les allumer là où le montage existe sur la
     * machine, reconnu à l'adresse des dépôts. Une base où ces dépôts ne sont
     * pas inscrits (base d'essai, autre machine) ne voit rien changer, et un
     * réglage déjà posé n'est jamais écrasé.
     */
    sql: `
      UPDATE projects
         SET data = json_set(data, '$.depotSansDonneesSensibles', json('true'))
       WHERE json_extract(data, '$.gitRemote') = 'git@github.com:haikostudio/belugabuild.git'
         AND json_extract(data, '$.depotSansDonneesSensibles') IS NULL;

      UPDATE projects
         SET data = json_set(data, '$.vitrineLiee', json_object(
               'site', (SELECT s.path FROM projects s WHERE json_extract(s.data, '$.gitRemote') = 'git@github.com:haikostudio/belugabuild.git' LIMIT 1),
               'constructeur', (SELECT c.path FROM projects c WHERE json_extract(c.data, '$.gitRemote') = 'git@github.com:haikostudio/beluga-vitrine.git' LIMIT 1),
               'adresseEssai', 'https://belugabuild.haikostudio.cloud',
               'adresseProduction', 'https://belugabuild.com',
               'dossierProduction', '/srv/belugabuild',
               'serviceProduction', 'belugabuild-prod'))
       WHERE json_extract(data, '$.gitRemote') = 'git@github.com:haikostudio/beluga.git'
         AND json_extract(data, '$.vitrineLiee') IS NULL
         AND EXISTS (SELECT 1 FROM projects s WHERE json_extract(s.data, '$.gitRemote') = 'git@github.com:haikostudio/belugabuild.git')
         AND EXISTS (SELECT 1 FROM projects c WHERE json_extract(c.data, '$.gitRemote') = 'git@github.com:haikostudio/beluga-vitrine.git');
    `,
  },
  {
    id: 55,
    name: 'demandes-sans-type',
    siTable: 'demandes',
    /*
     * LE TYPE D'UNE DEMANDE A DISPARU DU CODE (anomalie, évolution…). Il ne
     * vivait que dans le bloc JSON : aucune colonne à retirer. Le modèle
     * ignorerait la clé, mais une donnée que plus rien n'affiche ni ne filtre
     * n'a pas à rester en base — on l'efface pour de bon.
     */
    sql: `
      UPDATE demandes
         SET data = json_remove(data, '$.type')
       WHERE json_extract(data, '$.type') IS NOT NULL;
    `,
  },
  {
    id: 56,
    name: 'recette-des-backups',
    siTable: ['backup_sites', 'backup_points'],
    /*
     * UN BACKUP REJOUE UNE RECETTE, ET SON ARCHIVE SE JUGE. La fiche d'un site
     * porte désormais la RECETTE écrite par l'agent d'analyse (d'où prendre le
     * code, comment extraire chaque base, comment tout remettre), la date où
     * un essai l'a validée et l'agent qui l'a écrite. Chaque point porte le
     * chemin de son archive zip, sa taille et l'INVENTAIRE lu dans l'archive
     * même — c'est lui qui a décidé « réussi ». Ajout pur : les points d'avant
     * restent lisibles, sans archive, et l'écran les dit « ancien format ».
     */
    sql: `
      ALTER TABLE backup_sites ADD COLUMN recette TEXT;
      ALTER TABLE backup_sites ADD COLUMN recette_validee_le INTEGER;
      ALTER TABLE backup_sites ADD COLUMN recette_agent_id TEXT;
      ALTER TABLE backup_points ADD COLUMN chemin_archive TEXT;
      ALTER TABLE backup_points ADD COLUMN taille INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE backup_points ADD COLUMN inventaire TEXT;
    `,
  },
  {
    id: 57,
    name: 'espace-acces-et-journal-des-ouvertures',
    /*
     * L'ESPACE « ACCÈS » D'UN PROJET, ET LE JOURNAL DE SES OUVERTURES.
     *
     * `espace_acces` garde le contenu libre écrit par Haiko, une ligne par
     * projet. `espace_acces_journal` garde chaque ouverture et chaque
     * refermeture : qui, quand, sur quelle version du texte de responsabilité.
     * Le journal n'est JAMAIS réécrit — seulement complété — et l'état ouvert
     * ou fermé s'y LIT (`etatDeLAcces`) : aucun drapeau à tenir en double.
     * Ajout pur : aucune table existante n'est touchée.
     */
    sql: `
      CREATE TABLE IF NOT EXISTS espace_acces (
        project_id TEXT PRIMARY KEY,
        texte TEXT NOT NULL DEFAULT '',
        modifie_le INTEGER NOT NULL,
        modifie_par TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS espace_acces_journal (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        geste TEXT NOT NULL,
        compte_id TEXT NOT NULL,
        nom TEXT NOT NULL,
        role TEXT NOT NULL,
        version INTEGER NOT NULL,
        cree_le INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_espace_acces_journal ON espace_acces_journal(project_id, cree_le);
    `,
  },
  {
    id: 58,
    name: 'espace-notifications-par-compte',
    /*
     * LA CLOCHE D'UN CLIENT EST GARDÉE PAR LE SERVEUR : il passe du téléphone à
     * l'ordinateur, et ses notifications le suivent. Une ligne par
     * notification ET par destinataire, avec son état lu — ce que
     * `demande_activite` ne peut pas porter : l'activité est une par geste,
     * commune à tous, et ne connaît ni la discussion ni l'état lu de chacun.
     * Ajout pur ; les lignes lues de plus de 90 jours sont purgées au fil de
     * l'eau (`server/src/espace-notifications.ts`).
     */
    sql: `
      CREATE TABLE IF NOT EXISTS espace_notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        project_id TEXT,
        demande_id TEXT,
        evenement TEXT NOT NULL,
        data TEXT NOT NULL,
        cree_le INTEGER NOT NULL,
        lu_le INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_espace_notifications ON espace_notifications(user_id, cree_le);
    `,
  },
  {
    id: 59,
    name: 'rattraper-la-vitrine-liee-de-beluga',
    siTable: 'projects',
    /*
     * LA PREMIÈRE MIGRATION PORTAIT UN NUMÉRO DÉJÀ PRIS dans la base servie
     * par un ancien nom inconnu du code actuel. Ce cas doit rester traité comme
     * une base d'époque ; on repose donc le réglage sous un nouveau numéro,
     * sans écraser un réglage qui aurait été ajouté entre-temps.
     */
    sql: `
      UPDATE projects
         SET data = json_set(data, '$.vitrineLiee', json_object(
               'site', (SELECT s.path FROM projects s WHERE json_extract(s.data, '$.gitRemote') = 'git@github.com:haikostudio/belugabuild.git' LIMIT 1),
               'constructeur', (SELECT c.path FROM projects c WHERE json_extract(c.data, '$.gitRemote') = 'git@github.com:haikostudio/beluga-vitrine.git' LIMIT 1),
               'adresseEssai', 'https://belugabuild.haikostudio.cloud',
               'adresseProduction', 'https://belugabuild.com',
               'dossierProduction', '/srv/belugabuild',
               'serviceProduction', 'belugabuild-prod'))
       WHERE json_extract(data, '$.gitRemote') = 'git@github.com:haikostudio/beluga.git'
         AND json_extract(data, '$.vitrineLiee') IS NULL
         AND EXISTS (SELECT 1 FROM projects s WHERE json_extract(s.data, '$.gitRemote') = 'git@github.com:haikostudio/belugabuild.git')
         AND EXISTS (SELECT 1 FROM projects c WHERE json_extract(c.data, '$.gitRemote') = 'git@github.com:haikostudio/beluga-vitrine.git');
    `,
  },
  {
    id: 60,
    name: 'apparence-du-compte',
    siTable: 'users',
    /*
     * LE THÈME D'UN CLIENT SUIT SON COMPTE, PAS SON NAVIGATEUR. L'espace client
     * n'a pas accès aux préférences du serveur (`prefs`, réservées à
     * l'administration) : sa seule mémoire était le stockage local, donc un
     * choix perdu d'un appareil à l'autre et vidé avec le cache. Une colonne
     * ADDITIVE et SANS valeur obligatoire : un compte qui n'a rien choisi vaut
     * NULL, et l'écran retombe sur le réglage du système.
     */
    sql: `
      ALTER TABLE users ADD COLUMN apparence TEXT;
    `,
  },
  {
    id: 61,
    name: 'memoire-en-classeurs',
    /*
     * LA MÉMOIRE QUITTE LES FICHIERS POUR DES CLASSEURS EN BASE
     * (`shared/src/classeurs.ts`, `server/src/classeurs.ts`). Un classeur global
     * et un par projet, plus un classeur de compétences à chaque niveau ; des
     * thèmes ; des fiches au gabarit fixe. Chaque modification garde la version
     * précédente (`fiche_versions`) : la mémoire sort de git, c'est la base qui
     * garde la trace.
     *
     * DEUX INDEX TENUS PAR DÉCLENCHEURS, jamais par le code : le plein texte
     * (BM25, sans accents) et les trigrammes (fautes de frappe, mots partiels).
     * Un déclencheur ne peut pas être oublié par un chemin d'écriture de plus —
     * l'import intégral des données compris, qui écrit en SQL brut.
     */
    sql: `
      CREATE TABLE classeurs (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        genre TEXT NOT NULL DEFAULT 'memoire',
        nom TEXT NOT NULL,
        cree_le INTEGER NOT NULL
      );

      CREATE TABLE classeur_themes (
        classeur_id TEXT NOT NULL,
        id TEXT NOT NULL,
        libelle TEXT NOT NULL,
        rang INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (classeur_id, id)
      );

      CREATE TABLE fiches (
        id INTEGER PRIMARY KEY,
        classeur_id TEXT NOT NULL,
        theme TEXT NOT NULL,
        nature TEXT NOT NULL,
        titre TEXT NOT NULL,
        resume TEXT NOT NULL,
        corps TEXT NOT NULL,
        mots_cles TEXT NOT NULL DEFAULT '[]',
        alias TEXT NOT NULL DEFAULT '[]',
        pourquoi TEXT NOT NULL DEFAULT '',
        fichiers TEXT NOT NULL DEFAULT '[]',
        controle TEXT NOT NULL DEFAULT '',
        etat TEXT NOT NULL DEFAULT 'active',
        provenance TEXT NOT NULL DEFAULT '{}',
        cle_provenance TEXT UNIQUE,
        cree_le INTEGER NOT NULL,
        modifie_le INTEGER NOT NULL,
        servie INTEGER NOT NULL DEFAULT 0,
        lue INTEGER NOT NULL DEFAULT 0,
        utile INTEGER NOT NULL DEFAULT 0,
        inutile INTEGER NOT NULL DEFAULT 0,
        perimee INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_fiches_classeur ON fiches(classeur_id, theme, etat);

      CREATE TABLE fiche_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fiche_id INTEGER NOT NULL,
        contenu TEXT NOT NULL,
        auteur TEXT NOT NULL DEFAULT '',
        motif TEXT NOT NULL DEFAULT '',
        at INTEGER NOT NULL
      );
      CREATE INDEX idx_fiche_versions ON fiche_versions(fiche_id, at);

      CREATE TABLE classeur_synonymes (
        classeur_id TEXT NOT NULL,
        mot TEXT NOT NULL,
        synonymes TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (classeur_id, mot)
      );

      CREATE TABLE fiche_doublons (
        a INTEGER NOT NULL,
        b INTEGER NOT NULL,
        score REAL NOT NULL,
        etat TEXT NOT NULL DEFAULT 'propose',
        at INTEGER NOT NULL,
        PRIMARY KEY (a, b)
      );

      CREATE TABLE fiche_services (
        agent_id TEXT NOT NULL,
        fiche_id INTEGER NOT NULL,
        genre TEXT NOT NULL,
        card_id TEXT,
        en_contexte INTEGER NOT NULL DEFAULT 1,
        at INTEGER NOT NULL,
        PRIMARY KEY (agent_id, fiche_id, genre)
      );
      CREATE INDEX idx_fiche_services_carte ON fiche_services(card_id);

      CREATE VIRTUAL TABLE fiches_fts USING fts5(
        titre, alias, resume, mots_cles, corps,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE VIRTUAL TABLE fiches_tri USING fts5(
        titre, alias, resume, mots_cles,
        tokenize = 'trigram remove_diacritics 1'
      );

      CREATE TRIGGER fiches_index_ajout AFTER INSERT ON fiches BEGIN
        DELETE FROM fiches_fts WHERE rowid = new.id;
        DELETE FROM fiches_tri WHERE rowid = new.id;
        INSERT INTO fiches_fts (rowid, titre, alias, resume, mots_cles, corps) VALUES (
          new.id, new.titre,
          (SELECT COALESCE(group_concat(value, ' '), '') FROM json_each(new.alias)),
          new.resume,
          (SELECT COALESCE(group_concat(value, ' '), '') FROM json_each(new.mots_cles)),
          new.corps
        );
        INSERT INTO fiches_tri (rowid, titre, alias, resume, mots_cles) VALUES (
          new.id, new.titre,
          (SELECT COALESCE(group_concat(value, ' '), '') FROM json_each(new.alias)),
          new.resume,
          (SELECT COALESCE(group_concat(value, ' '), '') FROM json_each(new.mots_cles))
        );
      END;

      CREATE TRIGGER fiches_index_maj AFTER UPDATE OF titre, alias, resume, mots_cles, corps ON fiches BEGIN
        DELETE FROM fiches_fts WHERE rowid = old.id;
        DELETE FROM fiches_tri WHERE rowid = old.id;
        INSERT INTO fiches_fts (rowid, titre, alias, resume, mots_cles, corps) VALUES (
          new.id, new.titre,
          (SELECT COALESCE(group_concat(value, ' '), '') FROM json_each(new.alias)),
          new.resume,
          (SELECT COALESCE(group_concat(value, ' '), '') FROM json_each(new.mots_cles)),
          new.corps
        );
        INSERT INTO fiches_tri (rowid, titre, alias, resume, mots_cles) VALUES (
          new.id, new.titre,
          (SELECT COALESCE(group_concat(value, ' '), '') FROM json_each(new.alias)),
          new.resume,
          (SELECT COALESCE(group_concat(value, ' '), '') FROM json_each(new.mots_cles))
        );
      END;

      CREATE TRIGGER fiches_index_retrait AFTER DELETE ON fiches BEGIN
        DELETE FROM fiches_fts WHERE rowid = old.id;
        DELETE FROM fiches_tri WHERE rowid = old.id;
      END;
    `,
  },
  {
    id: 62,
    name: 'vecteurs-des-fiches',
    /*
     * LES VECTEURS DES FICHES (`server/src/classeurs-vecteurs.ts`) : un par fiche, calculé
     * sur son titre, son résumé et ses alias par un modèle LOCAL
     * (multilingual-e5-small). L'empreinte du texte vectorisé dit si le vecteur
     * est encore à jour : une fiche modifiée garde l'ancien jusqu'au prochain
     * passage, jamais un vecteur faux passé pour juste.
     */
    sql: `
      CREATE TABLE fiche_vecteurs (
        fiche_id INTEGER PRIMARY KEY,
        modele TEXT NOT NULL,
        empreinte TEXT NOT NULL,
        vecteur BLOB NOT NULL,
        at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 63,
    name: 'memoire-en-fiches-de-sujet',
    /*
     * UN CLASSEUR PAR PROJET, DES FICHES COMPLÈTES PAR SUJET
     * (`shared/src/fiches-sujet.ts`, `server/src/memoire-sujets.ts`). Les
     * micro-fiches de la migration 61 restent en place, en ARCHIVE : la reprise
     * les regroupe en documents au gabarit et note, pour chacune, où elle a été
     * reprise (`memoire_correspondance`).
     *
     * LA RECHERCHE TRAVAILLE SUR DES MORCEAUX (`fiche_morceaux`), un par
     * sous-bloc : les index plein texte et trigrammes les suivent par
     * déclencheurs. Un vecteur se range par l'EMPREINTE de son texte, pas par le
     * numéro du morceau : réécrire une fiche garde les vecteurs des passages qui
     * n'ont pas changé.
     *
     * LE CHANGELOG EST UNE SUITE D'ENTRÉES (`memoire_changelog`), jamais un texte
     * réécrit : deux agents qui écrivent ensemble font deux insertions.
     */
    sql: `
      CREATE TABLE fiches_sujet (
        id INTEGER PRIMARY KEY,
        classeur_id TEXT NOT NULL,
        sujet TEXT NOT NULL,
        markdown TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        auteur TEXT NOT NULL DEFAULT '',
        cree_le INTEGER NOT NULL,
        modifie_le INTEGER NOT NULL,
        UNIQUE (classeur_id, sujet)
      );

      CREATE TABLE fiche_sujet_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fiche_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        markdown TEXT NOT NULL,
        auteur TEXT NOT NULL DEFAULT '',
        motif TEXT NOT NULL DEFAULT '',
        at INTEGER NOT NULL
      );
      CREATE INDEX idx_fiche_sujet_versions ON fiche_sujet_versions(fiche_id, at);

      CREATE TABLE fiche_morceaux (
        id INTEGER PRIMARY KEY,
        fiche_id INTEGER NOT NULL,
        rang INTEGER NOT NULL,
        section TEXT NOT NULL,
        sous_titre TEXT,
        texte TEXT NOT NULL,
        ancre TEXT NOT NULL,
        empreinte TEXT NOT NULL
      );
      CREATE INDEX idx_fiche_morceaux ON fiche_morceaux(fiche_id, rang);

      CREATE VIRTUAL TABLE morceaux_fts USING fts5(
        sous_titre, section, texte,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE VIRTUAL TABLE morceaux_tri USING fts5(
        sous_titre, texte,
        tokenize = 'trigram remove_diacritics 1'
      );

      CREATE TRIGGER fiche_morceaux_ajout AFTER INSERT ON fiche_morceaux BEGIN
        INSERT INTO morceaux_fts (rowid, sous_titre, section, texte) VALUES (new.id, COALESCE(new.sous_titre, ''), new.section, new.texte);
        INSERT INTO morceaux_tri (rowid, sous_titre, texte) VALUES (new.id, COALESCE(new.sous_titre, ''), new.texte);
      END;
      CREATE TRIGGER fiche_morceaux_retrait AFTER DELETE ON fiche_morceaux BEGIN
        DELETE FROM morceaux_fts WHERE rowid = old.id;
        DELETE FROM morceaux_tri WHERE rowid = old.id;
      END;

      CREATE TABLE morceau_vecteurs (
        empreinte TEXT PRIMARY KEY,
        modele TEXT NOT NULL,
        vecteur BLOB NOT NULL,
        at INTEGER NOT NULL
      );

      CREATE TABLE memoire_changelog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        branche TEXT NOT NULL,
        description TEXT NOT NULL,
        card_id TEXT,
        at INTEGER NOT NULL
      );
      CREATE INDEX idx_memoire_changelog ON memoire_changelog(project_id, at);

      CREATE TABLE memoire_correspondance (
        ancien_id INTEGER PRIMARY KEY,
        ancien_code TEXT NOT NULL,
        classeur_id TEXT NOT NULL,
        sujet TEXT NOT NULL,
        section TEXT NOT NULL,
        repere TEXT NOT NULL,
        doublon INTEGER NOT NULL DEFAULT 0,
        at INTEGER NOT NULL
      );
      CREATE INDEX idx_memoire_correspondance ON memoire_correspondance(classeur_id, sujet);
    `,
  },
  {
    id: 64,
    name: 'base-de-connaissances',
    /*
     * LA BASE DE CONNAISSANCES (`shared/src/connaissances.ts`,
     * `server/src/connaissances.ts`) : des UNITÉS TYPÉES et versionnées, une
     * portée par projet plus le Global, rendues en fiches Markdown numérotées.
     *
     * `num` porte les index (plein texte, trigrammes, vecteurs) ; `id` est
     * l'identifiant stable qu'on lit (MEM-0042, DEC-007), tiré des compteurs.
     * Une unité ne s'efface pas : elle se déprécie, et chaque version est gardée
     * en entier (`connaissance_versions`).
     *
     * LE CHANGELOG est une suite d'entrées datées, jamais un texte réécrit ;
     * l'EMPREINTE (jour et texte normalisé) interdit le doublon. WORKING est le
     * brouillon d'une carte, purgé à sa fermeture.
     */
    sql: `
      CREATE TABLE connaissances (
        num INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        portee TEXT NOT NULL,
        type TEXT NOT NULL,
        sujets TEXT NOT NULL DEFAULT '[]',
        titre TEXT NOT NULL,
        titre_norme TEXT NOT NULL,
        resume TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        raisonnement TEXT NOT NULL DEFAULT '',
        statut TEXT NOT NULL DEFAULT 'active',
        importance TEXT NOT NULL DEFAULT 'P2',
        confiance REAL NOT NULL DEFAULT 0.8,
        source TEXT NOT NULL DEFAULT '{}',
        liens TEXT NOT NULL DEFAULT '[]',
        supersedes TEXT,
        superseded_by TEXT,
        jamais_supposer INTEGER NOT NULL DEFAULT 0,
        relue INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        auteur TEXT NOT NULL DEFAULT '',
        cree_le INTEGER NOT NULL,
        modifie_le INTEGER NOT NULL
      );
      CREATE INDEX idx_connaissances_portee ON connaissances(portee, statut, type);
      CREATE INDEX idx_connaissances_titre ON connaissances(portee, type, titre_norme);

      CREATE TABLE connaissance_compteurs (
        prefixe TEXT PRIMARY KEY,
        dernier INTEGER NOT NULL
      );

      CREATE TABLE connaissance_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        unite_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        instantane TEXT NOT NULL,
        auteur TEXT NOT NULL DEFAULT '',
        motif TEXT NOT NULL DEFAULT '',
        at INTEGER NOT NULL
      );
      CREATE INDEX idx_connaissance_versions ON connaissance_versions(unite_id, at);

      CREATE VIRTUAL TABLE connaissances_fts USING fts5(
        titre, resume, detail, sujets,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE VIRTUAL TABLE connaissances_tri USING fts5(
        titre, resume,
        tokenize = 'trigram remove_diacritics 1'
      );
      CREATE TRIGGER connaissances_index_ajout AFTER INSERT ON connaissances BEGIN
        INSERT INTO connaissances_fts (rowid, titre, resume, detail, sujets) VALUES (new.num, new.titre, new.resume, new.detail, new.sujets);
        INSERT INTO connaissances_tri (rowid, titre, resume) VALUES (new.num, new.titre, new.resume);
      END;
      CREATE TRIGGER connaissances_index_maj AFTER UPDATE OF titre, resume, detail, sujets ON connaissances BEGIN
        DELETE FROM connaissances_fts WHERE rowid = old.num;
        DELETE FROM connaissances_tri WHERE rowid = old.num;
        INSERT INTO connaissances_fts (rowid, titre, resume, detail, sujets) VALUES (new.num, new.titre, new.resume, new.detail, new.sujets);
        INSERT INTO connaissances_tri (rowid, titre, resume) VALUES (new.num, new.titre, new.resume);
      END;
      CREATE TRIGGER connaissances_index_retrait AFTER DELETE ON connaissances BEGIN
        DELETE FROM connaissances_fts WHERE rowid = old.num;
        DELETE FROM connaissances_tri WHERE rowid = old.num;
      END;

      CREATE TABLE connaissance_vecteurs (
        num INTEGER PRIMARY KEY,
        empreinte TEXT NOT NULL,
        modele TEXT NOT NULL,
        vecteur BLOB NOT NULL,
        at INTEGER NOT NULL
      );

      CREATE TABLE connaissance_refus (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portee TEXT NOT NULL,
        titre TEXT NOT NULL DEFAULT '',
        raisons TEXT NOT NULL DEFAULT '[]',
        auteur TEXT NOT NULL DEFAULT '',
        at INTEGER NOT NULL
      );
      CREATE INDEX idx_connaissance_refus ON connaissance_refus(portee, at);

      CREATE TABLE connaissance_lectures (
        agent_id TEXT NOT NULL,
        cle TEXT NOT NULL,
        card_id TEXT,
        en_contexte INTEGER NOT NULL DEFAULT 1,
        at INTEGER NOT NULL,
        PRIMARY KEY (agent_id, cle)
      );
      CREATE INDEX idx_connaissance_lectures_carte ON connaissance_lectures(card_id);

      CREATE TABLE connaissance_generations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portee TEXT NOT NULL,
        rapport TEXT NOT NULL,
        at INTEGER NOT NULL
      );

      CREATE TABLE changelog_entrees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        jour TEXT NOT NULL,
        categorie TEXT NOT NULL,
        texte TEXT NOT NULL,
        branche TEXT,
        commits TEXT NOT NULL DEFAULT '[]',
        cartes TEXT NOT NULL DEFAULT '[]',
        unites TEXT NOT NULL DEFAULT '[]',
        publication TEXT,
        source TEXT NOT NULL,
        empreinte TEXT NOT NULL,
        at INTEGER NOT NULL,
        UNIQUE (project_id, empreinte)
      );
      CREATE INDEX idx_changelog_entrees ON changelog_entrees(project_id, jour);

      CREATE TABLE working_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        agent_id TEXT,
        texte TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE INDEX idx_working_notes ON working_notes(card_id);
    `,
  },
  {
    id: 65,
    name: 'retrait-de-l-ancienne-memoire',
    /*
     * L'ANCIEN MODÈLE DISPARAÎT : les micro-fiches de la migration 61 et les
     * fiches de sujet de la migration 63, leurs index, versions, vecteurs et
     * correspondances. Rien n'est perdu : `sauvegarderLAncienneMemoire`
     * (`server/src/sauvegarde-ancienne-memoire.ts`) les a écrites en entier dans
     * `data/sauvegardes/memoire-avant-connaissances.json.gz` AVANT les
     * migrations, et la génération de la base de connaissances y reprend sa
     * matière première.
     */
    sql: `
      DROP TABLE IF EXISTS fiche_morceaux;
      DROP TABLE IF EXISTS morceaux_fts;
      DROP TABLE IF EXISTS morceaux_tri;
      DROP TABLE IF EXISTS morceau_vecteurs;
      DROP TABLE IF EXISTS fiche_sujet_versions;
      DROP TABLE IF EXISTS fiches_sujet;
      DROP TABLE IF EXISTS memoire_changelog;
      DROP TABLE IF EXISTS memoire_correspondance;
      DROP TABLE IF EXISTS fiche_services;
      DROP TABLE IF EXISTS fiche_doublons;
      DROP TABLE IF EXISTS fiche_versions;
      DROP TABLE IF EXISTS fiche_vecteurs;
      DROP TABLE IF EXISTS fiches_fts;
      DROP TABLE IF EXISTS fiches_tri;
      DROP TABLE IF EXISTS fiches;
      DROP TABLE IF EXISTS classeur_synonymes;
      DROP TABLE IF EXISTS classeur_themes;
      DROP TABLE IF EXISTS classeurs;
    `,
  },
  {
    id: 66,
    name: 'retrait-des-departs-automatiques',
    siTable: 'cards',
    /*
     * LES DÉPARTS QUE PERSONNE N'A CHOISIS DISPARAISSENT. Le créneau conseillé
     * était recopié dans `departPrevu` avec `creneauAutomatique: true` ; un
     * geste de l'utilisateur sur la date effaçait ce drapeau
     * (`programmerLeDepart`). Une date qui porte ENCORE le drapeau n'a donc
     * jamais été choisie : on la retire, le créneau reste en suggestion. Les
     * reprises après panne passagère ne portent pas ce drapeau : intactes.
     */
    sql: `
      UPDATE cards
         SET data = json_remove(data, '$.scheduling.departPrevu', '$.scheduling.creneauAutomatique')
       WHERE json_valid(data)
         AND json_extract(data, '$.scheduling.creneauAutomatique') = 1;
    `,
  },
  {
    id: 67,
    name: 'changelog-titre-explication-poids',
    siTable: 'changelog_entrees',
    /*
     * UNE ENTRÉE DE CHANGELOG SE RACONTE. `texte` garde la ligne d'origine
     * (titre de carte, sujet de commit) ; `titre` et `explication` sont écrits
     * pour un lecteur qui ne programme pas, et `poids` dit l'ampleur réelle
     * (grande-nouveaute, amelioration, correction, retrait, detail). `masquee`
     * retire de la vue un doublon fusionné par la reprise, sans l'effacer.
     */
    sql: `
      ALTER TABLE changelog_entrees ADD COLUMN titre TEXT;
      ALTER TABLE changelog_entrees ADD COLUMN explication TEXT;
      ALTER TABLE changelog_entrees ADD COLUMN poids TEXT;
      ALTER TABLE changelog_entrees ADD COLUMN masquee INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    id: 68,
    name: 'changelog-corrige-a-la-main',
    siTable: 'changelog_entrees',
    /*
     * UNE ENTRÉE CORRIGÉE À LA MAIN FAIT FOI. `corrigee` protège le titre,
     * l'explication et le poids écrits depuis l'écran : ni la reprise du passé,
     * ni la rédaction de repli, ni un agent ne les réécrivent ensuite.
     */
    sql: `
      ALTER TABLE changelog_entrees ADD COLUMN corrigee INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    id: 69,
    name: 'surveillances-recette-rythme-historique',
    siTable: 'sites_surveilles',
    /*
     * LES SURVEILLANCES PILOTÉES PAR UN AGENT. Chaque ligne gagne sa RECETTE
     * (JSON, sans aucun secret : les accès sont des références au coffre-fort),
     * son RYTHME, l'étape d'un parcours qui a cassé, et la dernière conversation
     * d'agent qui l'a touchée. Les passages vont dans `controles_surveillance`,
     * effacés au-delà de 24 heures à chaque tournée.
     *
     * LA REPRISE EST ADDITIVE : une ligne d'avant garde son état, sa date de
     * vérification et sa dernière panne. Sa recette vide se lit comme un simple
     * appel (`recetteDeLigne`) et son rythme vaut cinq minutes. Aucun état ne
     * bascule, donc aucune alerte ne repart.
     */
    sql: `
      ALTER TABLE sites_surveilles ADD COLUMN recette TEXT;
      ALTER TABLE sites_surveilles ADD COLUMN periode_ms INTEGER NOT NULL DEFAULT 300000;
      ALTER TABLE sites_surveilles ADD COLUMN duree_ms INTEGER;
      ALTER TABLE sites_surveilles ADD COLUMN etape_echouee TEXT;
      ALTER TABLE sites_surveilles ADD COLUMN agent_id TEXT;
      ALTER TABLE sites_surveilles ADD COLUMN project_id TEXT;
      ALTER TABLE sites_surveilles ADD COLUMN card_id TEXT;
      CREATE TABLE controles_surveillance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id TEXT NOT NULL,
        instant INTEGER NOT NULL,
        etat TEXT NOT NULL,
        raison TEXT,
        code INTEGER,
        duree_ms INTEGER NOT NULL DEFAULT 0,
        etape TEXT,
        detail TEXT
      );
      CREATE INDEX idx_controles_surveillance_site ON controles_surveillance(site_id, instant);
      CREATE INDEX idx_controles_surveillance_instant ON controles_surveillance(instant);
    `,
  },
  {
    id: 70,
    name: 'projets-port-fixe',
    siTable: 'projects',
    /*
     * LA PORTE D'ENTRÉE D'UN PROJET DEVIENT UNE VRAIE COLONNE (`Project.port`,
     * `shared/src/port-projet.ts`).
     *
     * Une colonne GÉNÉRÉE, lue dans le JSON du projet : `saveProject` écrit
     * déjà `data` en entier, la colonne suit donc chaque écriture sans qu'aucun
     * chemin d'écriture n'ait à la connaître — impossible qu'elle diverge du
     * projet. VIRTUELLE, parce que SQLite n'accepte que celle-là par
     * `ALTER TABLE` ; l'index la rend interrogeable comme une autre (qui porte
     * ce port ?). Les projets d'avant ont `NULL` : le rattrapage du démarrage
     * (`server/src/port-des-projets.ts`) leur donne le port réellement servi.
     */
    sql: `
      ALTER TABLE projects ADD COLUMN port INTEGER GENERATED ALWAYS AS (json_extract(data, '$.port')) VIRTUAL;
      CREATE INDEX idx_projects_port ON projects(port);
    `,
  },
  {
    id: 71,
    name: 'doublon-de-connaissance-sans-le-type',
    /*
     * La garde d'écriture reconnaît désormais un même fait rangé sous deux
     * types différents (`server/src/connaissances.ts:doublonDe`) : l'index qui
     * accélère sa recherche perd donc le type de sa clé, comme la requête
     * qu'il sert.
     */
    sql: `
      DROP INDEX idx_connaissances_titre;
      CREATE INDEX idx_connaissances_titre ON connaissances(portee, titre_norme);
    `,
  },
  {
    id: 72,
    name: 'cartes-instant-du-rendu',
    siTable: ['cards', 'projects'],
    /*
     * L'INSTANT DU DERNIER RENDU D'UNE CARTE (`Card.renduA`,
     * `shared/src/travail-rendu.ts`) devient interrogeable. Colonne GÉNÉRÉE
     * depuis le bloc `data`, comme le port d'un projet (migration 70) :
     * `saveCard` écrit déjà ce bloc en entier, aucune écriture n'a à la
     * connaître. Les cartes d'avant ont `NULL` et se rabattent sur leur agent.
     */
    sql: `
      ALTER TABLE cards ADD COLUMN rendu_a INTEGER GENERATED ALWAYS AS (json_extract(data, '$.renduA')) VIRTUAL;
      CREATE INDEX idx_cards_rendu ON cards(project_id, rendu_a);
      -- La visite d'un projet n'éteint plus rien : ce qu'elle éteignait
      -- jusqu'ici devient une vraie consultation des cartes, pour que le
      -- passage à la nouvelle règle ne rallume pas d'un coup tout l'historique.
      UPDATE cards SET last_read_at = (
        SELECT json_extract(p.data, '$.lastVisitedAt') FROM projects p WHERE p.id = cards.project_id
      )
      WHERE (SELECT json_extract(p.data, '$.lastVisitedAt') FROM projects p WHERE p.id = cards.project_id)
            > COALESCE(last_read_at, json_extract(data, '$.lastReadAt'), 0);
    `,
  },  {
    id: 73,
    name: 'coffre-fort-archives',
    siTable: 'secrets',
    /*
     * RETIRER UNE FICHE DU COFFRE L'ARCHIVE (`server/src/coffre-fort.ts`) : elle
     * garde sa ligne, avec l'instant du retrait, et n'est effacée pour de bon
     * qu'au bout de six mois (`DUREE_ARCHIVE_MS`, `shared/src/coffre-fort.ts`).
     * `NULL` = fiche active.
     */
    sql: `
      ALTER TABLE secrets ADD COLUMN archive_le INTEGER;
      CREATE INDEX idx_secrets_archive ON secrets(archive_le);
    `,
  },
  {
    id: 73,
    name: 'depots-beluga-remis-en-ordre',
    siTable: 'projects',
    /*
     * LES DÉPÔTS BELUGA RENOMMÉS (17/09/2026) : `beluga` → `beluga-dev` (privé),
     * `belugabuildtool` → `beluga` (public), `belugabuild` → `beluga-site`,
     * `beluga-vitrine` → `haiko-beluga`. L'instance d'essai du site officiel
     * disparaît : la démo ne vient plus que de la branche de production, et la
     * vitrine Haiko la reçoit dans la même mise en production.
     *
     * Ne touche QUE l'installation reconnue à son site de production
     * (belugabuild.com) ; les chemins de dossiers ne sont pas de son ressort.
     * Rejouable : chaque remplacement est sans effet la seconde fois, et une
     * adresse de vitrine déjà réglée n'est pas écrasée.
     */
    sql: `
      UPDATE projects
         SET data = json_set(
               json_remove(data, '$.vitrineLiee.adresseEssai'),
               '$.vitrineLiee.adresseConstructeur',
               COALESCE(json_extract(data, '$.vitrineLiee.adresseConstructeur'), 'https://dev.haikostudio.cloud'))
       WHERE json_extract(data, '$.vitrineLiee.adresseProduction') = 'https://belugabuild.com';

      UPDATE projects
         SET data = json_set(data, '$.miseEnProduction.miroirPublic', 'haikostudio/beluga')
       WHERE json_extract(data, '$.vitrineLiee.adresseProduction') = 'https://belugabuild.com'
         AND json_extract(data, '$.miseEnProduction.miroirPublic') = 'haikostudio/belugabuildtool';

      UPDATE projects
         SET data = json_set(data, '$.miseEnProduction.prompt',
               replace(replace(replace(replace(replace(replace(replace(
                 json_extract(data, '$.miseEnProduction.prompt'),
                 'haikostudio/belugabuildtool', '§depot-public§'),
                 'haikostudio/belugabuild', 'haikostudio/beluga-site'),
                 'sur haikostudio/beluga.', 'sur haikostudio/beluga-dev.'),
                 'Le dépôt privé beluga ', 'Le dépôt privé beluga-dev '),
                 ' ni belugabuild.haikostudio.cloud', ' ni https://dev.haikostudio.cloud'),
                 'du site de production lié https://belugabuild.com —', 'du site de production lié https://belugabuild.com et de la vitrine Haiko https://dev.haikostudio.cloud —'),
                 '§depot-public§', 'haikostudio/beluga'))
       WHERE json_extract(data, '$.vitrineLiee.adresseProduction') = 'https://belugabuild.com'
         AND instr(json_extract(data, '$.miseEnProduction.prompt'), 'belugabuildtool') > 0;
    `,
  },
  {
    id: 74,
    name: 'vitrine-haiko-suit-chaque-deploiement',
    siTable: 'projects',
    /*
     * LA DÉMO DE LA VITRINE HAIKO SUIT LA BRANCHE DE DÉVELOPPEMENT (17/09/2026) :
     * elle ne se refaisait qu'à la mise en production, et prenait des jours de
     * retard. Chaque déploiement réussi la reconstruit désormais depuis le commit
     * déployé et remet la vitrine en ligne — sans toucher au site officiel.
     *
     * Même installation que la 73 (belugabuild.com) ; un choix déjà posé (vrai
     * ou faux) n'est pas écrasé, et l'adresse de la vitrine est complétée si
     * elle manque encore.
     */
    sql: `
      UPDATE projects
         SET data = json_set(data, '$.vitrineLiee.adresseConstructeur', 'https://dev.haikostudio.cloud')
       WHERE json_extract(data, '$.vitrineLiee.adresseProduction') = 'https://belugabuild.com'
         AND json_type(data, '$.vitrineLiee.adresseConstructeur') IS NULL;

      UPDATE projects
         SET data = json_set(data, '$.vitrineLiee.constructeurSuitLeDeploiement', json('true'))
       WHERE json_extract(data, '$.vitrineLiee.adresseProduction') = 'https://belugabuild.com'
         AND json_type(data, '$.vitrineLiee.constructeurSuitLeDeploiement') IS NULL;
    `,
  },
  {
    id: 75,
    name: 'surveillance-projet-rattache-et-incident',
    siTable: 'sites_surveilles',
    /*
     * LE DÉPANNAGE AUTOMATIQUE D'UN SITE QUI TOMBE ET RETOMBE
     * (`shared/src/depannage-site.ts`).
     *
     * `projet_rattache` est LE PROJET DU SITE, à ne jamais confondre avec
     * `project_id` (migration 69) qui désigne l'endroit où vit la conversation
     * de l'agent de CONFIGURATION — presque toujours Beluga Build. Les deux
     * doivent coexister : l'un n'écrase pas l'autre.
     *
     * `incident_card_id` porte la carte de la panne EN COURS (une seule carte
     * par panne), `incident_depuis` son début, `incident_lance_le` l'heure du
     * dernier lancement — posée AVANT le tour, pour qu'un lancement raté ne se
     * rejoue pas à chaque contrôle, et pour tenir l'écart minimal de six heures.
     *
     * REPRISE ADDITIVE : toutes les colonnes sont nulles sur les lignes d'avant.
     * Un site déjà surveillé n'a donc aucun projet rattaché ni aucun incident
     * ouvert, et son premier rattachement se fera au prochain contrôle.
     */
    sql: `
      ALTER TABLE sites_surveilles ADD COLUMN projet_rattache TEXT;
      ALTER TABLE sites_surveilles ADD COLUMN projet_devine INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sites_surveilles ADD COLUMN incident_card_id TEXT;
      ALTER TABLE sites_surveilles ADD COLUMN incident_depuis INTEGER;
      ALTER TABLE sites_surveilles ADD COLUMN incident_lance_le INTEGER;
    `,
  },
  {
    id: 76,
    name: 'lectures-avec-leur-etape',
    siTable: 'connaissance_lectures',
    /*
     * LE BLOC « MÉMOIRE » DU FIL LIT LE RELEVÉ VIVANT (`carnetDesLectures`,
     * `server/src/connaissances.ts`), plus un enregistrement parallèle. Il lui
     * manquait l'ÉTAPE du parcours où la lecture a eu lieu (compréhension, plan,
     * travail) : `noterUneLecture` la pose désormais. REPRISE ADDITIVE : nulle
     * sur les lectures d'avant, où le rôle de l'agent tranche
     * (`ligneDUneLecture`, `shared/src/carnet-memoire.ts`).
     */
    sql: `
      ALTER TABLE connaissance_lectures ADD COLUMN etape TEXT;
    `,
  },
  {
    id: 77,
    name: 'purge-des-cles-de-l-ancienne-memoire-servie',
    siTable: 'meta',
    /*
     * `memoire.vue.<agent>` et `memoire.sujets.<agent>` retenaient ce que
     * l'ancien arbre avait servi à chaque agent. Plus rien ne les lit depuis le
     * retrait de l'arbre (13.09.2026), et « repartir de zéro » ne les écrit
     * plus. `memoire.demandes.<agent>` N'EST PAS TOUCHÉ : le lancement d'une
     * carte ancienne le lit encore (`sujetsMemoireDemandes`).
     */
    sql: `
      DELETE FROM meta WHERE key LIKE 'memoire.vue.%' OR key LIKE 'memoire.sujets.%';
    `,
  },
  {
    id: 78,
    name: 'retrait-de-l-economie-de-memoire',
    /*
     * CETTE TABLE MESURAIT CE QUE LE TRI DE LA MÉMOIRE ÉVITAIT D'ENVOYER. Son
     * seul écrivain a disparu à la bascule vers la mémoire en classeurs
     * (mi-septembre 2026, migration 36) sans que personne ne le remplace, et
     * aucun écran n'a jamais affiché ce calcul. `memoire_consultation`, créée
     * par cette même migration 36, mesure la vraie consultation de la mémoire
     * et reste seule à alimenter l'écran de télémétrie des tâches.
     *
     * La migration 34 qui a créé cette table reste dans cette liste : une base
     * déjà en service l'a appliquée, et l'histoire d'un schéma ne se réécrit
     * pas (même principe qu'à la migration 33). C'est celle-ci qui range
     * derrière elle — les lignes déjà écrites ne sont pas effacées ailleurs.
     */
    sql: `
      DROP TABLE IF EXISTS memoire_economie;
    `,
  },
  {
    id: 79,
    name: 'traces-du-juge-rapide',
    /*
     * LA TRACE DES JUGEMENTS RAPIDES — de quoi JUGER LE JUGE après coup.
     *
     * Chaque appel au service de jugements typés laisse sa ligne : l'usage
     * concerné, l'état et les questions envoyés, la réponse brute, la force du
     * verdict, le temps mis, ce que l'application a décidé ensuite, et les
     * jetons consommés (d'où la dépense cumulée). Les ÉCHECS y figurent aussi :
     * un repli silencieux qui ne laisse aucune trace est indétectable, et c'est
     * justement ce qu'on veut pouvoir relire.
     *
     * Aucune clé rangée au coffre = aucune ligne : la table reste vide, ce qui
     * est la preuve la plus simple que rien ne part.
     */
    sql: `
      CREATE TABLE jugement_traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usage_cle TEXT NOT NULL,
        question TEXT NOT NULL,
        reponse TEXT NOT NULL,
        confiance REAL,
        latence_ms INTEGER NOT NULL,
        suite TEXT NOT NULL DEFAULT '',
        issue TEXT NOT NULL,
        jetons_entree INTEGER NOT NULL DEFAULT 0,
        jetons_sortie INTEGER NOT NULL DEFAULT 0,
        card_id TEXT,
        project_id TEXT,
        at INTEGER NOT NULL
      );
      CREATE INDEX idx_jugement_traces_at ON jugement_traces(at DESC);
      CREATE INDEX idx_jugement_traces_usage ON jugement_traces(usage_cle, at DESC);
    `,
  },
  {
    id: 80,
    name: 'retrait-de-la-colonne-plan',
    // Comme toute migration de RÉPARATION, elle nomme la table qu'elle attend :
    // une base montée pour un contrôle ciblé n'a pas forcément `cards`, et la
    // migration doit se REPORTER plutôt que d'échouer.
    siTable: 'cards',
    // LA COLONNE « PLAN » N'EXISTE PLUS (même schéma qu'à la migration 37).
    //
    // Elle montrait la carte pendant que son plan s'écrivait. Mais le PARCOURS
    // de la carte le disait déjà, en mieux et sans la déplacer : l'étape
    // « Plan » du flux, son bloc replié numéroté, l'indicateur d'activité de la
    // colonne. Une carte discutée ne bouge donc plus du tableau — elle reste
    // dans « Demande » jusqu'au clic de lancement.
    //
    // Les cartes qui dormaient dans l'ancienne colonne doivent être reprises
    // AVANT toute lecture : leur clé n'est plus reconnue par le modèle
    // (`ColumnKey`, `shared/src/columns.ts`) et la carte ne se relirait pas —
    // elle disparaîtrait du tableau, ou ferait échouer le chargement du projet.
    //
    // Elles gardent leur position d'origine : l'ordre relatif à l'intérieur du
    // paquet est conservé. L'écriture est IDEMPOTENTE — rejouée sur une base
    // déjà reprise, elle ne touche aucune ligne.
    sql: `
      UPDATE cards SET column_key = 'planned' WHERE column_key = 'plan';
    `,
  },
  {
    id: 81,
    name: 'magasin-de-versions',
    /*
     * LE MAGASIN DE VERSIONS — le clic ne construit plus, il désigne.
     *
     * Une VERSION est un lot de cartes assemblé À L'ÉCART, construit et
     * contrôlé là-bas, puis rangé prêt à servir. Ce qu'on retient d'elle : sa
     * CLÉ DE CONTENU (branche d'accueil + branches retenues + verrou de
     * dépendances), le commit d'intégration obtenu, l'arbre de ce commit, les
     * cartes embarquées, celles écartées faute de fusion propre, l'état, le
     * dossier du paquet construit, et la VERSION DE SCHÉMA que ce code
     * applique — c'est elle, et rien d'autre, qui autorise ou refuse un retour
     * arrière (`shared/src/magasin-de-versions.ts`).
     *
     * `cle` n'est pas unique : une même sélection peut être préparée plusieurs
     * fois (une préparation tombée, puis une réussie). C'est l'ÉTAT qui
     * tranche, à la lecture.
     */
    sql: `
      CREATE TABLE IF NOT EXISTS releases (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        cle TEXT NOT NULL,
        cible TEXT NOT NULL DEFAULT 'dev',
        commit_sha TEXT NOT NULL DEFAULT '',
        arbre TEXT NOT NULL DEFAULT '',
        cartes TEXT NOT NULL DEFAULT '[]',
        ecartees TEXT NOT NULL DEFAULT '[]',
        etat TEXT NOT NULL,
        paquet TEXT NOT NULL DEFAULT '',
        schema_version INTEGER NOT NULL DEFAULT 0,
        recit TEXT NOT NULL DEFAULT '',
        creee_a INTEGER NOT NULL,
        prete_a INTEGER,
        servie_a INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_releases_projet ON releases(project_id, creee_a DESC);
      CREATE INDEX IF NOT EXISTS idx_releases_cle ON releases(project_id, cle, etat);
    `,
  },
  {
    id: 82,
    name: 'retrait-de-la-colonne-rapport',
    // Comme toute migration de RÉPARATION, elle nomme la table qu'elle attend :
    // une base montée pour un contrôle ciblé n'a pas forcément `cards`, et la
    // migration doit se REPORTER plutôt que d'échouer.
    siTable: 'cards',
    // LA COLONNE « RAPPORT » N'EXISTE PLUS (même schéma qu'aux migrations 37 et 80).
    //
    // Elle s'intercalait entre « Travail » et « À déployer » pour montrer un
    // travail rendu qui n'avait pas encore été poussé dans le lot. Personne ne
    // décidait ce passage : l'interrupteur de déploiement automatique le
    // faisait tout seul, ou la carte y dormait. Un rapport rendu range
    // désormais la carte DIRECTEMENT dans « À déployer »
    // (`COLONNE_DE_FIN_DE_TOUR`, `shared/src/suivi-colonne.ts`).
    //
    // Les cartes qui dormaient dans l'ancienne colonne doivent être reprises
    // AVANT toute lecture : leur clé n'est plus reconnue par le modèle
    // (`ColumnKey`, `shared/src/columns.ts`) et la carte ne se relirait pas —
    // elle disparaîtrait du tableau, ou ferait échouer le chargement du projet.
    //
    // DEUX SORTS, ET LE SECOND EST UN RATTRAPAGE. Une carte dont un message
    // avait rouvert le cadrage (`parcours.cadrageRouvertA`) attendait son
    // replacement en « Demande » (`rattraperLesRelancesRestees`, retiré avec
    // cette colonne) : elle y va, comme le rattrapage l'aurait fait. Toutes les
    // autres rejoignent « À déployer », le nouveau point d'arrivée d'un travail
    // rendu.
    //
    // Elles gardent leur position d'origine : l'ordre relatif à l'intérieur du
    // paquet est conservé. L'écriture est IDEMPOTENTE — rejouée sur une base
    // déjà reprise, elle ne touche aucune ligne.
    sql: `
      UPDATE cards SET column_key = 'planned'
        WHERE column_key = 'done' AND data LIKE '%"cadrageRouvertA":%';
      UPDATE cards SET column_key = 'to_deploy' WHERE column_key = 'done';
    `,
  },
  {
    id: 83,
    name: 'surveillance-alerte-courriel',
    siTable: 'sites_surveilles',
    /*
     * LE COURRIEL D'ALERTE DE LA SURVEILLANCE
     * (`shared/src/alerte-courriel-site.ts`).
     *
     * `alerte_courriel_le` est l'heure du dernier courriel PARTI — posée AVANT
     * l'envoi, exactement comme `incident_lance_le` (migration 75) : un envoi
     * refusé ne se rejoue pas à chaque contrôle, et le rappel de six heures se
     * tient sur cette date.
     *
     * `alerte_courriel_depuis` est le début de la panne ANNONCÉE : tant qu'il
     * est posé, la panne a déjà fait partir un courriel — on ne renvoie donc que
     * des rappels, et le retour à la normale mérite un mot. Les deux colonnes
     * sont effacées par le premier contrôle réussi.
     *
     * REPRISE ADDITIVE : nulles sur les lignes d'avant. Un site déjà surveillé
     * n'a donc aucun courriel en cours, et le premier ne partira qu'après trois
     * échecs d'affilée — jamais au premier passage suivant la mise en ligne.
     */
    sql: `
      ALTER TABLE sites_surveilles ADD COLUMN alerte_courriel_le INTEGER;
      ALTER TABLE sites_surveilles ADD COLUMN alerte_courriel_depuis INTEGER;
    `,
  },
  {
    id: 84,
    name: 'publication-remise-a-plat',
    siTable: 'projects',
    /*
     * LA REFONTE DE LA PUBLICATION (22/09/2026) — tous les projets repartent à
     * plat. Les anciens réglages ont été archivés AVANT, hors de la base
     * (`data/archives/publication-2026-09-22.json`) : l'agent d'initialisation
     * de la mise en production y relit l'ancienne recette de chaque projet.
     *
     *  - `miseEnProduction` est VIDÉ partout : aucun projet ne garde
     *    d'information de production tant qu'on ne l'a pas initialisé ;
     *  - `deploiement` ne garde que les deux réglages du déploiement simple
     *    (`shared/src/publication-simple.ts`), relevés projet par projet sur ce
     *    serveur : la commande de mise à jour, et les services à relancer. Les
     *    services qui CONSTRUISENT au démarrage (ProjetB, HaikoNote, ProjetE)
     *    n'ont pas de commande : leur redémarrage suffit. ERREUR pour Formations :
     *    son `start.sh` ne construit que si `.output` MANQUE, puis sert
     *    l'ancien — la commande « npm run build » lui est rendue par la 86 ;
     *  - `branchesDePublication` revient au schéma imposé, « dev » puis « main »
     *    (Maestria60+ produisait depuis « dev », HaikoNote, HaikoBill et
     *    ProjetE déployaient sur « main ») ;
     *  - le dépôt annexe de projetc suit la même règle.
     *
     * Une base qui n'a aucun de ces projets (essais, autre installation) voit
     * simplement ses réglages de publication vidés.
     */
    sql: `
      UPDATE projects
      SET data = json_set(
        data,
        '$.deploiement', json(CASE path
          WHEN '/root/HaikoNote' THEN '{"service":"autoproject-haikonote"}'
          WHEN '/root/bluemangocloud' THEN '{"service":"autoproject-bluemangocloud"}'
          WHEN '/root/projeta-saas' THEN '{"commande":"scripts/deploy_dev.sh"}'
          WHEN '/root/projeta-vps' THEN '{"service":"autoproject-projeta-vps"}'
          WHEN '/root/formations' THEN '{"service":"autoproject-formations"}'
          WHEN '/root/haiko-compta' THEN '{"commande":"npm run build"}'
          WHEN '/root/haiko-hetzner' THEN '{"service":"autoproject-haiko-hetzner"}'
          WHEN '/root/projete' THEN '{"service":"autoproject-projete"}'
          WHEN '/root/maestria' THEN '{"service":"autoproject-maestria"}'
          WHEN '/root/projetb' THEN '{"service":"autoproject-projetb-website autoproject-projetb-app"}'
          WHEN '/root/beluga-vitrine' THEN '{"commande":"scripts/mettre-en-ligne.sh"}'
          WHEN '/root/projetc' THEN '{"commande":"npm run build","service":"autoproject-projetc"}'
          WHEN '/root/haiko' THEN '{"commande":"npm run build","service":"haiko-vitrine"}'
          ELSE '{}' END),
        '$.miseEnProduction', json('{}'),
        '$.branchesDePublication', json('{}')
      );
      UPDATE projects
      SET data = json_set(
        data,
        '$.depots[0].deploiement', json('{"service":"autoproject-projetc-dashboard"}'),
        '$.depots[0].miseEnProduction', json('{}'),
        '$.depots[0].branchesDePublication', json('{}')
      )
      WHERE path = '/root/projetc' AND json_array_length(json_extract(data, '$.depots')) > 0;
    `,
  },
  {
    id: 85,
    name: 'haikodev-deploiement-standard',
    siTable: 'projects',
    /*
     * HAIKODEV SE DÉPLOIE COMME LES AUTRES (23/09/2026). La migration 84 lui
     * avait donné `scripts/mettre-en-ligne.sh` comme commande de mise à jour :
     * à chaque déploiement, ce script refaisait et ENREGISTRAIT la démonstration
     * embarquée, lançait un serveur d'essai et basculait Caddy — lent, et deux
     * déploiements y sont tombés. La recette devient la recette standard :
     * `scripts/construire.sh` (construction À CÔTÉ de ce qui est servi, puis
     * échange de `.output`), et le démon relance `beluga-vitrine`.
     * `mettre-en-ligne.sh` reste le geste de la mise en PRODUCTION.
     *
     * Ne touche que HaikoDev, et seulement s'il porte encore l'ancienne
     * commande : un réglage modifié entre-temps à la main est respecté.
     */
    sql: `
      UPDATE projects
      SET data = json_set(data, '$.deploiement', json('{"commande":"scripts/construire.sh","service":"beluga-vitrine"}'))
      WHERE path = '/root/beluga-vitrine'
        AND json_extract(data, '$.deploiement.commande') = 'scripts/mettre-en-ligne.sh';
    `,
  },
  {
    id: 86,
    name: 'formations-reconstruit-au-deploiement',
    siTable: 'projects',
    /*
     * FORMATIONS SE RECONSTRUIT À CHAQUE DÉPLOIEMENT (22/09/2026). La 84 l'a
     * rangé à tort parmi les services qui construisent au démarrage : son
     * `start.sh` sert `.output` tel quel s'il existe. Le déploiement relançait
     * donc le service sur la construction du matin. La commande est rendue au
     * projet, et seulement s'il n'en a aucune : un réglage posé entre-temps à
     * la main est respecté.
     */
    sql: `
      UPDATE projects
      SET data = json_set(data, '$.deploiement.commande', 'npm run build')
      WHERE path = '/root/formations'
        AND json_type(data, '$.deploiement') = 'object'
        AND COALESCE(json_extract(data, '$.deploiement.commande'), '') = '';
    `,
  },
  {
    id: 87,
    name: 'cartes-index-des-mises-en-ligne',
    siTable: 'cards',
    /*
     * L'ONGLET « TERMINÉ » DE LA PAGE « EN ROUTE » (`cartesDeployees`) lit les
     * cartes archivées par date de mise en ligne, tous projets confondus : sans
     * index, chaque paquet parcourrait toutes les archives.
     */
    sql: `
      CREATE INDEX IF NOT EXISTS idx_cards_deployees ON cards(column_key, deployed_at, id);
    `,
  },
  {
    id: 88,
    name: 'cartes-index-de-la-derniere-action',
    siTable: 'cards',
    /*
     * LES DEUX ONGLETS DE LA PAGE « EN ROUTE » se rangent désormais par
     * DERNIÈRE ACTION (`updated_at DESC, id DESC`), colonne par colonne : sans
     * index, chaque paquet trierait toutes les cartes de la base.
     */
    sql: `
      CREATE INDEX IF NOT EXISTS idx_cards_derniere_action ON cards(column_key, updated_at, id);
    `,
  },
  {
    id: 89,
    name: 'cartes-colonne-de-la-carte-mere',
    siTable: 'cards',
    /*
     * LES CARTES D'UNE DEMANDE COMMUNE S'EMPILENT sur la page « Tableaux de
     * bord » (`famillesParDerniereAction`) : la mère et ses filles forment UNE
     * entrée, rangée dans « Actifs » ou « Terminés » selon l'état de TOUTE la
     * famille. Le lien fille → mère sort du JSON en vraie colonne indexée
     * (« les champs d'une carte sont de vraies colonnes ») : sans elle, chaque
     * paquet relirait le JSON des milliers de cartes archivées.
     */
    sql: `
      ALTER TABLE cards ADD COLUMN carte_mere_id TEXT;
      UPDATE cards SET carte_mere_id = json_extract(data, '$.carteMereId'),
                       data = json_remove(data, '$.carteMereId')
       WHERE json_extract(data, '$.carteMereId') IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_cards_carte_mere ON cards(carte_mere_id) WHERE carte_mere_id IS NOT NULL;
    `,
  },
  {
    id: 90,
    name: 'atelier-marketing',
    /*
     * L'ATELIER MARKETING (`shared/src/marketing.ts`, `server/src/marketing.ts`).
     *
     *  - `marketing_espaces` : un par projet — son agent attitré, la CLÉ
     *    PUBLIQUE de son script de suivi, sa configuration en vraies colonnes
     *    (nature, hébergement, adresse, état du suivi…) et sa fiche commerciale
     *    (un texte rédigé, gardé tel quel) ;
     *  - `marketing_contenus` : posts, courriels, annonces — leur étape, leur
     *    date prévue et leur lien de suivi. `source_ref` empêche d'annoncer deux
     *    fois la même livraison ;
     *  - `marketing_evenements` : les passages reçus des sites, SANS adresse IP
     *    ni donnée personnelle (visiteur = hachage au sel du jour), effacés
     *    après 90 jours ;
     *  - `marketing_ventes` : une ligne par vente, dédoublonnée par sa
     *    référence de commande.
     *
     * Tout est NEUF : aucune donnée existante n'est touchée, et la migration se
     * rejoue sans dommage (IF NOT EXISTS).
     */
    sql: `
      CREATE TABLE IF NOT EXISTS marketing_espaces (
        project_id TEXT PRIMARY KEY,
        agent_id TEXT,
        card_id TEXT,
        cle_suivi TEXT NOT NULL UNIQUE,
        nature TEXT,
        hebergement TEXT,
        hebergement_detail TEXT,
        adresse TEXT,
        origines TEXT NOT NULL DEFAULT '[]',
        sources_ventes TEXT NOT NULL DEFAULT '[]',
        objectifs TEXT NOT NULL DEFAULT '[]',
        canaux TEXT NOT NULL DEFAULT '[]',
        methode_suivi TEXT,
        etat_suivi TEXT NOT NULL DEFAULT 'absent',
        langue TEXT NOT NULL DEFAULT 'fr',
        explication TEXT,
        fiche TEXT NOT NULL DEFAULT '{}',
        suivi_verifie_le INTEGER,
        plan_hebdo_pour TEXT,
        cree_le INTEGER NOT NULL,
        maj_le INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_marketing_espaces_agent ON marketing_espaces(agent_id) WHERE agent_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS marketing_contenus (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        genre TEXT NOT NULL,
        canal TEXT NOT NULL,
        titre TEXT NOT NULL,
        texte TEXT NOT NULL,
        date_prevue TEXT,
        heure_prevue TEXT,
        etape TEXT NOT NULL,
        origine TEXT NOT NULL,
        variante_de TEXT,
        lien_code TEXT UNIQUE,
        lien_cible TEXT,
        url_publiee TEXT,
        raison_echec TEXT,
        source_ref TEXT,
        cree_le INTEGER NOT NULL,
        maj_le INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_marketing_contenus_projet ON marketing_contenus(project_id, etape);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_contenus_source ON marketing_contenus(project_id, source_ref) WHERE source_ref IS NOT NULL;
      CREATE TABLE IF NOT EXISTS marketing_evenements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        instant INTEGER NOT NULL,
        type TEXT NOT NULL,
        chemin TEXT,
        source TEXT,
        contenu_id TEXT,
        visiteur TEXT NOT NULL,
        visite TEXT,
        duree_ms INTEGER,
        montant_centimes INTEGER,
        devise TEXT,
        reference TEXT,
        objectif TEXT,
        variante TEXT,
        retour INTEGER NOT NULL DEFAULT 0,
        appareil TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_marketing_evenements_projet ON marketing_evenements(project_id, instant);
      CREATE INDEX IF NOT EXISTS idx_marketing_evenements_instant ON marketing_evenements(instant);
      CREATE TABLE IF NOT EXISTS marketing_ventes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        instant INTEGER NOT NULL,
        montant_centimes INTEGER NOT NULL,
        devise TEXT NOT NULL,
        source TEXT NOT NULL,
        reference TEXT,
        visiteur TEXT,
        contenu_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_marketing_ventes_projet ON marketing_ventes(project_id, instant);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_ventes_reference ON marketing_ventes(project_id, reference) WHERE reference IS NOT NULL;
    `,
  },
  {
    id: 91,
    name: 'rapport-marketing',
    /*
     * LE RAPPORT DE L'AGENT MARKETING, rangé comme une procédure : écrit par
     * l'outil « marketing » (action « rapport »), relu dans le tiroir de
     * l'agent, refait sur « Réanalyser ». Deux vraies colonnes de l'espace.
     */
    sql: `
      ALTER TABLE marketing_espaces ADD COLUMN rapport TEXT;
      ALTER TABLE marketing_espaces ADD COLUMN rapport_le INTEGER;
    `,
  },
  {
    id: 92,
    name: 'plan-marketing',
    /*
     * L'AGENT MARKETING ORIENTE UN DÉBUTANT : son avis sur chaque canal du
     * catalogue (`recommandations_canaux`, JSON), et le PLAN D'ACTION daté
     * qu'il pose dans le calendrier — une chose à faire par ligne, cochée par
     * l'utilisateur (`fait_le`).
     */
    sql: `
      ALTER TABLE marketing_espaces ADD COLUMN recommandations_canaux TEXT NOT NULL DEFAULT '[]';
      CREATE TABLE IF NOT EXISTS marketing_actions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        titre TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        canal TEXT,
        date_prevue TEXT,
        fait_le INTEGER,
        cree_le INTEGER NOT NULL,
        maj_le INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_marketing_actions_projet ON marketing_actions(project_id, date_prevue);
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
  // Le passage des anciens noms de la sauvegarde des sites, AVANT les
  // migrations (bloc éphémère, voir `passage-backups.ts`).
  for (const fait of passerLaBaseAuxBackups(database)) log.info(`passage aux backups : ${fait}`);
  // L'ancienne mémoire est écrite en entier AVANT que sa migration de retrait ne passe.
  try {
    const sauvegarde = sauvegarderLAncienneMemoire(database, path.dirname(PATHS.db));
    if (sauvegarde) log.info(`ancienne mémoire sauvegardée avant son retrait : ${sauvegarde}`);
  } catch (err) {
    log.error(`ancienne mémoire : sauvegarde impossible (${(err as Error).message}) — le démarrage s'arrête pour ne rien perdre`);
    throw err;
  }
  // UN NUMÉRO REPRIS PAR UNE AUTRE MIGRATION NE FAIT PLUS SAUTER DU TRAVAIL.
  //
  // Le 8 septembre 2026, une fusion a renuméroté une migration déjà passée :
  // « retirer-le-journal-des-envois-au-cerveau » portait le 49 dans la base
  // servie, le code lui a donné le 50 et a offert le 49 à
  // « index-message-en-ecriture ». Le registre contenant déjà un 49, la
  // nouvelle migration a été sautée POUR TOUJOURS — sans un mot. La colonne
  // `messages.streaming` n'a jamais existé, et `saveMessage` est tombée à
  // CHAQUE message : plus une seule carte ne pouvait être lancée.
  //
  // Le numéro reste la clé — une base ancienne peut très bien porter des noms
  // d'époque que le code ne connaît plus, et ces numéros-là font foi. Ce qui
  // change, c'est le cas où le nom inscrit à un numéro appartient, DANS LE
  // CODE, à une AUTRE migration : là, le numéro a été repris, le travail
  // attendu ici n'a jamais été fait, et on l'applique. Le registre est corrigé
  // au passage (`ON CONFLICT(id)`) pour qu'il finisse par dire la vérité.
  //
  // Le garde-fou d'ensemble est `node scripts/verif-schema-base.mjs`, et la
  // réparation sans couper le démon `node scripts/rejouer-migrations.mjs`.
  const dejaFaites = database.prepare('SELECT id, name FROM migrations').all() as {
    id: number;
    name: string | null;
  }[];
  const nomsFaits = new Set<string>(dejaFaites.map((r) => r.name ?? '').filter(Boolean));
  const nomParId = new Map<number, string | null>(dejaFaites.map((r) => [r.id, r.name]));
  const numeroDuNomDansLeCode = new Map<string, number>();

  // Deux migrations de même nom rendraient ce registre aveugle : la seconde
  // passerait pour faite. On refuse de démarrer plutôt que de sauter du travail.
  for (const migration of MIGRATIONS) {
    if (numeroDuNomDansLeCode.has(migration.name)) {
      throw new Error(
        `migrations : le nom « ${migration.name} » est utilisé deux fois — un nom de migration est unique`,
      );
    }
    numeroDuNomDansLeCode.set(migration.name, migration.id);
  }

  const tableExiste = (nom: string) =>
    !!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nom);

  for (const migration of MIGRATIONS) {
    if (nomsFaits.has(migration.name)) continue;
    const occupant = nomParId.get(migration.id);
    if (occupant !== undefined) {
      // Le numéro est pris. Par une autre migration DU CODE ? Alors il a été
      // repris et ce travail-ci n'a jamais eu lieu. Par un nom que le code ne
      // connaît plus (base ancienne) ? Le numéro fait foi, on passe.
      const reprisPar = occupant ? numeroDuNomDansLeCode.get(occupant) : undefined;
      if (reprisPar === undefined || reprisPar === migration.id) continue;
      log.warn(
        `migration ${migration.id} (${migration.name}) : numéro repris par « ${occupant }` +
          `» (n° ${reprisPar} dans le code) — le travail n'a jamais été fait, on l'applique`,
      );
    }
    const attendues = migration.siTable
      ? Array.isArray(migration.siTable)
        ? migration.siTable
        : [migration.siTable]
      : [];
    const absentes = attendues.filter((nom) => !tableExiste(nom));
    if (absentes.length) {
      log.info(`migration ${migration.id} (${migration.name}) reportée : table ${absentes.join(', ')} absente`);
      continue;
    }
    const run = database.transaction(() => {
      database.exec(migration.sql);
      database
        .prepare(
          `INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, applied_at = excluded.applied_at`,
        )
        .run(migration.id, migration.name, Date.now());
    });
    run();
    nomsFaits.add(migration.name);
    nomParId.set(migration.id, migration.name);
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
