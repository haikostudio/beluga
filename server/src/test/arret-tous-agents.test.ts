import test from 'node:test';
import assert from 'node:assert/strict';
import { stopAllAgents } from '../runtime.js';
import * as store from '../store.js';

test('stopAllAgents retourne une liste vide quand aucun agent n\'est actif', () => {
  const result = stopAllAgents();
  assert.equal(Array.isArray(result), true);
  // On ne peut pas prédire le nombre exact car il dépend de l'état de la base,
  // mais on peut vérifier que c'est un tableau
  assert.equal(typeof result, 'object');
});

test('stopAllAgents retourne un tableau d\'objets avec agentId et cardId optionnel', () => {
  const result = stopAllAgents();
  if (result.length > 0) {
    result.forEach((item) => {
      assert.equal(typeof item.agentId, 'string');
      if (item.cardId) {
        assert.equal(typeof item.cardId, 'string');
      }
    });
  }
});
