import assert from 'node:assert/strict';
import test from 'node:test';
import {
  brancheDeTache,
  carteNonLue,
  commitsSansCarte,
  descriptionHorsTache,
  estPlomberie,
  rendusDuGroupe,
  rendusParProjet,
  titreHorsTache,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* La pastille « terminé, pas encore lu »                              */
/* ------------------------------------------------------------------ */

test('seul un agent qui a RENDU allume la pastille', () => {
  assert.equal(carteNonLue({ cardId: 'c', projectId: 'p', agentStatut: 'done', agentFiniA: 100 }), true);
  assert.equal(carteNonLue({ cardId: 'c', projectId: 'p', agentStatut: 'running', agentFiniA: 100 }), false);
  assert.equal(carteNonLue({ cardId: 'c', projectId: 'p', agentStatut: 'stopped', agentFiniA: 100 }), false);
  assert.equal(carteNonLue({ cardId: 'c', projectId: 'p', agentStatut: 'failed', agentFiniA: 100 }), false);
  assert.equal(carteNonLue({ cardId: 'c', projectId: 'p' }), false);
});

test('la lecture éteint la pastille, mais seulement si elle vient APRÈS', () => {
  const base = { cardId: 'c', projectId: 'p', agentStatut: 'done' as const, agentFiniA: 200 };
  assert.equal(carteNonLue({ ...base, luA: 300 }), false);
  // Ouvrir la carte avant que l'agent ait fini n'éteint rien.
  assert.equal(carteNonLue({ ...base, luA: 100 }), true);
});

test('une carte archivée ne réclame plus rien', () => {
  assert.equal(
    carteNonLue({ cardId: 'c', projectId: 'p', colonne: 'archived', agentStatut: 'done', agentFiniA: 10 }),
    false,
  );
});

test('le compte se fait par projet, et remonte sur le groupe replié', () => {
  const parProjet = rendusParProjet([
    { cardId: 'a', projectId: 'haiko', agentStatut: 'done', agentFiniA: 10 },
    { cardId: 'b', projectId: 'haiko', agentStatut: 'done', agentFiniA: 20 },
    { cardId: 'c', projectId: 'haiko', agentStatut: 'done', agentFiniA: 20, luA: 30 },
    { cardId: 'd', projectId: 'eloya', agentStatut: 'done', agentFiniA: 5 },
    { cardId: 'e', projectId: 'eloya', agentStatut: 'running' },
  ]);
  assert.deepEqual(parProjet, { haiko: 2, eloya: 1 });
  assert.equal(rendusDuGroupe(['haiko', 'eloya'], parProjet), 3);
  assert.equal(rendusDuGroupe(['inconnu'], parProjet), 0);
});

/* ------------------------------------------------------------------ */
/* Une carte pour le travail fait hors tâche                           */
/* ------------------------------------------------------------------ */

const commit = (sha: string, titre: string, extra: Record<string, unknown> = {}) => ({
  sha,
  titre,
  branche: 'main',
  ...extra,
});

test('un enregistrement ordinaire mérite sa carte', () => {
  const retenus = commitsSansCarte([commit('aaa1', 'Corrige l’heure des messages')]);
  assert.equal(retenus.length, 1);
  assert.equal(retenus[0].sha, 'aaa1');
});

test('la plomberie de la publication n’est pas du travail', () => {
  assert.equal(estPlomberie('Publication : 3 tâche(s)'), true);
  assert.equal(estPlomberie('Travaux en cours enregistrés avant publication'), true);
  assert.equal(estPlomberie('Merge branch «tache/x»'), true);
  assert.equal(estPlomberie('Corrige la barre d’écriture'), false);
  assert.equal(commitsSansCarte([commit('b1', 'Publication : 2 tâche(s)')]).length, 0);
});

test('une branche de tâche a déjà sa carte : on ne double jamais', () => {
  assert.equal(brancheDeTache('tache/quelque-chose-abc123'), true);
  assert.equal(brancheDeTache('main'), false);
  assert.equal(
    commitsSansCarte([commit('c1', 'Travail de carte', { branche: 'tache/ma-carte-123456' })]).length,
    0,
  );
});

test('un enregistrement déjà rattaché à une carte ne revient pas', () => {
  const retenus = commitsSansCarte([commit('d1', 'Déjà fiché'), commit('d2', 'Nouveau')], {
    shasCouverts: ['d1'],
  });
  assert.deepEqual(retenus.map((c) => c.sha), ['d2']);
});

test('une branche tenue par une carte est ignorée, même sans préfixe', () => {
  const retenus = commitsSansCarte([commit('e1', 'Travail', { branche: 'correctif-urgent' })], {
    branchesDeCartes: ['correctif-urgent'],
  });
  assert.equal(retenus.length, 0);
});

test('une fusion vient d’ailleurs : elle n’est pas du travail de cet agent', () => {
  assert.equal(commitsSansCarte([commit('f1', 'Fusion de main', { fusion: true })]).length, 0);
});

test('le même enregistrement vu deux fois ne donne qu’une carte', () => {
  assert.equal(commitsSansCarte([commit('g1', 'Une fois'), commit('g1', 'Une fois')]).length, 1);
});

test('le titre de la carte est repris du message enregistré', () => {
  assert.equal(titreHorsTache([commit('h1', 'Corrige le compteur')]), 'Corrige le compteur');
  assert.equal(
    titreHorsTache([commit('h1', 'Corrige le compteur'), commit('h2', 'Et le reste')]),
    'Corrige le compteur (+1)',
  );
  assert.equal(titreHorsTache([]), 'Travail enregistré sans carte');
  assert.ok(titreHorsTache([commit('h3', 'x'.repeat(200))]).length <= 90);
});

test('la description nomme l’auteur et liste ce qui est embarqué', () => {
  const texte = descriptionHorsTache([commit('abcdef1234', 'Corrige le compteur')], 'Chef d’orchestre');
  assert.ok(texte.includes('Chef d’orchestre'));
  assert.ok(texte.includes('Corrige le compteur'));
  assert.ok(texte.includes('abcdef1'));
});
