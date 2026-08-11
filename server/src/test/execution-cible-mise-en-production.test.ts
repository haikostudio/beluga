import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dossierConstruit, executerCibleMiseEnProduction } from '../cible-mise-en-production.js';
import type { Project } from '@haikodev/shared';

/*
 * L'EXÉCUTION du transfert SSH/FTP (`server/src/cible-mise-en-production.ts`).
 *
 * Le TYPE et les champs d'accès sont des règles pures, déjà verrouillées par
 * `cible-mise-en-production.test.ts`. Ici, on vérifie ce que ce module fait
 * lui-même sans réseau : détecter le dossier construit, et refuser proprement
 * quand rien n'a pu être trouvé — jamais lancer un transfert au hasard.
 */

function projetFactice(patch: Partial<Project['miseEnProduction']>, cwd: string): Project {
  return {
    id: 'p1',
    name: 'Projet',
    path: cwd,
    defaultEngine: 'claude',
    isSelf: false,
    branchesDePublication: {},
    miseEnProduction: patch,
    rank: 1000,
    archived: false,
    createdAt: 0,
    updatedAt: 0,
  } as Project;
}

test('le dossier construit réglé à la main est repris s’il existe', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-cible-'));
  fs.mkdirSync(path.join(cwd, 'sortie'));
  assert.equal(dossierConstruit(cwd, 'sortie'), path.join(cwd, 'sortie'));
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('un dossier construit réglé mais absent rend null, sans deviner autre chose', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-cible-'));
  assert.equal(dossierConstruit(cwd, 'sortie-absente'), null);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('sans réglage, le premier nom usuel trouvé (« dist ») est repris', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-cible-'));
  fs.mkdirSync(path.join(cwd, 'dist'));
  assert.equal(dossierConstruit(cwd), path.join(cwd, 'dist'));
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('sans aucun dossier usuel présent, rien n’est deviné', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-cible-'));
  assert.equal(dossierConstruit(cwd), null);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('le type « aucune » réussit sans rien transférer', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-cible-'));
  const resultat = await executerCibleMiseEnProduction(projetFactice({ type: 'aucune' }, cwd), cwd);
  assert.equal(resultat.ok, true);
  assert.match(resultat.recit, /Aucune/);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('SSH sans dossier construit trouvable échoue proprement, sans tenter de transfert', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-cible-'));
  const resultat = await executerCibleMiseEnProduction(
    projetFactice({ type: 'ssh', ssh: { hote: 'serveur.exemple.com', utilisateur: 'deploy', motDePasse: 'x', dossierDistant: '/var/www' } }, cwd),
    cwd,
  );
  assert.equal(resultat.ok, false);
  assert.match(resultat.recit, /dossier construit/);
  fs.rmSync(cwd, { recursive: true, force: true });
});
