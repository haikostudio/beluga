#!/usr/bin/env node
/**
 * Une carte lancée obtient-elle VRAIMENT sa branche « tache/… » ?
 *
 * Constat qui a produit ce contrôle : sur le projet Root, le journal des
 * déplacements du dépôt (`git reflog`) ne montrait aucun changement de branche,
 * et trois agents lancés à quelques secondes d'intervalle voyaient tous `main`.
 *
 * On fabrique un dépôt d'essai jetable et on rejoue les trois situations :
 *   1. deux cartes préparées l'une après l'autre → deux branches « tache/… »,
 *      visibles au journal des déplacements, et jamais `main` à l'arrivée ;
 *   2. un dossier qui n'est PAS un dépôt git → refus dit en toutes lettres,
 *      au lieu d'un agent lâché sur la branche principale ;
 *   3. deux cartes lancées ENSEMBLE dans le même dossier → la seconde attend,
 *      en disant pourquoi (porte dure du dossier partagé).
 *
 * Rien n'est touché dans un vrai dépôt : tout se passe dans un dossier
 * temporaire, effacé en partant.
 *
 *   npm run build:server && node scripts/verif-branche-de-carte.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { branchName, prepareBranch } from '../server/dist/scheduler.js';
import { RAISON_SANS_DEPOT, porteDuDossier } from '../shared/dist/index.js';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const carte = (id, titre) => ({ id, title: titre });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-branche-'));
const horsDepot = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-servi-'));
const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

try {
  g('init', '-b', 'main');
  g('config', 'user.email', 'essai@haikodev.local');
  g('config', 'user.name', 'Essai');
  fs.writeFileSync(path.join(dir, 'depart.txt'), 'base\n');
  g('add', 'depart.txt');
  g('commit', '-m', 'Base');

  /* 1. Deux cartes, deux branches, tracées au journal des déplacements. */
  const un = carte('aaaaaa11', 'Afficher la taille des fichiers');
  const deux = carte('bbbbbb22', 'Organiser les blocs en onglets');

  const prepaUn = await prepareBranch(dir, un);
  noter('la première carte obtient sa branche', prepaUn.kind === 'prete' && prepaUn.nom === branchName(un), prepaUn.nom ?? prepaUn.raison);
  const prepaDeux = await prepareBranch(dir, deux);
  noter('la seconde carte obtient la sienne', prepaDeux.kind === 'prete' && prepaDeux.nom === branchName(deux), prepaDeux.nom ?? prepaDeux.raison);

  noter('les deux branches portent bien « tache/… »', [prepaUn.nom, prepaDeux.nom].every((n) => n?.startsWith('tache/')));
  noter("le dossier n'est plus sur la branche principale", g('rev-parse', '--abbrev-ref', 'HEAD').trim() !== 'main');

  const journal = g('reflog', '--date=iso');
  const deplacements = journal.split('\n').filter((l) => l.includes('checkout: moving'));
  noter(
    'le journal des déplacements montre les deux passages de branche',
    deplacements.filter((l) => l.includes('tache/')).length >= 2,
    `${deplacements.length} déplacement(s)`,
  );

  /* 2. Un dossier qui n'est pas un dépôt : refus, pas de départ silencieux. */
  const servi = await prepareBranch(horsDepot, carte('cccccc33', 'Carte sur un dossier servi'));
  noter('un dossier sans dépôt git REFUSE le lancement', servi.kind === 'echec', servi.raison ?? servi.nom);
  noter('le refus dit ce qui manque', servi.raison === RAISON_SANS_DEPOT);

  /* 3. Deux cartes lancées ensemble dans le même dossier : la seconde attend. */
  const partage = porteDuDossier({ cardId: deux.id, dossier: dir }, [
    { cardId: un.id, titre: un.title, dossier: dir },
  ]);
  noter('la carte qui arrive en second ne prend pas le dossier', partage.ok === false);
  noter('elle nomme la carte qui l’occupe', (partage.raison ?? '').includes(un.title), partage.raison);

  const ailleurs = porteDuDossier({ cardId: deux.id, dossier: dir }, [
    { cardId: un.id, titre: un.title, dossier: horsDepot },
  ]);
  noter('un agent occupé dans un AUTRE dossier ne retient personne', ailleurs.ok === true);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(horsDepot, { recursive: true, force: true });
}

const rates = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôle(s) au vert`);
process.exit(rates.length ? 1 : 0);
