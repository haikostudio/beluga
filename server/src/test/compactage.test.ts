/**
 * COMPACTAGE NOCTURNE : retentative dans la nuit, jour consommé seulement par
 * un passage fait ou jugé inutile, une trace par nuit, place vidée comptée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'compactage-'));
process.env.BELUGA_DATA = bac;

const { getDb } = await import('../db.js');
const { passerLaNuit, ilFautEssayer, compacterLaBase } = await import('../compactage.js');
const { allegerUneTrancheDeJournaux, octetsVidesEnAttente, remettreLaPlaceVideeAZero } = await import('../journal-carte.js');

const nuit = (h: number, m = 0) => new Date(2026, 10, 24, h, m);
const etatVide = () => ({ dernierJour: null as string | null, dernierJourJournalise: null as string | null });

test('hors fenêtre, rien ne part', () => {
  assert.equal(ilFautEssayer(nuit(3, 55), null), false);
  assert.equal(ilFautEssayer(nuit(8, 0), null), false);
  assert.equal(ilFautEssayer(nuit(4, 0), null), true);
  assert.equal(ilFautEssayer(nuit(7, 55), null), true);
});

test('un report ne consomme pas la nuit : le passage suivant compacte', () => {
  const etat = etatVide();
  let appels = 0;
  const reponses = [
    { fait: false, reporte: true, raison: '1 agent(s) au travail' },
    { fait: false, reporte: true, raison: '1 agent(s) au travail' },
    { fait: true },
  ];
  const compacter = () => reponses[appels++] as any;
  passerLaNuit(nuit(4, 0), etat, compacter);
  passerLaNuit(nuit(4, 5), etat, compacter);
  passerLaNuit(nuit(4, 10), etat, compacter);
  passerLaNuit(nuit(4, 15), etat, compacter); // déjà fait : plus d'appel
  assert.equal(appels, 3);
});

test('sous le seuil : jour consommé', () => {
  const etat = etatVide();
  let appels = 0;
  const compacter = () => (appels++, { fait: false, sousLeSeuil: true, raison: 'peu' }) as any;
  passerLaNuit(nuit(4, 0), etat, compacter);
  passerLaNuit(nuit(4, 5), etat, compacter);
  assert.equal(appels, 1);
});

test('le lendemain, un nouveau passage est permis', () => {
  const etat = etatVide();
  let appels = 0;
  const compacter = () => (appels++, { fait: true }) as any;
  passerLaNuit(nuit(4, 0), etat, compacter);
  passerLaNuit(new Date(2026, 10, 25, 4, 0), etat, compacter);
  assert.equal(appels, 2);
});

test('la place vidée par l’allègement est comptée, puis remise à zéro', () => {
  const db = getDb();
  const ins = db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, libelle, outil, params, resultat, donnees)
     VALUES (?, 'c1', ?, 'execution', 'requete', 1000, '', 'Read', ?, ?, '{}')`,
  );
  ins.run('a', 1, 'pp', 'x'.repeat(1000));
  ins.run('b', 2, null, 'y'.repeat(500));
  remettreLaPlaceVideeAZero();
  const max = (db.prepare('SELECT MAX(rowid) AS m FROM card_journal').get() as any).m;
  assert.equal(allegerUneTrancheDeJournaux(5000, 0, max), 2);
  assert.equal(octetsVidesEnAttente(), 1502);
  assert.equal(allegerUneTrancheDeJournaux(5000, 0, max), 0); // seconde passe : rien de plus
  assert.equal(octetsVidesEnAttente(), 1502);
  remettreLaPlaceVideeAZero();
  assert.equal(octetsVidesEnAttente(), 0);
});

test('sous le seuil, aucun VACUUM', () => {
  const r = compacterLaBase();
  assert.equal(r.fait, false);
  assert.equal(r.sousLeSeuil, true);
});
