#!/usr/bin/env node
/**
 * Repose l'environnement Python de la DICTÉE — celui que `voiceAvailable()`
 * cherche à `data/venv/bin/python`, et sans lequel `/api/transcribe` répond
 * « moteur de transcription absent du serveur » à chaque coup de micro.
 *
 * Cet environnement vit HORS du dépôt (il pèse plusieurs centaines de
 * mégaoctets) et n'avait, jusqu'ici, aucun script pour le poser : monté une
 * fois à la main, il a disparu sans que rien ne le dise. D'où ce fichier.
 *
 * Il porte les DEUX moteurs qui partagent ce venv :
 *   — `faster-whisper`, que `scripts/transcribe.py` appelle pour la dictée ;
 *   — `piper-tts`, dont le binaire `data/venv/bin/piper` fait parler le serveur.
 *
 * Sans danger à relancer : ce qui est déjà là n'est pas réinstallé.
 *
 *   node scripts/installer-transcription.mjs
 *   BELUGA_DATA=/root/beluga/data node scripts/installer-transcription.mjs
 *
 * Les VOIX Piper se posent à part (`scripts/installer-voix.mjs`), et les
 * modèles Whisper se téléchargent tout seuls au premier usage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DONNEES = process.env.BELUGA_DATA ?? path.join(RACINE, 'data');
const VENV = path.join(DONNEES, 'venv');
const PYTHON = path.join(VENV, 'bin', 'python');
const PIP = path.join(VENV, 'bin', 'pip');

/* 1. L'environnement lui-même. */
if (fs.existsSync(PYTHON)) {
  console.log('Environnement Python déjà en place.');
} else {
  process.stdout.write('Création de l’environnement Python… ');
  execFileSync('python3', ['-m', 'venv', VENV], { stdio: 'inherit' });
  console.log('fait');
}

/* 2. Les deux bibliothèques, chacune posée seulement si elle manque. */
for (const [module, paquet] of [
  ['faster_whisper', 'faster-whisper'],
  ['piper', 'piper-tts'],
]) {
  try {
    execFileSync(PYTHON, ['-c', `import ${module}`], { stdio: 'ignore' });
    console.log(`Bibliothèque ${paquet} déjà installée.`);
  } catch {
    process.stdout.write(`Installation de ${paquet}… `);
    execFileSync(PIP, ['install', '--quiet', paquet], { stdio: 'inherit' });
    console.log('fait');
  }
}

/* 3. On ne se déclare pas vert sans avoir vu la chaîne marcher. */
const script = path.join(RACINE, 'scripts', 'transcribe.py');
if (!fs.existsSync(script)) {
  console.error(`Manque ${script} : la dictée ne peut pas fonctionner.`);
  process.exit(1);
}
if (!fs.existsSync(path.join(VENV, 'bin', 'piper'))) {
  console.error('Le binaire piper n’a pas été posé : la voix restera muette.');
  process.exit(1);
}

console.log('\nMoteur de dictée en place. À vérifier :');
console.log('  node scripts/verif-dictee-bout-en-bout.mjs');
