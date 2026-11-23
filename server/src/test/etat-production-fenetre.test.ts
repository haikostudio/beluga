import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeployRun, ecartProduction } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LA PRODUCTION SE RETROUVE, QUEL QUE SOIT LE NOMBRE DE DÉPLOIEMENTS  */
/*                                                                     */
/* L'état de la production relisait les 50 dernières publications,    */
/* toutes étapes confondues : après 66 déploiements, plus aucune mise  */
/* en production n'y figurait et la feuille disait « Jamais mise en    */
/* production » à un projet qui en comptait 28.                        */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'etat-production-fenetre-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { etatDeLaProduction } = await import('../deploy.js');

function publication(projectId: string, patch: Partial<DeployRun>): void {
  store.saveDeploy(DeployRun.parse({ id: store.newId(), projectId, state: 'success', startedAt: 1_000, ...patch }));
}

function projet(): string {
  const dossier = fs.mkdtempSync(path.join(bacASable, 'projet-'));
  return store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: dossier,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any).id;
}

test('une mise en production suivie de 80 déploiements reste la version en production', async () => {
  const id = projet();
  publication(id, { cible: 'production', targetCommit: 'abc1234def', startedAt: 1_000, endedAt: 2_000 });
  for (let i = 0; i < 40; i++) publication(id, { cible: 'dev', startedAt: 10_000 + i, endedAt: 10_500 + i });
  /* Une publication sans étape est un déploiement : jamais prise pour une production. */
  for (let i = 0; i < 40; i++) publication(id, { targetCommit: 'fff0000', startedAt: 20_000 + i });

  const etat = await etatDeLaProduction(id);
  assert.equal(etat.commit, 'abc1234def');
  assert.equal(etat.at, 2_000);
  assert.equal(etat.derniere, undefined);
  assert.notEqual(ecartProduction(etat).texte, 'Jamais mise en production');
});

test('la dernière tentative échouée se lit dans la même liste, noyée ou non sous les déploiements', async () => {
  const id = projet();
  publication(id, { cible: 'production', targetCommit: 'abc1234', startedAt: 1_000, endedAt: 2_000 });
  publication(id, { cible: 'production', state: 'failed', error: 'panne', startedAt: 3_000, endedAt: 4_000 });
  for (let i = 0; i < 60; i++) publication(id, { cible: 'dev', startedAt: 10_000 + i });

  const etat = await etatDeLaProduction(id);
  assert.equal(etat.commit, 'abc1234');
  assert.deepEqual(etat.derniere, { etat: 'failed', at: 4_000, erreur: 'panne' });
});

test('un projet vierge dit toujours « Jamais mise en production »', async () => {
  const id = projet();
  for (let i = 0; i < 5; i++) publication(id, { cible: 'dev', startedAt: 1_000 + i });
  const etat = await etatDeLaProduction(id);
  assert.equal(etat.commit, undefined);
  assert.equal(ecartProduction(etat).texte, 'Jamais mise en production');
});

test('la lecture par étape ne mêle ni les étapes ni les projets', () => {
  const id = projet();
  const voisin = projet();
  publication(voisin, { cible: 'production', startedAt: 5_000 });
  publication(id, { cible: 'production', startedAt: 1_000 });
  publication(id, { startedAt: 2_000 });
  publication(id, { cible: 'dev', startedAt: 3_000 });
  assert.deepEqual(store.deploysDeLEtape(id, 'production').map((r) => r.startedAt), [1_000]);
  assert.deepEqual(store.deploysDeLEtape(id, 'dev').map((r) => r.startedAt), [3_000, 2_000]);
});
