/**
 * LE CONSTAT NE MENT PLUS QUAND L'AGENT A TRAVAILLÉ AILLEURS.
 *
 * Le fait constaté : une carte est revenue en « Planifié » avec la phrase
 * « Réponse rendue, mais aucun fichier du projet n'a changé », alors que le
 * dossier du projet portait bel et bien les fichiers écrits par son agent. Cause
 * : l'agent était sorti de sa copie de travail (un `cd` vers la racine du
 * projet, des chemins relatifs écrits depuis cette racine), et le constat de fin
 * de tour ne regardait QUE la copie de la carte — vierge, donc muette.
 *
 * Deux niveaux vérifiés ici : la règle pure (que dit-on d'une trace
 * « ailleurs » ?) et le constat réel, sur un dépôt git jetable avec sa vraie
 * copie de travail.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  RAISON_DEJA_LIVRE,
  RAISON_RENDU_SANS_CODE,
  RAISON_TRAVAIL_HORS_COPIE,
  issueDeFinDeTour,
  natureDeLaMention,
  traceAcquise,
} from '@haikodev/shared';
import { fichiersRemues, repereAvant, traceDuTravailDuTour } from '../hors-tache.js';

/* ------------------------------------------------------------------ */
/* 1. La règle pure                                                     */
/* ------------------------------------------------------------------ */

test('« ailleurs » ne ferme pas la carte : le code n’est pas récoltable', () => {
  assert.equal(traceAcquise('ailleurs'), false);
});

test('« ailleurs » ne se dit surtout pas « aucun fichier n’a changé »', () => {
  const vu = issueDeFinDeTour('running', true, 'task', 'ailleurs', false);
  const rien = issueDeFinDeTour('running', true, 'task', 'non', false);

  assert.equal(rien.raison, RAISON_RENDU_SANS_CODE);
  assert.equal(vu.raison, RAISON_TRAVAIL_HORS_COPIE);
  assert.notEqual(vu.raison, rien.raison);
  // La phrase nomme les deux choses utiles : ce qui a été vu, et où le chercher.
  assert.match(RAISON_TRAVAIL_HORS_COPIE, /ont changé/);
  assert.match(RAISON_TRAVAIL_HORS_COPIE, /dossier du projet/);
});

test('« ailleurs » ferme la carte en disant où chercher le travail', () => {
  // Le rapport a été rendu : la carte se ferme. Mais sa branche est vide, donc
  // la phrase reste une ATTENTE — il y a un geste à faire, aller récupérer le
  // travail dans le dossier du projet.
  const issue = issueDeFinDeTour('running', true, 'task', 'ailleurs', false);
  assert.equal(issue.colonne, 'to_deploy');
  assert.equal(natureDeLaMention(issue.raison), 'attente');
});

test('une carte dont le code est DÉJÀ sur sa branche reste close', () => {
  // Le drapeau passe devant : ce qu'un agent a touché à côté ne rouvre pas une
  // carte dont le travail est acquis.
  const issue = issueDeFinDeTour('running', true, 'task', 'ailleurs', true);
  assert.equal(issue.colonne, 'to_deploy');
  assert.equal(issue.raison, RAISON_DEJA_LIVRE);
});

/* ------------------------------------------------------------------ */
/* 2. Le constat réel, sur un dépôt git jetable                         */
/* ------------------------------------------------------------------ */

function depotJetable(): { projet: string; copie: string } {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-hors-copie-'));
  const projet = path.join(racine, 'projet');
  fs.mkdirSync(projet);
  const git = (args: string[], cwd = projet) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'essai@haikodev.local']);
  git(['config', 'user.name', 'Essai']);
  fs.writeFileSync(path.join(projet, 'depart.txt'), 'depart\n');
  git(['add', 'depart.txt']);
  git(['commit', '-qm', 'depart']);

  const copie = path.join(racine, 'copie');
  git(['worktree', 'add', '-q', '-b', 'tache/essai', copie]);
  return { projet, copie };
}

test('un travail écrit dans le dossier partagé est VU, et nommé « ailleurs »', async () => {
  const { projet, copie } = depotJetable();
  const repere = await repereAvant(copie);
  const remuesAvant = await fichiersRemues(projet);

  // L'agent est sorti de sa copie : il écrit à la racine du projet.
  fs.writeFileSync(path.join(projet, 'travail.txt'), 'le vrai travail\n');

  const trace = await traceDuTravailDuTour({ dossier: copie, repere, projet, remuesAvant });
  assert.equal(trace, 'ailleurs');
});

test('un dossier partagé déjà sale AVANT le tour n’est pas mis au compte de la carte', async () => {
  const { projet, copie } = depotJetable();
  // Le dossier du projet est partagé : le chef, l'analyse et la publication y
  // laissent des fichiers. Ce qui traînait avant le tour n'est pas une trace.
  fs.writeFileSync(path.join(projet, 'deja-la.txt'), 'un autre agent\n');

  const repere = await repereAvant(copie);
  const remuesAvant = await fichiersRemues(projet);

  const trace = await traceDuTravailDuTour({ dossier: copie, repere, projet, remuesAvant });
  assert.equal(trace, 'non');
});

test('la copie de la carte reste la première réponse : elle prime sur le partagé', async () => {
  const { projet, copie } = depotJetable();
  const repere = await repereAvant(copie);
  const remuesAvant = await fichiersRemues(projet);

  fs.writeFileSync(path.join(copie, 'travail.txt'), 'travail bien rangé\n');
  fs.writeFileSync(path.join(projet, 'a-cote.txt'), 'du bruit\n');

  const trace = await traceDuTravailDuTour({ dossier: copie, repere, projet, remuesAvant });
  assert.equal(trace, 'oui');
});

test('sans second dossier, le constat d’origine tient mot pour mot', async () => {
  const { projet } = depotJetable();
  const repere = await repereAvant(projet);
  // La carte travaille à même le dossier du projet : un seul dossier, déjà
  // observé — on ne compte donc rien deux fois.
  assert.equal(await traceDuTravailDuTour({ dossier: projet, repere, projet }), 'non');
  fs.writeFileSync(path.join(projet, 'travail.txt'), 'ici\n');
  assert.equal(await traceDuTravailDuTour({ dossier: projet, repere, projet }), 'oui');
});
