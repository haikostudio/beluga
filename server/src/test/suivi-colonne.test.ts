import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLONNES_HORS_REPRISE,
  COLUMN_KEYS,
  MACHINE_ONLY_TARGETS,
  canMove,
  colonneAuDemarrage,
  colonneEnFinDeTour,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* La carte suit l'état de son agent                                    */
/* ------------------------------------------------------------------ */

/* -------- Le tour démarre -------- */

test('une carte terminée sur laquelle on relance une action repasse en cours', () => {
  assert.equal(colonneAuDemarrage('done'), 'running');
});

test('une carte encore en amont du parcours part en cours quand l’agent démarre', () => {
  for (const depart of ['notes', 'todo', 'validated', 'planned'] as const) {
    assert.equal(colonneAuDemarrage(depart), 'running', `depuis « ${depart} »`);
  }
});

test('une carte déjà en cours ne bouge pas : rien à annoncer', () => {
  assert.equal(colonneAuDemarrage('running'), null);
});

test('une carte prête à publier ou archivée ne sort pas de son rangement', () => {
  // Poser une question dans sa conversation ne doit pas la retirer du lot.
  assert.equal(colonneAuDemarrage('to_deploy'), null);
  assert.equal(colonneAuDemarrage('archived'), null);
  assert.deepEqual(COLONNES_HORS_REPRISE, ['to_deploy', 'archived']);
});

/* -------- Le tour se termine -------- */

test('un tour réussi pose la carte en terminé', () => {
  assert.equal(colonneEnFinDeTour('running', true), 'done');
});

test('un tour en échec ne déplace rien : le travail n’est pas fait', () => {
  assert.equal(colonneEnFinDeTour('running', false), null);
});

test('une carte qui n’était pas en cours n’est pas déclarée terminée', () => {
  for (const depart of COLUMN_KEYS.filter((c) => c !== 'running')) {
    assert.equal(colonneEnFinDeTour(depart, true), null, `depuis « ${depart} »`);
  }
});

/* -------- Aller-retour -------- */

test('terminé puis relancé puis terminé : la carte fait l’aller-retour', () => {
  const apresPremierTour = colonneEnFinDeTour('running', true);
  assert.equal(apresPremierTour, 'done');
  const relance = colonneAuDemarrage(apresPremierTour!);
  assert.equal(relance, 'running');
  assert.equal(colonneEnFinDeTour(relance!, true), 'done');
});

/* -------- Cohérence avec les droits de déplacement -------- */

test('la machine a le droit de poser une carte en terminé', () => {
  assert.equal(MACHINE_ONLY_TARGETS.includes('done'), true);
  assert.equal(canMove('machine', 'running', 'done').allowed, true);
});

test('l’ordonnanceur ne touche toujours pas à « À faire » : la validation manque', () => {
  assert.equal(canMove('machine', 'todo', 'running').allowed, false);
});
