import test from 'node:test';
import assert from 'node:assert/strict';
import { titreDuPointPropre } from '@beluga/shared';

/* Le titre du point d'un tour de cadrage (`titreDuPoint`) : la liste des sujets a quitté le fil le 13/11/2026. */
test('un titre de point : propre, borné, rien de vide', () => {
  assert.equal(titreDuPointPropre('  Mini-carte   de la mémoire. '), 'Mini-carte de la mémoire');
  assert.equal(titreDuPointPropre('x'.repeat(80))?.length, 60);
  assert.equal(titreDuPointPropre(''), undefined);
  assert.equal(titreDuPointPropre(42), undefined);
});
