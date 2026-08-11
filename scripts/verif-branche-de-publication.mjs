#!/usr/bin/env node
/**
 * LE DÉPLOIEMENT VA-T-IL SUR LA BRANCHE CHOISIE ?
 *
 * La branche de mise en ligne se règle désormais par projet, une par étape
 * (`shared/src/branche-de-publication.ts`, `Project.branchesDePublication`).
 * Une règle pure se teste en `server/src/test/branche-de-publication.test.ts` ;
 * ici on joue de VRAIES publications, de bout en bout, sur des dépôts d'essai
 * montés dans un dossier temporaire :
 *
 * 1. un projet SANS réglage et SANS branche « dev » — le lot doit atterrir sur
 *    la principale, exactement comme avant : rien n'est cassé ;
 * 2. un projet SANS réglage mais dont le dépôt A une branche « dev » — le lot
 *    doit atterrir sur « dev », la valeur par défaut demandée, et la principale
 *    ne doit PAS bouger ;
 * 3. un projet dont la branche de déploiement est RÉGLÉE — le lot doit atterrir
 *    sur elle, et le compte rendu doit dire laquelle ;
 * 4. l'annonce affichée AVANT le clic doit nommer la branche visée.
 *
 * Aucune base ni aucun dossier du serveur en service n'est touché :
 * HAIKODEV_DATA est détourné vers le dossier d'essai avant tout import.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-branche-publication-'));
process.env.HAIKODEV_DATA = path.join(racine, 'data');
fs.mkdirSync(process.env.HAIKODEV_DATA, { recursive: true });

const store = await import('../server/dist/store.js');
const { startDeploy, moyenDeMiseEnLigne } = await import('../server/dist/deploy.js');

let echecs = 0;
const dire = (ok, texte) => {
  if (!ok) echecs += 1;
  console.log(`${ok ? '  ok  ' : '  RATÉ'} ${texte}`);
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

/**
 * Un petit dépôt : une principale, une branche de carte à fusionner, et
 * facultativement une branche « dev » posée sur la principale.
 */
function monterDepot(nom, { avecDev }) {
  const cwd = path.join(racine, nom);
  fs.mkdirSync(cwd, { recursive: true });
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'essai@haikodev');
  git(cwd, 'config', 'user.name', 'Essai');
  fs.writeFileSync(path.join(cwd, 'README.md'), '# essai\n');
  git(cwd, 'add', 'README.md');
  git(cwd, 'commit', '-q', '-m', 'départ');

  if (avecDev) {
    git(cwd, 'branch', 'dev');
    git(cwd, 'branch', 'livraison');
  }

  git(cwd, 'checkout', '-q', '-b', 'tache/essai');
  fs.writeFileSync(path.join(cwd, 'nouveau.txt'), 'le travail de la carte\n');
  git(cwd, 'add', 'nouveau.txt');
  git(cwd, 'commit', '-q', '-m', 'le travail de la carte');
  git(cwd, 'checkout', '-q', 'main');
  return cwd;
}

function monterProjet(nom, { avecDev = false, branches } = {}) {
  const cwd = monterDepot(nom, { avecDev });
  const maintenant = Date.now();
  const projet = store.saveProject({
    id: store.newId(),
    name: nom,
    path: cwd,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1000,
    archived: false,
    branchesDePublication: branches ?? {},
    createdAt: maintenant,
    updatedAt: maintenant,
  });
  const carte = store.saveCard({
    id: store.newId(),
    projectId: projet.id,
    title: `Carte d'essai — ${nom}`,
    description: '',
    labels: [],
    column: 'to_deploy',
    position: 1,
    origin: 'user',
    run: { engine: 'claude' },
    excludedFromDeploy: false,
    horsTache: false,
    github: { branch: 'tache/essai' },
    createdAt: maintenant,
    updatedAt: maintenant,
  });
  return { projet, carte, cwd };
}

async function attendreFin(projectId, secondes = 180) {
  const fin = Date.now() + secondes * 1000;
  while (Date.now() < fin) {
    const run = store.latestDeploy(projectId);
    if (run && run.state !== 'running') return run;
    await new Promise((r) => setTimeout(r, 300));
  }
  return store.latestDeploy(projectId);
}

const journalDe = (run, cle) => run?.steps.find((s) => s.key === cle)?.log ?? '';
/** Le travail de la carte est-il arrivé sur CETTE branche ? */
const porteLeTravail = (cwd, branche) =>
  git(cwd, 'ls-tree', '--name-only', branche).split('\n').includes('nouveau.txt');

/* --- 1. Rien de réglé, pas de « dev » : la principale, comme avant --- */

console.log('\n1. Sans réglage et sans branche « dev » : rien ne change');
const simple = monterProjet('essai-sans-dev');
await startDeploy(simple.projet.id);
const runSimple = await attendreFin(simple.projet.id);
dire(runSimple?.state === 'success', `la publication aboutit (état « ${runSimple?.state} »)`);
dire(porteLeTravail(simple.cwd, 'main'), 'le lot est fusionné dans la principale, comme avant le réglage');

/* --- 2. Rien de réglé, mais le dépôt a « dev » : c'est « dev » ------- */

console.log('\n2. Sans réglage, avec une branche « dev » sur le dépôt');
const defaut = monterProjet('essai-defaut-dev', { avecDev: true });
await startDeploy(defaut.projet.id);
const runDefaut = await attendreFin(defaut.projet.id);
dire(runDefaut?.state === 'success', `la publication aboutit (état « ${runDefaut?.state} »)`);
dire(porteLeTravail(defaut.cwd, 'dev'), 'le lot part sur « dev », la branche par défaut');
dire(!porteLeTravail(defaut.cwd, 'main'), 'la principale n’a PAS bougé');
dire(/dev/.test(journalDe(runDefaut, 'merge')), 'le compte rendu de fusion NOMME la branche visée');

/* --- 3. Une branche réglée : c'est elle, et elle seule -------------- */

console.log('\n3. Avec une branche de déploiement réglée');
const regle = monterProjet('essai-branche-reglee', { avecDev: true, branches: { dev: 'livraison' } });
await startDeploy(regle.projet.id);
const runRegle = await attendreFin(regle.projet.id);
dire(runRegle?.state === 'success', `la publication aboutit (état « ${runRegle?.state} »)`);
dire(porteLeTravail(regle.cwd, 'livraison'), 'le lot part sur la branche choisie dans les réglages');
dire(!porteLeTravail(regle.cwd, 'dev'), '« dev » n’est plus prise : le réglage l’emporte');
dire(!porteLeTravail(regle.cwd, 'main'), 'la principale n’a PAS bougé');
dire(
  /réglages du projet/.test(journalDe(runRegle, 'merge')),
  'le compte rendu dit d’où vient la branche',
);

/* --- 4. L'annonce d'avant le clic nomme la branche ------------------ */

console.log('\n4. Ce qui est annoncé AVANT le clic');
const annonce = monterProjet('essai-annonce', { avecDev: true, branches: { dev: 'livraison' } });
const planDev = await moyenDeMiseEnLigne(annonce.projet.id, 'dev');
dire(/livraison/.test(planDev?.raison ?? ''), 'le bloc de déploiement annonce la branche visée');
const planProd = await moyenDeMiseEnLigne(annonce.projet.id, 'production');
dire(/Branche /.test(planProd?.raison ?? ''), 'le bloc de mise en production l’annonce aussi');
console.log(`   déploiement : ${planDev?.raison}`);
console.log(`   production  : ${planProd?.raison}`);

fs.rmSync(racine, { recursive: true, force: true });
console.log(echecs ? `\n${echecs} vérification(s) en échec.` : '\nTout est vérifié.');
process.exit(echecs ? 1 : 0);
