import test from 'node:test';
import assert from 'node:assert/strict';
import { activiteDeProjet } from '@beluga/shared';

/*
 * L'ACTIVITÉ D'UN PROJET — le compte des agents au travail et la nature de ce
 * qui attend, tels que les listes de projets les montrent. Sans base ni
 * navigateur : la colonne de gauche et les listes déroulantes appellent la
 * même règle, elle se vérifie ici.
 */

const AU_TRAVAIL = { role: 'task', status: 'running', tourVivantDepuis: 1_000 };

test('un projet sans agent ni décision ne montre rien', () => {
  assert.deepEqual(activiteDeProjet('p1', [], []), { enCours: 0, attente: null });
});

test('seuls les agents du projet comptent, et seulement ceux qui travaillent', () => {
  const agents = [
    { projectId: 'p1', ...AU_TRAVAIL },
    { projectId: 'p1', ...AU_TRAVAIL },
    { projectId: 'p2', ...AU_TRAVAIL },
    { projectId: 'p1', role: 'task', status: 'done', endedAt: 2_000 },
  ];
  assert.equal(activiteDeProjet('p1', agents, []).enCours, 2);
  assert.equal(activiteDeProjet('p2', agents, []).enCours, 1);
  assert.equal(activiteDeProjet('p3', agents, []).enCours, 0);
});

test('l’icône d’attente suit la table partagée : la question passe avant le plan', () => {
  const decisions = [
    { projectId: 'p1', genre: 'action' as const, geste: 'valider-et-lancer' as const },
    { projectId: 'p1', genre: 'question' as const },
    { projectId: 'p2', genre: 'incident' as const },
  ];
  assert.equal(activiteDeProjet('p1', [], decisions).attente, 'message');
  assert.equal(activiteDeProjet('p2', [], decisions).attente, 'triangle');
  assert.equal(activiteDeProjet('p3', [], decisions).attente, null);
});

test('une décision déjà réglée n’attend plus personne', () => {
  const decisions = [{ projectId: 'p1', genre: 'question' as const, reglee: true }];
  assert.equal(activiteDeProjet('p1', [], decisions).attente, null);
});
