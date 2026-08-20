import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { menageDesDossiers, dossiersOuverts } from '../dossier-de-carte.js';

const execFileAsync = promisify(execFile);

/*
 * `archiveCard` (`server/src/archive.ts`) renomme la branche d'une carte en
 * « archive/tache/… » à l'archivage. Une copie de travail encore ouverte à cet
 * instant continue de pointer sur cette nouvelle branche : le ménage doit la
 * reconnaître et la retirer — sans jamais la fusionner, la carte étant déjà
 * archivée.
 */

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
}

function bacASable(): string {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'menage-archivees-'));
  return dossier;
}

async function depotAvecPrincipale(): Promise<string> {
  const racine = bacASable();
  await git(racine, ['init', '--quiet', '-b', 'main']);
  await git(racine, ['config', 'user.email', 'test@haikodev.local']);
  await git(racine, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(racine, 'README.md'), 'racine\n');
  await git(racine, ['add', 'README.md']);
  await git(racine, ['commit', '--quiet', '-m', 'départ']);
  return racine;
}

test('une copie posée sur « archive/tache/… » est retirée, sans fusion', async () => {
  const racine = await depotAvecPrincipale();
  const dossier = path.join(racine, '.worktrees', 'carte-archivee');
  await git(racine, ['worktree', 'add', '-b', 'archive/tache/carte-archivee-abc123', dossier]);

  const avant = await dossiersOuverts(racine);
  assert.ok(avant.some((d) => path.resolve(d) === path.resolve(dossier)));

  const rattrapes = await menageDesDossiers(racine, []);

  assert.equal(rattrapes.length, 1);
  assert.equal(rattrapes[0].branche, 'archive/tache/carte-archivee-abc123');
  assert.equal(rattrapes[0].fusionnee, false, 'une carte archivée ne se refusionne jamais');

  assert.equal(fs.existsSync(dossier), false, 'la copie doit avoir été retirée du disque');
  const apres = await dossiersOuverts(racine);
  assert.ok(!apres.some((d) => path.resolve(d) === path.resolve(dossier)));

  // La branche « archive/tache/… », elle, doit survivre : on ne supprime que la copie.
  await git(racine, ['rev-parse', '--verify', '--quiet', 'archive/tache/carte-archivee-abc123']);

  fs.rmSync(racine, { recursive: true, force: true });
});

test('une copie « archive/tache/… » dont l’enregistrement d’office échoue reste ouverte', async () => {
  const racine = await depotAvecPrincipale();
  const dossier = path.join(racine, '.worktrees', 'carte-archivee-sale');
  await git(racine, ['worktree', 'add', '-b', 'archive/tache/carte-sale-def456', dossier]);
  fs.writeFileSync(path.join(dossier, 'oublie.txt'), 'travail non enregistré\n');
  // On force l'échec de l'enregistrement d'office (`--no-verify` sautant les
  // crochets git, on bloque directement l'index de la copie) pour vérifier le
  // refus : le dossier ne se retire jamais tant que son travail n'a pas pu être
  // mis en sûreté.
  const { stdout: gitDir } = await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dossier });
  const verrou = path.resolve(dossier, gitDir.trim(), 'index.lock');
  fs.writeFileSync(verrou, '');

  try {
    const rattrapes = await menageDesDossiers(racine, []);

    assert.equal(rattrapes.length, 1);
    assert.equal(rattrapes[0].fusionnee, false);
    assert.equal(rattrapes[0].enregistre, false, "l'enregistrement d'office a bien échoué");
    assert.equal(fs.existsSync(dossier), true, 'la copie reste ouverte tant que son travail n’est pas en sûreté');
  } finally {
    if (fs.existsSync(verrou)) fs.rmSync(verrou);
  }

  fs.rmSync(racine, { recursive: true, force: true });
});
