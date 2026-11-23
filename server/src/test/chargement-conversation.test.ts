import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELAI_CONVERSATION_MS,
  ESSAIS_CONVERSATION,
  suiteDuChargementRate,
} from '@beluga/shared';

test('une demande de conversation est tenue pour perdue au bout de huit secondes', () => {
  assert.equal(DELAI_CONVERSATION_MS, 8_000);
});

test('le premier essai raté est rejoué, le second abandonne la silhouette', () => {
  assert.equal(ESSAIS_CONVERSATION, 2);
  assert.equal(suiteDuChargementRate(1), 'rejouer');
  assert.equal(suiteDuChargementRate(2), 'echec');
  assert.equal(suiteDuChargementRate(5), 'echec');
});
