import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');

test('aucun export ne reste sans appelant (détecteur lancé avec npm test)', () => {
  const r = spawnSync('node', [path.join(RACINE, 'scripts', 'verif-exports-morts.mjs')], {
    cwd: RACINE,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
});
