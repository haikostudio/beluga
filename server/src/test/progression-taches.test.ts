import assert from 'node:assert/strict';
import test from 'node:test';
import { mentionProgressionTaches, type CartePourProgression } from '@haikodev/shared';

/** Une carte en cours dont l'agent a coché 2 étapes sur 3. */
const EN_COURS: CartePourProgression = {
  column: 'running',
  agentActif: true,
  todos: { done: 2, total: 3 },
};

test('une carte en cours affiche « n/N faites »', () => {
  assert.equal(mentionProgressionTaches(EN_COURS), '2/3 faites');
});

test('le pluriel suit le décompte, comme le volet des tâches', () => {
  assert.equal(mentionProgressionTaches({ ...EN_COURS, todos: { done: 1, total: 3 } }), '1/3 faite');
  assert.equal(mentionProgressionTaches({ ...EN_COURS, todos: { done: 0, total: 3 } }), '0/3 faite');
  assert.equal(mentionProgressionTaches({ ...EN_COURS, todos: { done: 3, total: 3 } }), '3/3 faites');
});

test('hors de « En cours », rien : la colonne dit déjà où en est la carte', () => {
  assert.equal(mentionProgressionTaches({ ...EN_COURS, column: 'done' }), null);
  assert.equal(mentionProgressionTaches({ ...EN_COURS, column: 'validated' }), null);
});

test('aucun agent au travail : un avancement figé n’apprend rien de vivant', () => {
  assert.equal(mentionProgressionTaches({ ...EN_COURS, agentActif: false }), null);
});

test('pas de liste de tâches : rien à afficher', () => {
  assert.equal(mentionProgressionTaches({ column: 'running', agentActif: true }), null);
  assert.equal(
    mentionProgressionTaches({ column: 'running', agentActif: true, todos: { done: 0, total: 0 } }),
    null,
  );
});
