import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alertesParCarte,
  attentionParProjet,
  decisionsOuvertes,
  decisionsParCarte,
  decisionsQuiAlertent,
  premiereDecision,
  type DecisionAttendue,
} from '@beluga/shared';

/** Un jeu représentatif : deux décisions sur une carte, deux dans le fil. */
const DECISIONS: DecisionAttendue[] = [
  { projectId: 'p1', agentId: 'chef', genre: 'validation', poseeA: 30, messageId: 'm30' },
  { projectId: 'p1', agentId: 'a-carte', cardId: 'c1', genre: 'question', poseeA: 10, messageId: 'm10' },
  { projectId: 'p1', agentId: 'chef', genre: 'question', poseeA: 40, messageId: 'm40' },
  { projectId: 'p1', agentId: 'a-carte', cardId: 'c1', genre: 'question', poseeA: 20, messageId: 'm20' },
  { projectId: 'p2', agentId: 'chef2', genre: 'validation', poseeA: 5, messageId: 'm5' },
];

/* ------------------------------------------------------------------ */
/* Chaque décision est posée quelque part                               */
/* ------------------------------------------------------------------ */

test('une décision née dans le travail d’une carte se pose sur la carte', () => {
  assert.deepEqual(decisionsParCarte(DECISIONS), { c1: 2 });
});

test('une décision de carte se compte une seule fois, sur sa carte', () => {
  const uneCarte: DecisionAttendue[] = [
    { projectId: 'p1', agentId: 'a-carte', cardId: 'c1', genre: 'question' },
  ];
  assert.deepEqual(decisionsParCarte(uneCarte), { c1: 1 });
  assert.equal(horsCarte(uneCarte), 0);
});

/* ------------------------------------------------------------------ */
/* Le compte annoncé est le nombre de repères visibles                  */
/* ------------------------------------------------------------------ */

/*
 * Les repères réellement posés par l'interface : `alertesParCarte` sur les
 * cartes du tableau, `decisionsQuiAlertent` filtré par agent dans les
 * conversations (celles qui ne tiennent à aucune carte).
 */
const somme = (compte: Record<string, number>) => Object.values(compte).reduce((t, n) => t + n, 0);
const horsCarte = (decisions: DecisionAttendue[]) =>
  decisionsQuiAlertent(decisions).filter((d) => !d.cardId && d.agentId).length;

test('jamais quatre annoncés et rien de visible', () => {
  const annonce = attentionParProjet(DECISIONS);

  assert.deepEqual(annonce, { p1: 4, p2: 1 });
  assert.equal(somme(alertesParCarte(DECISIONS)) + horsCarte(DECISIONS), somme(annonce));
});

test('une décision réglée ne laisse plus aucun repère', () => {
  const reglees = DECISIONS.map((decision) => ({ ...decision, reglee: true }));
  assert.deepEqual(decisionsParCarte(reglees), {});
  assert.deepEqual(alertesParCarte(reglees), {});
  assert.equal(horsCarte(reglees), 0);
  assert.deepEqual(attentionParProjet(reglees), {});
  assert.equal(decisionsOuvertes(reglees).length, 0);
});

/* ------------------------------------------------------------------ */
/* Le triangle du projet emmène quelque part                            */
/* ------------------------------------------------------------------ */

/* Le lieu emporte AUSSI le message où le geste se prend : ouvrir la carte ne
   suffit pas, il faut arriver jusqu'à la bulle qui porte la question. */
test('le clic emmène à la décision la plus ancienne du projet', () => {
  assert.deepEqual(premiereDecision(DECISIONS, 'p1'), {
    projectId: 'p1',
    agentId: 'a-carte',
    cardId: 'c1',
    messageId: 'm10',
  });
});

test('sans carte, le clic emmène à la conversation', () => {
  assert.deepEqual(premiereDecision(DECISIONS, 'p2'), {
    projectId: 'p2',
    agentId: 'chef2',
    cardId: undefined,
    messageId: 'm5',
  });
});

test('rien en attente : le triangle n’emmène nulle part', () => {
  assert.equal(premiereDecision([], 'p1'), null);
  assert.equal(premiereDecision(DECISIONS.map((d) => ({ ...d, reglee: true })), 'p1'), null);
});
