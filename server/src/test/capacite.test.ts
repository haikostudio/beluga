import assert from 'node:assert/strict';
import test from 'node:test';
import { partMemoire, phraseCapacite, tauxOccupation, tonCapacite } from '@haikodev/shared';

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
