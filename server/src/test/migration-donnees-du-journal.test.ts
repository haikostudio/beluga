import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { bornerTexte, PLAFOND_PARAMS } from '@beluga/shared';
import { MIGRATIONS } from '../db.js';

/* ------------------------------------------------------------------ */
/* LES DONNÉES DE JALON COUPÉES PAR L'ANCIEN BORNAGE SE RÉPARENT        */
/*                                                                      */
/* Une demande à 54 images avait perdu ses vignettes, une compréhension  */
/* à longue partie technique ses hypothèses et ses résumés. La migration */
/* repose ce que le message et la carte portent encore — et ne touche    */
/* rien d'autre, même rejouée.                                           */
/* ------------------------------------------------------------------ */

/** Ce que l'ancien bornage écrivait : le JSON indenté, coupé à 2000 signes. */
const coupe = (donnees: unknown) => bornerTexte(JSON.stringify(donnees, null, 2), PLAFOND_PARAMS);

function base() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE card_journal (
      id TEXT PRIMARY KEY, card_id TEXT NOT NULL, rang INTEGER NOT NULL, nature TEXT NOT NULL, at INTEGER NOT NULL,
      agent_id TEXT, tour_id TEXT, libelle TEXT NOT NULL DEFAULT '', donnees TEXT
    );
    CREATE TABLE messages (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, role TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE cards (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  `);
  const jalon = db.prepare(
    'INSERT INTO card_journal (id, card_id, rang, nature, at, agent_id, tour_id, libelle, donnees) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const message = db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)');
  const lire = (id: string) => (db.prepare('SELECT donnees FROM card_journal WHERE id = ?').get(id) as { donnees: string }).donnees;
  return { db, jalon, message, lire };
}

const migration = MIGRATIONS.find((item) => item.name === 'donnees-du-journal-coupees');

test('les pièces d’une demande reviennent du message, sans perdre la synthèse', () => {
  assert.ok(migration);
  const { db, jalon, message, lire } = base();
  const pieces = Array.from({ length: 54 }, (_, i) => `978141b5-525a-4db0-8721-${String(i).padStart(12, '0')}`);
  message.run('m1', 'a1', 'user', JSON.stringify({ attachments: pieces }), 100);
  message.run('m2', 'a1', 'user', JSON.stringify({ attachments: pieces }), 200);
  message.run('m3', 'a1', 'user', JSON.stringify({ attachments: [] }), 300);
  message.run('m4', 'a1', 'user', JSON.stringify({ attachments: ['p1'] }), 400);
  /* Écrasé par la synthèse : il ne reste qu'elle. */
  jalon.run('ecrase', 'c1', 0, 'jalon', 100, 'a1', null, 'Demande', JSON.stringify({ resumeDemande: 'Une refonte.' }, null, 2));
  /* Coupé, pas encore écrasé : la liste ne se relit plus. */
  jalon.run('coupe', 'c1', 1, 'jalon', 200, 'a1', null, 'Demande', coupe({ messageId: 'm2', ecriteLe: 200, pieces }));
  /* Sans pièce jointe, et en bon état : aucun des deux ne bouge. */
  const sansPiece = JSON.stringify({ messageId: 'm3', ecriteLe: 300 }, null, 2);
  const sain = JSON.stringify({ messageId: 'm4', ecriteLe: 400, pieces: ['p1'] }, null, 2);
  jalon.run('sans-piece', 'c1', 2, 'jalon', 300, 'a1', null, 'Demande', sansPiece);
  jalon.run('sain', 'c1', 3, 'jalon', 400, 'a1', null, 'Demande', sain);

  db.exec(migration.sql);
  assert.deepEqual(JSON.parse(lire('ecrase')), { messageId: 'm1', ecriteLe: 100, pieces, resumeDemande: 'Une refonte.' });
  assert.deepEqual(JSON.parse(lire('coupe')), { messageId: 'm2', ecriteLe: 200, pieces });
  assert.equal(lire('sans-piece'), sansPiece);
  assert.equal(lire('sain'), sain);

  /* REJOUABLE : une seconde passe ne retouche rien. */
  const apres = db.prepare('SELECT id, donnees FROM card_journal ORDER BY id').all();
  db.exec(migration.sql);
  assert.deepEqual(db.prepare('SELECT id, donnees FROM card_journal ORDER BY id').all(), apres);
  db.close();
});

test('une compréhension coupée reprend celle de sa carte, ou garde ce qui précédait la coupure', () => {
  assert.ok(migration);
  const { db, jalon, lire } = base();
  const comprehension = {
    hypotheses: ['Je suppose que le rythme est de dix minutes.'],
    sujets: ['interface'],
    partieTechnique: { decoupe: [{ titre: 'Diagnostic', detail: 'x'.repeat(3000) }] },
    resumeDemande: 'Des vignettes.',
    resumeComprehension: 'Les vignettes reviennent.',
  };
  db.prepare('INSERT INTO cards (id, data) VALUES (?, ?)').run(
    'c1',
    JSON.stringify({ parcours: { comprehension: { ...comprehension, texte: 'compris', at: 2, tourId: 'T2' } } }),
  );
  /* Le tour que la carte porte encore, et un tour plus ancien qu'elle a remplacé. */
  jalon.run('dernier', 'c1', 1, 'jalon', 2, 'a1', 'T2', 'Compréhension', coupe(comprehension));
  jalon.run('ancien', 'c1', 0, 'jalon', 1, 'a1', 'T1', 'Compréhension', coupe({ ...comprehension, hypotheses: ['Ancienne.'] }));
  const sain = JSON.stringify({ hypotheses: [], sujets: [] }, null, 2);
  jalon.run('sain', 'c1', 2, 'jalon', 3, 'a1', 'T3', 'Compréhension', sain);

  db.exec(migration.sql);
  assert.deepEqual(JSON.parse(lire('dernier')), comprehension, 'recopiée entière depuis la carte');
  assert.deepEqual(JSON.parse(lire('ancien')), { hypotheses: ['Ancienne.'], sujets: ['interface'] }, 'ce qui précédait la coupure');
  assert.equal(lire('sain'), sain);
  db.close();
});
