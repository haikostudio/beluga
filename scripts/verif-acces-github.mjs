#!/usr/bin/env node
/**
 * GITHUB EST-IL VRAIMENT ACCESSIBLE À UN AGENT, SUR TOUS LES PROJETS ?
 *
 * L'outil `gh` est identifié sur le serveur, mais son identification dort dans
 * le dossier personnel du compte qui porte le démon — invisible depuis un bac à
 * sable. Le démon pose donc le JETON dans l'environnement de chaque agent
 * (`shared/src/acces-github.ts`, `server/src/github.ts`). On contrôle ici, sans
 * rien inventer :
 *
 *   1. le serveur rend bien un jeton, et les variables sont posées ;
 *   2. un ESSAI RÉEL de `gh`, avec l'environnement d'un agent et un dossier
 *      personnel VIDE, réussit sur DEUX projets différents du tableau ;
 *   3. le même essai SANS le jeton échoue — la preuve que c'est bien le jeton
 *      qui ouvre l'accès, pas un reste du disque ;
 *   4. le briefing de ces deux projets ANNONCE la capacité (agent de tâche et
 *      chef d'orchestre), et l'accueil minimal d'un dépannage ne la porte pas.
 *
 *   node scripts/verif-acces-github.mjs
 *
 * Rien n'est écrit sur GitHub : on ne fait que LIRE (`gh repo view`,
 * `gh issue list`). Le script juge le dépôt d'où il PART, jamais le dossier
 * principal.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** La base du démon : celle du dépôt d'où l'on part, sinon celle du projet dont cette copie est issue. */
function dossierDonnees() {
  const candidats = [
    process.env.HAIKO_GITHUB_DATA,
    path.join(RACINE, 'data'),
    path.resolve(RACINE, '..', '..', 'data'),
  ].filter(Boolean);
  return candidats.find((d) => fs.existsSync(path.join(d, 'haikodev.db'))) ?? path.join(RACINE, 'data');
}

const DONNEES = dossierDonnees();
process.env.HAIKODEV_DATA = DONNEES;

const { variablesGithub, partsDAccueil } = await import('../shared/dist/index.js');
const { jetonGithub, envGithub } = await import('../server/dist/github.js');
const { briefing } = await import('../server/dist/memory.js');
const { openDb } = await import('../server/dist/db.js');

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

console.log(`  …  dépôt jugé : ${RACINE}`);
console.log(`  …  données du démon : ${DONNEES}`);

/* --- 1. Le jeton et les variables --- */
const jeton = await jetonGithub();
noter('le serveur rend un jeton GitHub pour ses agents', Boolean(jeton), jeton ? `${jeton.slice(0, 4)}… (${jeton.length} signes)` : 'aucun');
const variables = await envGithub();
noter(
  'les variables lues par gh sont posées',
  Boolean(variables.GH_TOKEN && variables.GITHUB_TOKEN && variables.GH_PROMPT_DISABLED),
  Object.keys(variables).join(', ') || 'aucune',
);
noter('sans jeton, aucune variable creuse n’est posée', Object.keys(variablesGithub('')).length === 0);

/*
 * L'ENVIRONNEMENT D'UN AGENT, RECONSTRUIT AU PLUS DUR : un dossier personnel
 * VIDE. Si `gh` marche là, il marche dans une copie de travail comme dans le bac
 * à sable du chef, où le dossier personnel du serveur n'est pas lisible.
 */
const HOME_VIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-gh-'));
function envAgent(avecJeton = true) {
  return {
    PATH: process.env.PATH,
    HOME: HOME_VIDE,
    XDG_CONFIG_HOME: path.join(HOME_VIDE, '.config'),
    NO_COLOR: '1',
    ...(avecJeton ? variables : {}),
  };
}

async function gh(args, cwd, avecJeton = true) {
  try {
    const { stdout } = await execFileAsync('gh', args, { cwd, env: envAgent(avecJeton), timeout: 30000 });
    return { ok: true, out: stdout.trim() };
  } catch (err) {
    return { ok: false, out: ((err?.stderr ?? err?.message) || '').toString().trim() };
  }
}

/* --- 2. Deux vrais projets du tableau --- */
let projets = [];
try {
  const db = openDb();
  projets = db
    .prepare('SELECT data FROM projects')
    .all()
    .map((r) => JSON.parse(r.data))
    .filter((p) => p && p.path && fs.existsSync(p.path) && !p.archived);
} catch (err) {
  console.log(`  …  projets illisibles : ${err.message}`);
}

/** Le dépôt GitHub d'un projet, déduit de son remote : « proprietaire/nom ». */
async function depotDe(projet) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', projet.path, 'remote', 'get-url', 'origin'], { timeout: 10000 });
    const brut = stdout.trim();
    const m = brut.match(/github\.com[:/](.+?)(?:\.git)?$/);
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

const avecDepot = [];
for (const projet of projets) {
  const depot = await depotDe(projet);
  if (depot && !avecDepot.some((p) => p.depot === depot)) avecDepot.push({ ...projet, depot });
  if (avecDepot.length >= 2) break;
}
noter(
  'deux projets du tableau portent un dépôt GitHub',
  avecDepot.length >= 2,
  avecDepot.map((p) => `${p.name} → ${p.depot}`).join(' ; ') || 'aucun',
);

for (const projet of avecDepot) {
  const vue = await gh(['repo', 'view', projet.depot, '--json', 'nameWithOwner,visibility'], projet.path);
  noter(
    `« ${projet.name} » : un agent consulte le dépôt ${projet.depot}`,
    vue.ok && vue.out.includes(projet.depot),
    vue.ok ? vue.out.slice(0, 120) : vue.out.slice(0, 160),
  );
  const tickets = await gh(['issue', 'list', '-R', projet.depot, '--limit', '3', '--state', 'all'], projet.path);
  noter(`« ${projet.name} » : un agent lit les tickets`, tickets.ok, (tickets.out || 'aucun ticket').split('\n')[0].slice(0, 120));
  const fusions = await gh(['pr', 'list', '-R', projet.depot, '--limit', '3', '--state', 'all'], projet.path);
  noter(
    `« ${projet.name} » : un agent lit les demandes de fusion`,
    fusions.ok,
    (fusions.out || 'aucune demande de fusion').split('\n')[0].slice(0, 120),
  );
}

/* --- 3. Sans le jeton, l'accès tombe : c'est bien lui qui ouvre --- */
if (avecDepot.length) {
  const sansJeton = await gh(['repo', 'view', avecDepot[0].depot, '--json', 'nameWithOwner'], avecDepot[0].path, false);
  noter(
    'sans le jeton dans l’environnement, l’accès est refusé (c’est donc bien lui qui ouvre)',
    !sansJeton.ok,
    sansJeton.ok ? 'réussi alors qu’il ne devrait pas' : sansJeton.out.split('\n')[0].slice(0, 120),
  );
}

/* --- 4. Dans le BAC À SABLE du chef d'orchestre, au niveau système --- */
if (avecDepot.length) {
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-gh-bac-'));
  try {
    const { stdout } = await execFileAsync(
      'bwrap',
      [
        '--ro-bind', '/', '/',
        '--dev', '/dev',
        '--proc', '/proc',
        '--tmpfs', '/tmp',
        '--bind', bac, bac,
        '--setenv', 'HOME', bac,
        '--setenv', 'GH_TOKEN', variables.GH_TOKEN ?? '',
        '--setenv', 'GH_PROMPT_DISABLED', '1',
        '--die-with-parent',
        'gh', 'repo', 'view', avecDepot[0].depot, '--json', 'nameWithOwner',
      ],
      { timeout: 30000, env: { PATH: process.env.PATH, HOME: bac } },
    );
    noter(
      'dans un bac à sable (celui du chef d’orchestre), gh répond quand même',
      stdout.includes(avecDepot[0].depot),
      stdout.trim().slice(0, 120),
    );
  } catch (err) {
    const message = ((err?.stderr ?? err?.message) || '').toString().trim();
    // Sans les espaces de noms utilisateur non privilégiés, `bwrap` ne démarre
    // pas du tout : on le DIT au lieu de conclure à tort que GitHub est fermé.
    if (/bwrap|Permission denied|ENOENT/i.test(message)) {
      console.log(`  …  bac à sable non testable ici : ${message.split('\n')[0].slice(0, 140)}`);
    } else {
      noter('dans un bac à sable (celui du chef d’orchestre), gh répond quand même', false, message.slice(0, 140));
    }
  } finally {
    fs.rmSync(bac, { recursive: true, force: true });
  }
}

/* --- 5. L'accueil annonce la capacité --- */
for (const projet of avecDepot) {
  const texte = briefing(projet.path, projet.name, true, 'claude');
  noter(`« ${projet.name} » : le briefing annonce l’accès GitHub`, /GITHUB EST DIRECTEMENT ACCESSIBLE/.test(texte));
  noter(`« ${projet.name} » : le briefing nomme une commande à lancer`, /gh (repo|pr|issue)/.test(texte));
}
if (avecDepot.length) {
  const chef = briefing(avecDepot[0].path, avecDepot[0].name, true, 'claude', undefined, 'tri');
  const depannage = briefing(avecDepot[0].path, avecDepot[0].name, true, 'claude', undefined, 'minimal');
  noter('le chef d’orchestre reçoit lui aussi l’annonce', /GITHUB EST DIRECTEMENT ACCESSIBLE/.test(chef));
  noter(
    'un dépannage de publication ne la reçoit pas (accueil minimal)',
    !/GITHUB EST DIRECTEMENT ACCESSIBLE/.test(depannage) && partsDAccueil('minimal').github === false,
  );
}

fs.rmSync(HOME_VIDE, { recursive: true, force: true });

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
