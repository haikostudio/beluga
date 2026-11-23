import test from 'node:test';
import assert from 'node:assert/strict';
import { COULEURS_PAR_OPTION_MAX, couleurValide, couleursDOption } from '@beluga/shared';

test('une teinte « #rrggbb » passe, en minuscules ; l’abrégé est déplié', () => {
  assert.equal(couleurValide('#2E7D32'), '#2e7d32');
  assert.equal(couleurValide(' #fff '), '#ffffff');
});

test('une couleur mal formée est ignorée, jamais transmise à l’écran', () => {
  for (const mauvaise of ['red', 'rgb(0,0,0)', '#12345', '#gggggg', 'url(x)', '#000000;background:red', 12, null]) {
    assert.equal(couleurValide(mauvaise), undefined, String(mauvaise));
  }
  assert.deepEqual(couleursDOption(['#00ff00', 'vert', '#ff0000']), ['#00ff00', '#ff0000']);
  assert.equal(couleursDOption(['vert', 'rouge']), undefined, 'aucune teinte valide : pas de points');
  assert.equal(couleursDOption(undefined), undefined, 'une ancienne question sans le champ reste telle quelle');
});

test('quatre points au plus par option', () => {
  const six = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'];
  assert.equal(couleursDOption(six)?.length, COULEURS_PAR_OPTION_MAX);
  assert.deepEqual(couleursDOption('#abcdef'), ['#abcdef']);
});
