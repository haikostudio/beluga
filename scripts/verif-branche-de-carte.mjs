#!/usr/bin/env node
/**
 * Une carte lancée obtient-elle VRAIMENT sa branche « tache/… » ET son dossier ?
 *
 * Constat qui a produit ce contrôle : sur le projet Root, le journal des
 * déplacements du dépôt (`git reflog`) ne montrait aucun changement de branche,
 * et trois agents lancés à quelques secondes d'intervalle voyaient tous `main`.
 * Puis, la branche acquise, toutes les cartes se partageaient encore UNE copie de
 * travail : la seconde attendait la première, et « Tout lancer » ne lançait
 * jamais qu'une carte à la fois.
 *
 * On fabrique un dépôt d'essai jetable et on rejoue les situations :
 *   1. deux cartes préparées l'une après l'autre → deux branches « tache/… »,
 *      deux DOSSIERS distincts, et le dossier principal qui ne bouge plus ;
 *   2. un dossier qui n'est PAS un dépôt git → refus dit en toutes lettres,
 *      au lieu d'un agent lâché sur la branche principale ;
 *   3. deux cartes lancées ENSEMBLE → aucune n'attend l'autre, chacune écrit
 *      chez elle sans voir le travail de l'autre ;
 *   4. fin de tour → la branche rejoint la principale et le dossier est refermé,
 *      sans laisser de copie orpheline.
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
import { refermerDossierDeCarte } from '../server/dist/dossier-de-carte.js';
import { RAISON_SANS_DEPOT, cheminDossierDeCarte, porteDuDossier } from '../shared/dist/index.js';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const carte = (id, titre) => ({ id, title: titre });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-branche-'));
const horsDepot = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-servi-'));
const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
const gDans = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

try {
  g('init', '-b', 'main');
  g('config', 'user.email', 'essai@haikodev.local');
  g('config', 'user.name', 'Essai');
  fs.writeFileSync(path.join(dir, 'depart.txt'), 'base\n');
  g('add', 'depart.txt');
  g('commit', '-m', 'Base');

  /* 1. Deux cartes, deux branches, deux dossiers. */
  const un = carte('aaaaaa11', 'Afficher la taille des fichiers');
  const deux = carte('bbbbbb22', 'Organiser les blocs en onglets');

  const prepaUn = await prepareBranch(dir, un);
  noter(
    'la première carte obtient sa branche',
    prepaUn.kind === 'prete' && prepaUn.nom === branchName(un),
    prepaUn.nom ?? prepaUn.raison,
  );
  const prepaDeux = await prepareBranch(dir, deux);
  noter(
    'la seconde carte obtient la sienne',
    prepaDeux.kind === 'prete' && prepaDeux.nom === branchName(deux),
    prepaDeux.nom ?? prepaDeux.raison,
  );

  noter('les deux branches portent bien « tache/… »', [prepaUn.nom, prepaDeux.nom].every((n) => n?.startsWith('tache/')));
  noter(
    'chaque carte a SON dossier, à l’endroit annoncé',
    prepaUn.dossier === cheminDossierDeCarte(dir, un.title, un.id) &&
      prepaDeux.dossier === cheminDossierDeCarte(dir, deux.title, deux.id) &&
      prepaUn.dossier !== prepaDeux.dossier,
    `${prepaUn.dossier} / ${prepaDeux.dossier}`,
  );
  noter(
    'les deux dossiers existent et sont chacun sur leur branche',
    gDans(prepaUn.dossier, 'rev-parse', '--abbrev-ref', 'HEAD').trim() === prepaUn.nom &&
      gDans(prepaDeux.dossier, 'rev-parse', '--abbrev-ref', 'HEAD').trim() === prepaDeux.nom,
  );
  noter(
    'le dossier principal, lui, ne quitte plus la branche principale',
    g('rev-parse', '--abbrev-ref', 'HEAD').trim() === 'main',
  );

  /* 2. Un dossier qui n'est pas un dépôt : refus, pas de départ silencieux. */
  const servi = await prepareBranch(horsDepot, carte('cccccc33', 'Carte sur un dossier servi'));
  noter('un dossier sans dépôt git REFUSE le lancement', servi.kind === 'echec', servi.raison ?? servi.nom);
  noter('le refus dit ce qui manque', servi.raison === RAISON_SANS_DEPOT);

  /* 3. Deux cartes lancées ensemble : aucune n'attend, aucune ne voit l'autre. */
  const ensemble = porteDuDossier({ cardId: deux.id, dossier: prepaDeux.dossier }, [
    { cardId: un.id, titre: un.title, dossier: prepaUn.dossier },
  ]);
  noter('deux cartes lancées ensemble démarrent toutes les deux', ensemble.ok === true, ensemble.raison ?? '');

  fs.writeFileSync(path.join(prepaUn.dossier, 'un.txt'), 'travail de la première\n');
  gDans(prepaUn.dossier, 'add', 'un.txt');
  gDans(prepaUn.dossier, 'commit', '-m', 'Première carte');
  fs.writeFileSync(path.join(prepaDeux.dossier, 'deux.txt'), 'travail de la seconde\n');
  gDans(prepaDeux.dossier, 'add', 'deux.txt');
  gDans(prepaDeux.dossier, 'commit', '-m', 'Seconde carte');
  noter(
    'chacune écrit chez elle, sans voir le fichier de l’autre',
    !fs.existsSync(path.join(prepaUn.dossier, 'deux.txt')) && !fs.existsSync(path.join(prepaDeux.dossier, 'un.txt')),
  );

  /* Le cas RÉEL que la porte doit encore refuser : le même dossier. */
  const memeDossier = porteDuDossier({ cardId: deux.id, dossier: prepaUn.dossier }, [
    { cardId: un.id, titre: un.title, dossier: prepaUn.dossier },
  ]);
  noter('deux cartes qui visent le MÊME dossier : la seconde attend', memeDossier.ok === false);
  noter('elle nomme la carte qui l’occupe', (memeDossier.raison ?? '').includes(un.title), memeDossier.raison);

  /* 4. Fin de tour : fusion dans la principale, dossier refermé. */
  const bilanUn = await refermerDossierDeCarte(dir, prepaUn.dossier, prepaUn.nom);
  const bilanDeux = await refermerDossierDeCarte(dir, prepaDeux.dossier, prepaDeux.nom);
  noter('les deux dossiers sont refermés', bilanUn.retire && bilanDeux.retire, `${bilanUn.raison} / ${bilanDeux.raison}`);
  noter('les deux branches sont fusionnées dans la principale', bilanUn.fusionnee && bilanDeux.fusionnee);
  noter(
    'le travail des deux cartes est sur la branche principale',
    fs.existsSync(path.join(dir, 'un.txt')) && fs.existsSync(path.join(dir, 'deux.txt')),
  );
  const ouverts = g('worktree', 'list', '--porcelain')
    .split('\n')
    .filter((l) => l.startsWith('worktree '));
  noter('aucun dossier de carte n’est resté ouvert', ouverts.length === 1, `${ouverts.length} copie(s) de travail`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(horsDepot, { recursive: true, force: true });
}

const rates = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôle(s) au vert`);
process.exit(rates.length ? 1 : 0);
