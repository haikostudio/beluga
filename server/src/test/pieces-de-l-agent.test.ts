import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* Quelles pièces viennent de l'agent : la migration range les pièces d'avant, sur une base à soi. */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'pieces-de-l-agent-'));
process.env.BELUGA_DATA = bacASable;

const { MIGRATIONS, getDb } = await import('../db.js');

function pose(id: string, extra: Record<string, unknown> = {}) {
  const piece = { id, projectId: 'p1', name: `${id}.png`, mime: 'image/png', size: 1, sha: id, createdAt: 1, ...extra };
  getDb()
    .prepare('INSERT INTO attachments (id, project_id, sha, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'p1', id, JSON.stringify(piece), 1);
}

function message(id: string, role: string, attachments: string[]) {
  getDb()
    .prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'a1', role, JSON.stringify({ id, agentId: 'a1', role, attachments }), 1);
}

const drapeau = (id: string) => {
  const ligne = getDb().prepare('SELECT data FROM attachments WHERE id = ?').get(id) as { data: string };
  return (JSON.parse(ligne.data) as { deLAgent?: boolean }).deLAgent;
};

test('une pièce jointe par un message de l’agent est reconnue ; celle d’un humain ne l’est pas', () => {
  pose('de-l-agent');
  pose('de-l-humain');
  pose('sans-message');
  message('m-agent', 'assistant', ['de-l-agent']);
  message('m-humain', 'user', ['de-l-humain']);
  message('m-vide', 'assistant', []);

  const migration = MIGRATIONS.find((m) => m.name === 'pieces-de-l-agent');
  assert.ok(migration, 'la migration existe');
  // Rejouée : la première fois est faite au démarrage, sur une base encore vide.
  getDb().exec(migration.sql);

  assert.equal(drapeau('de-l-agent'), true);
  assert.equal(drapeau('de-l-humain'), undefined, 'un message de l’utilisateur ne la rend pas « de l’agent »');
  assert.equal(drapeau('sans-message'), undefined);
});

test('la migration ne touche pas à une pièce déjà marquée, et se rejoue sans dégât', () => {
  const avant = getDb().prepare("SELECT data FROM attachments WHERE id = 'de-l-agent'").get() as { data: string };
  const migration = MIGRATIONS.find((m) => m.name === 'pieces-de-l-agent')!;
  getDb().exec(migration.sql);
  const apres = getDb().prepare("SELECT data FROM attachments WHERE id = 'de-l-agent'").get() as { data: string };
  assert.equal(apres.data, avant.data);
});
