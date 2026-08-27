import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* ARRÊTER TOUS LES AGENTS — sur une base à soi                         */
/*                                                                      */
/* Ce contrôle appelle un geste EN FORCE : sans bac à sable, il lisait   */
/* la base RÉELLE du serveur et coupait pour de bon les agents en train  */
/* de travailler. Il dépendait aussi de ce qu'elle contenait ce jour-là  */
/* — d'où un contrôle qui passait ou tombait selon la machine. La base   */
/* est donc montée ici, vide, et l'état à juger y est posé à la main.    */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'arret-tous-agents-'));
process.env.HAIKODEV_DATA = bacASable;

const { stopAllAgents } = await import('../runtime.js');
const store = await import('../store.js');
const { getDb, MIGRATIONS } = await import('../db.js');

function agentQuiTourne() {
  return store.saveAgent({
    id: store.newId(),
    projectId: 'p1',
    role: 'task',
    title: 'essai',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);
}

test('stopAllAgents retourne une liste vide quand aucun agent n\'est actif', () => {
  const result = stopAllAgents();
  assert.equal(Array.isArray(result), true);
  // Base montée pour ce contrôle et rien de lancé : la liste est vide, et on
  // le dit — c'était l'objet du contrôle, que l'état de la machine masquait.
  assert.equal(result.length, 0);
});

test('stopAllAgents retourne un tableau d\'objets avec agentId et cardId optionnel', () => {
  const agent = agentQuiTourne();
  const result = stopAllAgents();
  assert.equal(
    result.some((item) => item.agentId === agent.id),
    true,
  );
  result.forEach((item) => {
    assert.equal(typeof item.agentId, 'string');
    if (item.cardId) {
      assert.equal(typeof item.cardId, 'string');
    }
  });
});

/*
 * LA CAUSE DE LA PANNE : le rôle « orchestrator », retiré du code avec le chef
 * d'orchestre, restait écrit sur des lignes d'agents. `listAgents()` relit
 * chaque ligne au travers du modèle : une seule valeur inconnue faisait jeter
 * la lecture ENTIÈRE, donc « arrêter tous les agents » avec elle. On rejoue ici
 * la migration qui répare ces lignes, sur une ligne d'hier posée à la main.
 */
test('une ligne d\'agent portant l\'ancien rôle « orchestrator » est ramenée au rôle de cadrage', () => {
  const db = getDb();
  const id = store.newId();
  const ancien = {
    id,
    projectId: 'p1',
    role: 'orchestrator',
    title: 'chef d’hier',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'done',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, session_id, data, created_at, updated_at)
     VALUES (?, 'p1', NULL, 'orchestrator', 'done', NULL, ?, ?, ?)`,
  ).run(id, JSON.stringify(ancien), ancien.createdAt, ancien.updatedAt);

  const migration = MIGRATIONS.find((m) => m.name === 'role-chef-d-orchestre-devenu-cadrage');
  assert.ok(migration, 'la migration qui range l’ancien rôle doit exister');
  db.exec(migration.sql);

  const repare = store.listAgents().find((a) => a.id === id);
  assert.equal(repare?.role, 'cadrage');
  const ligne = db.prepare('SELECT role FROM agents WHERE id = ?').get(id) as { role: string };
  assert.equal(ligne.role, 'cadrage');
});
