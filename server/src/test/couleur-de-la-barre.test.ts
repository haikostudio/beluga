import test from 'node:test';
import assert from 'node:assert/strict';
import { composerLaCouleurDeLaBarre, lireRgba } from '@beluga/shared';

/*
 * LA COULEUR DU REPÈRE DE L'HEURE (`shared/src/couleur-de-la-barre.ts`) : les chiffres viennent des captures de l'iPhone.
 */
const NOIR_70 = [0, 0, 0, 0.7] as const;

test('un voile à 70 % sur une page blanche donne le gris mesuré sous le voile', () => {
  assert.equal(composerLaCouleurDeLaBarre([NOIR_70, [255, 255, 255, 1]], null), '#4d4d4d');
});

test('un voile à 70 % sur la page sombre donne le noir mesuré sous le voile', () => {
  assert.equal(composerLaCouleurDeLaBarre([NOIR_70, [33, 33, 33, 1]], null), '#0a0a0a');
});

test('sans voile, la couche opaque du dessus décide seule', () => {
  assert.equal(composerLaCouleurDeLaBarre([[33, 33, 33, 1], NOIR_70, [255, 255, 255, 1]], null), '#212121');
});

test('sans couche opaque, le fond de page reste dessous, et une couche transparente ne compte pas', () => {
  assert.equal(composerLaCouleurDeLaBarre([[0, 0, 0, 0], NOIR_70], [255, 255, 255, 1]), '#4d4d4d');
  assert.equal(composerLaCouleurDeLaBarre([], [33, 33, 33, 1]), '#212121');
});

test('le résultat est toujours opaque, même sans fond connu', () => {
  assert.equal(composerLaCouleurDeLaBarre([], null), '#ffffff');
  assert.equal(composerLaCouleurDeLaBarre([NOIR_70], [10, 10, 10, 0.5]), '#4d4d4d');
});

test('lit les écritures calculées par le navigateur', () => {
  assert.deepEqual(lireRgba('rgb(33, 33, 33)'), [33, 33, 33, 1]);
  assert.deepEqual(lireRgba('rgba(0, 0, 0, 0.7)'), [0, 0, 0, 0.7]);
  assert.deepEqual(lireRgba('rgb(0 0 0 / 0.4)'), [0, 0, 0, 0.4]);
  assert.equal(lireRgba('transparent'), null);
});
