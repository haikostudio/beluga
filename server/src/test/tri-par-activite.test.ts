import test from 'node:test';
import assert from 'node:assert/strict';
import { ordonnerParDerniereActivite } from '@beluga/shared';

test('le projet le plus récemment actif passe devant, sans toucher la liste reçue', () => {
  const liste = [
    { name: 'A', rank: 1, derniereActivite: 100 },
    { name: 'B', rank: 2, derniereActivite: 300 },
    { name: 'C', rank: 3, derniereActivite: 200 },
  ];
  assert.deepEqual(ordonnerParDerniereActivite(liste).map((p) => p.name), ['B', 'C', 'A']);
  assert.deepEqual(liste.map((p) => p.name), ['A', 'B', 'C']);
});

test('sans activité : en dernier ; à égalité : rang manuel, puis nom', () => {
  const liste = [
    { name: 'Vide', rank: 0 },
    { name: 'Zed', rank: 2, derniereActivite: 50 },
    { name: 'Bob', rank: 2, derniereActivite: 50 },
    { name: 'Premier', rank: 1, derniereActivite: 50 },
  ];
  assert.deepEqual(ordonnerParDerniereActivite(liste).map((p) => p.name), ['Premier', 'Bob', 'Zed', 'Vide']);
});
