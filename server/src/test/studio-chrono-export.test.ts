import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE CHRONOMÈTRE D'UN EXPORT EST ÉCRIT PAR LE DÉMON : l'heure de départ se pose
 * au passage en « en-cours » (sortie de la file lourde), jamais avant, et l'heure
 * d'arrêt à l'issue — prêt, échoué ou annulé. Un export annulé dans la file n'a
 * donc jamais d'heure de départ.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-chrono-'));
process.env.BELUGA_DATA = bacASable;

const { Project } = await import('@beluga/shared');
const store = await import('../store.js');
const studio = await import('../studio.js');

const projet = store.saveProject(Project.parse({ id: 'p-chrono', name: 'Chrono', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));
const creation = studio.creerCreation({ projectId: projet.id, titre: 'Chrono' });
assert.ok(creation.ok);

test('le départ se pose à la sortie de la file, l’arrêt à l’issue, et jamais l’un avant l’autre', async () => {
  const e = studio.creerExport({ creation: creation.creation, format: '9:16', genre: 'video', voixEnEssai: 0 });
  assert.equal(e.etat, 'en-file');
  assert.equal(e.demarreLe, undefined, 'dans la file : pas de départ');
  assert.equal(e.termineLe, undefined);

  await new Promise((r) => setTimeout(r, 15));
  const enCours = studio.majExport(e.id, { etat: 'en-cours', progression: 0.02 })!;
  assert.ok(enCours.demarreLe && enCours.demarreLe >= e.creeLe, 'le départ est posé au passage en cours');
  assert.equal(enCours.termineLe, undefined);

  // Une mise à jour de progression ne déplace pas le départ.
  const suite = studio.majExport(e.id, { progression: 0.5 })!;
  assert.equal(suite.demarreLe, enCours.demarreLe);

  await new Promise((r) => setTimeout(r, 15));
  const pret = studio.majExport(e.id, { etat: 'pret', progression: 1 })!;
  assert.equal(pret.demarreLe, enCours.demarreLe);
  assert.ok(pret.termineLe && pret.termineLe >= pret.demarreLe!, 'l’arrêt vient après le départ');
});

test('un export annulé dans la file n’a jamais de départ, et un arrêt tardif ne réécrit pas le premier', () => {
  const e = studio.creerExport({ creation: creation.creation, format: '1:1', genre: 'video', voixEnEssai: 0 });
  const annule = studio.majExport(e.id, { etat: 'annule', erreur: 'annulé à la main' })!;
  assert.equal(annule.demarreLe, undefined);
  assert.ok(annule.termineLe);
  const echec = studio.majExport(e.id, { etat: 'echoue', erreur: 'tard' })!;
  assert.equal(echec.termineLe, annule.termineLe, 'le premier arrêt fait foi');
});
