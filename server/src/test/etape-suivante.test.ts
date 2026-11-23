import assert from 'node:assert/strict';
import test from 'node:test';
import { avanceDEtape, etapeSuivante, libelleEtapeSuivante, lotDAvance } from '@beluga/shared';

test('l’étape suivante suit le chemin du tableau, et s’arrête au bout', () => {
  assert.equal(etapeSuivante('planned'), 'running');
  assert.equal(etapeSuivante('running'), 'to_deploy');
  assert.equal(etapeSuivante('to_deploy'), 'archived');
  assert.equal(etapeSuivante('archived'), null);
});

test('le bouton dit « Lancer maintenant » pour l’entrée en travail', () => {
  assert.equal(libelleEtapeSuivante('running'), 'Lancer maintenant');
  assert.equal(libelleEtapeSuivante('archived'), 'Passer à « Archivé »');
  assert.equal(libelleEtapeSuivante(null), 'Dernière étape atteinte');
});

test('lancer et archiver demandent confirmation, pas le passage à « À déployer »', () => {
  assert.equal(avanceDEtape({ colonne: 'planned' }).confirmation, true);
  assert.equal(avanceDEtape({ colonne: 'to_deploy' }).confirmation, true);
  assert.equal(avanceDEtape({ colonne: 'to_deploy' }).confirmation, true);
});

test('le cran d’avance NE PROPOSE PLUS « Travail → Rapport », et dit pourquoi', () => {
  /* Le refus vient de la règle du dépôt : un rapport se rend, il ne se décrète
     pas. Le bouton s'éteint donc avec sa raison, au lieu de laisser le clic se
     heurter au serveur. */
  const verdict = avanceDEtape({ colonne: 'running' });
  assert.equal(verdict.cible, 'to_deploy');
  assert.equal(verdict.possible, false);
  assert.equal(verdict.confirmation, false);
  assert.match(verdict.raison ?? '', /rapport est rendu/);
});

test('une carte dont un agent travaille ne s’avance pas, et le dit', () => {
  const verdict = avanceDEtape({ colonne: 'running', agentActif: true });
  assert.equal(verdict.possible, false);
  assert.match(verdict.raison ?? '', /agent travaille/);
});

test('la dernière étape refuse en nommant sa colonne', () => {
  const verdict = avanceDEtape({ colonne: 'archived' });
  assert.equal(verdict.possible, false);
  assert.match(verdict.raison ?? '', /Archivé/);
});

test('une colonne inconnue ne fait pas tomber la règle', () => {
  const verdict = avanceDEtape({ colonne: 'in_production' as never });
  assert.equal(verdict.possible, false);
  assert.equal(verdict.cible, null);
});

test('un lot avance chaque carte d’un cran, chacune vers SA cible', () => {
  const lot = lotDAvance([
    { id: 'a', colonne: 'planned' },
    { id: 'b', colonne: 'to_deploy' },
    { id: 'c', colonne: 'archived' },
    { id: 'd', colonne: 'running', agentActif: true },
  ]);
  assert.deepEqual(
    lot.avances.map((a) => [a.carte.id, a.cible]),
    [
      ['a', 'running'],
      ['b', 'archived'],
    ],
  );
  assert.deepEqual(lot.bloquees.map((b) => b.carte.id), ['c', 'd']);
  assert.equal(lot.confirmation, true);
  assert.match(lot.question ?? '', /lancer 1 tâche/);
  assert.match(lot.question ?? '', /archiver 1 tâche/);
});

test('un lot posé sur des cartes en travail ne demande rien, et les dit bloquées', () => {
  const lot = lotDAvance([{ id: 'a', colonne: 'running' }]);
  assert.deepEqual(lot.avances, []);
  assert.deepEqual(lot.bloquees.map((b) => b.carte.id), ['a']);
  assert.equal(lot.confirmation, false);
  assert.equal(lot.question, undefined);
});

test('un lot qui archive demande confirmation : on ne ressort pas d’« Archivé » d’un clic', () => {
  const lot = lotDAvance([{ id: 'a', colonne: 'to_deploy' }]);
  assert.deepEqual(lot.avances.map((a) => a.cible), ['archived']);
  assert.equal(lot.confirmation, true);
  assert.match(lot.question ?? '', /archiver 1 tâche/);
});
