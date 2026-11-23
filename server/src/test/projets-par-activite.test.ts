import test from 'node:test';
import assert from 'node:assert/strict';
import { filtrerProjetsParNom, projetsParActivite } from '@beluga/shared';

const projet = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  archived: false,
  updatedAt,
  ...extra,
});

test('le volet « Nouvel agent » range les projets du plus récemment actif au plus ancien', () => {
  const liste = projetsParActivite(
    [projet('a', 10), projet('b', 5), projet('c', 1, { lastVisitedAt: 50 }), projet('d', 99, { archived: true })],
    { b: 100 },
  );
  assert.deepEqual(
    liste.map((p) => p.id),
    ['b', 'c', 'a'],
  );
});

test('à activité égale, les projets se rangent par nom', () => {
  assert.deepEqual(
    projetsParActivite([projet('z', 1), projet('m', 1)]).map((p) => p.id),
    ['m', 'z'],
  );
});

test('la recherche du volet filtre par nom, sans accents ni majuscules, en gardant l’ordre', () => {
  const liste = [
    { id: '1', name: 'HaikoBill' },
    { id: '2', name: 'Rézidéo' },
    { id: '3', name: 'Haiko Studio' },
    { id: '4', name: 'Beluga' },
  ];
  assert.deepEqual(filtrerProjetsParNom(liste, 'haiko').map((p) => p.id), ['1', '3']);
  assert.deepEqual(filtrerProjetsParNom(liste, 'REZIDEO').map((p) => p.id), ['2']);
  assert.deepEqual(filtrerProjetsParNom(liste, ' studio  haiko ').map((p) => p.id), ['3']);
  assert.deepEqual(filtrerProjetsParNom(liste, '   ').map((p) => p.id), ['1', '2', '3', '4']);
  assert.deepEqual(filtrerProjetsParNom(liste, 'xyz'), []);
});
