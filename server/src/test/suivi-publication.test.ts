import assert from 'node:assert/strict';
import test from 'node:test';
import { suiviDeLaPublication, type DeployRun } from '@beluga/shared';

type Etape = DeployRun['steps'][number];
const etape = (key: Etape['key'], state: Etape['state']): Etape => ({ key, state, log: '' });

const run = (state: DeployRun['state'], steps: Etape[], extra: Partial<DeployRun> = {}) => ({
  state,
  steps,
  startedAt: 1_000,
  ...extra,
});

test('une étape sautée ne compte pas au total', () => {
  const suivi = suiviDeLaPublication(
    run('running', [
      etape('merge', 'skipped'),
      etape('commit', 'done'),
      etape('push', 'done'),
      etape('build', 'todo'),
      etape('publish', 'todo'),
    ]),
  );
  // 2 faites sur 4 jouées : 50 %, et la fusion sautée n'y pèse rien.
  assert.equal(suivi.pourcent, 50);
  assert.equal(suivi.etat, 'en-cours');
});

test('en route, le bandeau nomme l’étape qui travaille et garde le départ', () => {
  const suivi = suiviDeLaPublication(
    run('running', [etape('commit', 'done'), etape('build', 'running'), etape('publish', 'todo')], {
      currentStep: 'build',
    }),
  );
  assert.equal(suivi.etape, 'build');
  assert.equal(suivi.depuis, 1_000);
  assert.equal(suivi.pourcent, 50);
});

test('toutes les étapes cochées mais pas encore finie : 99 %, jamais 100', () => {
  const suivi = suiviDeLaPublication(run('running', [etape('commit', 'done'), etape('publish', 'done')]));
  assert.equal(suivi.pourcent, 99);
});

test('une publication réussie est à 100 % et ne nomme plus d’étape', () => {
  const suivi = suiviDeLaPublication(
    run('success', [etape('merge', 'skipped'), etape('commit', 'done'), etape('publish', 'done')], { endedAt: 5_000 }),
  );
  assert.deepEqual(suivi, { etat: 'reussie', pourcent: 100, etape: null, depuis: 1_000, finiA: 5_000 });
});

test('une publication tombée nomme l’étape tombée, et son chiffre est figé', () => {
  const suivi = suiviDeLaPublication(
    run('failed', [etape('commit', 'done'), etape('build', 'failed'), etape('publish', 'todo')], {
      currentStep: 'build',
    }),
  );
  assert.equal(suivi.etat, 'en-echec');
  assert.equal(suivi.etape, 'build');
  assert.equal(suivi.pourcent, 33);
});

test('une publication arrêtée se dit arrêtée, pas tombée', () => {
  const suivi = suiviDeLaPublication(run('stopped', [etape('commit', 'done'), etape('push', 'todo')], { currentStep: 'push' }));
  assert.equal(suivi.etat, 'arretee');
  assert.equal(suivi.etape, 'push');
});

test('sans étape connue, rien n’est inventé : 0 %', () => {
  assert.equal(suiviDeLaPublication(run('running', [])).pourcent, 0);
});
