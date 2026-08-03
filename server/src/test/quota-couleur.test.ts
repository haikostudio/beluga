import assert from 'node:assert/strict';
import test from 'node:test';
import { niveauQuota } from '@haikodev/shared';

test('une fenêtre à peine entamée reste au vert', () => {
  assert.equal(niveauQuota(0), 'ok');
  assert.equal(niveauQuota(37), 'ok');
  assert.equal(niveauQuota(69), 'ok');
});

test('le jaune commence quand il reste 30 % ou moins', () => {
  assert.equal(niveauQuota(70), 'attention');
  assert.equal(niveauQuota(80), 'attention');
  assert.equal(niveauQuota(84), 'attention');
});

test('le rouge commence quand il reste 15 % ou moins', () => {
  assert.equal(niveauQuota(85), 'critique');
  assert.equal(niveauQuota(100), 'critique');
});

test('une valeur hors bornes ne casse pas la règle', () => {
  assert.equal(niveauQuota(-20), 'ok');
  assert.equal(niveauQuota(140), 'critique');
});
