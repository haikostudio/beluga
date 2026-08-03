import assert from 'node:assert/strict';
import test from 'node:test';
import { etatVisuelCarte, gesteCarte, sortieAutorisee } from '@haikodev/shared';

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

/* ------------------------------------------------------------------ */
/* Les gestes de décision                                              */
/* ------------------------------------------------------------------ */

test('« Terminer la tâche » reste éteint pendant que l’agent travaille', () => {
  const d = gesteCarte('terminer', { colonne: 'running', etat: 'travaille', agentLance: true });
  assert.equal(d.affiche, true);
  assert.equal(d.possible, false);
  assert.match(d.raison ?? '', /travaille encore/);
});

test('« Terminer la tâche » s’allume quand l’agent a rendu', () => {
  const d = gesteCarte('terminer', { colonne: 'running', etat: 'termine', agentLance: true });
  assert.deepEqual(d, { affiche: true, possible: true });
});

test('une carte arrivée dans « En cours » sans agent ne se clôture pas', () => {
  const d = gesteCarte('terminer', { colonne: 'running', etat: 'repos', agentLance: false });
  assert.equal(d.possible, false);
  assert.match(d.raison ?? '', /Aucun agent/);
});

test('un agent en échec ou arrêté laisse clôturer : il n’y a plus rien à attendre', () => {
  assert.equal(gesteCarte('terminer', { colonne: 'running', etat: 'echec', agentLance: true }).possible, true);
  assert.equal(gesteCarte('terminer', { colonne: 'running', etat: 'repos', agentLance: true }).possible, true);
});

test('le geste ne s’affiche pas hors de sa colonne', () => {
  assert.equal(gesteCarte('terminer', { colonne: 'planned', etat: 'termine', agentLance: true }).affiche, false);
  assert.equal(gesteCarte('valider', { colonne: 'running', etat: 'repos' }).affiche, false);
  assert.equal(gesteCarte('publier', { colonne: 'running', etat: 'termine' }).affiche, false);
  assert.equal(gesteCarte('lancer', { colonne: 'todo', etat: 'repos' }).affiche, false);
});

test('« Lancer maintenant » s’éteint si un agent tourne déjà', () => {
  assert.equal(gesteCarte('lancer', { colonne: 'planned', etat: 'travaille' }).possible, false);
  assert.equal(gesteCarte('lancer', { colonne: 'planned', etat: 'repos' }).possible, true);
});

test('les gestes de début et de publication restent simples', () => {
  assert.deepEqual(gesteCarte('valider', { colonne: 'todo', etat: 'repos' }), { affiche: true, possible: true });
  assert.deepEqual(gesteCarte('publier', { colonne: 'done', etat: 'repos' }), { affiche: true, possible: true });
});

test('une carte ne quitte pas « En cours » pendant que son agent écrit', () => {
  const d = sortieAutorisee({ colonne: 'running', etat: 'travaille', agentLance: true }, 'done');
  assert.equal(d.possible, false);
  assert.match(d.raison ?? '', /travaille encore/);
});

test('l’agent a rendu : la carte se déplace librement', () => {
  assert.equal(sortieAutorisee({ colonne: 'running', etat: 'termine', agentLance: true }, 'done').possible, true);
  assert.equal(sortieAutorisee({ colonne: 'running', etat: 'echec', agentLance: true }, 'todo').possible, true);
});

test('rester dans sa colonne n’est jamais refusé', () => {
  assert.equal(sortieAutorisee({ colonne: 'running', etat: 'travaille' }, 'running').possible, true);
});

test('les autres colonnes ne sont pas verrouillées', () => {
  assert.equal(sortieAutorisee({ colonne: 'planned', etat: 'travaille' }, 'todo').possible, true);
  assert.equal(sortieAutorisee({ colonne: 'done', etat: 'repos' }, 'to_deploy').possible, true);
});
