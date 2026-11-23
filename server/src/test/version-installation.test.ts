/**
 * LA VERSION D'UNE INSTALLATION NE PART JAMAIS VIDE.
 *
 * Une installation (FI) envoyait au relais une version vide : `git` ne
 * répondait pas (absent du chemin du service, dépôt d'un autre compte, code
 * téléchargé sans `.git`). La version se lit alors sur le disque, au MÊME
 * format que `git log -1 --format=%cs %h` quand un `.git` existe, et en date
 * seule (« AAAA-MM-JJ ») sans lui.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'version-installation-'));
process.env.BELUGA_DATA = path.join(bacASable, 'donnees');

const { versionLueSurLeDisque } = await import('../relais-installations.js');

function git(dossier: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dossier, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@b', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@b' },
  }).trim();
}

function depot(nom: string): string {
  const d = path.join(bacASable, nom);
  fs.mkdirSync(d, { recursive: true });
  git(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'package.json'), '{}');
  git(d, 'add', 'package.json');
  execFileSync('git', ['-C', d, 'commit', '-q', '-m', 'x'], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'a',
      GIT_AUTHOR_EMAIL: 'a@b',
      GIT_COMMITTER_NAME: 'a',
      GIT_COMMITTER_EMAIL: 'a@b',
      // 23:30 à Zurich le 25 = 21:30 UTC : le jour est celui du commiteur, comme `%cs`.
      GIT_COMMITTER_DATE: '2026-10-25T23:30:00+02:00',
    },
  });
  return d;
}

test('un .git lu à la main rend exactement ce que rend git (objet libre)', () => {
  const d = depot('libre');
  assert.equal(versionLueSurLeDisque(d), git(d, 'log', '-1', '--format=%cs %h'));
  assert.match(versionLueSurLeDisque(d), /^2026-10-25 [0-9a-f]{7}$/);
});

test('un dépôt tassé (clone, gc) garde le sha et une date', () => {
  const d = depot('tasse');
  git(d, 'gc', '-q', '--aggressive');
  git(d, 'pack-refs', '--all');
  const sha = git(d, 'rev-parse', '--short=7', 'HEAD');
  assert.match(versionLueSurLeDisque(d), new RegExp(`^\\d{4}-\\d{2}-\\d{2} ${sha}$`));
});

test('sans .git, la date du code (package.json) seule', () => {
  const d = path.join(bacASable, 'archive');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'package.json'), '{}');
  const t = new Date('2026-10-20T12:00:00Z');
  fs.utimesSync(path.join(d, 'package.json'), t, t);
  assert.equal(versionLueSurLeDisque(d), '2026-10-20');
});

test('un dossier vide rend une chaîne vide, sans lever', () => {
  const d = path.join(bacASable, 'vide');
  fs.mkdirSync(d, { recursive: true });
  assert.equal(versionLueSurLeDisque(d), '');
});
