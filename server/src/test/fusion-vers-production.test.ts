import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gesteVersProduction } from '@beluga/shared';
import { fusionnerVersLaProduction } from '../fusion-vers-production.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

/** Un dépôt distant nu, et le dossier du projet qui le suit, sur « dev ». */
function monter(): { distant: string; projet: string; poser: (fichier: string, contenu: string, message: string) => string } {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'fusion-production-'));
  const distant = path.join(racine, 'distant.git');
  const projet = path.join(racine, 'projet');
  git(racine, 'init', '-q', '--bare', '-b', 'main', distant);
  git(racine, 'clone', '-q', distant, projet);
  git(projet, 'config', 'user.email', 'essai@exemple.test');
  git(projet, 'config', 'user.name', 'essai');
  git(projet, 'config', 'commit.gpgsign', 'false');
  const poser = (fichier: string, contenu: string, message: string) => {
    fs.writeFileSync(path.join(projet, fichier), contenu);
    git(projet, 'add', '-A');
    git(projet, 'commit', '-q', '-m', message);
    return git(projet, 'rev-parse', 'HEAD');
  };
  poser('app.txt', 'v1\n', 'Départ');
  git(projet, 'push', '-q', 'origin', 'HEAD:main');
  git(projet, 'checkout', '-q', '-b', 'dev');
  return { distant, projet, poser };
}

test('le geste suit ce qu’on constate sur les deux branches', () => {
  const base = { sourceExiste: true, cibleExiste: true, cibleContientSource: false, sourceContientCible: false, arbresEgaux: false };
  assert.equal(gesteVersProduction({ ...base, sourceExiste: false }), 'sans-source');
  assert.equal(gesteVersProduction({ ...base, cibleExiste: false }), 'creation');
  assert.equal(gesteVersProduction({ ...base, sourceContientCible: true, cibleContientSource: true, arbresEgaux: true }), 'deja-a-jour');
  assert.equal(gesteVersProduction({ ...base, sourceContientCible: true }), 'avance-rapide');
  assert.equal(gesteVersProduction({ ...base, cibleContientSource: true, arbresEgaux: true }), 'deja-a-jour');
  assert.equal(gesteVersProduction({ ...base, cibleContientSource: true }), 'recalage');
  assert.equal(gesteVersProduction(base), 'fusion');
});

test('main derrière dev avance en avance rapide, sans commit de plus', async () => {
  const { distant, projet, poser } = monter();
  const tete = poser('app.txt', 'v2\n', 'Travail déployé');
  git(projet, 'push', '-q', 'origin', 'dev');

  const issue = await fusionnerVersLaProduction(projet, 'dev', 'main');
  assert.equal(issue.ok, true, issue.recit);
  assert.equal(issue.geste, 'avance-rapide');
  assert.equal(git(distant, 'rev-parse', 'main'), tete);
  assert.equal(git(projet, 'rev-parse', 'main'), tete);
  assert.equal(git(projet, 'rev-parse', '--abbrev-ref', 'HEAD'), 'dev');
});

test('une fusion écrasée venue de GitHub : main reçoit l’arbre exact de dev, par un vrai commit de fusion, sans forcer', async () => {
  const { distant, projet, poser } = monter();
  poser('app.txt', 'v2\n', 'Fonction A');
  poser('essai.txt', 'provisoire\n', 'Essai provisoire');
  git(projet, 'push', '-q', 'origin', 'dev');

  // GitHub écrase « dev » en UN commit posé sur « main » : l'historique diverge.
  const ancienMain = git(distant, 'rev-parse', 'main');
  const arbreDev = git(projet, 'rev-parse', 'dev^{tree}');
  const ecrase = git(projet, 'commit-tree', arbreDev, '-p', ancienMain, '-m', 'Dev (#6)');
  git(projet, 'push', '-q', 'origin', `${ecrase}:refs/heads/main`);

  // Puis « dev » défait l'essai et continue.
  fs.rmSync(path.join(projet, 'essai.txt'));
  poser('app.txt', 'v3\n', 'Retire l’essai, fonction B');
  git(projet, 'push', '-q', 'origin', 'dev');
  const ecrit = fs.readFileSync(path.join(projet, 'app.txt'), 'utf8');

  const issue = await fusionnerVersLaProduction(projet, 'dev', 'main');
  assert.equal(issue.ok, true, issue.recit);
  assert.equal(issue.geste, 'fusion');
  assert.match(issue.recit, /Dev \(#6\)/);

  const main = git(distant, 'rev-parse', 'main');
  assert.equal(git(distant, 'rev-parse', 'main^{tree}'), git(distant, 'rev-parse', 'dev^{tree}'), 'main porte l’arbre exact de dev');
  assert.equal(git(distant, 'rev-list', '--parents', '-n', '1', main).split(' ').length, 3, 'deux parents : un vrai commit de fusion');
  execFileSync('git', ['merge-base', '--is-ancestor', ecrase, main], { cwd: distant });
  assert.equal(git(distant, 'rev-list', '--count', 'dev..main'), '0');
  assert.equal(git(distant, 'rev-list', '--count', 'main..dev'), '0');
  assert.equal(git(distant, 'show', 'main:app.txt'), 'v3');
  assert.throws(() => git(distant, 'show', 'main:essai.txt'), 'l’essai défait sur dev ne revient pas en production');

  // Le dossier partagé n'a pas bougé : même branche, mêmes fichiers.
  assert.equal(git(projet, 'rev-parse', '--abbrev-ref', 'HEAD'), 'dev');
  assert.equal(fs.readFileSync(path.join(projet, 'app.txt'), 'utf8'), ecrit);
  assert.equal(git(projet, 'rev-parse', 'main'), main);

  const encore = await fusionnerVersLaProduction(projet, 'dev', 'main');
  assert.equal(encore.ok, true, encore.recit);
  assert.equal(encore.geste, 'deja-a-jour');
});

test('un dépôt distant qui refuse l’avance rapide fait échouer l’étape, sans envoi forcé', async () => {
  const { distant, projet, poser } = monter();
  poser('app.txt', 'v2\n', 'Travail déployé');
  git(projet, 'push', '-q', 'origin', 'dev');
  // Un crochet du distant refuse toute mise à jour de « main ».
  const crochet = path.join(distant, 'hooks', 'update');
  fs.writeFileSync(crochet, '#!/bin/sh\n[ "$1" = "refs/heads/main" ] && { echo "main verrouillée" >&2; exit 1; }\nexit 0\n');
  fs.chmodSync(crochet, 0o755);
  const avant = git(distant, 'rev-parse', 'main');

  const issue = await fusionnerVersLaProduction(projet, 'dev', 'main');
  assert.equal(issue.ok, false);
  assert.match(issue.recit, /aucun envoi forcé/);
  assert.equal(git(distant, 'rev-parse', 'main'), avant);
});
