import test from 'node:test';
import assert from 'node:assert/strict';
import { moteurDoitEtreMisAJour, PERIODE_MISE_A_JOUR_MOTEURS_MS } from '@beluga/shared';

test('un outil jamais passé est dû tout de suite', () => {
  assert.equal(moteurDoitEtreMisAJour(Date.now(), undefined), true);
});

test('un outil tenté il y a moins d’un jour attend son tour', () => {
  const maintenant = Date.now();
  assert.equal(moteurDoitEtreMisAJour(maintenant, maintenant - PERIODE_MISE_A_JOUR_MOTEURS_MS + 60_000), false);
});

test('un outil tenté il y a plus d’un jour redevient dû, même après un échec', () => {
  const maintenant = Date.now();
  assert.equal(moteurDoitEtreMisAJour(maintenant, maintenant - PERIODE_MISE_A_JOUR_MOTEURS_MS - 1), true);
});
