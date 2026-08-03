import assert from 'node:assert/strict';
import test from 'node:test';
import { descriptionHorsTache, estUneSuite, groupesHorsTache } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Une fonctionnalité = une branche = une carte                        */
/* ------------------------------------------------------------------ */

const commit = (sha: string, titre: string) => ({ sha, titre, branche: 'main' });

test('chaque enregistrement est une fonctionnalité à lui seul', () => {
  const groupes = groupesHorsTache([
    commit('a1', 'Le volet des quotas devient un vrai tiroir'),
    commit('b2', 'Plus de trait à l’intérieur du panneau des projets'),
    commit('c3', 'Une seule notification, qui nomme le projet'),
  ]);
  assert.equal(groupes.length, 3);
  assert.deepEqual(
    groupes.map((groupe) => groupe.length),
    [1, 1, 1],
  );
});

test('un enregistrement qui se dit une suite reste collé au précédent', () => {
  const groupes = groupesHorsTache([
    commit('a1', 'Le volet des quotas devient un vrai tiroir'),
    commit('a2', 'Correction du défilement du volet'),
    commit('b1', 'Une seule notification'),
  ]);
  assert.equal(groupes.length, 2);
  assert.deepEqual(groupes[0].map((c) => c.sha), ['a1', 'a2']);
  assert.deepEqual(groupes[1].map((c) => c.sha), ['b1']);
});

test('une suite en TÊTE de tour ouvre quand même sa fonctionnalité', () => {
  // Rien devant à quoi se rattacher : elle ne peut pas disparaître.
  const groupes = groupesHorsTache([commit('a1', 'Correction du défilement'), commit('b1', 'Autre chose')]);
  assert.equal(groupes.length, 2);
});

test('les marques de suite sont reconnues, le reste non', () => {
  assert.equal(estUneSuite('fixup! quelque chose'), true);
  assert.equal(estUneSuite('suite du volet des quotas'), true);
  assert.equal(estUneSuite('Corrige le compteur'), true);
  assert.equal(estUneSuite('WIP volet'), true);
  assert.equal(estUneSuite('Le volet des quotas devient un vrai tiroir'), false);
  assert.equal(estUneSuite(''), false);
});

test('sans aucun enregistrement, il n’y a aucun groupe', () => {
  assert.deepEqual(groupesHorsTache([]), []);
});

test('une branche empilée sur une autre le DIT dans sa description', () => {
  const texte = descriptionHorsTache(
    [commit('abcdef1234', 'Le bouton d’arrêt prend la largeur')],
    'Chef d’orchestre',
    'hors-tache/le-bouton-abcdef1',
    'hors-tache/le-volet-9999999',
  );
  assert.ok(texte.includes('hors-tache/le-volet-9999999'));
  assert.ok(texte.includes('ne peut pas partir sans elle'));
});

test('une branche qui tient seule ne parle d’aucune dépendance', () => {
  const texte = descriptionHorsTache(
    [commit('abcdef1234', 'Le volet des quotas')],
    'Chef d’orchestre',
    'hors-tache/le-volet-abcdef1',
  );
  assert.ok(!texte.includes('ne peut pas partir sans elle'));
  assert.ok(texte.includes('supprimer cette carte suffit'));
});
