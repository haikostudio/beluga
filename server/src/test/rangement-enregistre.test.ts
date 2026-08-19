import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { rangerUnProjet } from '../instructions-en-attente.js';

/*
 * LE RANGEMENT DE NUIT S'ENREGISTRE, SINON IL EST DÉFAIT LE LENDEMAIN.
 *
 * Le rendez-vous écrivait sur le disque du dossier partagé sans jamais
 * enregistrer. Chaque carte ouvrant sa copie de travail depuis le DERNIER
 * COMMIT, l'agent y retrouvait le fichier d'attente non rangé et sa fusion le
 * ramenait en entier : rangé chaque nuit, défait chaque jour, au-dessus de son
 * plafond pendant des jours.
 */

function projetDEssai(): string {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-rangement-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: racine, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'essai@haikodev.test');
  git('config', 'user.name', 'Essai');

  fs.mkdirSync(path.join(racine, 'docs', 'regles'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'docs', 'regles', 'methode.md'), '# Méthode — règles du moteur\n');
  fs.writeFileSync(path.join(racine, 'CLAUDE.md'), '# Instructions du moteur\n');
  fs.writeFileSync(
    path.join(racine, 'docs', 'instructions-en-attente.md'),
    '# Instructions en attente de rangement\n\n' +
      '## Une règle apprise cette nuit\n- sujet : methode\n- contrat : la règle nommée en une ligne\n\n' +
      'Le texte entier de la règle, avec le fichier qui la porte.\n',
  );
  git('add', '-A');
  git('commit', '-q', '-m', 'départ');
  return racine;
}

function fichiersDuDernierCommit(racine: string): string[] {
  return execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: racine, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort();
}

test('le rangement de nuit enregistre lui-même ce qu’il vient de ranger', () => {
  const racine = projetDEssai();
  const plan = rangerUnProjet(racine);
  assert.ok(plan, 'le rangement a bien eu lieu');

  // Le disque est rangé…
  assert.match(fs.readFileSync(path.join(racine, 'docs', 'regles', 'methode.md'), 'utf8'), /Une règle apprise/);
  assert.match(fs.readFileSync(path.join(racine, 'CLAUDE.md'), 'utf8'), /la règle nommée en une ligne/);

  // …et surtout ENREGISTRÉ : sans commit, la copie de travail de la carte
  // suivante repartirait du fichier d'attente non rangé.
  assert.deepEqual(fichiersDuDernierCommit(racine), [
    'CLAUDE.md',
    'docs/instructions-en-attente.md',
    'docs/regles/methode.md',
  ]);

  // Rien ne traîne en changement non enregistré.
  const restant = execFileSync('git', ['status', '--porcelain'], { cwd: racine, encoding: 'utf8' }).trim();
  assert.equal(restant, '');

  fs.rmSync(racine, { recursive: true, force: true });
});

test('un rangement qui n’a rien changé ne fabrique pas un commit à vide', () => {
  const racine = projetDEssai();
  rangerUnProjet(racine);
  const avant = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: racine, encoding: 'utf8' }).trim();

  // Le fichier d'attente est désormais vide : le second passage ne range rien.
  assert.equal(rangerUnProjet(racine), undefined);
  const apres = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: racine, encoding: 'utf8' }).trim();
  assert.equal(apres, avant);

  fs.rmSync(racine, { recursive: true, force: true });
});
