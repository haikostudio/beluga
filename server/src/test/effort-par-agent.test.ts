import test from 'node:test';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* CHAQUE FAMILLE D'AGENT A SON CRAN DE RÉFLEXION.                     */
/*                                                                     */
/* Les agents lancés par le démon lui-même (dépannage, publication,    */
/* analyse de la nuit) sont créés sans `run.thinking` : aucun          */
/* `--effort` ne partait à la ligne de commande, et le moteur          */
/* appliquait le sien — le même pour un conflit de fusion de trois     */
/* minutes que pour un chantier d'architecture.                        */
/* ------------------------------------------------------------------ */

const { effortParDefaut, effortDuTour } = await import('@beluga/shared');

test('un dépannage de publication réfléchit au minimum', () => {
  for (const motif of ['controles', 'construction'] as const) {
    assert.equal(effortParDefaut({ role: 'deploy', motif }), 'low', motif);
  }
});

test('la réparation silencieuse et le heurt réglé sur place gardent un cran moyen', () => {
  // Décision du 2026-10-18 : la cause reste à comprendre, ce n'est pas un geste dicté.
  for (const motif of ['conflit', 'depannage'] as const) {
    assert.equal(effortParDefaut({ role: 'deploy', motif }), 'medium', motif);
  }
});

test("l'assistant qui configure un site réfléchit au minimum", () => {
  assert.equal(effortParDefaut({ role: 'deploy', motif: 'configuration-backup' }), 'low');
});

test('une publication et une analyse gardent un cran moyen', () => {
  assert.equal(effortParDefaut({ role: 'deploy' }), 'medium');
  assert.equal(effortParDefaut({ role: 'deploy', motif: 'mise-en-ligne' }), 'medium');
  assert.equal(effortParDefaut({ role: 'analysis' }), 'medium');
});

test("un agent de tâche ou de cadrage ne reçoit aucun cran d'office", () => {
  assert.equal(effortParDefaut({ role: 'task' }), undefined);
  assert.equal(effortParDefaut({ role: 'cadrage' }), undefined);
});

test('un cran réglé sur la carte est INTANGIBLE', () => {
  // La règle du 02/09/2026 : dès qu'une carte porte un réglage, plus rien ne le
  // réécrit — pas même un défaut de famille.
  assert.equal(effortDuTour('max', { role: 'deploy', motif: 'conflit' }), 'max');
  assert.equal(effortDuTour('none', { role: 'deploy' }), 'none');
});

test("un agent PORTEUR d'une carte suit sa carte, jamais sa famille", () => {
  // Un tour d'analyse qui chiffre une carte est commandé par elle : lui poser
  // le cran « analyse » masquerait le réglage voulu par l'utilisateur.
  assert.equal(effortDuTour(undefined, { role: 'analysis', porteUneCarte: true }), undefined);
});

test('un agent sans réglage suit sa famille', () => {
  assert.equal(effortDuTour(undefined, { role: 'deploy', motif: 'controles' }), 'low');
  assert.equal(effortDuTour(undefined, { role: 'analysis' }), 'medium');
});
