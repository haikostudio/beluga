import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeployRun, decisionRepriseCoupure, REPRISES_PUBLICATION_MAX } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Une publication coupée par un redémarrage est REPRISE, pas jetée —   */
/* une seule fois, puis l'échec reste et nomme la cause.                */
/* ------------------------------------------------------------------ */

// Une vraie base, dans un dossier jetable, avant d'importer ce qui la lit.
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'reprise-publication-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { recoverAfterRestart } = await import('../runtime.js');

function runningDeploy(overrides: Partial<import('@haikodev/shared').DeployRun>) {
  return store.saveDeploy(
    DeployRun.parse({
      id: store.newId(),
      projectId: store.newId(),
      state: 'running',
      startedAt: Date.now(),
      ...overrides,
    }),
  );
}

/* ------------------------------------------------------------------ */
/* La règle pure                                                        */
/* ------------------------------------------------------------------ */

test('une première coupure se reprend, avec le compte à un de plus', () => {
  const decision = decisionRepriseCoupure(0);
  assert.equal(decision.reprendre, true);
  assert.equal(decision.reprendre && decision.reprises, 1);
});

test('au plafond, on abandonne et l’on nomme la cause', () => {
  const decision = decisionRepriseCoupure(REPRISES_PUBLICATION_MAX);
  assert.equal(decision.reprendre, false);
  assert.match(!decision.reprendre ? decision.erreur : '', /reprise .* fois sans aboutir/);
});

/* ------------------------------------------------------------------ */
/* La reprise au démarrage                                              */
/* ------------------------------------------------------------------ */

test('une publication « running » à l’extinction repart avec la même cible', () => {
  const run = runningDeploy({ cible: 'production', reprises: 0 });

  const reprises: Array<{ projectId: string; cible?: string; reprises: number }> = [];
  recoverAfterRestart((repris, n) => reprises.push({ projectId: repris.projectId, cible: repris.cible, reprises: n }));

  // La reprise est demandée pour CETTE publication, même cible, compte à 1.
  const demande = reprises.find((r) => r.projectId === run.projectId);
  assert.ok(demande, 'la reprise aurait dû être demandée');
  assert.equal(demande!.cible, 'production');
  assert.equal(demande!.reprises, 1);

  // L'ancien run est clos pour ne pas être repris de nouveau au prochain départ.
  const apres = store.getDeploy(run.id);
  assert.equal(apres!.state, 'stopped');
});

test('deux coupures d’affilée finissent en échec nommé, sans nouvelle reprise', () => {
  const run = runningDeploy({ cible: 'dev', reprises: REPRISES_PUBLICATION_MAX });

  const reprises: string[] = [];
  recoverAfterRestart((repris) => reprises.push(repris.projectId));

  assert.equal(reprises.includes(run.projectId), false, 'aucune reprise ne doit repartir');
  const apres = store.getDeploy(run.id);
  assert.equal(apres!.state, 'failed');
  assert.match(apres!.error ?? '', /abandonnée/);
});

test('une publication en échec ordinaire n’est pas reprise ni touchée', () => {
  const run = store.saveDeploy(
    DeployRun.parse({
      id: store.newId(),
      projectId: store.newId(),
      state: 'failed',
      error: 'Contrôles en échec : not ok 3 - un test.',
      startedAt: Date.now(),
      endedAt: Date.now(),
    }),
  );

  const reprises: string[] = [];
  recoverAfterRestart((repris) => reprises.push(repris.projectId));

  assert.equal(reprises.includes(run.projectId), false);
  const apres = store.getDeploy(run.id);
  assert.equal(apres!.state, 'failed');
  assert.equal(apres!.error, 'Contrôles en échec : not ok 3 - un test.');
});
