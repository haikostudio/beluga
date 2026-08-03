import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLONNES_HORS_REPRISE,
  COLUMN_KEYS,
  MACHINE_ONLY_TARGETS,
  ROLES_QUI_CLOTURENT,
  ROLES_QUI_DEPLACENT,
  canMove,
  colonneAuDemarrage,
  colonneEnFinDeTour,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* La carte suit les étapes réelles du travail                          */
/* ------------------------------------------------------------------ */

/* -------- Le tour d'exécution démarre -------- */

test('une carte terminée sur laquelle on relance une exécution repasse en cours', () => {
  assert.equal(colonneAuDemarrage('done', 'task'), 'running');
});

test('une carte en amont du parcours part en cours quand l’exécution démarre', () => {
  for (const depart of ['notes', 'todo', 'validated', 'planned'] as const) {
    assert.equal(colonneAuDemarrage(depart, 'task'), 'running', `depuis « ${depart} »`);
  }
});

test('une carte déjà en cours ne bouge pas : rien à annoncer', () => {
  assert.equal(colonneAuDemarrage('running', 'task'), null);
});

test('une carte prête à publier ou archivée ne sort pas de son rangement', () => {
  // Poser une question dans sa conversation ne doit pas la retirer du lot.
  assert.equal(colonneAuDemarrage('to_deploy', 'task'), null);
  assert.equal(colonneAuDemarrage('archived', 'task'), null);
  assert.deepEqual(COLONNES_HORS_REPRISE, ['to_deploy', 'archived']);
});

/* -------- Le tour d'exécution se termine -------- */

test('un tour d’exécution réussi pose la carte en terminé', () => {
  assert.equal(colonneEnFinDeTour('running', true, 'task'), 'done');
});

test('un tour d’exécution en échec ne déplace rien : le travail n’est pas fait', () => {
  assert.equal(colonneEnFinDeTour('running', false, 'task'), null);
  for (const depart of ['validated', 'planned', 'done'] as const) {
    assert.equal(colonneEnFinDeTour(depart, false, 'task'), null, `depuis « ${depart} »`);
  }
});

test('une carte qui n’était pas en cours n’est pas déclarée terminée', () => {
  for (const depart of COLUMN_KEYS.filter((c) => c !== 'running')) {
    assert.equal(colonneEnFinDeTour(depart, true, 'task'), null, `depuis « ${depart} »`);
  }
});

/* -------- Seul l'agent d'exécution déplace la carte -------- */

test('une analyse qui démarre laisse la carte validée où elle est', () => {
  // Le défaut d'origine : la carte sautait en « En cours » dès l'analyse.
  assert.equal(colonneAuDemarrage('validated', 'analysis'), null);
  for (const depart of COLUMN_KEYS) {
    assert.equal(colonneAuDemarrage(depart, 'analysis'), null, `depuis « ${depart} »`);
  }
});

test('un tour d’analyse réussi ne clôt pas la carte : rien n’a été exécuté', () => {
  assert.equal(colonneEnFinDeTour('running', true, 'analysis'), null);
  assert.equal(colonneEnFinDeTour('validated', true, 'analysis'), null);
});

test('ni l’orchestration ni la publication ne déplacent une carte', () => {
  for (const role of ['orchestrator', 'deploy'] as const) {
    assert.equal(colonneAuDemarrage('validated', role), null, `démarrage « ${role} »`);
    assert.equal(colonneAuDemarrage('done', role), null, `démarrage « ${role} »`);
    assert.equal(colonneEnFinDeTour('running', true, role), null, `fin « ${role} »`);
  }
});

test('la liste des rôles qui déplacent se réduit à l’exécution', () => {
  assert.deepEqual(ROLES_QUI_DEPLACENT, ['task']);
  // Clore et déplacer, c'est la même liste : un seul rôle décide.
  assert.deepEqual(ROLES_QUI_CLOTURENT, ROLES_QUI_DEPLACENT);
});

/* -------- Le parcours complet -------- */

test('validé, analyse, exécution : la carte ne bouge qu’au bon moment', () => {
  // 1. L'analyse démarre sur une carte validée : elle reste validée.
  assert.equal(colonneAuDemarrage('validated', 'analysis'), null);
  // 2. L'analyse rend son chiffrage : toujours validée.
  assert.equal(colonneEnFinDeTour('validated', true, 'analysis'), null);
  // 3. L'ordonnanceur lance l'exécution : la carte passe en cours.
  assert.equal(colonneAuDemarrage('validated', 'task'), 'running');
  // 4. L'exécution rend son rapport : terminé.
  assert.equal(colonneEnFinDeTour('running', true, 'task'), 'done');
});

test('terminé puis relancé puis terminé : la carte fait l’aller-retour', () => {
  const apresPremierTour = colonneEnFinDeTour('running', true, 'task');
  assert.equal(apresPremierTour, 'done');
  // Un message dans la conversation de l'agent d'EXÉCUTION la relance.
  const relance = colonneAuDemarrage(apresPremierTour!, 'task');
  assert.equal(relance, 'running');
  assert.equal(colonneEnFinDeTour(relance!, true, 'task'), 'done');
});

/* -------- Cohérence avec les droits de déplacement -------- */

test('la machine a le droit de poser une carte en terminé', () => {
  assert.equal(MACHINE_ONLY_TARGETS.includes('done'), true);
  assert.equal(canMove('machine', 'running', 'done').allowed, true);
});

test('l’ordonnanceur ne touche toujours pas à « À faire » : la validation manque', () => {
  assert.equal(canMove('machine', 'todo', 'running').allowed, false);
});
