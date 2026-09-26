#!/usr/bin/env node
/*
 * LA NUIT DE LAYA : ENTRAÎNER, EXAMINER, ET NE REMPLACER QUE SI C'EST MIEUX.
 *
 * Lancé chaque nuit par le démon entre 3 h et 7 h (`server/src/laya-nuit.ts`),
 * ou à la main :
 *
 *   node scripts/laya-nuit.mjs            → la nuit entière (refuse hors de 3 h – 7 h)
 *   node scripts/laya-nuit.mjs --forcer   → idem, à n'importe quelle heure (fin = prochaine 7 h)
 *   node scripts/laya-nuit.mjs --essai    → quelques pas seulement, pour vérifier la chaîne
 *   node scripts/laya-nuit.mjs --revenir  → remet en service la version précédente
 *
 * DANS L'ORDRE :
 *   1. pose le VERROU (`outils/laya/entrainement/EN-COURS`) : tant qu'il existe
 *      et que son processus vit, le démon ne recharge pas Laya ; le Laya en
 *      service est arrêté pour rendre sa mémoire ;
 *   2. refait le jeu d'exemples depuis la base servie (lecture seule) ;
 *   3. examine la version EN SERVICE si son examen n'est pas déjà connu ;
 *   4. entraîne jusqu'à 6 h 10 (ou tant que la mémoire le permet), en reprenant
 *      la passe de la nuit précédente ;
 *   5. examine la version CANDIDATE ; elle ne remplace l'actuelle que si
 *      `verdictDeBascule` le dit (gain franc, aucun recul) — l'ancienne reste
 *      gardée pour `--revenir` ;
 *   6. écrit le compte rendu (`derniere-nuit.json`), lu par l'écran du juge,
 *      puis lève le verrou. Le démon relance Laya à la question suivante.
 *
 * Aucun usage ne s'allume ici : la bascule change le MODÈLE, les interrupteurs
 * restent à l'utilisateur et à la preuve chiffrée (DEC-267).
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dansLaFenetreDeNuit, finDeLEntrainement, jourDeLaNuit, verdictDeBascule } from '../shared/dist/index.js';
import { depotPrincipal } from './base-servie.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const forcer = args.includes('--forcer') || args.includes('--essai');
const essai = args.includes('--essai');

const LAYA = process.env.BELUGA_LAYA_DIR?.trim() || path.join(depotPrincipal(), 'outils/laya');
const PYTHON = path.join(LAYA, 'venv/bin/python');
const TRAVAIL = path.join(LAYA, 'entrainement');
const VERROU = path.join(TRAVAIL, 'EN-COURS');
const RAPPORT = path.join(TRAVAIL, 'derniere-nuit.json');
const EXAMEN_SERVICE = path.join(TRAVAIL, 'examen-en-service.json');
const EXAMEN_CANDIDAT = path.join(TRAVAIL, 'examen-candidat.json');
const VERSIONS = path.join(LAYA, 'versions');
const EN_SERVICE = path.join(LAYA, 'en-service');
const PRECEDENTE = path.join(LAYA, 'precedente');
/** Au démarrage de l'entraînement, il faut de quoi charger le modèle et apprendre. */
const MEMOIRE_DEPART_MO = Number(process.env.BELUGA_LAYA_NUIT_MEMOIRE_MO ?? 3200);
/** En cours de route, sous ce plancher, la tranche s'arrête proprement. */
const MEMOIRE_PLANCHER_MO = Number(process.env.BELUGA_LAYA_NUIT_PLANCHER_MO ?? 700);

const env = { ...process.env, HF_HOME: path.join(LAYA, 'hf'), HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
const dire = (texte) => console.log(`${new Date().toLocaleTimeString('fr-CH')} ${texte}`);

function memoireLibreMo() {
  const m = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
  return m ? Math.round(Number(m[1]) / 1024) : 0;
}

function vivant(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Le dossier du modèle en service : une version entraînée ici, sinon le multilingue du cache. */
function modeleEnService() {
  if (fs.existsSync(path.join(EN_SERVICE, 'model.safetensors'))) return fs.realpathSync(EN_SERVICE);
  const instantanes = path.join(LAYA, 'hf/hub/models--convaiinnovations--laya/snapshots');
  for (const s of fs.readdirSync(instantanes)) {
    const d = path.join(instantanes, s, 'multilingual');
    if (fs.existsSync(path.join(d, 'model.safetensors'))) return d;
  }
  throw new Error('aucun modèle multilingue dans le cache : node scripts/installer-laya.mjs --installer');
}

function ecrireRapport(r) {
  fs.mkdirSync(TRAVAIL, { recursive: true });
  fs.writeFileSync(`${RAPPORT}.tmp`, JSON.stringify(r, null, 2));
  fs.renameSync(`${RAPPORT}.tmp`, RAPPORT);
}

function lire(fichier) {
  try {
    return JSON.parse(fs.readFileSync(fichier, 'utf8'));
  } catch {
    return null;
  }
}

/** Un lien existe-t-il, même s'il pointe vers « origine » (qui n'est pas un dossier) ? */
function lienPresent(lien) {
  try {
    fs.lstatSync(lien);
    return true;
  } catch {
    return false;
  }
}

/** Remplace un lien symbolique d'un seul geste (lien temporaire, puis renommage). */
function lier(lien, cible) {
  const tmp = `${lien}.tmp-${process.pid}`;
  fs.rmSync(tmp, { force: true });
  fs.symlinkSync(cible, tmp);
  fs.renameSync(tmp, lien);
}

/* ------------------------------------------------------------------ */
/* --revenir                                                            */
/* ------------------------------------------------------------------ */

if (args.includes('--revenir')) {
  if (!lienPresent(PRECEDENTE)) {
    console.log('Aucune version précédente gardée : la version en service reste.');
    process.exit(1);
  }
  const avant = lienPresent(EN_SERVICE) ? fs.readlinkSync(EN_SERVICE) : null;
  const cible = fs.readlinkSync(PRECEDENTE);
  if (cible === 'origine') fs.rmSync(EN_SERVICE, { force: true });
  else lier(EN_SERVICE, cible);
  if (avant) lier(PRECEDENTE, avant);
  else lier(PRECEDENTE, 'origine');
  fs.rmSync(EXAMEN_SERVICE, { force: true });
  console.log(`Version remise en service : ${cible === 'origine' ? 'le modèle d’origine' : cible}. Le démon la charge à la prochaine question.`);
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* LA NUIT                                                              */
/* ------------------------------------------------------------------ */

const maintenant = new Date();
if (!forcer && !dansLaFenetreDeNuit(maintenant)) {
  console.log('Hors de la fenêtre de nuit (3 h – 7 h) : rien à faire. --forcer pour passer outre.');
  process.exit(0);
}
if (!fs.existsSync(PYTHON)) {
  console.log('Laya n’est pas installé : node scripts/installer-laya.mjs --installer');
  process.exit(1);
}
fs.mkdirSync(TRAVAIL, { recursive: true });
const verrou = lire(VERROU);
if (verrou?.pid && vivant(verrou.pid)) {
  console.log(`Une nuit est déjà en cours (processus ${verrou.pid}).`);
  process.exit(0);
}
fs.writeFileSync(VERROU, JSON.stringify({ pid: process.pid, depuis: Date.now() }));
const leverLeVerrou = () => fs.rmSync(VERROU, { force: true });
process.on('exit', leverLeVerrou);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));

const fin = essai ? Date.now() + 60 * 60_000 : finDeLEntrainement(maintenant);
const rapport = {
  jour: jourDeLaNuit(maintenant),
  debut: Date.now(),
  fin: 0,
  issue: 'rien',
  raison: '',
  versionEnService: 'origine',
};
ecrireRapport(rapport);

try {
  /* 1. Rendre la mémoire : le Laya du démon s'arrête, et ne se relance pas tant que le verrou vit. */
  spawnSync('pkill', ['-f', 'scripts/laya-service.py'], { stdio: 'ignore' });

  /* 2. Le jeu d'exemples. */
  const jeu = spawnSync(process.execPath, [path.join(ICI, 'laya-jeu-d-exemples.mjs')], { encoding: 'utf8', env: process.env });
  if (jeu.status !== 0) throw new Error(`jeu d'exemples : ${(jeu.stderr || jeu.stdout).slice(-300)}`);
  dire(jeu.stdout.trim().split('\n').join(' | '));
  const lignes = fs.readFileSync(path.join(TRAVAIL, 'exemples.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  rapport.exemples = {
    entrainement: lignes.filter((l) => l.partie === 'entrainement').length,
    examen: lignes.filter((l) => l.partie === 'examen').length,
  };

  const service = modeleEnService();
  rapport.versionEnService = fs.existsSync(path.join(EN_SERVICE, 'model.safetensors')) ? path.basename(service) : 'origine';

  /* 3. L'examen de la version en service, s'il n'est pas déjà connu pour ce modèle et ces examens. */
  const examenDuJeu = `${rapport.exemples.examen}`;
  const connu = lire(EXAMEN_SERVICE);
  if (!essai && (!connu || connu.modele !== service || connu.examenDuJeu !== examenDuJeu)) {
    dire(`examen de la version en service (${rapport.versionEnService})…`);
    const r = spawnSync(process.execPath, [path.join(ICI, 'preuve-laya.mjs'), '--jeu', '--modele', service, '--json', EXAMEN_SERVICE], {
      encoding: 'utf8',
      env,
    });
    if (r.status !== 0) throw new Error(`examen de la version en service : ${(r.stderr || r.stdout).slice(-300)}`);
    const e = lire(EXAMEN_SERVICE);
    e.modele = service;
    e.examenDuJeu = examenDuJeu;
    fs.writeFileSync(EXAMEN_SERVICE, JSON.stringify(e, null, 2));
  }

  /* 4. L'entraînement, par tranche. */
  const libre = memoireLibreMo();
  if (libre < MEMOIRE_DEPART_MO) {
    rapport.issue = 'interrompu';
    rapport.raison = `mémoire libre trop juste pour entraîner (${libre} Mo, il en faut ${MEMOIRE_DEPART_MO})`;
    throw Object.assign(new Error(rapport.raison), { attendu: true });
  }
  dire(`entraînement jusqu'à ${new Date(fin).toLocaleTimeString('fr-CH')}, ${libre} Mo libres`);
  const sortie = await new Promise((resoudre) => {
    const p = spawn(
      PYTHON,
      [
        path.join(ICI, 'laya-entrainement.py'),
        '--base', service,
        '--jeu', path.join(TRAVAIL, 'exemples.jsonl'),
        '--travail', path.join(TRAVAIL, 'passe'),
        '--fin', String(fin),
        '--memoire-min', String(MEMOIRE_PLANCHER_MO),
        ...(essai ? ['--max-pas', '3'] : []),
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => {
      const texte = String(d);
      if (!/warn/i.test(texte)) process.stdout.write(texte);
    });
    /* Filet : l'entraînement se borne lui-même, mais un processus qui ne rend pas la main est coupé. */
    const garde = setTimeout(() => p.kill('SIGKILL'), Math.max(60_000, fin - Date.now() + 20 * 60_000));
    p.on('exit', (code) => {
      clearTimeout(garde);
      resoudre({ code, out });
    });
  });
  const issue = sortie.out.trim().split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).pop();
  if (!issue) throw new Error(`entraînement sans issue lisible (code ${sortie.code})`);
  rapport.issue = issue.issue;
  rapport.raison = issue.raison;
  rapport.progression = issue.progression;
  if (!issue.candidat) throw Object.assign(new Error(issue.raison), { attendu: true });

  /* 5. L'examen de la candidate, puis la bascule. */
  if (essai) {
    rapport.raison = `essai : candidate écrite (${issue.candidat}), ni examinée ni mise en service`;
  } else {
    dire('examen de la version entraînée…');
    const r = spawnSync(
      process.execPath,
      [path.join(ICI, 'preuve-laya.mjs'), '--jeu', '--modele', issue.candidat, '--json', EXAMEN_CANDIDAT],
      { encoding: 'utf8', env },
    );
    if (r.status !== 0) throw new Error(`examen de la version entraînée : ${(r.stderr || r.stdout).slice(-300)}`);
    const avant = lire(EXAMEN_SERVICE)?.bilans ?? [];
    const apres = lire(EXAMEN_CANDIDAT)?.bilans ?? [];
    const verdict = verdictDeBascule(avant, apres);
    rapport.bascule = verdict;
    rapport.examen = apres;
    dire(`bascule : ${verdict.remplace ? 'OUI' : 'non'} — ${verdict.raison}`);
    if (verdict.remplace) {
      const nom = `${rapport.jour}-${new Date().toISOString().slice(11, 16).replace(':', '')}`;
      fs.mkdirSync(VERSIONS, { recursive: true });
      const dest = path.join(VERSIONS, nom);
      fs.cpSync(issue.candidat, dest, { recursive: true, dereference: true });
      const ancienne = lienPresent(EN_SERVICE) ? fs.readlinkSync(EN_SERVICE) : 'origine';
      lier(PRECEDENTE, ancienne);
      lier(EN_SERVICE, dest);
      /* L'examen de la candidate devient celui de la version en service. */
      const e = lire(EXAMEN_CANDIDAT);
      e.modele = fs.realpathSync(EN_SERVICE);
      e.examenDuJeu = examenDuJeu;
      fs.writeFileSync(EXAMEN_SERVICE, JSON.stringify(e, null, 2));
      /* Deux versions gardées sur le disque, pas plus : chacune pèse ~650 Mo. */
      const gardees = new Set([fs.realpathSync(EN_SERVICE), ancienne !== 'origine' ? path.resolve(LAYA, ancienne) : '']);
      for (const v of fs.readdirSync(VERSIONS)) {
        const d = path.join(VERSIONS, v);
        if (!gardees.has(d)) fs.rmSync(d, { recursive: true, force: true });
      }
      rapport.versionEnService = nom;
    }
  }
} catch (err) {
  if (!err.attendu) {
    rapport.issue = 'echec';
    rapport.raison = String(err.message ?? err).slice(0, 500);
  }
  dire(`nuit arrêtée : ${rapport.raison}`);
} finally {
  rapport.fin = Date.now();
  ecrireRapport(rapport);
  dire(`compte rendu écrit : ${rapport.issue} — ${rapport.raison}`);
}
process.exit(rapport.issue === 'echec' ? 1 : 0);
