#!/usr/bin/env node
/**
 * Les deux moteurs de voix parlent-ils, chacun de son côté, sans se marcher
 * dessus ?
 *
 * On passe par le VRAI code du serveur (`server/dist/voice.js`), pas par une
 * imitation : la liste des voix, la résolution d'un identifiant, la fabrication
 * du son et le cache sont exactement ceux que le démon emploie.
 *
 *   HAIKODEV_DATA=/root/haikodev/data node scripts/verif-voix-kokoro.mjs
 *
 * Le dossier de données doit être celui qui porte les modèles : dans une copie
 * de travail, `data/models` n'est qu'un renvoi vers le dossier principal, et
 * l'environnement Python des moteurs n'y est pas.
 *
 * Aucun son n'est joué : la qualité à l'oreille se juge à l'écoute, pas ici.
 * Ce contrôle dit seulement que chaque moteur rend un fichier, et que les deux
 * ne se partagent jamais le même.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// La racine se déduit du script lui-même : lancé depuis une copie de travail, il
// doit juger CE dépôt, jamais le dossier principal.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

console.log(`Dépôt jugé : ${RACINE}`);

const voice = await import(path.join(RACINE, 'server', 'dist', 'voice.js'));
const { listVoices, voiceChoisie, cleDuSon, speak, EXTRAIT } = voice;

/* 1. Les deux moteurs dans la MÊME liste, sous des noms lisibles. */
const voix = listVoices();
const kokoro = voix.filter((v) => v.id.startsWith('kokoro:'));
const piper = voix.filter((v) => !v.id.startsWith('kokoro:'));
console.log(`\nVoix proposées : ${voix.map((v) => `${v.label} (${v.id})`).join(', ')}\n`);

noter('les voix Piper sont toujours là', piper.length >= 4, `${piper.length} voix`);
noter('la voix par défaut ouvre la liste', voix[0]?.id === 'fr_FR-siwis-medium', voix[0]?.id ?? 'aucune');
noter('au moins une voix Kokoro est proposée', kokoro.length >= 1, `${kokoro.length} voix`);
noter(
  'aucun nom technique affiché',
  voix.every((v) => v.label.trim() && !/fr_FR|onnx|medium|_/.test(v.label)),
);

/* 2. Chaque identifiant mène au bon moteur, et l'inconnu retombe sur Piper. */
noter('une voix Piper est résolue en Piper', voiceChoisie('fr_FR-tom-medium').moteur === 'piper');
noter(
  'une voix Kokoro est résolue en Kokoro',
  kokoro.length ? voiceChoisie(kokoro[0].id).moteur === 'kokoro' : false,
);
noter('la voix par défaut reste Piper', voiceChoisie(undefined).moteur === 'piper');
noter('une voix Kokoro inconnue retombe sur Piper', voiceChoisie('kokoro:inexistante').moteur === 'piper');

/* 3. L'empreinte du cache tient compte du moteur, de la voix et de la vitesse. */
const commun = { modele: '/modele.onnx' };
const empreintePiper = cleDuSon({ ...commun, moteur: 'piper' }, EXTRAIT, 1);
const empreinteKokoro = cleDuSon({ ...commun, moteur: 'kokoro', voix: 'ff_siwis' }, EXTRAIT, 1);
noter('deux moteurs, deux empreintes', empreintePiper !== empreinteKokoro);
noter(
  'deux vitesses, deux empreintes',
  empreinteKokoro !== cleDuSon({ ...commun, moteur: 'kokoro', voix: 'ff_siwis' }, EXTRAIT, 1.25),
);

/* 4. Les deux moteurs fabriquent réellement un son, et le cache le garde. */
const depart = Date.now();
const sonKokoro = kokoro.length ? await speak(EXTRAIT, kokoro[0].id) : { ok: false, error: 'aucune voix Kokoro' };
const premier = Date.now() - depart;
noter('Kokoro rend un fichier', Boolean(sonKokoro.ok && sonKokoro.file), sonKokoro.error ?? `${premier} ms`);

const reprise = Date.now();
const encore = kokoro.length ? await speak(EXTRAIT, kokoro[0].id) : { file: null };
noter(
  'un texte réécouté ne relance pas la synthèse',
  Boolean(encore.file) && encore.file === sonKokoro.file && Date.now() - reprise < 200,
  `${Date.now() - reprise} ms`,
);

const sonPiper = await speak(EXTRAIT, 'fr_FR-siwis-medium');
noter('Piper rend toujours un fichier', Boolean(sonPiper.ok && sonPiper.file), sonPiper.error ?? '');
noter(
  'changer de moteur produit un autre fichier de cache',
  Boolean(sonPiper.file && sonKokoro.file) && sonPiper.file !== sonKokoro.file,
);

if (sonKokoro.file && fs.existsSync(sonKokoro.file)) {
  const taille = fs.statSync(sonKokoro.file).size;
  noter('le son de Kokoro n’est pas vide', taille > 10_000, `${Math.round(taille / 1024)} ko`);
}

const tombes = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - tombes.length}/${resultats.length} contrôles passés.`);
process.exit(tombes.length ? 1 : 0);
