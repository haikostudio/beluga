import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Card, carteDepuisLigne, colonnesDeLaCarte, resteLibreDeLaCarte } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* LES CHAMPS DES CARTES, SORTIS DU BLOC JSON                           */
/*                                                                      */
/* Les champs stables sont de VRAIES colonnes, les listes variables ont  */
/* leur table fille, et le bloc `data` ne garde que le vraiment libre.   */
/* Ce qui compte : une base d'AVANT retrouve tout après la migration, et */
/* une carte écrite puis relue est identique à elle-même.                */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'carte-sql-'));
process.env.HAIKODEV_DATA = bacASable;

/** Une carte complète, telle qu'elle était rangée AVANT : tout en JSON. */
const CARTE_ANCIENNE = {
  id: 'carte-ancienne',
  projectId: 'projet-1',
  title: 'Une carte venue de la base d’avant',
  description: 'Constat, attendu, limites, vérification.',
  labels: ['urgent', 'base'],
  column: 'todo',
  position: 1_700_000_000_000,
  origin: 'agent',
  attachments: ['/data/attachments/une-image.png', '/data/attachments/deux.png'],
  run: { engine: 'codex', model: 'gpt-5.4', thinking: 'medium', mode: 'plan' },
  estimate: { machineSeconds: 600, failed: false },
  analyseDemandee: true,
  analysisContext: 'Le chef a déjà tout regardé.',
  scheduling: { asap: false, attempts: 2, restarts: 0, waitingReason: 'dossier occupé' },
  agentId: 'agent-42',
  conversationAgentId: 'agent-chef',
  github: { branch: 'tache/essai', commits: [], comments: [] },
  closureDoc: 'docs/cloture.md',
  excludedFromDeploy: true,
  lastReadAt: 1_700_000_001_000,
  horsTache: true,
  sansModification: 'aucun fichier n’a changé',
  codeDejaEnregistre: true,
  createdAt: 1_699_000_000_000,
  updatedAt: 1_700_000_000_000,
  doneAt: 1_700_000_002_000,
  deployedAt: 1_700_000_003_000,
  archivedAt: 1_700_000_004_000,
};

/* On fabrique la base D'AVANT : la table `cards` d'origine, les migrations 1 à
   16 déjà posées. L'ouverture par le démon n'appliquera donc que la 17. */
fs.mkdirSync(bacASable, { recursive: true });
const avant = new Database(path.join(bacASable, 'haikodev.db'));
avant.exec(`
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
  CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER);
`);
for (let id = 1; id <= 16; id += 1) {
  avant.prepare('INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)').run(id, `ancienne-${id}`, 1);
}
avant
  .prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  .run(
    CARTE_ANCIENNE.id,
    CARTE_ANCIENNE.projectId,
    CARTE_ANCIENNE.column,
    CARTE_ANCIENNE.position,
    CARTE_ANCIENNE.title,
    JSON.stringify(CARTE_ANCIENNE),
    CARTE_ANCIENNE.deployedAt,
    CARTE_ANCIENNE.createdAt,
    CARTE_ANCIENNE.updatedAt,
  );
avant.close();

const store = await import('../store.js');
const { getDb } = await import('../db.js');

/* ------------------------------------------------------------------ */
/* La traduction pure, sans base                                        */
/* ------------------------------------------------------------------ */

test('le bloc libre ne garde plus un champ devenu colonne', () => {
  const carte = Card.parse(CARTE_ANCIENNE);
  const reste = resteLibreDeLaCarte(carte);
  for (const parti of ['title', 'description', 'labels', 'attachments', 'run', 'agentId', 'doneAt', 'archivedAt']) {
    assert.ok(!(parti in reste), `${parti} devrait avoir quitté le JSON`);
  }
  // Ce qui n'a pas de forme fixe reste, lui, dans le bloc libre.
  for (const garde of ['estimate', 'scheduling', 'github', 'analysisContext', 'closureDoc', 'sansModification']) {
    assert.ok(garde in reste, `${garde} devrait rester dans le JSON`);
  }
});

test('une carte découpée en colonnes puis recollée est la même', () => {
  const carte = Card.parse(CARTE_ANCIENNE);
  const colonnes = colonnesDeLaCarte(carte);
  const relue = carteDepuisLigne(colonnes, { labels: carte.labels, attachments: carte.attachments });
  assert.deepEqual(relue, carte);
});

test('une colonne vide laisse le bloc libre répondre', () => {
  // Une ligne posée par un outil extérieur : tout en JSON, aucune colonne neuve.
  const relue = carteDepuisLigne({
    id: CARTE_ANCIENNE.id,
    project_id: CARTE_ANCIENNE.projectId,
    column_key: CARTE_ANCIENNE.column,
    position: CARTE_ANCIENNE.position,
    title: CARTE_ANCIENNE.title,
    data: JSON.stringify(CARTE_ANCIENNE),
    created_at: CARTE_ANCIENNE.createdAt,
    updated_at: CARTE_ANCIENNE.updatedAt,
  });
  assert.deepEqual(relue, Card.parse(CARTE_ANCIENNE));
});

/* ------------------------------------------------------------------ */
/* La migration d'une base d'avant                                      */
/* ------------------------------------------------------------------ */

test('la migration recopie la carte d’avant sans rien perdre', () => {
  const relue = store.getCard(CARTE_ANCIENNE.id);
  assert.ok(relue);
  assert.deepEqual(relue, Card.parse(CARTE_ANCIENNE));
});

test('les champs recopiés sont interrogeables en SQL, sans décoder le JSON', () => {
  const ligne = getDb()
    .prepare(
      `SELECT description, origin, agent_id, analyse_demandee, hors_tache, excluded_from_deploy,
              code_deja_enregistre, done_at, archived_at, last_read_at, run_engine, run_model,
              run_thinking, run_mode, data
         FROM cards WHERE id = ?`,
    )
    .get(CARTE_ANCIENNE.id) as Record<string, unknown>;
  assert.equal(ligne.description, CARTE_ANCIENNE.description);
  assert.equal(ligne.origin, 'agent');
  assert.equal(ligne.agent_id, 'agent-42');
  assert.equal(ligne.analyse_demandee, 1);
  assert.equal(ligne.hors_tache, 1);
  assert.equal(ligne.excluded_from_deploy, 1);
  assert.equal(ligne.code_deja_enregistre, 1);
  assert.equal(ligne.done_at, CARTE_ANCIENNE.doneAt);
  assert.equal(ligne.archived_at, CARTE_ANCIENNE.archivedAt);
  assert.equal(ligne.last_read_at, CARTE_ANCIENNE.lastReadAt);
  assert.equal(ligne.run_engine, 'codex');
  assert.equal(ligne.run_model, 'gpt-5.4');
  assert.equal(ligne.run_thinking, 'medium');
  assert.equal(ligne.run_mode, 'plan');
  // Le bloc libre est allégé : plus de titre ni de réglages dedans.
  const reste = JSON.parse(String(ligne.data));
  assert.ok(!('title' in reste) && !('run' in reste) && !('labels' in reste));
  assert.ok('estimate' in reste && 'scheduling' in reste);
});

test('les étiquettes et les pièces jointes ont pris leur table fille', () => {
  const etiquettes = getDb()
    .prepare('SELECT label FROM card_labels WHERE card_id = ? ORDER BY position')
    .all(CARTE_ANCIENNE.id) as { label: string }[];
  assert.deepEqual(etiquettes.map((e) => e.label), CARTE_ANCIENNE.labels);
  const pieces = getDb()
    .prepare('SELECT path FROM card_attachments WHERE card_id = ? ORDER BY position')
    .all(CARTE_ANCIENNE.id) as { path: string }[];
  assert.deepEqual(pieces.map((p) => p.path), CARTE_ANCIENNE.attachments);
});

/* ------------------------------------------------------------------ */
/* L'écriture, désormais                                                */
/* ------------------------------------------------------------------ */

test('une carte écrite puis relue garde tous ses champs', () => {
  const ecrite = store.saveCard(
    Card.parse({ ...CARTE_ANCIENNE, id: 'carte-neuve', labels: ['a', 'b', 'c'], title: 'Carte neuve' }),
  );
  const relue = store.getCard('carte-neuve');
  assert.deepEqual(relue, ecrite);
  assert.deepEqual(relue?.labels, ['a', 'b', 'c']);
});

test('une liste vidée ne laisse aucune ligne fille derrière elle', () => {
  const carte = store.getCard('carte-neuve');
  assert.ok(carte);
  store.saveCard({ ...carte, labels: [], attachments: [] });
  const restantes = getDb()
    .prepare('SELECT COUNT(*) AS n FROM card_labels WHERE card_id = ?')
    .get('carte-neuve') as { n: number };
  assert.equal(restantes.n, 0);
  assert.deepEqual(store.getCard('carte-neuve')?.labels, []);
});

test('une carte effacée emporte ses listes filles', () => {
  store.deleteCard('carte-neuve');
  const pieces = getDb()
    .prepare('SELECT COUNT(*) AS n FROM card_attachments WHERE card_id = ?')
    .get('carte-neuve') as { n: number };
  assert.equal(pieces.n, 0);
});

test('les cartes d’un projet se relisent en lot, listes filles comprises', () => {
  const cartes = store.listCards(CARTE_ANCIENNE.projectId);
  assert.equal(cartes.length, 1);
  assert.deepEqual(cartes[0].labels, CARTE_ANCIENNE.labels);
  assert.deepEqual(cartes[0].attachments, CARTE_ANCIENNE.attachments);
});
