/**
 * LA MIGRATION « FABLE BANNI » : seuls les champs de MODÈLE passent à Opus, la
 * voix « fable » et les textes qui citent le mot restent intacts. Base jetable :
 * `BELUGA_DATA` est posé AVANT tout import du démon.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BELUGA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fable-banni-'));
const { getDb, MIGRATIONS } = await import('../db.js');

test('la migration ne touche que les champs de modèle, jamais un texte', () => {
  const db = getDb();
  const t = Date.now();
  db.prepare(`INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, run_engine, run_model)
              VALUES ('c1', 'p', 'planned', 1, 'carte', '{}', ?, ?, 'claude', 'claude-fable-5-1')`).run(t, t);
  const agent = (id: string, model: string, titre: string) =>
    db.prepare(`INSERT INTO agents (id, project_id, role, status, data, created_at, updated_at) VALUES (?, 'p', 'task', 'done', ?, ?, ?)`)
      .run(id, JSON.stringify({ id, title: titre, run: { engine: 'claude', model } }), t, t);
  agent('a1', 'claude-fable-5-1', 'essai');
  agent('a2', 'claude-sonnet-5-5', 'la voix fable reste citée');
  const migration = MIGRATIONS.find((m) => m.name === 'fable-banni-vers-opus');
  assert.ok(migration);
  db.exec(migration!.sql);
  db.exec(migration!.sql); // idempotente
  assert.equal((db.prepare(`SELECT run_model FROM cards WHERE id = 'c1'`).get() as any).run_model, 'claude-opus-5-5');
  const lire = (id: string) => JSON.parse((db.prepare('SELECT data FROM agents WHERE id = ?').get(id) as any).data);
  assert.equal(lire('a1').run.model, 'claude-opus-5-5');
  assert.equal(lire('a2').run.model, 'claude-sonnet-5-5');
  assert.equal(lire('a2').title, 'la voix fable reste citée');
});
