import assert from 'node:assert/strict';
import test from 'node:test';
import { mentionProgressionTaches, type CartePourProgression } from '@haikodev/shared';

/** Une carte dont l'agent a coché 2 étapes sur 3. */
const AVEC_TACHES: CartePourProgression = { todos: { done: 2, total: 3 } };

test('une carte avec un décompte affiche « n/N faites »', () => {
  assert.equal(mentionProgressionTaches(AVEC_TACHES), '2/3 faites');
});

test('le pluriel suit le décompte, comme le volet des tâches', () => {
  assert.equal(mentionProgressionTaches({ todos: { done: 1, total: 3 } }), '1/3 faite');
  assert.equal(mentionProgressionTaches({ todos: { done: 0, total: 3 } }), '0/3 faite');
  assert.equal(mentionProgressionTaches({ todos: { done: 3, total: 3 } }), '3/3 faites');
});

test('la mention n’a rien à voir avec la colonne ni un agent actif : elle reste tant que le décompte reste', () => {
  // Le décompte porté par l'agent survit à la fin de son tour : rien ici ne
  // dépend plus de la colonne de la carte ni d'un agent encore au travail.
  assert.equal(mentionProgressionTaches(AVEC_TACHES), '2/3 faites');
});

test('pas de liste de tâches : rien à afficher', () => {
  assert.equal(mentionProgressionTaches({}), null);
  assert.equal(mentionProgressionTaches({ todos: { done: 0, total: 0 } }), null);
});
