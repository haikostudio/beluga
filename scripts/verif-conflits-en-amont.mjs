#!/usr/bin/env node
/*
 * COMBIEN DE CONFLITS ATTEIGNENT ENCORE LA FUSION DU LOT ?
 *
 * On ne suppose pas : on rejoue. Le contrôle monte un dépôt git JETABLE, y
 * lance PLUSIEURS cartes en parallèle — toutes parties du même tronc, comme
 * dans la vraie vie —, leur fait toucher les mêmes fichiers, puis referme leurs
 * copies de travail une par une. Ce qu'on compte est exactement ce que la carte
 * demande : le nombre de branches qui, à la fin du tour de leur agent, ne
 * rejoignent PAS le tronc et repoussent donc leur conflit jusqu'à la
 * publication.
 *
 * Deux mondes, le même scénario :
 *
 *   AVANT — un fichier d'attente COMMUN à toutes les cartes, et une fusion nue
 *   qui s'annule au premier heurt. C'est le comportement d'avant cette carte.
 *
 *   APRÈS — un fichier d'attente PAR CARTE (deux fichiers ne se heurtent
 *   jamais) et le recollage mécanique des documents à la fermeture
 *   (`refermerDossierDeCarte`). C'est le comportement du démon.
 *
 * AUCUN moteur n'est appelé, aucun jeton n'est dépensé, et rien n'est touché
 * hors du dossier temporaire. Le contrôle vise le dépôt d'où il PART : il
 * charge `server/dist` de ce dépôt-là, copie de travail comprise.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const dist = path.join(RACINE, 'server', 'dist', 'dossier-de-carte.js');
if (!fs.existsSync(dist)) {
  console.error(`server/dist manquant : lancer « npm run build:server » d'abord (${dist}).`);
  process.exit(1);
}
const { refermerDossierDeCarte } = await import(pathToFileURL(dist).href);
const { fichierDAttentePourCopie, FICHIER_D_ATTENTE } = await import(
  pathToFileURL(path.join(RACINE, 'shared', 'dist', 'index.js')).href
);

const CARTES = 4;
let echecs = 0;

function verifier(ce, vrai) {
  if (vrai) {
    console.log(`  ✓ ${ce}`);
    return;
  }
  console.error(`  ✗ ${ce}`);
  echecs += 1;
}

/* ------------------------------------------------------------------ */
/* Le décor : un dépôt jetable, et des cartes qui partent du même tronc */
/* ------------------------------------------------------------------ */

function git(cwd, args, tolere = false) {
  try {
    return {
      ok: true,
      out: execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    };
  } catch (err) {
    if (!tolere) throw err;
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function monterLeDepot() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-conflits-'));
  git(racine, ['init', '-q', '-b', 'main']);
  git(racine, ['config', 'user.email', 'essai@haikodev']);
  git(racine, ['config', 'user.name', 'Essai']);
  fs.mkdirSync(path.join(racine, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'MEMOIRE.md'), '# Mémoire\n\n- un fait de départ\n');
  fs.writeFileSync(
    path.join(racine, FICHIER_D_ATTENTE),
    '# Instructions en attente de rangement\n\nLe mode d’emploi.\n',
  );
  git(racine, ['add', '-A']);
  git(racine, ['commit', '-q', '-m', 'départ']);
  return racine;
}

/**
 * Une carte : sa branche, sa copie de travail, et le travail qu'elle enregistre
 * — un fait de mémoire (fichier PARTAGÉ par tout le monde) et une règle apprise
 * (fichier commun dans le monde d'AVANT, fichier à soi dans celui d'APRÈS).
 */
function lancerUneCarte(racine, rang, { depotACommun }) {
  const branche = `tache/carte-${rang}`;
  const copie = `carte-${rang}-aaaaa${rang}`;
  const dossier = path.join(racine, '.worktrees', copie);
  git(racine, ['worktree', 'add', '-q', '-b', branche, dossier, 'main']);

  const memoire = path.join(dossier, 'MEMOIRE.md');
  fs.writeFileSync(memoire, `${fs.readFileSync(memoire, 'utf8')}- ce qu’a appris la carte ${rang}\n`);

  const relatif = depotACommun ? FICHIER_D_ATTENTE : fichierDAttentePourCopie(copie);
  const attente = path.join(dossier, relatif);
  fs.mkdirSync(path.dirname(attente), { recursive: true });
  const avant = fs.existsSync(attente) ? fs.readFileSync(attente, 'utf8') : '';
  fs.writeFileSync(attente, `${avant}\n## Règle apprise par la carte ${rang}\n- sujet : cartes\n\nSon texte.\n`);

  git(dossier, ['add', '-A']);
  git(dossier, ['commit', '-q', '-m', `travail de la carte ${rang}`]);
  return { branche, dossier };
}

/* ------------------------------------------------------------------ */
/* AVANT : fichier commun, fusion nue                                  */
/* ------------------------------------------------------------------ */

function mondeDAvant() {
  const racine = monterLeDepot();
  try {
    const cartes = [];
    // TOUTES les cartes partent d'abord, comme quand on en lance plusieurs le
    // même matin : aucune ne voit le travail des autres.
    for (let rang = 1; rang <= CARTES; rang++) cartes.push(lancerUneCarte(racine, rang, { depotACommun: true }));

    let reportes = 0;
    for (const { branche } of cartes) {
      const fusion = git(racine, ['merge', '--no-ff', '--no-edit', branche], true);
      if (!fusion.ok) {
        git(racine, ['merge', '--abort'], true);
        reportes += 1;
      }
    }
    return reportes;
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* APRÈS : un dépôt par carte, et le recollage à la fermeture          */
/* ------------------------------------------------------------------ */

async function mondeDApres() {
  const racine = monterLeDepot();
  try {
    const cartes = [];
    for (let rang = 1; rang <= CARTES; rang++) cartes.push(lancerUneCarte(racine, rang, { depotACommun: false }));

    let reportes = 0;
    const bilans = [];
    for (const { branche, dossier } of cartes) {
      const bilan = await refermerDossierDeCarte(racine, dossier, branche);
      bilans.push(bilan);
      if (!bilan.fusionnee) reportes += 1;
    }

    // Le tronc porte-t-il VRAIMENT le travail des quatre cartes ?
    const memoire = fs.readFileSync(path.join(racine, 'MEMOIRE.md'), 'utf8');
    const faits = Array.from({ length: CARTES }, (_, i) => `la carte ${i + 1}`).filter((m) => memoire.includes(m));
    const reglesGardees = Array.from({ length: CARTES }, (_, i) => {
      const chemin = path.join(racine, fichierDAttentePourCopie(`carte-${i + 1}-aaaaa${i + 1}`));
      return fs.existsSync(chemin) && fs.readFileSync(chemin, 'utf8').includes(`carte ${i + 1}`);
    }).filter(Boolean);

    return { reportes, faits: faits.length, reglesGardees: reglesGardees.length, bilans };
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */

console.log(`\nQUATRE CARTES LANCÉES EN PARALLÈLE, TOUTES PARTIES DU MÊME TRONC\n`);

const avant = mondeDAvant();
console.log('AVANT — un fichier d’attente commun, fusion nue à la fin du tour');
console.log(`  ${avant} conflit(s) sur ${CARTES} repoussé(s) jusqu’à la fusion du lot`);
verifier('le monde d’avant repousse bien des conflits (sinon le décor ne prouve rien)', avant > 0);

const apres = await mondeDApres();
console.log('\nAPRÈS — un dépôt de règles par carte, recollage des documents à la fermeture');
console.log(`  ${apres.reportes} conflit(s) sur ${CARTES} repoussé(s) jusqu’à la fusion du lot`);
for (const bilan of apres.bilans) console.log(`    · ${bilan.raison}`);

verifier('plus aucun conflit n’atteint la fusion du lot', apres.reportes === 0);
verifier('la baisse est réelle par rapport au monde d’avant', apres.reportes < avant);
verifier('les quatre cartes ont bien leur fait dans la mémoire du tronc', apres.faits === CARTES);
verifier('les quatre règles apprises sont là, chacune dans son dépôt', apres.reglesGardees === CARTES);
verifier('les copies de travail sont refermées', apres.bilans.every((b) => b.retire));

console.log(
  `\nBAISSE MESURÉE : ${avant} → ${apres.reportes} conflit(s) atteignant la fusion, ` +
    `sur ${CARTES} cartes lancées en parallèle.`,
);

if (echecs) {
  console.error(`\n${echecs} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('\nTous les contrôles passent.');
