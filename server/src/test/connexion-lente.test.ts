import test from 'node:test';
import assert from 'node:assert/strict';
import { SEUIL_CONNEXION_LENTE_MS, connexionEstLente, delaiAvantConnexionLente } from '@beluga/shared';

test('le seuil de la connexion lente est de quatre secondes', () => {
  assert.equal(SEUIL_CONNEXION_LENTE_MS, 4000);
});

test('rien n’attend : la connexion n’est pas lente', () => {
  assert.equal(connexionEstLente(null, 1_000_000), false);
  assert.equal(delaiAvantConnexionLente(null, 1_000_000), null);
});

test('une attente courte ne se dit pas, une attente longue se dit', () => {
  assert.equal(connexionEstLente(1000, 1000 + 3999), false);
  assert.equal(connexionEstLente(1000, 1000 + 4000), true);
  assert.equal(connexionEstLente(1000, 1000 + 60_000), true);
});

test('le délai restant se compte jusqu’au seuil, sans jamais être négatif', () => {
  assert.equal(delaiAvantConnexionLente(1000, 1000), 4000);
  assert.equal(delaiAvantConnexionLente(1000, 1000 + 1500), 2500);
  assert.equal(delaiAvantConnexionLente(1000, 1000 + 9000), 0);
});

test('un seuil donné remplace celui par défaut', () => {
  assert.equal(connexionEstLente(0, 500, 400), true);
  assert.equal(delaiAvantConnexionLente(0, 100, 400), 300);
});
