import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { lireLaRecette } from '@beluga/shared';
import { SCRIPT_ACCEPTER, SCRIPT_NETTOYER } from '../capture-nettoyage.js';

test('une recette nettoie les surcouches par défaut, et ne les garde que sur demande explicite', () => {
  const defaut = lireLaRecette({ cibles: ['https://exemple.fr/'] });
  assert.ok(defaut.ok && !defaut.recette.garderLesSurcouches);
  const garde = lireLaRecette({ cibles: ['https://exemple.fr/'], garderLesSurcouches: true });
  assert.ok(garde.ok && garde.recette.garderLesSurcouches === true);
  const flou = lireLaRecette({ cibles: ['https://exemple.fr/'], garderLesSurcouches: 'oui' });
  assert.ok(flou.ok && !flou.recette.garderLesSurcouches);
});

test('les scripts de nettoyage évalués dans la page sont du JavaScript valide', () => {
  assert.doesNotThrow(() => new vm.Script(SCRIPT_ACCEPTER));
  assert.doesNotThrow(() => new vm.Script(SCRIPT_NETTOYER));
});
