import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeployRun } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LA DERNIÈRE RÉUSSITE DE CHAQUE ÉTAPE DE PUBLICATION                 */
/*                                                                     */
/* C'est ce qui rend stable le repère « Essai réussi » de la page de    */
/* réglage : l'écran ne garde qu'UNE publication par projet, et la      */
/* preuve d'une étape disparaissait dès que l'autre publiait.           */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'reussites-de-publication-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');

function publication(projectId: string, patch: Partial<DeployRun>): void {
  store.saveDeploy(DeployRun.parse({ id: store.newId(), projectId, state: 'success', startedAt: 1_000, ...patch }));
}

test('chaque étape rend l’instant de sa dernière réussite, et une publication sans étape est un déploiement', () => {
  const projet = store.newId();
  publication(projet, { startedAt: 1_000, endedAt: 2_000 });
  publication(projet, { startedAt: 3_000, endedAt: 4_000 });
  publication(projet, { cible: 'production', startedAt: 5_000, endedAt: 6_000 });
  /* Plus récentes, mais pas des réussites : elles ne déplacent rien. */
  publication(projet, { state: 'failed', startedAt: 7_000, endedAt: 8_000 });
  publication(projet, { cible: 'production', state: 'stopped', startedAt: 9_000, endedAt: 9_500 });
  publication(projet, { state: 'running', startedAt: 10_000 });

  assert.deepEqual(store.dernieresReussitesDePublication(projet), { dev: 4_000, production: 6_000 });
});

test('une étape qui n’a jamais réussi est absente, et un projet ne lit jamais les réussites d’un autre', () => {
  const projet = store.newId();
  const voisin = store.newId();
  publication(voisin, { cible: 'production', startedAt: 1_000, endedAt: 2_000 });
  publication(projet, { state: 'failed', startedAt: 1_000, endedAt: 2_000 });
  assert.deepEqual(store.dernieresReussitesDePublication(projet), {});

  /* Une réussite sans heure de fin (publication d'avant ce champ) compte à son départ. */
  publication(projet, { startedAt: 3_000 });
  assert.deepEqual(store.dernieresReussitesDePublication(projet), { dev: 3_000 });
});
