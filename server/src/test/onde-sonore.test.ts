import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANCHER_D_ONDE, instantDuPointeur, ondeDeRepli, picsDOnde } from '@beluga/shared';

test("l'onde : un bâton par tranche, normalisé sur le pic le plus haut", () => {
  const son = new Float32Array(1000);
  for (let i = 500; i < 750; i += 1) son[i] = i % 2 ? 0.5 : -0.25;
  const pics = picsDOnde(son, 4);
  assert.equal(pics.length, 4);
  assert.deepEqual(pics, [PLANCHER_D_ONDE, PLANCHER_D_ONDE, 1, PLANCHER_D_ONDE]);
});

test("l'onde : un son vide ou silencieux reste un trait, jamais un trou", () => {
  assert.deepEqual(picsDOnde(new Float32Array(0), 3), [PLANCHER_D_ONDE, PLANCHER_D_ONDE, PLANCHER_D_ONDE]);
  assert.deepEqual(picsDOnde(new Float32Array(30), 3), [PLANCHER_D_ONDE, PLANCHER_D_ONDE, PLANCHER_D_ONDE]);
  assert.deepEqual(picsDOnde(new Float32Array(30), 0), []);
});

test("l'onde : plus de bâtons que d'échantillons ne casse rien", () => {
  const pics = picsDOnde([0.2, -1], 5);
  assert.equal(pics.length, 5);
  assert.ok(pics.every((p) => p >= PLANCHER_D_ONDE && p <= 1));
});

test("l'onde de repli est stable pour un même fichier et bornée", () => {
  const a = ondeDeRepli('piece-1', 60);
  assert.deepEqual(a, ondeDeRepli('piece-1', 60));
  assert.notDeepEqual(a, ondeDeRepli('piece-2', 60));
  assert.ok(a.every((p) => p >= PLANCHER_D_ONDE && p <= 1));
});

test("l'instant sous le pointeur est borné au son", () => {
  assert.equal(instantDuPointeur(50, 200, 40), 10);
  assert.equal(instantDuPointeur(-10, 200, 40), 0);
  assert.equal(instantDuPointeur(500, 200, 40), 40);
  assert.equal(instantDuPointeur(50, 0, 40), 0);
  assert.equal(instantDuPointeur(50, 200, Number.NaN), 0);
});
