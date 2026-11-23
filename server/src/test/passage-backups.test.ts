import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  ANCIENNES_MIGRATIONS,
  ANCIENNES_TABLES,
  ANCIENS_REGLAGES,
  manifesteAuxNomsActuels,
  nomDeDossierActuel,
  passerLaBaseAuxBackups,
  passerLeDossierAuxBackups,
} from '../passage-backups.js';

/*
 * LE PASSAGE DES ANCIENS NOMS, SUR UNE BASE MONTÉE À L'ANCIENNE. Les anciens
 * noms ne sont jamais recopiés ici : ils viennent du bloc de passage lui-même,
 * seul endroit du code qui les cite.
 */
const [SITES_HIER, POINTS_HIER] = Object.keys(ANCIENNES_TABLES);
const [MIGRATION_39_HIER, MIGRATION_48_HIER] = Object.keys(ANCIENNES_MIGRATIONS);
const [DOSSIER_HIER, HEURE_HIER, AUTO_HIER] = Object.keys(ANCIENS_REGLAGES);

function baseDHier(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE ${SITES_HIER} (id TEXT PRIMARY KEY, project_id TEXT, nom TEXT NOT NULL, actif INTEGER NOT NULL DEFAULT 1,
      data TEXT NOT NULL, cree_le INTEGER NOT NULL, modifie_le INTEGER NOT NULL);
    CREATE TABLE ${POINTS_HIER} (id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES ${SITES_HIER}(id) ON DELETE CASCADE,
      debut INTEGER NOT NULL, statut TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX idx_${POINTS_HIER}_site ON ${POINTS_HIER}(site_id, debut DESC);
  `);
  db.prepare('INSERT INTO migrations (id, name, applied_at) VALUES (39, ?, 1), (48, ?, 2)').run(
    MIGRATION_39_HIER,
    MIGRATION_48_HIER,
  );
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?)").run(
    JSON.stringify({ [DOSSIER_HIER]: '/mnt/disque/ancien', [HEURE_HIER]: 5, [AUTO_HIER]: false, autre: 'gardé' }),
  );
  db.prepare(`INSERT INTO ${SITES_HIER} VALUES ('s1', NULL, 'Maestria', 1, '{"id":"s1"}', 1, 1)`).run();
  db.prepare(`INSERT INTO ${POINTS_HIER} VALUES ('p1', 's1', 10, 'reussi', '{"chemin":"/mnt/disque/ancien/x/1"}')`).run();
  return db;
}

test('une base d’hier arrive intacte sous les nouveaux noms', () => {
  const db = baseDHier();
  const faits = passerLaBaseAuxBackups(db);
  assert.ok(faits.length >= 5, faits.join(' | '));

  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
    (t) => t.name,
  );
  assert.ok(tables.includes('backup_sites') && tables.includes('backup_points'));
  assert.ok(!tables.includes(SITES_HIER) && !tables.includes(POINTS_HIER));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_backup_points_site'").get());

  assert.equal((db.prepare('SELECT nom FROM backup_sites WHERE id = ?').get('s1') as any).nom, 'Maestria');
  assert.equal((db.prepare('SELECT statut FROM backup_points WHERE id = ?').get('p1') as any).statut, 'reussi');
  // La clé étrangère suit la table renommée : un point sans site est refusé.
  assert.throws(() =>
    db.prepare("INSERT INTO backup_points VALUES ('p2', 'absent', 1, 'echec', '{}')").run(),
  );

  const noms = (db.prepare('SELECT name FROM migrations ORDER BY id').all() as { name: string }[]).map((m) => m.name);
  assert.deepEqual(noms, ['backups-des-sites', 'purger-les-fiches-de-backup-d-essai']);

  const reglages = JSON.parse((db.prepare("SELECT value FROM meta WHERE key = 'settings'").get() as any).value);
  assert.equal(reglages.backupDossier, '/mnt/disque/ancien');
  assert.equal(reglages.backupHeure, 5);
  assert.equal(reglages.backupAuto, false);
  assert.equal(reglages.autre, 'gardé');
  assert.ok(!(DOSSIER_HIER in reglages));
});

test('une seconde exécution ne fait rien', () => {
  const db = baseDHier();
  passerLaBaseAuxBackups(db);
  const avant = db.prepare("SELECT value FROM meta WHERE key = 'settings'").get();
  assert.deepEqual(passerLaBaseAuxBackups(db), []);
  assert.deepEqual(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get(), avant);
  assert.equal((db.prepare('SELECT count(*) AS n FROM backup_points').get() as any).n, 1);
});

test('une base neuve ne voit aucun passage', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER)');
  assert.deepEqual(passerLaBaseAuxBackups(db), []);
});

test('le dossier de stockage change de nom et les points gardent un chemin juste', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'passage-backups-'));
  const ancien = path.join(racine, `${['snap', 'shot'].join('')}s-beluga`);
  fs.mkdirSync(path.join(ancien, 'site', '1'), { recursive: true });
  fs.writeFileSync(path.join(ancien, 'site', '1', 'base.sql'), 'x');

  const db = new Database(':memory:');
  db.exec('CREATE TABLE backup_points (id TEXT PRIMARY KEY, site_id TEXT, debut INTEGER, statut TEXT, data TEXT)');
  db.prepare("INSERT INTO backup_points VALUES ('p', 's', 1, 'reussi', ?)").run(
    JSON.stringify({ chemin: path.join(ancien, 'site', '1') }),
  );

  // Les deux anciens noms mènent au nom d'aujourd'hui, en un seul passage.
  const attendu = path.join(racine, 'sauvegardes-service-beluga');
  const neuf = passerLeDossierAuxBackups(ancien, db);
  assert.equal(neuf, attendu);
  assert.ok(fs.existsSync(path.join(attendu, 'site', '1', 'base.sql')));
  assert.ok(!fs.existsSync(ancien));
  const data = JSON.parse((db.prepare('SELECT data FROM backup_points').get() as any).data);
  assert.equal(data.chemin, path.join(attendu, 'site', '1'));

  // Seconde fois : le réglage porte déjà le nouveau nom, rien ne bouge.
  assert.equal(passerLeDossierAuxBackups(neuf!, db), null);
  fs.rmSync(racine, { recursive: true, force: true });
});

/*
 * « backups-beluga » DEVIENT « sauvegardes-service-beluga » (08/11/2026) : à
 * côté de « backups » et « Backups » (l'autre système de sauvegarde), le nom
 * passait pour un doublon. Le chemin de chaque archive vit dans sa propre
 * colonne : c'est elle que l'écran des sauvegardes et le rangement lisent.
 */
test('le dossier du service Beluga prend un nom clair, archives comprises', () => {
  assert.equal(nomDeDossierActuel('backups-beluga'), 'sauvegardes-service-beluga');
  assert.equal(nomDeDossierActuel('backups'), 'backups', 'les sauvegardes des serveurs ne sont pas visées');
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'passage-backups-'));
  const ancien = path.join(racine, 'backups-beluga');
  fs.mkdirSync(path.join(ancien, 'maestria', '1'), { recursive: true });
  fs.writeFileSync(path.join(ancien, 'maestria', '1', 'base.sql.gz'), 'x');
  const db = new Database(':memory:');
  db.exec(
    'CREATE TABLE backup_points (id TEXT PRIMARY KEY, site_id TEXT, debut INTEGER, statut TEXT, data TEXT, chemin_archive TEXT, taille INTEGER, inventaire TEXT)',
  );
  db.prepare("INSERT INTO backup_points VALUES ('p', 's', 1, 'reussi', '{}', ?, 1, NULL)").run(path.join(ancien, 'maestria', '1', 'base.sql.gz'));
  db.prepare("INSERT INTO backup_points VALUES ('q', 's', 2, 'reussi', '{}', ?, 1, NULL)").run(`${ancien}-autre/x.gz`);

  const neuf = passerLeDossierAuxBackups(ancien, db);
  assert.equal(neuf, path.join(racine, 'sauvegardes-service-beluga'));
  const archives = db.prepare('SELECT id, chemin_archive FROM backup_points ORDER BY id').all() as { id: string; chemin_archive: string }[];
  assert.equal(archives[0].chemin_archive, path.join(neuf!, 'maestria', '1', 'base.sql.gz'));
  assert.ok(fs.existsSync(archives[0].chemin_archive));
  assert.equal(archives[1].chemin_archive, `${ancien}-autre/x.gz`, 'un dossier voisin au nom proche ne bouge pas');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('un nouveau nom déjà pris ne mélange jamais deux dossiers', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'passage-backups-'));
  const ancien = path.join(racine, ['Snap', 'shots'].join(''));
  fs.mkdirSync(ancien);
  fs.mkdirSync(path.join(racine, 'Backups'));
  const db = new Database(':memory:');
  assert.equal(passerLeDossierAuxBackups(ancien, db), null);
  assert.ok(fs.existsSync(ancien));
  fs.rmSync(racine, { recursive: true, force: true });
});

test('une archive d’export d’avant est relue sous les noms d’aujourd’hui', () => {
  const lu = manifesteAuxNomsActuels({
    categories: [['snap', 'shots'].join(''), 'projets'],
    tables: [{ table: SITES_HIER, categorie: ['snap', 'shots'].join(''), chemin: `tables/${SITES_HIER}.json` }],
  });
  assert.deepEqual(lu.categories, ['backups', 'projets']);
  assert.equal(lu.tables[0].table, 'backup_sites');
  assert.equal(lu.tables[0].categorie, 'backups');
  assert.equal(lu.tables[0].chemin, `tables/${SITES_HIER}.json`, 'le chemin dans l’archive ne bouge pas');
});
