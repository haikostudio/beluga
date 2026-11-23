import test from 'node:test';
import assert from 'node:assert/strict';
import { BoiteDesAccuses, DUREE_DES_ACCUSES_ORPHELINS_MS } from '@beluga/shared';

type Accuse = { type: 'ack'; id: string; ok: boolean; data?: unknown };

test('une réponse orpheline se rend au compte qui l a demandée, une seule fois', () => {
  const boite = new BoiteDesAccuses<Accuse>();
  boite.garder('admin', { type: 'ack', id: 'a1', ok: true, data: { project: { id: 'p' } } }, 1000);
  assert.deepEqual(boite.reprendre('admin', ['a1', 'inconnu'], 2000), [
    { type: 'ack', id: 'a1', ok: true, data: { project: { id: 'p' } } },
  ]);
  assert.deepEqual(boite.reprendre('admin', ['a1'], 3000), []);
});

test('un autre compte ne reprend jamais la réponse d un autre', () => {
  const boite = new BoiteDesAccuses<Accuse>();
  boite.garder('admin', { type: 'ack', id: 'a1', ok: true }, 1000);
  assert.deepEqual(boite.reprendre('client-1', ['a1'], 2000), []);
  assert.equal(boite.reprendre('admin', ['a1'], 2000).length, 1);
});

test('une réponse trop vieille est oubliée, et la boîte reste bornée', () => {
  const boite = new BoiteDesAccuses<Accuse>(DUREE_DES_ACCUSES_ORPHELINS_MS, 3);
  boite.garder('admin', { type: 'ack', id: 'vieux', ok: true }, 0);
  assert.deepEqual(boite.reprendre('admin', ['vieux'], DUREE_DES_ACCUSES_ORPHELINS_MS + 1), []);
  for (const id of ['b1', 'b2', 'b3', 'b4']) boite.garder('admin', { type: 'ack', id, ok: true }, 10);
  assert.equal(boite.taille, 3);
  assert.deepEqual(
    boite.reprendre('admin', ['b1', 'b2', 'b3', 'b4'], 20).map((a) => a.id),
    ['b2', 'b3', 'b4'],
  );
});
