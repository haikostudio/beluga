#!/usr/bin/env node
/**
 * Installe le second moteur de voix, Kokoro, À CÔTÉ de Piper.
 *
 * Kokoro n'a ni « medium » ni « high » : c'est UN modèle unique, multilingue,
 * accompagné d'un fichier qui porte toutes ses voix. Les deux pèsent ensemble
 * plus de trois cents mégaoctets : ils vivent dans `data/models/kokoro`, hors du
 * dépôt, comme les voix Piper.
 *
 * Le moteur a son PROPRE environnement Python (`data/venv-kokoro`) : celui de
 * Piper n'est pas touché, donc rien de ce qui parle aujourd'hui ne peut casser.
 *
 * Sans danger à relancer : ce qui est déjà là n'est ni retéléchargé ni réinstallé.
 *
 *   node scripts/installer-kokoro.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DONNEES = process.env.BELUGA_DATA ?? path.join(RACINE, 'data');
const VENV = path.join(DONNEES, 'venv-kokoro');
const DOSSIER = path.join(DONNEES, 'models', 'kokoro');
const SOURCE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0';

/** Les deux fichiers du moteur : le modèle, et le sac de toutes ses voix. */
const FICHIERS = ['kokoro-v1.0.onnx', 'voices-v1.0.bin'];

async function telecharger(url, destination) {
  const reponse = await fetch(url);
  if (!reponse.ok) throw new Error(`${reponse.status} sur ${url}`);
  // On écrit à côté puis on renomme : une coupure de réseau ne laisse jamais un
  // fichier à moitié écrit que le serveur croirait valable.
  const provisoire = `${destination}.en-cours`;
  fs.writeFileSync(provisoire, Buffer.from(await reponse.arrayBuffer()));
  fs.renameSync(provisoire, destination);
}

/* 1. L'environnement Python du moteur, et la bibliothèque qui le fait tourner. */
if (fs.existsSync(path.join(VENV, 'bin', 'python'))) {
  console.log('Environnement Python déjà en place.');
} else {
  process.stdout.write('Création de l’environnement Python… ');
  execFileSync('python3', ['-m', 'venv', VENV], { stdio: 'inherit' });
  console.log('fait');
}

const pip = path.join(VENV, 'bin', 'pip');
try {
  execFileSync(path.join(VENV, 'bin', 'python'), ['-c', 'import kokoro_onnx'], { stdio: 'ignore' });
  console.log('Bibliothèque kokoro-onnx déjà installée.');
} catch {
  process.stdout.write('Installation de kokoro-onnx… ');
  // `espeakng-loader`, tiré par kokoro-onnx, apporte lui-même le prononciateur :
  // rien à installer sur le système.
  execFileSync(pip, ['install', '--quiet', 'kokoro-onnx'], { stdio: 'inherit' });
  console.log('fait');
}

/* 2. Le modèle et ses voix. */
fs.mkdirSync(DOSSIER, { recursive: true });
for (const nom of FICHIERS) {
  const destination = path.join(DOSSIER, nom);
  if (fs.existsSync(destination)) continue;
  process.stdout.write(`Téléchargement de ${nom}… `);
  try {
    await telecharger(`${SOURCE}/${nom}`, destination);
    console.log('fait');
  } catch (err) {
    console.log(`échec : ${err.message}`);
  }
}

const complet = FICHIERS.every((nom) => fs.existsSync(path.join(DOSSIER, nom)));
console.log(`\n${complet ? '✓' : '✗'} Moteur Kokoro ${complet ? 'prêt' : 'incomplet'}.`);
console.log('Une seule voix française existe dans ce moteur : « Camille ».');
console.log('Le choix se fait dans Réglages, section « La voix du point du jour ».');
