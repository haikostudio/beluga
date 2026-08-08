import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '@haikodev/shared';
import { reprendPourExecution } from '../scheduler.js';

/* ------------------------------------------------------------------ */
/* UNE SEULE SESSION PAR CARTE : le chiffrage et l'exécution partagent  */
/* le MÊME agent. `startCard` reprend donc l'agent d'analyse au lieu    */
/* d'en créer un second — sauf s'il n'y en a pas, ou s'il travaille     */
/* encore, ou si le dernier agent est déjà un agent de tâche.           */
/* ------------------------------------------------------------------ */

function agent(role: Agent['role'], id = 'a1'): Agent {
  return Agent.parse({
    id,
    projectId: 'p1',
    cardId: 'c1',
    role,
    title: 'x',
    run: { engine: 'claude' },
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
  });
}

test('un agent d’analyse au repos est repris pour l’exécution', () => {
  assert.equal(reprendPourExecution(agent('analysis'), false), true);
});

test('un agent d’analyse encore en tour n’est PAS repris (on ne double pas un tour)', () => {
  assert.equal(reprendPourExecution(agent('analysis'), true), false);
});

test('sans agent préalable, on repart neuf', () => {
  assert.equal(reprendPourExecution(null, false), false);
});

test('un dernier agent DÉJÀ de tâche (carte relancée) n’est pas repris par cette règle', () => {
  assert.equal(reprendPourExecution(agent('task'), false), false);
});
