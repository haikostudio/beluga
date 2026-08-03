#!/usr/bin/env node
/**
 * Installe les voix du point du jour.
 *
 * Les fichiers de voix pèsent plusieurs dizaines de mégaoctets : ils vivent
 * dans `data/`, hors du dépôt. Sans ce script, une nouvelle installation
 * n'aurait qu'une seule voix — ou aucune. Il est SANS DANGER à relancer : une
 * voix déjà présente n'est pas retéléchargée.
 *
 * Chaque voix listée ici a été écoutée avant d'être retenue : les modèles qui
 * bafouillent ou avalent les nombres ont été écartés, ils ne sont pas ici.
 *
 *   node scripts/installer-voix.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIER = path.join(process.env.HAIKODEV_DATA ?? path.join(RACINE, 'data'), 'models', 'piper');
const SOURCE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR';

/** Les voix retenues, et le chemin de leur modèle chez l'hébergeur. */
const VOIX = [
  { nom: 'fr_FR-siwis-medium', chemin: 'siwis/medium', dit: 'Claire — voix de femme, posée et nette' },
  { nom: 'fr_FR-tom-medium', chemin: 'tom/medium', dit: 'Thomas — voix d\'homme, chaleureuse' },
  { nom: 'fr_FR-upmc-medium', chemin: 'upmc/medium', dit: 'Pierre et Jessica — deux voix dans un seul fichier' },
];

async function telecharger(url, destination) {
  const reponse = await fetch(url);
  if (!reponse.ok) throw new Error(`${reponse.status} sur ${url}`);
  // On écrit à côté puis on renomme : une coupure de réseau ne laisse jamais
  // un fichier à moitié écrit que le serveur croirait valable.
  const provisoire = `${destination}.en-cours`;
  fs.writeFileSync(provisoire, Buffer.from(await reponse.arrayBuffer()));
  fs.renameSync(provisoire, destination);
}

fs.mkdirSync(DOSSIER, { recursive: true });

for (const voix of VOIX) {
  for (const extension of ['onnx', 'onnx.json']) {
    const destination = path.join(DOSSIER, `${voix.nom}.${extension}`);
    if (fs.existsSync(destination)) continue;
    process.stdout.write(`Téléchargement de ${voix.nom}.${extension}… `);
    try {
      await telecharger(`${SOURCE}/${voix.chemin}/${voix.nom}.${extension}`, destination);
      console.log('fait');
    } catch (err) {
      console.log(`échec : ${err.message}`);
    }
  }
}

console.log('\nVoix disponibles :');
for (const voix of VOIX) {
  const present = fs.existsSync(path.join(DOSSIER, `${voix.nom}.onnx`));
  console.log(`  ${present ? '✓' : '✗'} ${voix.dit}`);
}
console.log('\nLe choix se fait dans Réglages, section « La voix du point du jour ».');
