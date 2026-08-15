#!/usr/bin/env node
/*
 * L'ONGLET « GITHUB » D'UNE CARTE NE MONTRE QUE SA BRANCHE.
 *
 * Il affichait « les 10 derniers commits » de la branche : une fois celle-ci
 * née de la principale, c'était l'historique GÉNÉRAL du dépôt — le travail
 * d'autres cartes, sans aucun rapport avec celle qu'on regardait.
 *
 * Tout tient au POINT DE DÉPART de la branche. On l'éprouve ici pour de vrai,
 * sur un dépôt git jetable, dans les trois situations qui comptent :
 *
 *  1. la branche est OUVERTE : l'ancêtre commun suffit, et le relevé ne compte
 *     que les enregistrements et les fichiers de la carte ;
 *  2. la branche est FUSIONNÉE et la principale a continué d'avancer : l'ancêtre
 *     commun ne dit plus rien (la principale contient la branche), et c'est le
 *     commit de fusion qui rend le point de départ — le périmètre ne bouge pas ;
 *  3. la base RETENUE à la création (`baseSha`) passe devant tout le reste.
 *
 * AUCUN moteur n'est appelé, aucune base réelle n'est touchée.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const jetable = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-github-'));
process.env.HAIKODEV_DATA = path.join(jetable, 'data');
fs.mkdirSync(process.env.HAIKODEV_DATA, { recursive: true });

const { baseDeLaBranche } = await import(path.join(RACINE, 'server/dist/github.js'));
const { fichiersDepuisNameStatus, resumeDesFichiers, phraseDesFichiers } = await import(
  path.join(RACINE, 'shared/dist/index.js')
);

const depot = path.join(jetable, 'depot');
fs.mkdirSync(depot, { recursive: true });

const git = (...args) => execFileSync('git', args, { cwd: depot, encoding: 'utf8' }).trim();
const ecrire = (nom, texte) => {
  fs.mkdirSync(path.dirname(path.join(depot, nom)), { recursive: true });
  fs.writeFileSync(path.join(depot, nom), texte);
};

const echecs = [];
const verifier = (nom, condition, detail = '') => {
  if (condition) console.log(`  ok   ${nom}`);
  else {
    console.log(`  ÉCHEC ${nom}${detail ? ` — ${detail}` : ''}`);
    echecs.push(nom);
  }
};

/* -------- Un dépôt avec une histoire à lui -------- */

git('init', '-b', 'main');
git('config', 'user.email', 'essai@haikodev');
git('config', 'user.name', 'Essai');
git('commit', '--allow-empty', '-m', 'départ');
for (const n of [1, 2, 3]) {
  ecrire(`vieux-${n}.md`, `histoire ${n}`);
  git('add', `vieux-${n}.md`);
  git('commit', '-m', `travail d'une autre carte ${n}`);
}
const baseAttendue = git('rev-parse', 'HEAD');

/* -------- La branche de la carte, encore ouverte -------- */

git('checkout', '-b', 'tache/ma-carte');
ecrire('web/neuf.tsx', 'neuf');
ecrire('vieux-1.md', 'histoire 1 corrigée');
git('add', '-A');
git('commit', '-m', 'la carte ajoute et modifie');
fs.rmSync(path.join(depot, 'vieux-2.md'));
git('add', '-A');
git('commit', '-m', 'la carte supprime');
git('checkout', 'main');

console.log('\n1. Branche ouverte');
let base = await baseDeLaBranche(depot, 'tache/ma-carte', 'main');
verifier('le point de départ de la branche est retrouvé', base === baseAttendue, `${base} ≠ ${baseAttendue}`);

const commitsDeLaBranche = git('log', '--format=%s', `${base}..tache/ma-carte`).split('\n').filter(Boolean);
verifier('seuls les enregistrements de la carte sont comptés', commitsDeLaBranche.length === 2, commitsDeLaBranche.join(' | '));
verifier(
  "aucun enregistrement d'une autre carte ne s'y glisse",
  !commitsDeLaBranche.some((m) => m.includes('autre carte')),
);

const diff = git('diff', '--name-status', base, 'tache/ma-carte');
const fichiers = fichiersDepuisNameStatus(diff);
const resume = resumeDesFichiers(fichiers);
verifier(
  'les fichiers touchés sont comptés par sort',
  resume.ajoutes === 1 && resume.modifies === 1 && resume.supprimes === 1 && resume.total === 3,
  phraseDesFichiers(resume),
);
verifier(
  'la liste nomme les fichiers de la carte, et eux seuls',
  fichiers.map((f) => f.chemin).sort().join(',') === 'vieux-1.md,vieux-2.md,web/neuf.tsx',
  fichiers.map((f) => f.chemin).join(','),
);

/* -------- La branche fusionnée, et la principale qui avance -------- */

console.log('\n2. Branche fusionnée, principale repartie');
git('merge', '--no-ff', '--no-edit', 'tache/ma-carte');
for (const n of [4, 5]) {
  ecrire(`vieux-${n}.md`, `suite ${n}`);
  git('add', `vieux-${n}.md`);
  git('commit', '-m', `travail d'une autre carte ${n}`);
}

const ancetre = git('merge-base', 'main', 'tache/ma-carte');
verifier(
  "l'ancêtre commun ne dit plus rien une fois la branche fusionnée",
  ancetre === git('rev-parse', 'tache/ma-carte'),
);

base = await baseDeLaBranche(depot, 'tache/ma-carte', 'main');
verifier('le commit de fusion rend le point de départ', base === baseAttendue, `${base} ≠ ${baseAttendue}`);

const apres = resumeDesFichiers(fichiersDepuisNameStatus(git('diff', '--name-status', base, 'tache/ma-carte')));
verifier(
  'le périmètre de la carte ne bouge pas après la fusion',
  apres.total === 3 && apres.ajoutes === 1 && apres.modifies === 1 && apres.supprimes === 1,
  phraseDesFichiers(apres),
);

/* -------- La base retenue passe devant -------- */

console.log('\n3. Base retenue à la création');
const retenue = git('rev-parse', 'HEAD~2');
base = await baseDeLaBranche(depot, 'tache/ma-carte', 'main', retenue);
verifier('la base retenue est reprise telle quelle', base === retenue, `${base} ≠ ${retenue}`);

base = await baseDeLaBranche(depot, 'tache/ma-carte', 'main', 'ceciNestPasUnCommit');
verifier('une base inventée est écartée, pas suivie', base === baseAttendue, String(base));

/* -------- Une branche qui n'existe pas ne fabrique rien -------- */

base = await baseDeLaBranche(depot, 'tache/jamais-vue', 'main');
verifier("une branche absente rend « je ne sais pas », jamais un périmètre inventé", base === undefined, String(base));

fs.rmSync(jetable, { recursive: true, force: true });

console.log('');
if (echecs.length) {
  console.error(`${echecs.length} contrôle(s) en échec : ${echecs.join(', ')}`);
  process.exit(1);
}
console.log('Tout est conforme : l’onglet GitHub ne parle que de la branche de la carte.');
