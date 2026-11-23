import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cheminsIgnores, deposerLesFichiersIgnores, recollerLesDepotsIgnores } from '../memoire-hors-depot.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

/** Un projet dont la mémoire de travail est ignorée par git, et la copie d'une carte. */
function monter(ignore: string): { racine: string; copie: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'memoire-hors-depot-'));
  const racine = path.join(base, 'projet');
  fs.mkdirSync(racine);
  git(racine, 'init', '-q', '-b', 'dev');
  git(racine, 'config', 'user.email', 'essai@exemple.test');
  git(racine, 'config', 'user.name', 'essai');
  fs.writeFileSync(path.join(racine, '.gitignore'), ignore);
  fs.writeFileSync(path.join(racine, 'site.html'), '<p>site</p>\n');
  git(racine, 'add', '-A');
  git(racine, 'commit', '-q', '-m', 'Départ');
  fs.writeFileSync(path.join(racine, 'CLAUDE.md'), '# Instructions du site\n');
  fs.writeFileSync(path.join(racine, 'AGENTS.md'), 'Lire CLAUDE.md\n');
  const copie = path.join(base, 'copie');
  git(racine, 'worktree', 'add', '-q', '-b', 'tache/essai', copie);
  return { racine, copie };
}

test('le fichier d’instructions ignoré est déposé dans la copie, sans jamais y être enregistré', () => {
  const { racine, copie } = monter('CLAUDE.md\ndocs/instructions-en-attente/\n');
  assert.deepEqual(deposerLesFichiersIgnores(racine, copie), ['CLAUDE.md']);
  assert.equal(fs.readFileSync(path.join(copie, 'CLAUDE.md'), 'utf8'), '# Instructions du site\n');
  // AGENTS.md n'est pas ignoré : déposé, il partirait sur la branche au premier enregistrement.
  assert.equal(fs.existsSync(path.join(copie, 'AGENTS.md')), false);
  assert.equal(git(copie, 'status', '--porcelain'), '');
});

test('le dépôt de règles d’une carte rejoint le dossier du projet avant que la copie disparaisse, une seule fois', () => {
  const { racine, copie } = monter('CLAUDE.md\ndocs/instructions-en-attente/\n');
  const relatif = 'docs/instructions-en-attente/copie.md';
  fs.mkdirSync(path.join(copie, 'docs', 'instructions-en-attente'), { recursive: true });
  fs.writeFileSync(path.join(copie, relatif), '## Une règle\n- sujet : publication\n\nTexte.\n');

  assert.deepEqual(recollerLesDepotsIgnores(racine, copie), [relatif]);
  assert.equal(fs.readFileSync(path.join(racine, relatif), 'utf8'), '## Une règle\n- sujet : publication\n\nTexte.\n');
  assert.deepEqual(recollerLesDepotsIgnores(racine, copie), [], 'un second passage ne recopie pas le même texte');
  assert.equal(git(racine, 'status', '--porcelain'), '?? AGENTS.md', 'rien d’ignoré n’apparaît à enregistrer');
});

test('un projet qui suit sa mémoire ne voit rien changer', () => {
  const { racine, copie } = monter('node_modules/\n');
  assert.deepEqual(deposerLesFichiersIgnores(racine, copie), []);
  fs.mkdirSync(path.join(copie, 'docs', 'instructions-en-attente'), { recursive: true });
  fs.writeFileSync(path.join(copie, 'docs/instructions-en-attente/copie.md'), '## Règle suivie\n');
  assert.deepEqual(recollerLesDepotsIgnores(racine, copie), [], 'un dépôt suivi part avec la branche de la carte');
  assert.deepEqual([...cheminsIgnores(racine, ['CLAUDE.md', 'site.html'])], []);
});
