import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/*
 * LA MISE EN PRODUCTION D'UNE PARTIE DES TÂCHES (`server/src/production-partielle.ts`, refonte du 13/11/2026) :
 * sur un vrai dépôt jetable, trois cas — une tâche indépendante part seule, une tâche qui s'appuie sur une tâche
 * décochée est signalée avant le départ, et tout cocher reste possible.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'production-partielle-'));
process.env.BELUGA_DATA = bacASable;

const { getDb } = await import('../db.js');
const pp = await import('../production-partielle.js');
getDb();

const depot = fs.mkdtempSync(path.join(os.tmpdir(), 'depot-production-partielle-'));
const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: depot,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  }).trim();
const ecrire = (fichier: string, texte: string) => fs.writeFileSync(path.join(depot, fichier), texte);

git('init', '-q', '-b', 'main');
ecrire('a.txt', 'a1\n');
ecrire('b.txt', 'b1\n');
git('add', '.');
git('commit', '-qm', 'base');
git('checkout', '-qb', 'dev');

/* Trois cartes fusionnées l'une après l'autre dans « dev » : A touche a.txt, B touche b.txt, C retouche a.txt. */
let rang = 0;
function deployerUneCarte(cardId: string, fichier: string, texte: string) {
  const avant = git('rev-parse', 'HEAD');
  git('checkout', '-qb', `tache/${cardId}`, avant);
  ecrire(fichier, texte);
  git('commit', '-qam', cardId);
  git('checkout', '-q', 'dev');
  git('merge', '-q', '--no-ff', '--no-edit', `tache/${cardId}`);
  const apres = git('rev-parse', 'HEAD');
  pp.retenirLApport({ cardId, projectId: 'p', avant, apres, branche: `tache/${cardId}` });
  getDb().prepare('UPDATE apports_de_carte SET fusionne_le = ? WHERE card_id = ?').run(1000 + rang++, cardId);
}
deployerUneCarte('A', 'a.txt', 'a2\n');
deployerUneCarte('B', 'b.txt', 'b2\n');
deployerUneCarte('C', 'a.txt', 'a3\n');
const main = git('rev-parse', 'main');

test('les apports en attente se lisent dans l’ordre du déploiement', () => {
  assert.deepEqual(pp.apportsEnAttenteDeProduction('p').map((a) => a.cardId), ['A', 'B', 'C']);
});

test('une tâche indépendante (B seule) passe l’essai à blanc', async () => {
  const verdict = await pp.verifierLaSelection(depot, main, 'p', ['B']);
  assert.equal(verdict.ok, true);
});

test('une tâche qui touche les fichiers d’une tâche décochée plus ancienne (C sans A) est signalée', async () => {
  const verdict = await pp.verifierLaSelection(depot, main, 'p', ['B', 'C']);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.manques.map((m) => [m.cardId, m.besoinDe]), [['C', ['A']]]);
});

test('la mise en production de B seule ne porte que B, et la note', async () => {
  const issue = await pp.produireLaSelection(depot, 'main', 'p', ['B'], (id) => `Tâche ${id}`);
  assert.equal(issue.ok, true, issue.recit);
  assert.equal(git('show', 'main:b.txt'), 'b2');
  assert.equal(git('show', 'main:a.txt'), 'a1', 'A et C ne sont pas partis');
  assert.equal(git('merge-base', '--is-ancestor', main, 'main'), '', 'avance rapide depuis l’ancienne production');
  assert.deepEqual(pp.apportsEnAttenteDeProduction('p').map((a) => a.cardId), ['A', 'C']);
});

test('A puis C ensuite : C s’applique sur A, sans heurt', async () => {
  const issue = await pp.produireLaSelection(depot, 'main', 'p', ['A', 'C'], (id) => `Tâche ${id}`);
  assert.equal(issue.ok, true, issue.recit);
  assert.equal(git('show', 'main:a.txt'), 'a3');
  assert.deepEqual(pp.apportsEnAttenteDeProduction('p'), []);
});
