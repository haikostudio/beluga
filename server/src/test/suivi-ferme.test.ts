import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * LE SUIVI D'UNE PRODUCTION SE FERME, ET CHAQUE CARTE S'EN SOUVIENT
 * (28/10/2026) : la liste des cartes où il est fermé, réglage du compte borné.
 */
const { CLE_SUIVIS_FERMES, PLAFOND_DES_SUIVIS_FERMES, suivisFermes, suivisFermesApres } = await import('@beluga/shared');

test('fermer met la carte en tête, rouvrir la retire, sans doublon', () => {
  assert.equal(CLE_SUIVIS_FERMES, 'suivi.fermes');
  const une = suivisFermesApres(undefined, 'a', true);
  assert.deepEqual(une, ['a']);
  const deux = suivisFermesApres(une, 'b', true);
  assert.deepEqual(deux, ['b', 'a']);
  assert.deepEqual(suivisFermesApres(deux, 'a', true), ['a', 'b'], 'refermer remonte la carte sans la doubler');
  assert.deepEqual(suivisFermesApres(deux, 'a', false), ['b']);
  assert.deepEqual(suivisFermesApres(deux, 'z', false), ['b', 'a'], 'rouvrir une carte absente ne change rien');
});

test('une valeur abîmée se lit comme une liste vide, et la liste reste bornée', () => {
  assert.deepEqual(suivisFermes('a'), []);
  assert.deepEqual(suivisFermes([1, '', 'x', null]), ['x']);
  let liste: string[] = [];
  for (let i = 0; i < PLAFOND_DES_SUIVIS_FERMES + 5; i++) liste = suivisFermesApres(liste, `c${i}`, true);
  assert.equal(liste.length, PLAFOND_DES_SUIVIS_FERMES);
  assert.equal(liste[0], `c${PLAFOND_DES_SUIVIS_FERMES + 4}`, 'la plus récente en tête');
  assert.ok(!liste.includes('c0'), 'la plus ancienne est sortie');
});
