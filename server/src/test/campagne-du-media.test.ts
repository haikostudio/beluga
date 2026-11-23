import test from 'node:test';
import assert from 'node:assert/strict';
import { campagneDuMedia } from '@beluga/shared';

/* TOUT MÉDIA APPARTIENT À SA CAMPAGNE (carte « Média du calendrier en aperçu ») */

const base = { versions: ['export:v2', 'export:v1'], rattachements: new Map<string, string | null>(), campagnesDesPublications: [] as string[], campagnesDeLaMarque: ['a', 'b'] };

test('un rattachement enregistré sur une version l’emporte sur tout le reste', () => {
  const r = campagneDuMedia({ ...base, rattachements: new Map([['export:v1', 'b']]), campagnesDesPublications: ['a', 'a'] });
  assert.deepEqual(r, { campagneId: 'b', source: 'enregistree' });
});

test('une création lancée pour une campagne lui rattache ses exports', () => {
  const r = campagneDuMedia({ ...base, creationId: 'c1', rattachements: new Map([['creation:c1', 'a']]) });
  assert.deepEqual(r, { campagneId: 'a', source: 'creation' });
});

test('sans rattachement, la campagne de ses publications (la plus fréquente)', () => {
  assert.equal(campagneDuMedia({ ...base, campagnesDesPublications: ['b', 'a', 'b', null] }).campagneId, 'b');
});

test('une marque à une seule campagne reprend ses médias orphelins ; sinon aucun choix arbitraire', () => {
  assert.deepEqual(campagneDuMedia({ ...base, campagnesDeLaMarque: ['seule'] }), { campagneId: 'seule', source: 'seule' });
  assert.equal(campagneDuMedia(base).campagneId, null);
});

test('une campagne qui n’existe pas dans la marque ne compte jamais', () => {
  const r = campagneDuMedia({ ...base, rattachements: new Map([['export:v1', 'disparue']]), campagnesDesPublications: ['fantome', 'a'] });
  assert.deepEqual(r, { campagneId: 'a', source: 'publications' });
});

test('un média RETIRÉ de sa campagne n’y revient pas tout seul (ni par ses publications, ni par la campagne seule)', async () => {
  const { SANS_CAMPAGNE } = await import('@beluga/shared');
  const r = campagneDuMedia({ ...base, campagnesDeLaMarque: ['seule'], rattachements: new Map([['export:v2', SANS_CAMPAGNE]]), campagnesDesPublications: ['seule'] });
  assert.deepEqual(r, { campagneId: null, source: 'retiree' });
  /* Rangé ensuite dans une autre campagne : ce choix, posé sur la tête, l'emporte. */
  const range = campagneDuMedia({ ...base, rattachements: new Map([['export:v2', 'b'], ['export:v1', SANS_CAMPAGNE]]) });
  assert.deepEqual(range, { campagneId: 'b', source: 'enregistree' });
});
