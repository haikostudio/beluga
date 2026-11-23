import assert from 'node:assert/strict';
import test from 'node:test';
import { raisonDuPlafond } from '../capacity.js';
import type { CapacityEtat } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LE MESSAGE DE REFUS DÉSIGNE LA VRAIE LIMITE TOMBÉE À ZÉRO             */
/*                                                                     */
/* Le refus de lancer un agent accusait toujours le plafond d'agents,  */
/* même quand c'est la mémoire ou la réserve de tâches qui a réellement */
/* bloqué. `raisonDuPlafond` doit nommer celle des trois limites qui    */
/* est la plus basse au moment du refus.                               */
/* ------------------------------------------------------------------ */

const base: CapacityEtat = {
  loadPct: 0,
  memUsedMb: 0,
  memTotalMb: 0,
  cpuCount: 4,
  runningAgents: 3,
  maxAgents: 15,
  slotsFree: 0,
  paused: false,
  at: Date.now(),
};

test('mémoire insuffisante : le message parle de mémoire', () => {
  const snap: CapacityEtat = { ...base, placesParMemoire: 0, avgAgentMemMb: 500 };
  assert.match(raisonDuPlafond(snap), /Mémoire disponible insuffisante/);
});

test('réserve de tâches pleine : le message parle de la réserve de tâches', () => {
  const snap: CapacityEtat = {
    ...base,
    placesParMemoire: 8,
    placesParTaches: 0,
    tasksCurrent: 435,
    tasksMax: 512,
  };
  assert.match(raisonDuPlafond(snap), /Réserve de tâches du service presque pleine/);
});

test('plafond d’agents atteint : le message garde le texte existant', () => {
  const snap: CapacityEtat = { ...base, placesParMemoire: 8, runningAgents: 15, maxAgents: 15 };
  assert.match(raisonDuPlafond(snap), /Plafond atteint : 15 agents tournent déjà \(maximum 15\)/);
});

test('plafond de six agents : le septième départ est refusé, en le disant', () => {
  const snap: CapacityEtat = { ...base, placesParMemoire: 8, runningAgents: 6, maxAgents: 6 };
  assert.match(raisonDuPlafond(snap), /Plafond atteint : 6 agents tournent déjà \(maximum 6\)/);
});
