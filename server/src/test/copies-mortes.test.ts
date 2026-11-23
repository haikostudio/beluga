import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cheminNettoyable, copiesMortes, racineDesCopies, tailleDesCopies, trierLeNettoyage } from '@beluga/shared';
import { copiesMortesDuProjet, nettoyerLesCopies } from '../dossier-de-carte.js';
import { dossiersOuverts } from '../git.js';

const execFileAsync = promisify(execFile);

/*
 * LES COPIES MORTES : celles que `git worktree list` ne nomme plus, donc que
 * `git worktree prune` ne rangera jamais. Constat : 1,3 Go sur le dépôt
 * principal. Rien ne s'efface tout seul, et le nettoyage refuse tout chemin
 * qui n'est pas posé sous le dossier des copies du projet.
 */

/* ------------------------------------------------------------------ */
/* Les règles pures                                                    */
/* ------------------------------------------------------------------ */

test('un chemin nettoyable est posé DIRECTEMENT sous le dossier des copies du projet', () => {
  const racine = racineDesCopies('/root/projet');
  assert.equal(racine, '/root/projet/.worktrees');
  assert.equal(cheminNettoyable('/root/projet/.worktrees/carte-abc123', racine), true);
  assert.equal(cheminNettoyable('/root/projet/.worktrees/carte-abc123/', racine), true);
});

test('le nettoyage refuse le dossier des copies lui-même, le dépôt, un autre projet, un chemin relatif ou qui remonte', () => {
  const racine = racineDesCopies('/root/projet');
  for (const chemin of [
    '/root/projet/.worktrees',
    '/root/projet/.worktrees/',
    '/root/projet',
    '/root/projet/server',
    '/root/autre/.worktrees/carte',
    '/root/projet/.worktrees/../server',
    '/root/projet/.worktrees/carte/../../server',
    '/root/projet/.worktrees/carte/sous-dossier',
    '.worktrees/carte',
    'carte',
    '',
    undefined,
    '/root/projet/.worktreesbis/carte',
  ]) {
    assert.equal(cheminNettoyable(chemin, racine), false, String(chemin));
  }
});

test('une copie encore inscrite dans git n’est jamais morte, même si son dossier est vide', () => {
  const presentes = [{ chemin: '/p/.worktrees/a' }, { chemin: '/p/.worktrees/b' }, { chemin: '/p/.worktrees/c' }];
  const mortes = copiesMortes(presentes, ['/p', '/p/.worktrees/b/']);
  assert.deepEqual(
    mortes.map((c) => c.chemin),
    ['/p/.worktrees/a', '/p/.worktrees/c'],
  );
});

test('le tri du nettoyage sépare ce qui part de ce qui est refusé, en disant pourquoi', () => {
  const tri = trierLeNettoyage(
    ['/p/.worktrees/morte', '/p/.worktrees/vivante', '/etc', '/p/.worktrees/morte'],
    '/p/.worktrees',
    ['/p', '/p/.worktrees/vivante'],
  );
  assert.deepEqual(tri.aEffacer, ['/p/.worktrees/morte']);
  assert.equal(tri.refusees.length, 2);
  assert.match(tri.refusees.find((r) => r.chemin === '/etc')?.raison ?? '', /dossier des copies/);
  assert.match(tri.refusees.find((r) => r.chemin === '/p/.worktrees/vivante')?.raison ?? '', /encore inscrite/);
});

test('la taille totale additionne ce qui est mesuré et ignore ce qui ne l’est pas', () => {
  assert.equal(tailleDesCopies([{ tailleOctets: 10 }, {}, { tailleOctets: 5 }]), 15);
});

/* ------------------------------------------------------------------ */
/* Sur un vrai dépôt jetable                                           */
/* ------------------------------------------------------------------ */

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
  return stdout.trim();
}

async function depot(): Promise<string> {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'copies-mortes-'));
  await git(racine, ['init', '--quiet', '-b', 'main']);
  await git(racine, ['config', 'user.email', 'test@beluga.local']);
  await git(racine, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(racine, 'README.md'), 'racine\n');
  await git(racine, ['add', 'README.md']);
  await git(racine, ['commit', '--quiet', '-m', 'départ']);
  return racine;
}

test('sur un dépôt : les copies que git ne liste plus sont détectées, les vivantes non', async () => {
  const racine = await depot();
  const copies = path.join(racine, '.worktrees');
  const vivante = path.join(copies, 'vivante-aaaaaa');
  await git(racine, ['worktree', 'add', '--quiet', '-b', 'tache/vivante-aaaaaa', vivante]);

  // Une copie inscrite puis coupée de git : son inscription est retirée, le
  // dossier reste — c'est le cas des 1,3 Go constatés.
  const coupee = path.join(copies, 'coupee-bbbbbb');
  await git(racine, ['worktree', 'add', '--quiet', '-b', 'tache/coupee-bbbbbb', coupee]);
  fs.rmSync(path.join(racine, '.git', 'worktrees', 'coupee-bbbbbb'), { recursive: true, force: true });
  // Un dossier jamais inscrit du tout (copie faite à la main, reste d'un essai).
  const jamais = path.join(copies, 'jamais-cccccc');
  fs.mkdirSync(jamais, { recursive: true });
  fs.writeFileSync(path.join(jamais, 'gros.bin'), Buffer.alloc(64 * 1024));

  const ouverts = await dossiersOuverts(racine);
  assert.ok(ouverts.some((d) => path.resolve(d) === path.resolve(vivante)));
  assert.ok(!ouverts.some((d) => path.resolve(d) === path.resolve(coupee)), 'git ne voit plus la copie coupée');

  const { racine: dossierDesCopies, copies: mortes } = await copiesMortesDuProjet(racine);
  assert.equal(dossierDesCopies, copies);
  assert.deepEqual(
    mortes.map((c) => c.nom).sort(),
    ['coupee-bbbbbb', 'jamais-cccccc'],
  );
  const grosse = mortes.find((c) => c.nom === 'jamais-cccccc');
  assert.ok((grosse?.tailleOctets ?? 0) >= 64 * 1024, 'la taille est approchée, mais jamais nulle sur un dossier plein');
  assert.ok(grosse?.modifieA, 'la date du dossier est relevée');
  assert.equal(mortes.find((c) => c.nom === 'coupee-bbbbbb')?.branche, undefined, 'sans inscription, plus de branche lisible');

  fs.rmSync(racine, { recursive: true, force: true });
});

test('sur un dépôt : le nettoyage n’efface que ce qu’on lui nomme, refuse le reste, et range git derrière lui', async () => {
  const racine = await depot();
  const copies = path.join(racine, '.worktrees');
  const vivante = path.join(copies, 'vivante-aaaaaa');
  await git(racine, ['worktree', 'add', '--quiet', '-b', 'tache/vivante-aaaaaa', vivante]);
  const morte = path.join(copies, 'morte-bbbbbb');
  fs.mkdirSync(morte, { recursive: true });
  fs.writeFileSync(path.join(morte, 'reste.txt'), 'reste\n');
  const gardee = path.join(copies, 'gardee-cccccc');
  fs.mkdirSync(gardee, { recursive: true });
  // Une inscription dont le dossier a disparu : c'est `git worktree prune` qui la range.
  const disparue = path.join(copies, 'disparue-dddddd');
  await git(racine, ['worktree', 'add', '--quiet', '-b', 'tache/disparue-dddddd', disparue]);
  fs.rmSync(disparue, { recursive: true, force: true });
  assert.ok(fs.existsSync(path.join(racine, '.git', 'worktrees', 'disparue-dddddd')));

  const dehors = fs.mkdtempSync(path.join(os.tmpdir(), 'pas-a-toucher-'));
  const bilan = await nettoyerLesCopies(racine, [morte, vivante, dehors, racine, copies, path.join(copies, '..', 'README.md')]);

  assert.deepEqual(bilan.effacees, [morte]);
  assert.equal(fs.existsSync(morte), false, 'la copie nommée est effacée');
  assert.equal(fs.existsSync(gardee), true, 'ce qui n’est pas nommé reste');
  assert.equal(fs.existsSync(vivante), true, 'une copie vivante ne s’efface pas');
  assert.equal(fs.existsSync(dehors), true, 'rien hors du dossier des copies');
  assert.equal(fs.existsSync(path.join(racine, 'README.md')), true);
  assert.equal(bilan.refusees.length, 5);
  assert.equal(fs.existsSync(path.join(racine, '.git', 'worktrees', 'disparue-dddddd')), false, '`git worktree prune` a rangé l’inscription orpheline');

  fs.rmSync(racine, { recursive: true, force: true });
  fs.rmSync(dehors, { recursive: true, force: true });
});

test('sur un dépôt : un projet qui est lui-même une copie de travail ne voit rien et ne nettoie rien', async () => {
  const racine = await depot();
  const copie = path.join(racine, '.worktrees', 'copie-aaaaaa');
  await git(racine, ['worktree', 'add', '--quiet', '-b', 'tache/copie-aaaaaa', copie]);
  fs.mkdirSync(path.join(copie, '.worktrees', 'quelque-chose'), { recursive: true });

  const vues = await copiesMortesDuProjet(copie);
  assert.equal(vues.copies.length, 0);
  const bilan = await nettoyerLesCopies(copie, [path.join(copie, '.worktrees', 'quelque-chose')]);
  assert.equal(bilan.effacees.length, 0);
  assert.equal(bilan.refusees.length, 1);
  assert.equal(fs.existsSync(path.join(copie, '.worktrees', 'quelque-chose')), true);

  fs.rmSync(racine, { recursive: true, force: true });
});
