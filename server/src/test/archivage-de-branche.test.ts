import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BRANCHES_TOUJOURS_PROTEGEES,
  PREFIXE_BRANCHE_ARCHIVEE,
  decisionDArchivage,
  estDejaArchivee,
  nomDeBrancheArchivee,
} from '@beluga/shared';
import { archiverLaBrancheDeCarte, dossiersOuverts } from '../dossier-de-carte.js';
import { branchePrincipale, existeLaBranche } from '../git.js';

const execFileAsync = promisify(execFile);

/*
 * L'ARCHIVAGE NE TOUCHE QU'À LA BRANCHE DE LA CARTE. Constat sur le dépôt
 * principal : 782 branches « tache/ » vivantes, 640 refs « archive/ », neuf
 * « archive/ » empilés sur une même branche. La règle pure tranche, git
 * exécute — et on vérifie les deux, sur des dépôts jetables.
 */

/* ------------------------------------------------------------------ */
/* La règle pure                                                       */
/* ------------------------------------------------------------------ */

test('une branche de carte fusionnée dans la branche de déploiement est supprimée, pas archivée', () => {
  const decision = decisionDArchivage({ branche: 'tache/x-abc123', brancheDeDeploiement: 'dev', fusionnee: true });
  assert.equal(decision.geste, 'supprimer');
  assert.equal(decision.branche, undefined);
  assert.match(decision.raison, /fusionnée dans « dev »/);
});

test('une branche de carte non fusionnée est renommée « archive/tache/… », une seule fois', () => {
  const decision = decisionDArchivage({ branche: 'tache/x-abc123', brancheDeDeploiement: 'dev', fusionnee: false });
  assert.equal(decision.geste, 'renommer');
  assert.equal(decision.branche, `${PREFIXE_BRANCHE_ARCHIVEE}x-abc123`);
});

test('une branche déjà « archive/… » ne se re-préfixe JAMAIS', () => {
  for (const nom of ['archive/tache/x-abc123', 'archive/archive/tache/x-abc123']) {
    const decision = decisionDArchivage({ branche: nom, brancheDeDeploiement: 'dev', fusionnee: false });
    assert.equal(decision.geste, 'laisser', nom);
    assert.equal(decision.branche, nom);
  }
  assert.equal(estDejaArchivee('archive/tache/x'), true);
  assert.equal(nomDeBrancheArchivee('archive/tache/x'), 'archive/tache/x');
  assert.equal(nomDeBrancheArchivee('tache/x'), 'archive/tache/x');
});

test('les branches du projet ne sont ni renommées ni supprimées, même fusionnées', () => {
  const protegees = [...BRANCHES_TOUJOURS_PROTEGEES, 'livraison', 'master'];
  for (const nom of protegees) {
    const decision = decisionDArchivage({
      branche: nom,
      brancheDeDeploiement: 'dev',
      fusionnee: true,
      protegees: ['livraison'],
    });
    assert.equal(decision.geste, 'laisser', nom);
    assert.equal(decision.branche, nom);
  }
  // La branche de déploiement du projet est protégée par sa seule position.
  const deploiement = decisionDArchivage({ branche: 'tache/en-fait-deploiement', brancheDeDeploiement: 'tache/en-fait-deploiement', fusionnee: true });
  assert.equal(deploiement.geste, 'laisser');
});

test('une branche qui n’est pas « tache/… », ou aucune branche, est laissée en place', () => {
  assert.equal(decisionDArchivage({ branche: 'hors-tache/x', brancheDeDeploiement: 'dev', fusionnee: false }).geste, 'laisser');
  assert.equal(decisionDArchivage({ branche: undefined, brancheDeDeploiement: 'dev', fusionnee: false }).geste, 'laisser');
  assert.equal(decisionDArchivage({ branche: '  ', brancheDeDeploiement: 'dev', fusionnee: true }).geste, 'laisser');
});

/* ------------------------------------------------------------------ */
/* Sur un vrai dépôt jetable                                           */
/* ------------------------------------------------------------------ */

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
  return stdout.trim();
}

async function depot(principale = 'main'): Promise<string> {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'archivage-'));
  await git(racine, ['init', '--quiet', '-b', principale]);
  await git(racine, ['config', 'user.email', 'test@beluga.local']);
  await git(racine, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(racine, 'README.md'), 'racine\n');
  await git(racine, ['add', 'README.md']);
  await git(racine, ['commit', '--quiet', '-m', 'départ']);
  await git(racine, ['branch', 'dev']);
  return racine;
}

async function brancheAvecTravail(racine: string, nom: string, fichier: string): Promise<void> {
  await git(racine, ['checkout', '--quiet', '-b', nom]);
  fs.writeFileSync(path.join(racine, fichier), `${nom}\n`);
  await git(racine, ['add', fichier]);
  await git(racine, ['commit', '--quiet', '-m', `travail ${nom}`]);
  await git(racine, ['checkout', '--quiet', 'main']);
}

test('sur un dépôt : la branche fusionnée dans « dev » disparaît, la non fusionnée passe sous « archive/ », « main » et « dev » ne bougent pas', async () => {
  const racine = await depot();
  await brancheAvecTravail(racine, 'tache/livree-aaaaaa', 'livree.txt');
  await brancheAvecTravail(racine, 'tache/en-attente-bbbbbb', 'attente.txt');
  await git(racine, ['checkout', '--quiet', 'dev']);
  await git(racine, ['merge', '--quiet', '--no-edit', 'tache/livree-aaaaaa']);
  await git(racine, ['checkout', '--quiet', 'main']);

  const livree = await archiverLaBrancheDeCarte(racine, 'tache/livree-aaaaaa');
  assert.equal(livree.geste, 'supprimer');
  assert.equal(livree.branche, undefined);
  assert.equal(await existeLaBranche(racine, 'tache/livree-aaaaaa'), false, 'la branche fusionnée est supprimée');
  // Son travail, lui, est toujours dans l'histoire de « dev ».
  assert.equal(await git(racine, ['cat-file', '-e', 'dev:livree.txt']).then(() => 'ok', () => 'absent'), 'ok');

  const attente = await archiverLaBrancheDeCarte(racine, 'tache/en-attente-bbbbbb');
  assert.equal(attente.geste, 'renommer');
  assert.equal(attente.branche, 'archive/tache/en-attente-bbbbbb');
  assert.equal(await existeLaBranche(racine, 'archive/tache/en-attente-bbbbbb'), true);
  assert.equal(await existeLaBranche(racine, 'tache/en-attente-bbbbbb'), false);

  // Une seconde fois avec le nom déjà archivé : rien ne s'empile.
  const encore = await archiverLaBrancheDeCarte(racine, attente.branche);
  assert.equal(encore.geste, 'laisser');
  assert.equal(encore.branche, 'archive/tache/en-attente-bbbbbb');
  assert.equal(await existeLaBranche(racine, 'archive/archive/tache/en-attente-bbbbbb'), false);

  for (const nom of ['main', 'dev']) {
    const bilan = await archiverLaBrancheDeCarte(racine, nom);
    assert.equal(bilan.geste, 'laisser', nom);
    assert.equal(await existeLaBranche(racine, nom), true, `${nom} doit survivre`);
    assert.equal(await existeLaBranche(racine, `archive/${nom}`), false, `archive/${nom} ne doit pas exister`);
  }

  fs.rmSync(racine, { recursive: true, force: true });
});

test('sur un dépôt : une branche fusionnée encore montée dans une copie de carte est démontée puis supprimée', async () => {
  const racine = await depot();
  await brancheAvecTravail(racine, 'tache/montee-cccccc', 'montee.txt');
  await git(racine, ['checkout', '--quiet', 'dev']);
  await git(racine, ['merge', '--quiet', '--no-edit', 'tache/montee-cccccc']);
  await git(racine, ['checkout', '--quiet', 'main']);
  const copie = path.join(racine, '.worktrees', 'montee-cccccc');
  await git(racine, ['worktree', 'add', '--quiet', copie, 'tache/montee-cccccc']);

  const bilan = await archiverLaBrancheDeCarte(racine, 'tache/montee-cccccc');
  assert.equal(bilan.geste, 'supprimer', bilan.detail);
  assert.equal(fs.existsSync(copie), false, 'la copie est démontée d’abord');
  assert.equal(await existeLaBranche(racine, 'tache/montee-cccccc'), false);
  assert.ok(!(await dossiersOuverts(racine)).some((d) => path.resolve(d) === path.resolve(copie)));

  fs.rmSync(racine, { recursive: true, force: true });
});

test('sur un dépôt : la branche courante du dossier principal n’est jamais supprimée, et on le dit', async () => {
  const racine = await depot();
  await brancheAvecTravail(racine, 'tache/courante-dddddd', 'courante.txt');
  await git(racine, ['checkout', '--quiet', 'dev']);
  await git(racine, ['merge', '--quiet', '--no-edit', 'tache/courante-dddddd']);
  // Le dossier principal reste posé sur la branche de la carte.
  await git(racine, ['checkout', '--quiet', 'tache/courante-dddddd']);

  const bilan = await archiverLaBrancheDeCarte(racine, 'tache/courante-dddddd');
  assert.equal(bilan.geste, 'laisser');
  assert.equal(bilan.branche, 'tache/courante-dddddd');
  assert.match(bilan.detail, /dossier principal/);
  assert.equal(await existeLaBranche(racine, 'tache/courante-dddddd'), true);

  fs.rmSync(racine, { recursive: true, force: true });
});

test('la branche principale se lit à un seul endroit : « master » reste « master »', async () => {
  const racine = await depot('master');
  assert.equal(await branchePrincipale(racine), 'master');
  const enMain = await depot('main');
  assert.equal(await branchePrincipale(enMain), 'main');
  fs.rmSync(racine, { recursive: true, force: true });
  fs.rmSync(enMain, { recursive: true, force: true });
});
