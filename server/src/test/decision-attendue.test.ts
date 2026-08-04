import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attentionParProjet,
  decisionsHorsCarte,
  decisionsOuvertes,
  decisionsParCarte,
  decisionsParConversation,
  premiereDecision,
  reperesParProjet,
  type DecisionAttendue,
} from '@haikodev/shared';

/** Un jeu représentatif : deux décisions sur une carte, deux dans le fil. */
const DECISIONS: DecisionAttendue[] = [
  { projectId: 'p1', agentId: 'chef', genre: 'validation', poseeA: 30 },
  { projectId: 'p1', agentId: 'a-carte', cardId: 'c1', genre: 'question', poseeA: 10 },
  { projectId: 'p1', agentId: 'chef', genre: 'question', poseeA: 40 },
  { projectId: 'p1', agentId: 'a-carte', cardId: 'c1', genre: 'question', poseeA: 20 },
  { projectId: 'p2', agentId: 'chef2', genre: 'validation', poseeA: 5 },
];

/* ------------------------------------------------------------------ */
/* Chaque décision est posée quelque part                               */
/* ------------------------------------------------------------------ */

test('une décision née dans le travail d’une carte se pose sur la carte', () => {
  assert.deepEqual(decisionsParCarte(DECISIONS), { c1: 2 });
});

test('une décision sans carte se pose sur la conversation', () => {
  assert.deepEqual(decisionsParConversation(DECISIONS), { chef: 2, chef2: 1 });
});

test('une décision de carte ne se pose PAS aussi sur la conversation', () => {
  const uneCarte: DecisionAttendue[] = [
    { projectId: 'p1', agentId: 'a-carte', cardId: 'c1', genre: 'question' },
  ];
  assert.deepEqual(decisionsParCarte(uneCarte), { c1: 1 });
  assert.deepEqual(decisionsParConversation(uneCarte), {});
});

/* ------------------------------------------------------------------ */
/* Le compte annoncé est le nombre de repères visibles                  */
/* ------------------------------------------------------------------ */

test('jamais quatre annoncés et rien de visible', () => {
  const annonce = attentionParProjet(DECISIONS);
  const parCarte = decisionsParCarte(DECISIONS);
  const parConversation = decisionsParConversation(DECISIONS);
  const somme = (compte: Record<string, number>) => Object.values(compte).reduce((t, n) => t + n, 0);

  assert.deepEqual(annonce, { p1: 4, p2: 1 });
  assert.deepEqual(reperesParProjet(DECISIONS), annonce);
  assert.equal(somme(parCarte) + somme(parConversation), somme(annonce));
});

test('une décision réglée ne laisse plus aucun repère', () => {
  const reglees = DECISIONS.map((decision) => ({ ...decision, reglee: true }));
  assert.deepEqual(decisionsParCarte(reglees), {});
  assert.deepEqual(decisionsParConversation(reglees), {});
  assert.deepEqual(reperesParProjet(reglees), attentionParProjet(reglees));
  assert.equal(decisionsOuvertes(reglees).length, 0);
});

test('le repère de l’entrée « Chef » ne compte que ce qui n’a pas de carte', () => {
  assert.equal(decisionsHorsCarte(DECISIONS, 'p1'), 2);
  assert.equal(decisionsHorsCarte(DECISIONS, 'p2'), 1);
  assert.equal(decisionsHorsCarte(DECISIONS, 'inconnu'), 0);
});

/* ------------------------------------------------------------------ */
/* Le triangle du projet emmène quelque part                            */
/* ------------------------------------------------------------------ */

test('le clic emmène à la décision la plus ancienne du projet', () => {
  assert.deepEqual(premiereDecision(DECISIONS, 'p1'), {
    projectId: 'p1',
    agentId: 'a-carte',
    cardId: 'c1',
  });
});

test('sans carte, le clic emmène à la conversation', () => {
  assert.deepEqual(premiereDecision(DECISIONS, 'p2'), {
    projectId: 'p2',
    agentId: 'chef2',
    cardId: undefined,
  });
});

test('rien en attente : le triangle n’emmène nulle part', () => {
  assert.equal(premiereDecision([], 'p1'), null);
  assert.equal(premiereDecision(DECISIONS.map((d) => ({ ...d, reglee: true })), 'p1'), null);
});
