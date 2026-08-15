import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chargeRetenue,
  detailDesAgents,
  freinDeCharge,
  partMemoire,
  phraseCapacite,
  tauxOccupation,
  tonCapacite,
} from '@haikodev/shared';

test('le cas vécu : un agent en cours, quatorze places libres', () => {
  const etat = { runningAgents: 1, slotsFree: 14 };
  // La barre montrait cent (charge processeur plafonnée) : elle doit montrer sept.
  assert.equal(tauxOccupation(etat), 7);
  assert.equal(tonCapacite(etat), 'libre');
  assert.equal(phraseCapacite(etat), '14 agents peuvent encore démarrer');
});

test('plus aucune place : la barre est pleine et rouge', () => {
  const etat = { runningAgents: 15, slotsFree: 0 };
  assert.equal(tauxOccupation(etat), 100);
  assert.equal(tonCapacite(etat), 'sature');
  assert.equal(phraseCapacite(etat), 'Plus aucun agent ne peut démarrer');
});

test('départs suspendus : plein, quoi qu’en dise le compte des places', () => {
  const etat = { runningAgents: 0, slotsFree: 5, paused: true };
  assert.equal(tauxOccupation(etat), 100);
  assert.equal(tonCapacite(etat), 'sature');
  assert.equal(phraseCapacite(etat), 'Départs suspendus');
});

test('presque plus de place : le ton se tend avant la saturation', () => {
  assert.equal(tonCapacite({ runningAgents: 13, slotsFree: 2 }), 'tendu');
  assert.equal(tonCapacite({ runningAgents: 12, slotsFree: 3 }), 'libre');
});

test('une seule place restante s’écrit en toutes lettres', () => {
  assert.equal(phraseCapacite({ runningAgents: 14, slotsFree: 1 }), 'Un agent peut encore démarrer');
});

test('machine au repos : rien d’occupé', () => {
  assert.equal(tauxOccupation({ runningAgents: 0, slotsFree: 15 }), 0);
});

test('la part de mémoire ne divise jamais par zéro', () => {
  assert.equal(partMemoire(4000, 16000), 25);
  assert.equal(partMemoire(4000, 0), 0);
});

/* ------------------------------------------------------------------ */
/* Le cas de la capture : « saturé » avec 3 en cours sur 15            */
/* ------------------------------------------------------------------ */

test('une pointe de charge d’une minute ne freine rien', () => {
  // Le cas vécu : 216 % sur la minute, mais la machine tourne à 105 % de fond.
  assert.equal(freinDeCharge({ instantPct: 216, soutenuePct: 105 }).placesMax, null);
  assert.equal(chargeRetenue({ instantPct: 216, soutenuePct: 105 }), 105);
});

test('une charge qui DURE freine, sans jamais tout bloquer', () => {
  const frein = freinDeCharge({ instantPct: 250, soutenuePct: 180 });
  assert.equal(frein.placesMax, 3);
  assert.match(frein.raison ?? '', /chargée/);

  assert.equal(freinDeCharge({ instantPct: 260, soutenuePct: 250 }).placesMax, 1);
});

test('seule une surcharge réelle et durable arrête les départs', () => {
  const frein = freinDeCharge({ instantPct: 400, soutenuePct: 340 });
  assert.equal(frein.placesMax, 0);
  assert.match(frein.raison ?? '', /surchargée/);
});

test('un frein de charge ne se déguise jamais en manque de place', () => {
  const etat = { runningAgents: 3, slotsFree: 12, freinCharge: 'Machine chargée (180 %).' };
  assert.equal(phraseCapacite(etat), 'Départs ralentis : la machine est chargée');
  assert.equal(tonCapacite(etat), 'tendu');
  // La barre continue de dire la place occupée, pas cent.
  assert.equal(tauxOccupation(etat), 20);
});

test('le compte sépare les tâches du tableau des agents de service', () => {
  // La capture disait « 3 en cours » quand l'utilisateur ne voyait que 2 tâches.
  assert.equal(detailDesAgents({ runningAgents: 3, runningTasks: 2 }), '2 tâches en cours · 1 agent de service');
  assert.equal(detailDesAgents({ runningAgents: 1, runningTasks: 1 }), '1 tâche en cours');
  assert.equal(detailDesAgents({ runningAgents: 5, runningTasks: 2 }), '2 tâches en cours · 3 agents de service');
  // Un serveur d'avant, qui n'envoie pas le détail : on ne raconte rien de plus.
  assert.equal(detailDesAgents({ runningAgents: 3 }), '3 en cours');
});
