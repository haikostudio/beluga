#!/usr/bin/env node
/*
 * POSER LAYA SUR CETTE MACHINE, OU DIRE OÙ ON EN EST.
 *
 * Le modèle ne vit PAS dans le dépôt : un environnement Python (~1,2 Go, torch
 * pour processeur compris) et 650 Mo de poids, que chaque copie de travail
 * repaierait. Il s'installe une fois sur le serveur, sous `outils/laya/` du
 * dépôt PRINCIPAL (ou `BELUGA_LAYA_DIR`), hors git.
 *
 *   node scripts/installer-laya.mjs              → dit où on en est
 *   node scripts/installer-laya.mjs --installer  → crée l'environnement, installe, télécharge les poids
 *   node scripts/installer-laya.mjs --essayer    → pose une vraie question et la chronomètre
 *
 * Rejouable : chaque étape déjà faite est sautée. Un serveur SANS Laya n'est
 * pas en panne : tous les jugements reprennent leur comportement d'avant.
 *
 * Source : https://github.com/NandhaKishorM/laya (Convai Innovations,
 * Apache-2.0), poids convaiinnovations/laya, sous-dossier « multilingual ».
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { depotPrincipal } from './base-servie.mjs';

const DOSSIER_LAYA = 'outils/laya';
/** La version essayée et mesurée sur ce serveur le 25.09.2026. */
const VERSION = '0.3.20';
const dossier = process.env.BELUGA_LAYA_DIR?.trim() || path.join(depotPrincipal(), DOSSIER_LAYA);
const python = path.join(dossier, 'venv/bin/python');
const cache = path.join(dossier, 'hf');
const service = path.join(path.dirname(fileURLToPath(import.meta.url)), 'laya-service.py');

const installer = process.argv.includes('--installer');
const essayer = process.argv.includes('--essayer');

function lancer(commande, args, options = {}) {
  console.log(`  $ ${[commande, ...args].join(' ')}`);
  const r = spawnSync(commande, args, { stdio: 'inherit', ...options });
  if (r.status !== 0) {
    console.log(`\nÉchec (code ${r.status}).`);
    process.exit(1);
  }
}

function versionInstallee() {
  if (!fs.existsSync(python)) return '';
  const r = spawnSync(python, ['-I', '-c', 'import laya; print(laya.__version__)'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function poidsPresents() {
  const racine = path.join(cache, 'hub', 'models--convaiinnovations--laya', 'snapshots');
  try {
    return fs.readdirSync(racine).some((instantane) => fs.existsSync(path.join(racine, instantane, 'multilingual')));
  } catch {
    return false;
  }
}

console.log(`Dossier visé : ${dossier}`);

if (installer) {
  fs.mkdirSync(dossier, { recursive: true });
  if (!fs.existsSync(python)) {
    console.log('\n1. Environnement Python');
    lancer('python3', ['-m', 'venv', path.join(dossier, 'venv')]);
    lancer(python, ['-m', 'pip', 'install', '-q', '--upgrade', 'pip']);
  }
  if (spawnSync(python, ['-I', '-c', 'import torch'], { stdio: 'ignore' }).status !== 0 || !versionInstallee()) {
    console.log('\n2. torch (processeur seul) puis Laya');
    lancer(python, ['-m', 'pip', 'install', '-q', 'torch', '--index-url', 'https://download.pytorch.org/whl/cpu']);
    lancer(python, ['-m', 'pip', 'install', '-q', `laya==${VERSION}`]);
  }
  if (!poidsPresents()) {
    console.log('\n3. Poids du modèle multilingue (650 Mo)');
    lancer(
      python,
      ['-c', 'import laya; laya.load("convaiinnovations/laya", subfolder="multilingual", device="cpu")'],
      { env: { ...process.env, HF_HOME: cache } },
    );
  }
}

const version = versionInstallee();
if (!version) {
  console.log('\nLaya n’est pas installé. Relance avec --installer (≈ 2 Go de disque, réseau requis une seule fois).');
  process.exit(1);
}
console.log(`\nLaya ${version} est installé${version === VERSION ? '' : ` (la version mesurée ici est ${VERSION})`}.`);
if (!poidsPresents()) {
  console.log('Les poids du modèle multilingue manquent : relance avec --installer.');
  process.exit(1);
}
console.log('Poids du modèle multilingue présents : le démon le chargera à la première question, sans réseau.');

if (!essayer) {
  console.log('Relance avec --essayer pour lui poser une vraie question et mesurer sa réponse.');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Une vraie question, par le même service que le démon                */
/* ------------------------------------------------------------------ */

const question = {
  id: 1,
  state: 'Le site est en panne depuis ce matin : plus aucun client ne peut se connecter.',
  questions: {
    urgente: { type: 'noul', instructions: 'Cette demande presse-t-elle vraiment ?' },
    genre: {
      type: 'choice',
      instructions: 'Quel genre de travail ?',
      criteria: { programmation_avancee: 'code, serveur, bug', administratif: 'facture, courriel, sans code' },
    },
  },
};
const debut = Date.now();
const r = spawnSync(python, [service], {
  input: `${JSON.stringify(question)}\n`,
  encoding: 'utf8',
  timeout: 120_000,
  env: { ...process.env, HF_HOME: cache, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
});
const lignes = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
const reponse = lignes.find((l) => l.id === 1);
if (!reponse?.answers) {
  console.log('\nLaya n’a rendu aucune réponse lisible :');
  console.log((r.stderr || r.stdout || '').slice(-800));
  process.exit(1);
}
const { urgente, genre } = reponse.answers;
console.log(
  `Essai : urgente à ${Math.round(urgente.noul * 100)} %, genre « ${genre.choice} » à ${Math.round(genre.answer_confidence * 100)} %, ` +
    `en ${Date.now() - debut} ms chargement compris.`,
);
