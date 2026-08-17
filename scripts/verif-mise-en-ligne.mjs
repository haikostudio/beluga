#!/usr/bin/env node
/**
 * « Tout déployer » fait-il VRAIMENT ce qu'il annonce ?
 *
 * Déployer est désormais UNE seule chose, toujours disponible et sans réglage :
 * fusionner les branches des cartes de « À déployer », enregistrer, envoyer sur
 * le dépôt, puis rafraîchir l'instance de dev du projet sur ce serveur.
 *
 * Trois publications réelles, jouées de bout en bout sur des projets d'essai
 * montés dans un dossier temporaire, avec leur propre base :
 *
 * 1. un projet SANS instance de dev sur cette machine — la publication doit
 *    aboutir quand même (le lot est fusionné), le dire en toutes lettres, et la
 *    carte doit se poser en « En production », JAMAIS aux archives ;
 * 2. un projet AVEC un script de construction — l'étape « Construction » doit
 *    réellement l'exécuter ;
 * 3. la seconde étape — depuis « En production », publier CLÔT la carte.
 *
 * Aucune base ni aucun dossier du serveur en service n'est touché :
 * HAIKODEV_DATA est détourné vers le dossier d'essai avant tout import.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-mise-en-ligne-'));
process.env.HAIKODEV_DATA = path.join(racine, 'data');
fs.mkdirSync(process.env.HAIKODEV_DATA, { recursive: true });

const store = await import('../server/dist/store.js');
const { startDeploy } = await import('../server/dist/deploy.js');

let echecs = 0;
const dire = (ok, texte) => {
  if (!ok) echecs += 1;
  console.log(`${ok ? '  ok  ' : '  RATÉ'} ${texte}`);
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

/** Un petit dépôt : une branche principale, une branche de carte à fusionner. */
function monterDepot(nom) {
  const cwd = path.join(racine, nom);
  fs.mkdirSync(cwd, { recursive: true });
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'essai@haikodev');
  git(cwd, 'config', 'user.name', 'Essai');
  fs.writeFileSync(path.join(cwd, 'README.md'), '# essai\n');
  git(cwd, 'add', 'README.md');
  git(cwd, 'commit', '-q', '-m', 'départ');

  git(cwd, 'checkout', '-q', '-b', 'tache/essai');
  fs.writeFileSync(path.join(cwd, 'nouveau.txt'), 'le travail de la carte\n');
  git(cwd, 'add', 'nouveau.txt');
  git(cwd, 'commit', '-q', '-m', 'le travail de la carte');
  git(cwd, 'checkout', '-q', 'main');
  return cwd;
}

function monterProjet(nom, colonne = 'to_deploy') {
  const cwd = monterDepot(nom);
  const maintenant = Date.now();
  const projet = store.saveProject({
    id: store.newId(),
    name: nom,
    path: cwd,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1000,
    archived: false,
    /* La mise en production ne part plus sans réglage. « Aucune » (projet
       local) est le seul type qui n'appelle NI agent NI transfert : la
       plomberie git est jouée en entier, aucun quota n'est dépensé. */
    miseEnProduction: { type: 'aucune' },
    /* Un projet neuf n'a plus de procédure de déploiement : sans elle, rien ne
       part. « Constaté » est le marqueur des projets d'avant — le déroulé de
       HaikoDev, du service système ou du dossier servi, inchangé. */
    deploiement: { constate: true },
    createdAt: maintenant,
    updatedAt: maintenant,
  });
  const carte = store.saveCard({
    id: store.newId(),
    projectId: projet.id,
    title: `Carte d'essai — ${nom}`,
    description: '',
    labels: [],
    column: colonne,
    position: 1,
    origin: 'user',
    run: { engine: 'claude' },
    excludedFromDeploy: false,
    horsTache: false,
    github: { branch: 'tache/essai' },
    // Une carte déjà « En production » porte forcément une date de déploiement.
    deployedAt: colonne === 'in_production' ? maintenant : undefined,
    createdAt: maintenant,
    updatedAt: maintenant,
  });
  return { projet, carte, cwd };
}

/** Attend la fin du run : la publication travaille en arrière-plan. */
async function attendreFin(projectId, secondes = 180) {
  const fin = Date.now() + secondes * 1000;
  while (Date.now() < fin) {
    const run = store.latestDeploy(projectId);
    if (run && run.state !== 'running') return run;
    await new Promise((r) => setTimeout(r, 300));
  }
  return store.latestDeploy(projectId);
}

/**
 * ATTENDRE QUE LA CARTE SOIT RANGÉE — un run « réussi » ne le dit pas encore.
 *
 * Ce contrôle échouait une fois sur huit sur « c'est CETTE étape qui clôt la
 * carte », et ce n'était pas un défaut du produit : le rangement des cartes est
 * de la COMPTABILITÉ, il vient APRÈS la mise en ligne et ne peut plus la
 * démentir (`avertissementCartesNonRangees`, règle voulue). La publication
 * s'annonce donc « réussie » AVANT d'archiver, et `attendreFin` rendait la main
 * dans cette fenêtre : on lisait la carte pendant qu'`archiveCard` travaillait
 * encore, et le verdict tombait au hasard du temps machine.
 *
 * On ATTEND donc le fait au lieu de le supposer, comme partout ailleurs. La
 * fonction rend la carte dès que la condition tient, sinon la dernière lue au
 * bout du délai — l'assertion échoue alors pour de VRAIES raisons, et le
 * contrôle ne peut plus passer par accident.
 */
async function attendreCarte(cardId, tient, secondes = 30) {
  const fin = Date.now() + secondes * 1000;
  let carte = store.getCard(cardId);
  while (Date.now() < fin) {
    if (carte && tient(carte)) return carte;
    await new Promise((r) => setTimeout(r, 100));
    carte = store.getCard(cardId);
  }
  return carte;
}

const etatDe = (run, cle) => run?.steps.find((s) => s.key === cle)?.state;
const journalDe = (run, cle) => run?.steps.find((s) => s.key === cle)?.log ?? '';

function raconter(run) {
  console.log(`   étapes : ${(run?.steps ?? []).map((s) => `${s.key}=${s.state}`).join(' ')}`);
  for (const step of run?.steps ?? []) {
    if (step.log) console.log(`   [${step.key}] ${step.log.trim().split('\n').pop()?.slice(0, 110)}`);
  }
}

/* --- 1. Sans instance de dev : on déploie quand même, et on le dit ---- */

console.log('\n1. Un projet sans instance de dev sur ce serveur');
const sans = monterProjet('essai-sans-instance');
const lanceSans = await startDeploy(sans.projet.id);
dire(lanceSans.ok === true, 'la publication démarre — plus aucun refus faute de réglage');

const runSans = await attendreFin(sans.projet.id);
dire(runSans?.state === 'success', `la publication aboutit (état « ${runSans?.state} »)`);
dire(etatDe(runSans, 'merge') === 'done', 'la branche de la carte est fusionnée');
dire(
  fs.existsSync(path.join(sans.cwd, 'nouveau.txt')),
  'le travail de la carte est bien sur la branche principale',
);
dire(
  etatDe(runSans, 'publish') === 'skipped' && /Aucune instance de dev/.test(journalDe(runSans, 'publish')),
  'l’étape de mise en ligne DIT qu’aucune instance de dev n’a été trouvée',
);
// Le rangement suit la mise en ligne : on l'attend, on ne le suppose pas.
const carteDeployee = await attendreCarte(sans.carte.id, (c) => c.column === 'in_production');
dire(carteDeployee?.column === 'in_production', 'la carte déployée se pose en « En production »');
dire(carteDeployee?.column !== 'archived', 'elle ne part PAS aux archives : clore vient après');
dire(!!carteDeployee?.deployedAt, 'la carte porte sa date de déploiement');
dire(runSans?.cible === 'dev', 'la publication retient son étape (déploiement)');
raconter(runSans);

/* --- 2. Avec un script de construction : il tourne pour de vrai ------ */

console.log('\n2. Un projet avec un script de construction');
const avec = monterProjet('essai-avec-build');
const preuve = path.join(racine, 'preuve-construction.txt');
fs.writeFileSync(
  path.join(avec.cwd, 'package.json'),
  JSON.stringify({ name: 'essai-avec-build', scripts: { build: `date +%s > ${preuve}` } }, null, 2),
);
git(avec.cwd, 'add', 'package.json');
git(avec.cwd, 'commit', '-q', '-m', 'un script de construction');

const lanceAvec = await startDeploy(avec.projet.id);
dire(lanceAvec.ok === true, 'la publication démarre');
const runAvec = await attendreFin(avec.projet.id);
dire(runAvec?.state === 'success', `la publication aboutit (état « ${runAvec?.state} »)`);
dire(etatDe(runAvec, 'build') === 'done', 'l’étape « Construction » est menée à terme');
dire(fs.existsSync(preuve), 'le script de construction a RÉELLEMENT tourné (il a laissé sa trace)');
raconter(runAvec);

/* --- 3. La seconde étape : publier depuis « En production » clôt ----- */

console.log('\n3. La mise en production, depuis « En production »');
const prod = monterProjet('essai-production', 'in_production');
const lanceProd = await startDeploy(prod.projet.id, { cible: 'production' });
dire(lanceProd.ok === true, 'la mise en production démarre');
const runProd = await attendreFin(prod.projet.id);
dire(runProd?.state === 'success', `elle aboutit (état « ${runProd?.state} »)`);
dire(runProd?.cible === 'production', 'la publication retient son étape (production)');
dire(runProd?.cardIds.includes(prod.carte.id), 'le lot part bien de la colonne « En production »');
// Archiver est plus long que déplacer (document de clôture, branche refermée) :
// c'est ici que la fenêtre entre « réussi » et « rangé » se voyait le plus.
const carteClose = await attendreCarte(prod.carte.id, (c) => c.column === 'archived');
dire(carteClose?.column === 'archived', 'c’est CETTE étape qui clôt la carte');
raconter(runProd);

fs.rmSync(racine, { recursive: true, force: true });
console.log(echecs ? `\n${echecs} vérification(s) en échec.` : '\nTout est vérifié.');
process.exit(echecs ? 1 : 0);
