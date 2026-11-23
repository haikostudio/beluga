/**
 * L'APERÇU DU STUDIO NE S'OUVRE PLUS SUR LE CADRE VIDE DE t = 0 : il reprend la
 * tête de lecture laissée, sinon un instant parlant du premier visuel.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { instantDOuverture } from '@beluga/shared';

type Seg = { debut: number; duree: number; masque?: boolean };
const piste = (genre: string, segments: Seg[], masquee = false) => ({
  id: `p-${genre}`,
  nom: genre,
  genre,
  masquee,
  segments: segments.map((s, i) => ({ id: `s${i}`, ...s })),
});
const pistes = (...p: ReturnType<typeof piste>[]) => p as any;

test('une tête de lecture laissée dans la vidéo est reprise', () => {
  assert.equal(instantDOuverture({ pistes: pistes(piste('video', [{ debut: 0, duree: 30 }])), duree: 30, curseurRetenu: 12.34 }), 12.34);
});

test('un curseur à 0, sur la fin ou au-delà ne se reprend pas : instant parlant', () => {
  const p = pistes(piste('video', [{ debut: 0, duree: 6 }]));
  assert.equal(instantDOuverture({ pistes: p, duree: 30, curseurRetenu: 0 }), 1);
  assert.equal(instantDOuverture({ pistes: p, duree: 30, curseurRetenu: 29.99 }), 1);
  assert.equal(instantDOuverture({ pistes: p, duree: 30, curseurRetenu: 45 }), 1);
  assert.equal(instantDOuverture({ pistes: p, duree: 30, curseurRetenu: null }), 1);
});

test('instant parlant : une seconde après l’entrée du premier visuel, même s’il ne commence pas à 0', () => {
  const p = pistes(piste('vecteur', [{ debut: 20, duree: 4 }]), piste('image', [{ debut: 3, duree: 10 }]), piste('son', [{ debut: 0, duree: 30 }]));
  assert.equal(instantDOuverture({ pistes: p, duree: 30 }), 4);
});

test('un visuel court : son milieu', () => {
  assert.equal(instantDOuverture({ pistes: pistes(piste('video', [{ debut: 0, duree: 1 }])), duree: 5 }), 0.5);
});

test('les pistes masquées, segments masqués, sons et voix ne comptent pas', () => {
  const p = pistes(piste('video', [{ debut: 0, duree: 5 }], true), piste('image', [{ debut: 0, duree: 5, masque: true }, { debut: 8, duree: 5 }]), piste('voix', [{ debut: 0, duree: 5 }]));
  assert.equal(instantDOuverture({ pistes: p, duree: 20 }), 9);
});

test('rien de visuel, ou durée nulle : 0', () => {
  assert.equal(instantDOuverture({ pistes: pistes(piste('son', [{ debut: 0, duree: 5 }])), duree: 5 }), 0);
  assert.equal(instantDOuverture({ pistes: pistes(piste('video', [{ debut: 0, duree: 5 }])), duree: 0 }), 0);
});

test('l’instant reste dans la durée exportée', () => {
  assert.equal(instantDOuverture({ pistes: pistes(piste('video', [{ debut: 0, duree: 10 }])), duree: 0.6 }), 0.55);
});
