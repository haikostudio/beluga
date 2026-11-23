import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consigneDuConducteur,
  libelleDuChampDuFil,
  parcoursDeLaPublication,
  publicationTerminee,
  reponsesToutesFaites,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LE PARCOURS À QUATRE TEMPS                                          */
/* ------------------------------------------------------------------ */

test('sans publication, aucun parcours n’est inventé', () => {
  assert.equal(parcoursDeLaPublication(null), null);
  assert.equal(parcoursDeLaPublication(undefined), null);
});

test('une publication qui tourne a son travail en cours et son rapport à venir', () => {
  const points = parcoursDeLaPublication({ state: 'running' })!;
  assert.equal(points.length, 4);
  assert.equal(points[0].etat, 'fait');
  assert.equal(points[1].etat, 'fait');
  assert.equal(points[2].etat, 'encours');
  assert.equal(points[3].etat, 'avenir');
});

test('une publication réussie coche ses quatre temps', () => {
  const points = parcoursDeLaPublication({ state: 'success' })!;
  assert.ok(points.every((point) => point.etat === 'fait'));
});

test('une publication tombée rend quand même son rapport — en erreur', () => {
  for (const etat of ['failed', 'stopped'] as const) {
    const points = parcoursDeLaPublication({ state: etat })!;
    assert.equal(points[2].etat, 'erreur');
    // Le rapport n'est jamais « à venir » sur une publication finie : c'est
    // précisément lui qu'on vient lire.
    assert.equal(points[3].etat, 'erreur');
  }
});

/* ------------------------------------------------------------------ */
/* CE QU'ON PEUT RÉPONDRE, ET CE QU'ON NE PEUT PAS DÉCLENCHER           */
/* ------------------------------------------------------------------ */

test('un échec propose deux réponses toutes faites, jamais un champ vide', () => {
  const reponses = reponsesToutesFaites('Construction');
  assert.equal(reponses.length, 2);
  assert.match(reponses[0], /Construction/);
  assert.match(reponses[1], /bloqué/);
  // Sans nom d'étape, la proposition reste utilisable.
  assert.equal(reponsesToutesFaites().length, 2);
});

test('une publication finie met son conducteur en posture d’explication', () => {
  assert.equal(publicationTerminee({ state: 'running' }), false);
  assert.equal(publicationTerminee({ state: 'success' }), true);
  assert.equal(publicationTerminee(null), false);
  assert.match(libelleDuChampDuFil({ state: 'success' }), /question/);
  assert.match(libelleDuChampDuFil({ state: 'running' }), /agent/);
});

test('la consigne du conducteur interdit TOUJOURS de publier, dans les deux postures', () => {
  for (const terminee of [true, false]) {
    const consigne = consigneDuConducteur(terminee);
    assert.match(consigne, /JAMAIS/);
    assert.match(consigne, /Seul un clic de l’utilisateur publie/);
  }
  assert.match(consigneDuConducteur(true), /EXPLICATION/);
  assert.match(consigneDuConducteur(false), /TOURNE ENCORE/);
});
