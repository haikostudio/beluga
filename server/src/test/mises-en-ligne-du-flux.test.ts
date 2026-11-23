import assert from 'node:assert/strict';
import test from 'node:test';
import { dateDeLaMiseEnLigne, fluxMele, misesEnLigneApres, sansEchecsRemplaces } from '@beluga/shared';

const run = (id: string, startedAt: number, state = 'success', endedAt?: number) => ({
  id,
  projectId: 'p',
  state,
  cible: 'dev' as const,
  startedAt,
  endedAt: state === 'running' ? undefined : (endedAt ?? startedAt + 5),
});
const ligne = (id: string, updatedAt: number) => ({ carte: { id, updatedAt } });

test('la date d’une mise en ligne : sa fin, sinon son départ', () => {
  assert.equal(dateDeLaMiseEnLigne({ startedAt: 10, endedAt: 20 }), 20);
  assert.equal(dateDeLaMiseEnLigne({ startedAt: 10 }), 10);
});

test('cartes et mises en ligne se rangent ensemble par date, cinq comptées', () => {
  const lignes = [ligne('c1', 100), ligne('c2', 80), ligne('c3', 60)];
  const runs = [run('d1', 90), run('d2', 70), run('d3', 50)];
  const flux = fluxMele(lignes, new Set(['c1', 'c2', 'c3']), runs, 5, () => false);
  assert.deepEqual(flux.map((e) => e.id), ['c1', 'd1', 'c2', 'd2', 'c3']);
});

test('une mise en ligne qui tourne ne quitte jamais la liste, ni une carte gardée', () => {
  const lignes = [ligne('c1', 100), ligne('ouverte', 1)];
  const runs = [run('d1', 90), run('vieux', 2, 'running')];
  const flux = fluxMele(lignes, new Set(['c1', 'ouverte']), runs, 2, (l) => l.carte.id === 'ouverte');
  assert.deepEqual(flux.map((e) => e.id), ['c1', 'd1', 'vieux', 'ouverte']);
});

test('aucun doublon : la même mise en ligne lue deux fois ne fait qu’une ligne', () => {
  const flux = fluxMele([], new Set(), [run('d1', 10, 'running'), run('d1', 10, 'success', 30)], 5, () => false);
  assert.equal(flux.length, 1);
  assert.equal(flux[0].genre === 'mise-en-ligne' && flux[0].run.state, 'success');
});

test('un événement en retard ne rallume pas une ligne finie', () => {
  const finie = misesEnLigneApres([], run('d1', 10, 'success', 30));
  const apres = misesEnLigneApres(finie, run('d1', 10, 'running'));
  assert.equal(apres[0].state, 'success');
  const suivante = misesEnLigneApres(apres, run('d2', 40, 'running'));
  assert.deepEqual(suivante.map((r) => r.id), ['d2', 'd1']);
});

test('une seule ligne d’échec par projet et par étape : la suivante efface la précédente', () => {
  const run = (id: string, startedAt: number, state: string, cible: 'dev' | 'production' = 'dev', projectId = 'p') =>
    ({ id, projectId, state, cible, startedAt, endedAt: startedAt + 10 }) as const;
  const echecs = [run('e1', 1, 'failed'), run('e2', 2, 'failed'), run('e3', 3, 'failed'), run('e4', 4, 'failed')];
  assert.deepEqual(sansEchecsRemplaces(echecs).map((r) => r.id), ['e4']);
  // une réussite plus récente efface l'échec ; une autre étape ou un autre projet ne l'efface pas
  assert.deepEqual(sansEchecsRemplaces([run('e1', 1, 'failed'), run('ok', 2, 'success')]).map((r) => r.id), ['ok']);
  assert.deepEqual(
    sansEchecsRemplaces([run('e1', 1, 'failed'), run('prod', 2, 'success', 'production'), run('autre', 3, 'success', 'dev', 'q')]).map((r) => r.id),
    ['e1', 'prod', 'autre'],
  );
  // les réussites passées restent toutes au flux
  assert.equal(sansEchecsRemplaces([run('a', 1, 'success'), run('b', 2, 'success')]).length, 2);
});
