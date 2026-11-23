/**
 * LA HAUTEUR DU CLAVIER, MÊME QUAND L'IPHONE NE LA DONNE PAS.
 *
 * iOS 26, application installée : la zone visible reste parfois bloquée à
 * pleine hauteur, clavier ouvert — le champ de la feuille de question restait
 * dessous jusqu'à une rotation (captures #2da6 / #866f). On reprend alors la
 * dernière hauteur mesurée, dans un cadre étroit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { decisionDuClavier, champQuiFaitMonterLeClavier, cleDeLaHauteurRetenue } = await import('@beluga/shared');

const BASE = {
  ecart: 0,
  saisieActive: true,
  champTexte: true,
  pointeurGrossier: true,
  suiviFini: true,
  mesureDepuisLEntree: false,
  clavierPrecedent: 0,
  hauteurRetenue: 336,
  fenetreHauteur: 844,
  hauteurDeRepos: 844,
};

test('clavier mesuré : on le pose et on le retient', () => {
  assert.deepEqual(decisionDuClavier({ ...BASE, ecart: 340.4 }), { clavier: 340, source: 'mesuree', aRetenir: 340 });
});

test('mesure invraisemblable : posée, jamais retenue', () => {
  assert.equal(decisionDuClavier({ ...BASE, ecart: 760 }).aRetenir, null);
});

test('zone visible bloquée après le suivi : la hauteur retenue prend le relais', () => {
  assert.deepEqual(decisionDuClavier(BASE), { clavier: 336, source: 'secours', aRetenir: null });
});

test('pendant la montée du clavier, pas de secours (on attend la vraie mesure)', () => {
  assert.equal(decisionDuClavier({ ...BASE, suiviFini: false }).clavier, 0);
});

test('d’un champ à l’autre, clavier déjà ouvert : pas de chute à 0', () => {
  assert.equal(decisionDuClavier({ ...BASE, suiviFini: false, clavierPrecedent: 336 }).source, 'secours');
});

test('aucun champ actif : rien, quelle que soit la mémoire', () => {
  assert.deepEqual(decisionDuClavier({ ...BASE, saisieActive: false, ecart: 400 }), { clavier: 0, source: 'aucune', aRetenir: null });
});

test('souris ou clavier physique : jamais de secours', () => {
  assert.equal(decisionDuClavier({ ...BASE, pointeurGrossier: false }).clavier, 0);
});

test('champ sans clavier (case, lecture seule) : jamais de secours', () => {
  assert.equal(decisionDuClavier({ ...BASE, champTexte: false }).clavier, 0);
});

test('clavier mesuré puis refermé, champ gardé au curseur : pas de secours', () => {
  assert.equal(decisionDuClavier({ ...BASE, mesureDepuisLEntree: true, clavierPrecedent: 336 }).clavier, 0);
});

test('rien de retenu : rien à reprendre', () => {
  assert.equal(decisionDuClavier({ ...BASE, hauteurRetenue: null }).clavier, 0);
});

test('fenêtre déjà rétrécie par le système : on ne lève pas une seconde fois', () => {
  assert.equal(decisionDuClavier({ ...BASE, fenetreHauteur: 500 }).clavier, 0);
});

test('les champs qui font monter le clavier', () => {
  assert.equal(champQuiFaitMonterLeClavier({ tag: 'TEXTAREA' }), true);
  assert.equal(champQuiFaitMonterLeClavier({ tag: 'INPUT', type: 'text' }), true);
  assert.equal(champQuiFaitMonterLeClavier({ tag: 'INPUT', type: 'checkbox' }), false);
  assert.equal(champQuiFaitMonterLeClavier({ tag: 'INPUT', type: 'text', lectureSeule: true }), false);
  assert.equal(champQuiFaitMonterLeClavier({ tag: 'TEXTAREA', inputMode: 'none' }), false);
  assert.equal(champQuiFaitMonterLeClavier({ tag: 'DIV', editable: true }), true);
  assert.equal(champQuiFaitMonterLeClavier({ tag: 'DIV' }), false);
});

test('une hauteur retenue par orientation', () => {
  assert.notEqual(cleDeLaHauteurRetenue(true), cleDeLaHauteurRetenue(false));
});
