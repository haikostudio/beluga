#!/usr/bin/env node
/**
 * LA DICTÉE, DE LA VOIX AU TEXTE, PAR LE VRAI POINT DU SERVEUR.
 *
 * Tous les contrôles de micro qui existaient jugeaient l'ÉCRAN avec un micro
 * FACTICE et une transcription INTERCEPTÉE : aucun ne touchait `/api/transcribe`.
 * Le jour où l'environnement Python de la dictée a disparu du serveur, tous
 * sont restés verts pendant que le micro était mort — et l'écran, lui, disait
 * « connexion trop faible ».
 *
 * Ce contrôle ferme ce trou : il fabrique une phrase avec les voix Piper du
 * projet, la POSTE au démon comme le ferait le bouton micro, et exige un texte
 * en retour. Un refus du serveur est REPRIS TEL QUEL — c'est justement la
 * raison qu'on veut lire.
 *
 *   node scripts/verif-dictee-bout-en-bout.mjs
 *   HAIKO_DICTEE_URL=http://127.0.0.1:7070 node scripts/verif-dictee-bout-en-bout.mjs
 *
 * La session d'essai est fabriquée en base (jeton HACHÉ) puis RETIRÉE ;
 * `BELUGA_URL`, qui désigne l'application publiée, n'est jamais repris.
 * Piper et le moteur de transcription vivent hors dépôt : absents, le contrôle
 * ne se déclare pas vert, il DIT ce qui manque (`node scripts/installer-transcription.mjs`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';
const BASE = process.env.HAIKO_DICTEE_URL || 'http://127.0.0.1:7070';
const DB = process.env.BELUGA_DB || path.join(DONNEES, 'beluga.db');

const PYTHON = path.join(DONNEES, 'venv', 'bin', 'python');
const PIPER = path.join(DONNEES, 'venv', 'bin', 'piper');
const VOIX = path.join(DONNEES, 'models', 'piper', 'fr_FR-siwis-medium.onnx');
const TRANSCRIRE = path.join(RACINE, 'scripts', 'transcribe.py');

const PHRASE = 'Bonjour, ceci est un essai de dictée.';
/** Des mots que la transcription doit rendre, quelle que soit sa ponctuation. */
const ATTENDUS = ['bonjour', 'essai'];

function manque(quoi) {
  console.error(`MANQUE : ${quoi}`);
  console.error('Poser le moteur : node scripts/installer-transcription.mjs');
  process.exit(2);
}

for (const [chemin, nom] of [
  [PYTHON, 'l’environnement Python de la dictée (data/venv)'],
  [PIPER, 'le binaire piper (data/venv/bin/piper)'],
  [VOIX, 'la voix Piper fr_FR-siwis-medium'],
  [TRANSCRIRE, 'scripts/transcribe.py'],
]) {
  if (!fs.existsSync(chemin)) manque(nom);
}

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-dictee-'));
const son = path.join(dossier, 'phrase.wav');
let db;
let empreinte;
let code = 0;

try {
  /* 1. De la vraie parole, dite par le projet lui-même. */
  execFileSync(PIPER, ['-m', VOIX, '-f', son], { input: PHRASE, stdio: ['pipe', 'ignore', 'inherit'] });
  if (!fs.existsSync(son) || fs.statSync(son).size < 1000) throw new Error('Piper n’a produit aucun son.');
  console.log(`Parole fabriquée (${Math.round(fs.statSync(son).size / 1024)} ko).`);

  /* 2. Le moteur, appelé seul : on sait ainsi si c'est lui ou le serveur. */
  const horsServeur = execFileSync(PYTHON, [TRANSCRIRE, son], { encoding: 'utf8' }).trim();
  console.log(`Moteur seul : « ${horsServeur} »`);
  if (!horsServeur) throw new Error('Le moteur de transcription n’a rien rendu.');

  /* 3. Le VRAI point du serveur, atteint comme le fait le bouton micro. */
  db = new Database(DB);
  const cookie = crypto.randomBytes(24).toString('hex');
  empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    Date.now(),
    Date.now() + 3600_000,
    'vérification dictée bout en bout',
  );

  const reponse = await fetch(`${BASE}/api/transcribe`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-audio-ext': 'wav',
      cookie: `beluga_session=${cookie}`,
    },
    body: fs.readFileSync(son),
  });
  const data = await reponse.json().catch(() => ({}));

  if (!reponse.ok || !data.ok) {
    throw new Error(`Le serveur refuse la dictée (${reponse.status}) : ${data.error ?? 'sans raison donnée'}`);
  }
  const texte = String(data.text ?? '').toLowerCase();
  console.log(`Par le serveur : « ${data.text} »`);
  const oublies = ATTENDUS.filter((mot) => !texte.includes(mot));
  if (oublies.length) throw new Error(`Mots absents de la transcription : ${oublies.join(', ')}`);

  console.log('\nVERT — la dictée va du micro au texte, par le vrai point du serveur.');
} catch (err) {
  console.error(`\nROUGE — ${err.message}`);
  code = 1;
} finally {
  if (db && empreinte) {
    try {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    } catch {
      /* la session d'essai s'éteindra d'elle-même dans l'heure */
    }
  }
  fs.rmSync(dossier, { recursive: true, force: true });
}

process.exit(code);
