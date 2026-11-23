import test from 'node:test';
import assert from 'node:assert/strict';

/* LES CARTES SYSTÈME (cadre violet) : au travail dans « Actifs », puis 24 heures dans « Archiver ». */
const {
  DUREE_SYSTEME_TERMINE_MS,
  agentSystemeActif,
  agentSystemeTermine,
  miseEnProductionAffichee,
  miseEnProductionTerminee,
  misesEnProductionAAfficher,
  deploiementsApres,
  productionsApres,
  systemeFiniRecemment,
} = await import('@beluga/shared');

const JOUR = DUREE_SYSTEME_TERMINE_MS;
const T = 10 * JOUR;

const run = (id: string, projet: string, extra: Record<string, unknown> = {}) => ({
  id,
  projectId: projet,
  state: 'running',
  cible: 'production' as const,
  startedAt: T - 1_000,
  ...extra,
});

test('fini récemment : moins de 24 heures, jamais sans fin', () => {
  assert.equal(JOUR, 24 * 60 * 60 * 1000);
  assert.equal(systemeFiniRecemment(undefined, T), false);
  assert.equal(systemeFiniRecemment(T - 1, T), true);
  assert.equal(systemeFiniRecemment(T - JOUR + 1, T), true);
  assert.equal(systemeFiniRecemment(T - JOUR, T), false);
});

test('un agent sans carte fini va dans « Archiver » 24 heures — pas l’analyse, ni un agent actif ou sur sa carte', () => {
  assert.equal(agentSystemeTermine({ role: 'deploy', status: 'done', endedAt: T - 10 }, T), true);
  assert.equal(agentSystemeTermine({ role: 'deploy', status: 'failed', endedAt: T - 10 }, T), true);
  // Un ancien repère de lecture ne compte plus.
  assert.equal(agentSystemeTermine({ role: 'deploy', status: 'done', endedAt: T - 10, luA: T } as never, T), true);
  assert.equal(agentSystemeTermine({ role: 'deploy', status: 'done', endedAt: T - JOUR - 1 }, T), false);
  assert.equal(agentSystemeTermine({ role: 'analysis', status: 'done', endedAt: T - 10 }, T), false);
  assert.equal(agentSystemeTermine({ role: 'task', cardId: 'c', status: 'done', endedAt: T - 10 }, T), false);
  // Reparti pour un tour, ou arrêté sur sa question : il est encore actif.
  for (const agent of [
    { role: 'deploy', status: 'running', endedAt: T - 10 },
    { role: 'deploy', status: 'done', endedAt: T - 10, tourVivantDepuis: T - 5 },
    { role: 'deploy', status: 'idle', endedAt: T - 10, attendReponse: true },
  ]) {
    assert.equal(agentSystemeActif(agent), true);
    assert.equal(agentSystemeTermine(agent, T), false);
  }
});

test('seule une mise en PRODUCTION a sa carte : en cours, puis 24 heures après sa fin', () => {
  assert.equal(miseEnProductionAffichee(run('a', 'p'), T), true);
  assert.equal(miseEnProductionAffichee(run('a', 'p', { cible: 'dev' }), T), false);
  assert.equal(miseEnProductionAffichee(run('a', 'p', { cible: undefined }), T), false);
  for (const state of ['success', 'failed', 'stopped']) {
    assert.equal(miseEnProductionTerminee(run('a', 'p', { state, endedAt: T - 10 }), T), true, state);
    assert.equal(miseEnProductionAffichee(run('a', 'p', { state, endedAt: T - JOUR }), T), false, state);
  }
  // En cours, elle n'est pas « terminée » : elle reste dans « Actifs ».
  assert.equal(miseEnProductionTerminee(run('a', 'p'), T), false);
});

test('une carte par projet : la mise en production la plus récente remplace l’ancienne', () => {
  const runs = [
    run('vieille', 'p', { state: 'failed', startedAt: T - 500, endedAt: T - 450 }),
    run('recente', 'p', { state: 'success', startedAt: T - 300, endedAt: T - 250 }),
    run('en-cours', 'q', { startedAt: T - 400 }),
    run('finie', 'r', { state: 'success', startedAt: T - 100, endedAt: T - 50 }),
    run('perimee', 't', { state: 'success', startedAt: T - JOUR - 100, endedAt: T - JOUR - 50 }),
    run('deploiement', 's', { cible: 'dev', startedAt: T }),
  ];
  assert.deepEqual(
    misesEnProductionAAfficher(runs, T).map((r) => r.id),
    ['finie', 'recente', 'en-cours'],
  );
});

test('la table de l’écran : elle entre, reste finie, un déploiement ou un retard ne la touche pas', () => {
  let table: Record<string, ReturnType<typeof run>> = {};
  table = productionsApres(table, run('a', 'p'), T);
  assert.deepEqual(Object.keys(table), ['p']);
  // Un déploiement sur ce serveur, lancé ensuite, ne masque pas la carte de production.
  table = productionsApres(table, run('d', 'p', { cible: 'dev', startedAt: T }), T);
  assert.equal(table.p.id, 'a');
  table = productionsApres(table, run('a', 'p', { state: 'success', endedAt: T - 10 }), T);
  assert.equal(table.p.state, 'success');
  // Un événement en retard d'une publication plus ancienne ne la remplace pas.
  table = productionsApres(table, run('ancienne', 'p', { startedAt: 50 }), T);
  assert.equal(table.p.id, 'a');
  // Finie depuis plus de 24 heures : elle sort.
  table = productionsApres(table, run('a', 'p', { state: 'success', endedAt: T - JOUR - 1 }), T);
  assert.deepEqual(table, {});
});


test('la table des déploiements de l’écran : un événement en retard ne remplace pas le plus récent', () => {
  const T = 1_000_000_000;
  const run = (id: string, projectId: string, cible: 'dev' | 'production' | undefined, state: string, startedAt: number, endedAt?: number) => ({ id, projectId, cible, state, startedAt, endedAt });
  const t1 = deploiementsApres({}, run('x', 'p', 'dev', 'running', 10));
  assert.equal(deploiementsApres(t1, run('y', 'p', 'dev', 'success', 5, 6)).p!.id, 'x', 'un événement en retard ne remplace pas le plus récent');
  assert.equal(deploiementsApres(t1, run('z', 'p', 'production', 'running', 20)).p!.id, 'x', 'une mise en production a sa propre table');
});
