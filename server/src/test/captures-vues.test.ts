import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClientCommand, MAX_CLES_DE_CAPTURES, commandeAutorisee, evenementAutorise } from '@beluga/shared';

/* Les images déjà ouvertes en grand, par compte, sur une base à soi. */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'captures-vues-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { getDb } = await import('../db.js');

test('une image marquée vue l’est pour SON compte, et pour lui seul', () => {
  assert.deepEqual(store.capturesVues('haiko', ['jointe:a', 'etape:b']), []);
  assert.deepEqual(store.marquerCapturesVues('haiko', ['jointe:a', 'etape:b'], 100), ['jointe:a', 'etape:b']);
  assert.deepEqual(store.capturesVues('haiko', ['jointe:a', 'etape:b', 'jointe:inconnue']).sort(), ['etape:b', 'jointe:a']);
  assert.deepEqual(store.capturesVues('autre-compte', ['jointe:a', 'etape:b']), [], 'un autre compte ne voit pas l’œil');
});

test('remarquer une image ne la compte pas comme nouvelle, et garde sa première date', () => {
  assert.deepEqual(store.marquerCapturesVues('haiko', ['jointe:a', 'jointe:c', 'jointe:c'], 500), ['jointe:c']);
  const ligne = getDb().prepare("SELECT vue_le FROM capture_vues WHERE user_id = 'haiko' AND cle = 'jointe:a'").get() as { vue_le: number };
  assert.equal(ligne.vue_le, 100);
  assert.deepEqual(store.marquerCapturesVues('haiko', []), []);
});

test('une demande ne rend que les clés demandées, même sur une longue liste', () => {
  const cles = Array.from({ length: MAX_CLES_DE_CAPTURES }, (_, i) => `jointe:lot-${i}`);
  store.marquerCapturesVues('haiko', cles.filter((_, i) => i % 2 === 0));
  assert.equal(store.capturesVues('haiko', cles).length, MAX_CLES_DE_CAPTURES / 2);
  assert.deepEqual(store.capturesVues('haiko', ['jointe:lot-1']), []);
});

test('le protocole borne les listes, et rien de tout cela n’est ouvert à un client', () => {
  const trop = Array.from({ length: MAX_CLES_DE_CAPTURES + 1 }, (_, i) => `jointe:${i}`);
  for (const type of ['captures.vues', 'captures.voir'] as const) {
    assert.ok(ClientCommand.safeParse({ type, cles: ['jointe:a'] }).success, type);
    assert.equal(ClientCommand.safeParse({ type, cles: trop }).success, false, `${type} : liste trop longue`);
    assert.equal(ClientCommand.safeParse({ type, cles: ['x'.repeat(201)] }).success, false, `${type} : clé trop longue`);
    assert.equal(commandeAutorisee('client', type), false, `${type} : refusée à un client`);
    assert.ok(commandeAutorisee('admin', type));
  }
  assert.equal(evenementAutorise('client', 'captures.vues'), false);
});
