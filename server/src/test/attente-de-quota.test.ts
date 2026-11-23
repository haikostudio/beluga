import assert from 'node:assert/strict';
import test from 'node:test';
import { cartesEnAttenteDeQuota } from '@beluga/shared';

const agents = [
  { id: 'a1', cardId: 'c1' },
  { id: 'a2', cardId: 'c2' },
  { id: 'a3', cardId: 'c3' },
  { id: 'libre' },
];

test('une demande écrite retombée en file faute de compte met sa carte en attente de quota', () => {
  const cartes = cartesEnAttenteDeQuota({
    agents,
    files: { a1: [{ messageId: 'm1' }], a2: [{}], libre: [{ messageId: 'm9' }] },
    decisions: [],
  });
  assert.deepEqual([...cartes], ['c1']);
});

test('une reprise de compte ouverte met sa carte en attente ; réglée, elle ne compte plus', () => {
  const cartes = cartesEnAttenteDeQuota({
    agents,
    files: {},
    decisions: [
      { source: 'reprise-de-compte', cardId: 'c2' },
      { source: 'reprise-de-compte', agentId: 'a3', reglee: true },
      { source: 'question-outil', cardId: 'c1' },
    ],
  });
  assert.deepEqual([...cartes], ['c2']);
});

test('la reprise sans carte nommée se rattache par son agent ; une file vidée efface le badge', () => {
  const cartes = cartesEnAttenteDeQuota({
    agents,
    files: { a1: [] },
    decisions: [{ source: 'reprise-de-compte', agentId: 'a3' }],
  });
  assert.deepEqual([...cartes], ['c3']);
});

test('un agent absent de l’écran se rattache par l’agent retenu de sa carte', () => {
  const cartes = cartesEnAttenteDeQuota({
    agents: [],
    cartes: [{ id: 'c7', agentId: 'ancien' }],
    files: { ancien: [{ messageId: 'm1' }] },
    decisions: [],
  });
  assert.deepEqual([...cartes], ['c7']);
});
