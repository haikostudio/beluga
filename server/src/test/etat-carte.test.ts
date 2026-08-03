import assert from 'node:assert/strict';
import test from 'node:test';
import { etatVisuelCarte } from '@haikodev/shared';

test('l’agent travaille : la roue tourne', () => {
  assert.equal(etatVisuelCarte({ agentStatut: 'running' }), 'travaille');
  assert.equal(etatVisuelCarte({ agentStatut: 'starting' }), 'travaille');
  assert.equal(etatVisuelCarte({ analyseEnCours: true }), 'travaille');
  assert.equal(etatVisuelCarte({ chiffrageEnCours: true }), 'travaille');
});

test('l’agent a rendu son travail : la coche', () => {
  assert.equal(etatVisuelCarte({ agentStatut: 'done' }), 'termine');
});

test('une relance repasse à la roue, puis revient à la coche', () => {
  assert.equal(etatVisuelCarte({ agentStatut: 'done' }), 'termine');
  assert.equal(etatVisuelCarte({ agentStatut: 'running' }), 'travaille');
  assert.equal(etatVisuelCarte({ agentStatut: 'done' }), 'termine');
});

test('un agent arrêté ou au repos n’a rien rendu : pas de coche', () => {
  assert.equal(etatVisuelCarte({ agentStatut: 'stopped' }), 'repos');
  assert.equal(etatVisuelCarte({ agentStatut: 'idle' }), 'repos');
  assert.equal(etatVisuelCarte({}), 'repos');
});

test('l’échec prime sur l’attente et sur la fin', () => {
  assert.equal(etatVisuelCarte({ agentStatut: 'failed' }), 'echec');
  assert.equal(etatVisuelCarte({ agentStatut: 'done', estimationEchouee: true }), 'echec');
});

test('l’attente prime sur la fin : la carte n’a pas repris', () => {
  assert.equal(etatVisuelCarte({ agentStatut: 'done', enAttente: true }), 'attente');
});

test('ce qui tourne prime sur tout le reste', () => {
  assert.equal(etatVisuelCarte({ agentStatut: 'running', estimationEchouee: true, enAttente: true }), 'travaille');
});

test('en ligne sans agent fini : la pastille « en ligne »', () => {
  assert.equal(etatVisuelCarte({ enLigne: true }), 'enligne');
  // Un travail rendu se dit AVANT la mise en ligne : c'est lui qui appelle un geste.
  assert.equal(etatVisuelCarte({ agentStatut: 'done', enLigne: true }), 'termine');
});
