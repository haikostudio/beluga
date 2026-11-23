import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ONGLETS_DES_TABLEAUX_DE_BORD,
  PREF_ONGLET_DES_TABLEAUX_DE_BORD,
  ongletDesTableauxDeBord,
} from '@beluga/shared';

test('les onglets du téléphone : « Tâches » en premier', () => {
  assert.deepEqual([...ONGLETS_DES_TABLEAUX_DE_BORD], ['taches', 'a-deployer', 'production']);
});

test('sans préférence ou avec une valeur abîmée, la page s’ouvre sur « Tâches »', () => {
  for (const v of [undefined, null, '', 'inconnu', 3, {}, ['production']]) assert.equal(ongletDesTableauxDeBord(v), 'taches');
  assert.equal(ongletDesTableauxDeBord('production'), 'production');
  assert.equal(ongletDesTableauxDeBord('a-deployer'), 'a-deployer');
});

test('la clé de la préférence ne change pas (des comptes l’ont déjà en base)', () => {
  assert.equal(PREF_ONGLET_DES_TABLEAUX_DE_BORD, 'tableaux-de-bord.onglet-telephone');
});
