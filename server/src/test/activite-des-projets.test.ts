import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* La dernière activité de chaque projet, lue en base sur une base à soi. */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'activite-des-projets-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { getDb } = await import('../db.js');

test('projects.activite rend, par projet, la date de sa carte modifiée le plus récemment', () => {
  const inserer = getDb().prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, 'todo', 0, 't', '{}', 1, ?)`,
  );
  inserer.run('c1', 'p1', 100);
  inserer.run('c2', 'p1', 300);
  inserer.run('c3', 'p2', 200);
  assert.deepEqual(store.activiteDesProjets(), { p1: 300, p2: 200 });
});
