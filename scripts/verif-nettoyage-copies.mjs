#!/usr/bin/env node
/*
 * UNE COPIE DE TRAVAIL VIVANTE SURVIT-ELLE AU NETTOYAGE DU DISQUE ?
 *
 * Le 06/09/2026, la copie de travail d'une carte EN TRAIN de travailler a été
 * retirée par la minuterie de nettoyage : le tour est mort sur un
 * « spawn claude ENOENT », et la relance est repartie sans sa liste de tâches.
 * La cause était un tuyau : « find … | grep -q . » fait sortir grep au PREMIER
 * résultat, find prend un SIGPIPE et sort en 141, et « set -o pipefail »
 * remonte ce 141 comme un échec — donc « rien n'a bougé ici ». Plus la copie
 * contenait de fichiers, plus le SIGPIPE était certain.
 *
 * Ce contrôle ne raisonne pas, il REJOUE. Il monte un décor jetable dans un
 * dossier temporaire — un dépôt git et trois copies — puis lance la section
 * « copies de travail » du script système versionné, telle quelle :
 *
 *   1. une copie ACTIVE, chargée de milliers de fichiers du jour, encore
 *      rattachée à sa branche « tache/… » : elle DOIT survivre ;
 *   2. une copie OUBLIÉE depuis quarante jours, rattachée elle aussi : le délai
 *      de grâce est écoulé, elle DOIT partir ;
 *   3. un DOSSIER ORPHELIN que git ne déclare plus, vieux de dix jours : il
 *      DOIT partir.
 *
 * Puis il rejoue le décor avec le code d'AVANT — le tuyau — et exige qu'il
 * échoue : sans ce contre-essai, on ne saurait pas si le contrôle vérifie
 * quelque chose.
 *
 * Rien n'est touché hors du dossier temporaire : aucun cache, aucun service,
 * aucun dépôt réel. Le contrôle vise le script du dépôt d'où il PART.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(RACINE, 'scripts', 'systeme', 'root-storage-cleanup.sh');

if (!fs.existsSync(SCRIPT)) {
  console.error(`Script système introuvable : ${SCRIPT}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* La section à éprouver, découpée dans le script versionné            */
/* ------------------------------------------------------------------ */

/**
 * On n'exécute PAS le script entier : il vide des caches, parle à systemd et à
 * docker, et relâche la mémoire du noyau. On en extrait la seule section qui
 * décide du sort des copies de travail, et on la joue avec un `ajouter_etape`
 * de circonstance.
 */
function sectionDesCopies() {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const debut = source.indexOf('# Copies de travail (.worktrees)');
  const marque = 'ajouter_etape "Copies de travail abandonnees';
  const fin = source.indexOf(marque);
  if (debut < 0 || fin < 0) {
    console.error('Section « copies de travail » introuvable dans le script système.');
    console.error('Le script a changé de forme : ce contrôle doit être remis à jour.');
    process.exit(1);
  }
  // On s'arrête juste avant l'appel final : il ne fait qu'écrire la trace.
  return source.slice(debut, fin);
}

/** La boucle telle qu'elle était AVANT le correctif, pour le contre-essai. */
const SECTION_AVANT = `
freed_worktrees=0
worktrees_retires=0
for wt in "$WORKTREES_ROOT"/*/.worktrees/*/; do
  [ -d "$wt" ] || continue
  wt="\${wt%/}"
  depot="$(dirname "$(dirname "$wt")")"
  [ -d "$depot/.git" ] || continue
  if find "$wt" -newermt "-\${WORKTREE_MAX_AGE_DAYS} days" 2>/dev/null | grep -q .; then
    continue
  fi
  if git -C "$depot" worktree remove --force "$wt" 2>/dev/null; then
    worktrees_retires=$(( worktrees_retires + 1 ))
  elif rm -rf "$wt" 2>/dev/null; then
    git -C "$depot" worktree prune 2>/dev/null
    worktrees_retires=$(( worktrees_retires + 1 ))
  fi
done
`;

/* ------------------------------------------------------------------ */
/* Le décor                                                            */
/* ------------------------------------------------------------------ */

const git = (dossier, args) =>
  execFileSync('git', ['-C', dossier, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Recule la date de TOUT le contenu d'un dossier, le dossier compris. */
function vieillir(dossier, jours) {
  execFileSync('bash', [
    '-c',
    `find ${JSON.stringify(dossier)} -exec touch -h -d "-${jours} days" {} + 2>/dev/null; ` +
      `touch -d "-${jours} days" ${JSON.stringify(dossier)}`,
  ]);
}

/**
 * Le décor, monté à neuf à chaque essai. `FICHIERS_ACTIFS` est le cœur du
 * contre-essai : il faut que la liste des chemins dépasse la taille d'un tuyau
 * (64 Ko) pour que le SIGPIPE soit certain, comme avec un `node_modules`.
 */
const FICHIERS_ACTIFS = 5000;

function monterLeDecor() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-nettoyage-copies-'));
  const depot = path.join(racine, 'projet');
  fs.mkdirSync(depot, { recursive: true });

  git(depot, ['init', '--quiet', '--initial-branch=main']);
  git(depot, ['config', 'user.email', 'controle@beluga.local']);
  git(depot, ['config', 'user.name', 'Contrôle']);
  fs.writeFileSync(path.join(depot, 'LISEZMOI.md'), 'décor jetable\n');
  git(depot, ['add', 'LISEZMOI.md']);
  git(depot, ['commit', '--quiet', '-m', 'départ']);

  const copies = path.join(depot, '.worktrees');
  fs.mkdirSync(copies, { recursive: true });

  // 1. La copie ACTIVE : rattachée, chargée, du jour.
  const active = path.join(copies, 'carte-active');
  git(depot, ['worktree', 'add', '--quiet', '-b', 'tache/carte-active', active, 'main']);
  const lourd = path.join(active, 'node_modules', 'paquet-avec-un-nom-plutot-long');
  fs.mkdirSync(lourd, { recursive: true });
  for (let i = 0; i < FICHIERS_ACTIFS; i += 1) {
    fs.writeFileSync(path.join(lourd, `module-interne-numero-${i}-index.js`), 'x\n');
  }

  // 2. La copie OUBLIÉE : rattachée, mais immobile depuis quarante jours.
  const oubliee = path.join(copies, 'carte-oubliee');
  git(depot, ['worktree', 'add', '--quiet', '-b', 'tache/carte-oubliee', oubliee, 'main']);
  vieillir(oubliee, 40);

  // 3. Le DOSSIER ORPHELIN : git ne le déclare plus, il traîne depuis dix jours.
  const orphelin = path.join(copies, 'dossier-orphelin');
  fs.mkdirSync(orphelin, { recursive: true });
  fs.writeFileSync(path.join(orphelin, 'reste.txt'), 'oublié\n');
  vieillir(orphelin, 10);

  return { racine, depot, active, oubliee, orphelin };
}

function jouer(section, decor) {
  const harnais = [
    'set -uo pipefail',
    `WORKTREES_ROOT=${JSON.stringify(decor.racine)}`,
    'WORKTREE_MAX_AGE_DAYS=7',
    'WORKTREE_ATTACHED_MAX_AGE_DAYS=30',
    'ajouter_etape() { printf "%s\\n" "$3"; }',
    section,
    'printf "RETIRES=%s\\n" "$worktrees_retires"',
    'printf "NOMS=%s\\n" "${noms_retires:-}"',
  ].join('\n');
  const res = spawnSync('bash', ['-c', harnais], { encoding: 'utf8' });
  return { code: res.status, sortie: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

/* ------------------------------------------------------------------ */
/* Les essais                                                          */
/* ------------------------------------------------------------------ */

const echecs = [];
const dire = (ok, texte) => {
  console.log(`  ${ok ? '✓' : '✗'}  ${texte}`);
  if (!ok) echecs.push(texte);
};

console.log('CONTRÔLE DU NETTOYAGE DES COPIES DE TRAVAIL\n');

// --- Essai 1 : le script d'aujourd'hui ------------------------------
{
  const decor = monterLeDecor();
  try {
    const { code, sortie } = jouer(sectionDesCopies(), decor);
    console.log(`Script actuel — ${FICHIERS_ACTIFS} fichiers dans la copie active :`);
    dire(code === 0, `la section s’exécute sans erreur (code ${code})`);
    dire(fs.existsSync(decor.active), 'la copie ACTIVE est intacte');
    dire(!fs.existsSync(decor.oubliee), 'la copie OUBLIÉE depuis 40 jours est retirée');
    dire(!fs.existsSync(decor.orphelin), 'le DOSSIER ORPHELIN de 10 jours est retiré');
    dire(/NOMS=.*carte-oubliee/.test(sortie), 'la trace NOMME les copies retirées');
    if (echecs.length) console.log(`\n  sortie du script :\n${sortie.replace(/^/gm, '    ')}`);
  } finally {
    fs.rmSync(decor.racine, { recursive: true, force: true });
  }
}

// --- Essai 2 : le contre-essai, avec le code d'avant ------------------
console.log('\nContre-essai — la même section AVANT le correctif (le tuyau) :');
{
  const decor = monterLeDecor();
  try {
    jouer(SECTION_AVANT, decor);
    const active = fs.existsSync(decor.active);
    dire(
      !active,
      active
        ? 'le code d’avant garde la copie active : le contre-essai ne prouve rien, ' +
            'le décor ne déclenche plus le SIGPIPE (vérifier FICHIERS_ACTIFS)'
        : 'le code d’avant retire bien la copie ACTIVE — la panne est reproduite, donc le correctif compte',
    );
  } finally {
    fs.rmSync(decor.racine, { recursive: true, force: true });
  }
}

console.log('');
if (echecs.length) {
  console.log(`ÉCHEC : ${echecs.length} attente(s) non tenue(s).`);
  process.exit(1);
}
console.log('OK — une copie de travail vivante survit au nettoyage, une copie abandonnée part.');
