import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VALEUR_LISTE_DE_TACHES,
  VARIABLE_LISTE_DE_TACHES,
  environnementDeLaListeDeTaches,
} from '@haikodev/shared';

test('le lancement Claude ouvre les outils de liste de tâches', () => {
  assert.deepEqual(environnementDeLaListeDeTaches({}), {
    [VARIABLE_LISTE_DE_TACHES]: VALEUR_LISTE_DE_TACHES,
  });
});

test('un environnement sans la variable la reçoit, même chargé par ailleurs', () => {
  const ajout = environnementDeLaListeDeTaches({ CLAUDE_CONFIG_DIR: '/home/haiko/.claude-accounts/secondary' });
  assert.equal(ajout[VARIABLE_LISTE_DE_TACHES], VALEUR_LISTE_DE_TACHES);
});

test('un réglage déjà posé par la machine n’est jamais écrasé', () => {
  assert.deepEqual(environnementDeLaListeDeTaches({ [VARIABLE_LISTE_DE_TACHES]: '0' }), {});
  assert.deepEqual(environnementDeLaListeDeTaches({ [VARIABLE_LISTE_DE_TACHES]: 'true' }), {});
});

test('une variable vide ne compte pas pour un réglage', () => {
  assert.deepEqual(environnementDeLaListeDeTaches({ [VARIABLE_LISTE_DE_TACHES]: '  ' }), {
    [VARIABLE_LISTE_DE_TACHES]: VALEUR_LISTE_DE_TACHES,
  });
});
