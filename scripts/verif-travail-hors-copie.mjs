#!/usr/bin/env node
/*
 * LA CARTE NE S'ENTEND PLUS DIRE « AUCUN FICHIER N'A CHANGÉ » QUAND DES FICHIERS
 * ONT CHANGÉ.
 *
 * Le fait d'origine : une carte est revenue en « Planifié » avec la phrase
 * « Réponse rendue, mais aucun fichier du projet n'a changé », alors que le
 * dossier du projet portait bel et bien les fichiers écrits par son agent — un
 * `git status` le montrait. L'agent était sorti de sa copie de travail (un `cd`
 * vers la racine du projet, des chemins relatifs écrits depuis cette racine), et
 * le constat de fin de tour ne regardait QUE la copie de la carte : vierge, donc
 * muette.
 *
 * Le scénario est rejoué ici pour de vrai, sur un dépôt git jetable avec sa
 * vraie copie de travail (`git worktree`) :
 *
 *  1. l'agent écrit HORS de sa copie, dans le dossier partagé du projet — le
 *     constat le voit et rend « ailleurs », la carte porte une phrase VRAIE ;
 *  2. ce qui traînait dans le dossier partagé AVANT le tour n'est pas mis au
 *     compte de la carte : le dossier est partagé avec le chef, l'analyse et la
 *     publication ;
 *  3. un travail rangé dans la copie de la carte reste la première réponse ;
 *  4. rien nulle part rend toujours « rien n'a changé », mot pour mot.
 *
 * AUCUN MOTEUR N'EST APPELÉ, aucune base n'est touchée.
 *
 *   node scripts/verif-travail-hors-copie.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { fichiersRemues, repereAvant, traceDuTravailDuTour } = await import(
  path.join(RACINE, 'server/dist/hors-tache.js')
);
const { issueDeFinDeTour, natureDeLaMention, RAISON_SANS_MODIFICATION, RAISON_TRAVAIL_HORS_COPIE } =
  await import(path.join(RACINE, 'shared/dist/index.js'));

const echecs = [];
function verifier(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.error(`  ✗ ${message}`);
    echecs.push(message);
  }
}

/* Un dépôt jetable, avec le dossier PARTAGÉ du projet et la COPIE d'une carte. */
function depotJetable(nom) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), `haikodev-hors-copie-${nom}-`));
  const projet = path.join(racine, 'projet');
  fs.mkdirSync(projet);
  const git = (args) => execFileSync('git', args, { cwd: projet, stdio: 'ignore' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'essai@haikodev.local']);
  git(['config', 'user.name', 'Essai']);
  fs.writeFileSync(path.join(projet, 'depart.txt'), 'depart\n');
  git(['add', 'depart.txt']);
  git(['commit', '-qm', 'depart']);
  const copie = path.join(racine, 'copie');
  git(['worktree', 'add', '-q', '-b', 'tache/essai', copie]);
  return { racine, projet, copie };
}

/** Ce que le démon constaterait à la fin d'un tour, dans ce dépôt. */
async function constater(projet, copie, ecrire) {
  const repere = await repereAvant(copie);
  const remuesAvant = await fichiersRemues(projet);
  ecrire();
  return traceDuTravailDuTour({ dossier: copie, repere, projet, remuesAvant });
}

/* ------------------------------------------------------------------ */
console.log('\n1. L’agent sort de sa copie et écrit dans le dossier du projet');
{
  const { projet, copie } = depotJetable('sorti');
  const trace = await constater(projet, copie, () =>
    fs.writeFileSync(path.join(projet, 'travail.txt'), 'le vrai travail\n'),
  );
  verifier(trace === 'ailleurs', `le constat voit le travail et le nomme « ailleurs » (rendu : « ${trace} »)`);

  const issue = issueDeFinDeTour('running', true, 'task', trace, false);
  verifier(issue.raison === RAISON_TRAVAIL_HORS_COPIE, 'la carte porte la phrase du travail fait hors de sa copie');
  verifier(issue.raison !== RAISON_SANS_MODIFICATION, 'elle ne dit PLUS « aucun fichier n’a changé »');
  verifier(issue.colonne === 'planned' && issue.retenue, 'elle revient en « Planifié », retenue — rien à livrer sur sa branche');
  verifier(natureDeLaMention(issue.raison) === 'attente', 'la phrase reste une attente, donc en jaune');
}

/* ------------------------------------------------------------------ */
console.log('\n2. Ce qui traînait AVANT le tour n’est pas mis au compte de la carte');
{
  const { projet, copie } = depotJetable('deja-sale');
  fs.writeFileSync(path.join(projet, 'deja-la.txt'), 'un autre agent\n');
  const trace = await constater(projet, copie, () => {});
  verifier(trace === 'non', `le dossier partagé est sale, mais pas de ce tour-ci (rendu : « ${trace} »)`);
}

/* ------------------------------------------------------------------ */
console.log('\n3. Le travail rangé dans la copie de la carte reste la première réponse');
{
  const { projet, copie } = depotJetable('bien-range');
  const trace = await constater(projet, copie, () => {
    fs.writeFileSync(path.join(copie, 'travail.txt'), 'travail bien rangé\n');
    fs.writeFileSync(path.join(projet, 'a-cote.txt'), 'du bruit\n');
  });
  verifier(trace === 'oui', `la copie a bougé, la carte se ferme (rendu : « ${trace} »)`);
}

/* ------------------------------------------------------------------ */
console.log('\n4. Rien nulle part se dit toujours « rien n’a changé »');
{
  const { projet, copie } = depotJetable('rien');
  const trace = await constater(projet, copie, () => {});
  verifier(trace === 'non', `aucun des deux dossiers n’a bougé (rendu : « ${trace} »)`);
  const issue = issueDeFinDeTour('running', true, 'task', trace, false);
  verifier(issue.raison === RAISON_SANS_MODIFICATION, 'la phrase d’origine est intacte');
}

/* ------------------------------------------------------------------ */
if (echecs.length) {
  console.error(`\n${echecs.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('\nTout est conforme : le constat regarde les deux dossiers et dit ce qu’il voit.\n');
