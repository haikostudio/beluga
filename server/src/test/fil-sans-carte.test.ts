import assert from 'node:assert/strict';
import test from 'node:test';
import { entreesDuTourSansCarte, travailEnSousPoints, type RunStep } from '@beluga/shared';

const etape = (id: string, debut: number, fin: number, o: Partial<RunStep> = {}): RunStep => ({
  id,
  label: `Étape ${id}`,
  state: 'done',
  startedAt: debut,
  endedAt: fin,
  outil: 'Bash',
  ...o,
});

test('un tour sans carte se relit comme le journal d’une carte : actions rangées sous leur tâche', () => {
  const entrees = entreesDuTourSansCarte({
    id: 'm1',
    agentId: 'a1',
    createdAt: 100,
    steps: [
      etape('lecture', 110, 120),
      etape('cmd', 210, 230),
      etape('vivante', 240, 0, { state: 'running' }),
      etape('memoire', 115, 116),
    ],
    todos: [
      { label: 'Étudier', state: 'done', startedAt: 200, endedAt: 300 },
      { label: 'Écrire', state: 'todo' },
    ],
  }, (step) => step.id !== 'memoire');
  assert.ok(entrees.every((e) => e.cardId === '' && e.tourId === 'm1'));
  assert.deepEqual(entrees.map((e) => e.rang), entrees.map((_, i) => i), 'rangs sans trou, dans l’ordre du temps');
  assert.ok(!entrees.some((e) => e.id.includes('vivante')), 'une étape encore en cours n’entre pas au journal');
  assert.ok(!entrees.some((e) => e.id.includes('memoire')), 'le filtre écarte une étape');
  const sousPoints = travailEnSousPoints(entrees);
  assert.deepEqual(sousPoints.map((sp) => sp.libelle), ['Réflexion', 'Étudier', 'Écrire']);
  assert.deepEqual(sousPoints[0]!.entrees.map((e) => e.libelle), ['Étape lecture'], 'avant la première tâche : la réflexion');
  assert.deepEqual(sousPoints[1]!.entrees.map((e) => e.libelle), ['Étape cmd']);
  assert.equal(sousPoints[1]!.etat, 'done');
  assert.equal(sousPoints[1]!.dureeMs, 100);
  const requete = entrees.find((e) => e.id === 'm1:step:cmd')!;
  assert.equal(requete.nature, 'requete');
  assert.equal(requete.dureeMs, 20);
});

test('une question posée garde sa réponse, comme dans le journal', () => {
  const entrees = entreesDuTourSansCarte({
    id: 'm2',
    createdAt: 0,
    steps: [etape('q', 5, 9, { outil: 'mcp__beluga__ask_user', entree: '{"question":"Où ?"}', detail: 'Sur ce serveur' })],
  });
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0]!.outil, 'mcp__beluga__ask_user');
  assert.equal(entrees[0]!.params, '{"question":"Où ?"}');
  assert.equal(entrees[0]!.resultat, 'Sur ce serveur');
});

test('la phrase écrite avant une action (`noteAvant`) se relit à sa place, juste avant elle (13/11/2026)', () => {
  const entrees = entreesDuTourSansCarte({
    id: 'm2',
    createdAt: 100,
    steps: [
      etape('a', 110, 120, { noteAvant: 'Je regarde le fil.' }),
      etape('b', 130, 140),
      etape('c', 150, 0, { state: 'running', noteAvant: 'Je lance les tests.' }),
    ],
  });
  assert.deepEqual(
    entrees.map((e) => e.nature === 'jalon' ? `note:${e.resultat}` : e.libelle),
    ['note:Je regarde le fil.', 'Étape a', 'Étape b', 'note:Je lance les tests.'],
    'la phrase d’une action encore en cours est déjà écrite : elle se lit',
  );
});
