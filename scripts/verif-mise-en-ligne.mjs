#!/usr/bin/env node
/**
 * « Tout déployer » met-il VRAIMENT en ligne ?
 *
 * Deux publications réelles, jouées de bout en bout sur des projets d'essai
 * montés dans un dossier temporaire, avec leur propre base :
 *
 * 1. un projet SANS aucun moyen d'être mis en ligne — la publication doit être
 *    REFUSÉE, en nommant ce qui manque ; rien ne doit être fusionné, et la
 *    carte doit rester à déployer ;
 * 2. un projet AVEC commande de publication — la publication doit aller au
 *    bout, la commande doit réellement s'être exécutée, et la carte doit
 *    porter sa date de mise en ligne.
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

function monterProjet(nom, deployCommand) {
  const cwd = monterDepot(nom);
  const maintenant = Date.now();
  const projet = store.saveProject({
    id: store.newId(),
    name: nom,
    path: cwd,
    defaultEngine: 'claude',
    isSelf: false,
    deployCommand,
    rank: 1000,
    archived: false,
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

/** Attend la fin du run : la publication travaille en arrière-plan. */
async function attendreFin(projectId, secondes = 120) {
  const fin = Date.now() + secondes * 1000;
  while (Date.now() < fin) {
    const run = store.latestDeploy(projectId);
    if (run && run.state !== 'running') return run;
    await new Promise((r) => setTimeout(r, 300));
  }
  return store.latestDeploy(projectId);
}

/* --- 1. Sans aucun moyen de mise en ligne : refus honnête ---------- */

console.log('\n1. Un projet sans commande de publication');
const sans = monterProjet('essai-sans-commande', undefined);
const refus = await startDeploy(sans.projet.id);

dire(refus.ok === false, 'la publication est refusée');
dire(
  /aucun moyen d’être mis en ligne/.test(refus.error ?? ''),
  `le motif nomme ce qui manque : « ${(refus.error ?? '').slice(0, 90)}… »`,
);
dire(/commande de publication/.test(refus.error ?? ''), 'le motif dit quoi faire (renseigner la commande)');
dire(store.latestDeploy(sans.projet.id) === null, 'aucun rapport de publication n’est fabriqué');
dire(!store.getCard(sans.carte.id)?.deployedAt, 'la carte n’est PAS marquée comme mise en ligne');
dire(
  store.getCard(sans.carte.id)?.column === 'to_deploy',
  'la carte reste dans « À déployer », rien n’est perdu',
);
dire(
  !fs.existsSync(path.join(sans.cwd, 'nouveau.txt')),
  'rien n’a été fusionné sur la branche principale : le refus vient AVANT',
);

/* --- 2. Avec commande de publication : mise en ligne réelle -------- */

console.log('\n2. Un projet avec commande de publication');
const preuve = path.join(racine, 'preuve-mise-en-ligne.txt');
const avec = monterProjet('essai-avec-commande', `date +%s > ${preuve}`);
const lance = await startDeploy(avec.projet.id);
dire(lance.ok === true, 'la publication démarre');

const run = await attendreFin(avec.projet.id);
const etat = (cle) => run?.steps.find((s) => s.key === cle)?.state;

dire(run?.state === 'success', `la publication aboutit (état « ${run?.state} »)`);
dire(etat('merge') === 'done', 'la branche de la carte est fusionnée');
dire(etat('build') === 'done', 'la commande de publication est exécutée');
dire(etat('publish') === 'done', 'la mise en ligne est constatée');
dire(fs.existsSync(preuve), 'la commande a RÉELLEMENT tourné (elle a laissé sa trace)');
dire(
  fs.existsSync(path.join(avec.cwd, 'nouveau.txt')),
  'le travail de la carte est bien sur la branche principale',
);
dire(!!store.getCard(avec.carte.id)?.deployedAt, 'la carte porte sa date de mise en ligne');

const etapes = (run?.steps ?? []).map((s) => `${s.key}=${s.state}`).join(' ');
console.log(`\n   étapes : ${etapes}`);
for (const step of run?.steps ?? []) {
  if (step.log) console.log(`   [${step.key}] ${step.log.trim().split('\n').pop()?.slice(0, 110)}`);
}

fs.rmSync(racine, { recursive: true, force: true });
console.log(echecs ? `\n${echecs} vérification(s) en échec.` : '\nTout est vérifié.');
process.exit(echecs ? 1 : 0);
