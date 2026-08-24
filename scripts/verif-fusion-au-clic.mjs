#!/usr/bin/env node
/**
 * UNE TÂCHE NE MET PLUS RIEN EN LIGNE TOUTE SEULE : LA FUSION ATTEND LE CLIC.
 *
 * Constat qui a produit ce contrôle : la branche d'une carte rejoignait la
 * branche principale à la seconde où son agent rendait sa réponse
 * (`refermerDossierDeCarte`). Sur un projet servi depuis son dossier — tous
 * ceux que HaikoDev monte sur le serveur —, le travail d'une tâche terminée
 * était donc servi avant même d'apparaître dans « À déployer ».
 *
 * Quatre volets, tous rejoués sur du VRAI git, rien de simulé :
 *
 *   1. MONTAGE — un projet neuf reçoit sa branche de déploiement « dev », et un
 *      dépôt qui en a déjà une n'est pas touché.
 *   2. DÉPART — une carte lancée part de « dev », l'image de ce qui tourne, et
 *      non de la principale.
 *   3. FIN DE TOUR — la copie de travail se referme, la branche GARDE son
 *      travail, et NI « dev » NI « main » n'ont reçu quoi que ce soit.
 *   4. CLIC — une publication RÉELLE (`startDeploy`, cible « dev ») fusionne la
 *      branche de la carte sur « dev », et « main » reste intacte : c'est la
 *      mise en production, plus tard, qui la servira.
 *
 * Aucun agent n'est appelé et aucun jeton n'est dépensé : les branches sont
 * PROPRES, la mise en production est réglée sur « aucune », et le déroulé
 * constaté ne lance ni construction ni redémarrage.
 *
 *   npm run build:server && node scripts/verif-fusion-au-clic.mjs
 *
 * Aucune base ni aucun dossier du serveur en service n'est touché : HAIKODEV_DATA
 * est détourné vers un dossier d'essai AVANT tout import.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-fusion-clic-'));
process.env.HAIKODEV_DATA = path.join(racine, 'data');
fs.mkdirSync(process.env.HAIKODEV_DATA, { recursive: true });

const store = await import('../server/dist/store.js');
const { startDeploy } = await import('../server/dist/deploy.js');
const { assurerLaBrancheDeDeploiement, brancheDeDeploiement } = await import(
  '../server/dist/branche-de-deploiement.js'
);
const { prepareBranch } = await import('../server/dist/scheduler.js');
const { refermerDossierDeCarte } = await import('../server/dist/dossier-de-carte.js');

let echecs = 0;
const dire = (ok, texte, detail = '') => {
  if (!ok) echecs += 1;
  console.log(`${ok ? '  ok  ' : '  RATÉ'} ${texte}${detail ? ` — ${detail}` : ''}`);
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
const surLaBranche = (cwd, branche, fichier) => {
  try {
    git(cwd, 'cat-file', '-e', `${branche}:${fichier}`);
    return true;
  } catch {
    return false;
  }
};

/** Un dépôt d'essai : « main » seule, ou « main » et « dev » déjà séparées. */
function monterDepot(nom, { avecDev = false } = {}) {
  const cwd = path.join(racine, nom);
  fs.mkdirSync(cwd, { recursive: true });
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'essai@haikodev');
  git(cwd, 'config', 'user.name', 'Essai');
  fs.writeFileSync(path.join(cwd, 'DEPART.md'), 'la base du projet\n');
  git(cwd, 'add', 'DEPART.md');
  git(cwd, 'commit', '-q', '-m', 'départ');
  if (avecDev) {
    git(cwd, 'checkout', '-q', '-b', 'dev');
    // « dev » porte ce qui a DÉJÀ été déployé : c'est l'image du serveur.
    fs.writeFileSync(path.join(cwd, 'DEJA-EN-LIGNE.md'), 'une carte déployée hier\n');
    git(cwd, 'add', 'DEJA-EN-LIGNE.md');
    git(cwd, 'commit', '-q', '-m', 'une carte déjà déployée');
    git(cwd, 'checkout', '-q', 'main');
  }
  return cwd;
}

/* ------------------------------------------------------------------ */
console.log('\n1. LE MONTAGE — un projet neuf reçoit sa branche de déploiement');

const neuf = monterDepot('projet-neuf');
const pose = await assurerLaBrancheDeDeploiement(neuf);
dire(pose.branche === 'dev' && pose.creee === true, 'un dépôt sans « dev » en reçoit une', pose.detail);
dire(
  git(neuf, 'rev-parse', 'dev').trim() === git(neuf, 'rev-parse', 'main').trim(),
  '« dev » part exactement de la branche principale',
);
dire(git(neuf, 'rev-parse', '--abbrev-ref', 'HEAD').trim() === 'main', 'le dépôt n’a pas changé de branche');

const dejaLa = monterDepot('projet-avec-dev', { avecDev: true });
const teteAvant = git(dejaLa, 'rev-parse', 'dev').trim();
const repose = await assurerLaBrancheDeDeploiement(dejaLa);
dire(
  repose.branche === 'dev' && repose.creee === false && git(dejaLa, 'rev-parse', 'dev').trim() === teteAvant,
  'un dépôt qui a déjà sa « dev » n’est pas touché',
  repose.detail,
);
dire(
  (await brancheDeDeploiement(dejaLa, { dev: 'dev' })) === 'dev' &&
    (await brancheDeDeploiement(monterDepot('sans-rien'))) === 'main',
  'sans réglage ni branche « dev », tout retombe sur la principale — comme avant',
);

/* ------------------------------------------------------------------ */
console.log('\n2. LE DÉPART — la carte part de « dev », pas de la principale');

const depot = monterDepot('cycle-complet', { avecDev: true });
const carte = { id: 'ccccc111', title: 'Une carte d’essai' };
const prepa = await prepareBranch(depot, carte, { dev: 'dev' });
dire(prepa.kind === 'prete', 'la carte obtient sa branche et son dossier', prepa.raison ?? prepa.nom);
dire(
  fs.existsSync(path.join(prepa.dossier, 'DEJA-EN-LIGNE.md')),
  'le dossier de la carte porte ce qui est DÉJÀ en ligne',
);
dire(
  git(depot, 'rev-parse', prepa.nom).trim() === git(depot, 'rev-parse', 'dev').trim(),
  'la branche de la carte part bien de la tête de « dev »',
);

/* ------------------------------------------------------------------ */
console.log('\n3. LA FIN DE TOUR — la branche garde son travail, rien ne bouge ailleurs');

fs.writeFileSync(path.join(prepa.dossier, 'TRAVAIL.md'), 'ce que la carte a fait\n');
git(prepa.dossier, 'add', 'TRAVAIL.md');
git(prepa.dossier, 'commit', '-q', '-m', 'travail de la carte');

const bilan = await refermerDossierDeCarte(depot, prepa.dossier, prepa.nom);
dire(bilan.retire === true, 'la copie de travail est refermée', bilan.raison);
dire(bilan.fusionnee === false, 'AUCUNE fusion n’a eu lieu en fin de tour');
dire(surLaBranche(depot, prepa.nom, 'TRAVAIL.md'), 'la branche de la carte garde son travail');
dire(
  !surLaBranche(depot, 'dev', 'TRAVAIL.md') && !surLaBranche(depot, 'main', 'TRAVAIL.md'),
  'ni « dev » ni « main » n’ont reçu le travail avant le clic',
);

/* ------------------------------------------------------------------ */
console.log('\n4. LE CLIC — « Tout déployer » fusionne le lot sur « dev »');

const maintenant = Date.now();
const projet = store.saveProject({
  id: store.newId(),
  name: 'Projet d’essai',
  path: depot,
  defaultEngine: 'claude',
  isSelf: false,
  rank: 1000,
  archived: false,
  branchesDePublication: { dev: 'dev' },
  // « Aucune » : le seul type qui n'appelle NI agent NI transfert.
  miseEnProduction: { type: 'aucune' },
  deploiement: { constate: true },
  createdAt: maintenant,
  updatedAt: maintenant,
});
store.saveCard({
  id: store.newId(),
  projectId: projet.id,
  title: 'Une carte d’essai',
  description: '',
  labels: [],
  column: 'to_deploy',
  position: 1,
  origin: 'user',
  run: { engine: 'claude' },
  excludedFromDeploy: false,
  horsTache: false,
  github: { branch: prepa.nom },
  createdAt: maintenant,
  updatedAt: maintenant,
});

const lance = await startDeploy(projet.id, { cible: 'dev' });
dire(lance.ok === true, 'la publication démarre', lance.error ?? '');
const fin = Date.now() + 180000;
let run = null;
while (Date.now() < fin) {
  run = store.latestDeploy(projet.id);
  if (run && run.state !== 'running') break;
  await new Promise((r) => setTimeout(r, 300));
}
const merge = (run?.steps ?? []).find((s) => s.key === 'merge');
dire(merge?.state === 'done', 'l’étape « Fusion des branches » est passée', merge?.log?.slice(0, 200) ?? '');
dire(surLaBranche(depot, 'dev', 'TRAVAIL.md'), '« dev » porte maintenant le travail de la carte');
dire(
  !surLaBranche(depot, 'main', 'TRAVAIL.md'),
  '« main » reste intacte : c’est la mise en production qui la servira',
);
dire(
  git(depot, 'rev-parse', '--abbrev-ref', 'HEAD').trim() === 'dev',
  'le dossier du projet est posé sur « dev » : c’est lui que le serveur sert',
);

/* ------------------------------------------------------------------ */
fs.rmSync(racine, { recursive: true, force: true });
console.log(echecs ? `\n${echecs} contrôle(s) en échec.` : '\nTous les contrôles passent.');
process.exit(echecs ? 1 : 0);
