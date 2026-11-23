import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/*
 * LE RANGEMENT DE NUIT S'ENREGISTRE, SINON IL EST DÉFAIT LE LENDEMAIN.
 *
 * Le rendez-vous écrivait sur le disque du dossier partagé sans jamais
 * enregistrer. Chaque carte ouvrant sa copie de travail depuis le DERNIER
 * COMMIT, l'agent y retrouvait le fichier d'attente non rangé et sa fusion le
 * ramenait en entier : rangé chaque nuit, défait chaque jour, au-dessus de son
 * plafond pendant des jours. Le texte des règles part désormais en fiches de
 * classeur ; ce qui reste à enregistrer, ce sont le fichier d'attente vidé et
 * le fichier d'instructions.
 */

// Une base JETABLE, posée avant les imports du démon.
process.env.BELUGA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-rangement-enregistre-base-'));
const { rangerUnProjet } = await import('../instructions-en-attente.js');
const { unitesDeLaPortee } = await import('../connaissances.js');

function projetDEssai(): string {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-rangement-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: racine, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'essai@beluga.test');
  git('config', 'user.name', 'Essai');

  fs.mkdirSync(path.join(racine, 'docs'), { recursive: true });
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

test('le rangement de nuit enregistre lui-même ce qu’il vient de ranger', async () => {
  const racine = projetDEssai();
  const plan = await rangerUnProjet(racine);
  assert.ok(plan, 'le rangement a bien eu lieu');

  // La règle est une unité de la base de connaissances sous son sujet, et son nom rejoint le contrat…
  const regle = unitesDeLaPortee('global').find((u) => u.sujets.includes('methode') && u.titre === 'Une règle apprise cette nuit');
  assert.ok(regle, 'la règle est rangée en unité, sous son sujet');
  assert.equal(regle?.type, 'convention');
  assert.match(fs.readFileSync(path.join(racine, 'CLAUDE.md'), 'utf8'), /la règle nommée en une ligne/);

  // …et le disque est ENREGISTRÉ : sans commit, la copie de travail de la carte
  // suivante repartirait du fichier d'attente non rangé.
  assert.deepEqual(fichiersDuDernierCommit(racine), ['CLAUDE.md', 'docs/instructions-en-attente.md']);

  // Rien ne traîne en changement non enregistré.
  const restant = execFileSync('git', ['status', '--porcelain'], { cwd: racine, encoding: 'utf8' }).trim();
  assert.equal(restant, '');

  fs.rmSync(racine, { recursive: true, force: true });
});

test('un rangement qui n’a rien changé ne fabrique pas un commit à vide', async () => {
  const racine = projetDEssai();
  await rangerUnProjet(racine);
  const avant = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: racine, encoding: 'utf8' }).trim();

  // Le fichier d'attente est désormais vide : le second passage ne range rien.
  assert.equal(await rangerUnProjet(racine), undefined);
  const apres = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: racine, encoding: 'utf8' }).trim();
  assert.equal(apres, avant);

  fs.rmSync(racine, { recursive: true, force: true });
});
