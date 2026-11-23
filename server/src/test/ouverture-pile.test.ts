import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUETE_SURVOL } from '@beluga/shared';

/*
 * La pile des messages courts s'ouvre au survol à la souris, à l'appui au
 * doigt. Sur un écran tactile il n'y a pas de survol : sans ce relais, la pile
 * resterait fermée et tout ce qui est dessous serait hors d'atteinte.
 */

test('la question posée au navigateur porte sur le pointeur, jamais sur la largeur', () => {
  assert.match(REQUETE_SURVOL, /hover/);
  assert.match(REQUETE_SURVOL, /pointer/);
  assert.ok(!/width/.test(REQUETE_SURVOL), 'la largeur d’écran ne doit pas décider du geste');
});
