#!/usr/bin/env node
/**
 * LA PERTINENCE DE LA RECHERCHE DANS LA MÉMOIRE, MESURÉE SUR DES CAS RÉELS.
 *
 * `scripts/cas-tests-memoire.json` associe une demande PARAPHRASÉE (des mots
 * différents de ceux de l'unité visée) à l'identifiant qu'elle doit retrouver.
 * Le script rejoue chaque cas sur une COPIE de la base réellement servie (rien
 * n'y est jamais écrit) et donne le rang où l'unité attendue ressort, pour
 * `chercherUnitesMelees` (mots + sens) et pour la recherche par les mots seuls,
 * afin de voir ce que le sens apporte vraiment.
 *
 *   node scripts/mesure-pertinence-memoire.mjs
 *   node scripts/mesure-pertinence-memoire.mjs --data /un/dossier/deja/copie
 *
 * Le script échoue si le taux de bonnes réponses dans les 5 premiers résultats
 * descend sous SEUIL_MIN_TOP5 : un réglage futur qui ferait régresser la
 * pertinence mesurée ici le saurait tout de suite, au lieu de le découvrir à
 * l'usage.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cheminDeLaBaseServie, dossierDesDonnees } from './lib/base-servie.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJET_BELUGA = '90b65dcb-5139-460a-998d-a93cec9230e1';
const SEUIL_MIN_TOP5 = 0.6;

const CAS = JSON.parse(fs.readFileSync(path.join(RACINE, 'scripts/cas-tests-memoire.json'), 'utf8'));

const i = process.argv.indexOf('--data');
const dejaCopie = i >= 0 ? process.argv[i + 1] : null;

let JETABLE = dejaCopie;
let source = dejaCopie;
if (!dejaCopie) {
  source = cheminDeLaBaseServie();
  if (!fs.existsSync(source)) {
    console.error(`Base servie introuvable : ${source}`);
    process.exit(1);
  }
  JETABLE = fs.mkdtempSync(path.join(os.tmpdir(), 'mesure-pertinence-'));
  execFileSync('sqlite3', [source, `.backup ${path.join(JETABLE, 'beluga.db')}`]);
  const vectoriseur = path.join(dossierDesDonnees(), 'vectoriseur');
  if (fs.existsSync(vectoriseur)) fs.symlinkSync(vectoriseur, path.join(JETABLE, 'vectoriseur'));
}
process.env.BELUGA_DATA = JETABLE;

const k = await import(path.join(RACINE, 'server/dist/connaissances.js'));

function rang(resultats, attendu) {
  const i = resultats.findIndex((r) => attendu.includes(r.unite.id));
  return i < 0 ? null : i + 1;
}

async function mesurer(nom, chercher) {
  let sommeRangsTrouves = 0;
  let trouves = 0;
  let top3 = 0;
  let top5 = 0;
  const manques = [];
  for (const cas of CAS) {
    const resultats = await chercher(cas.demande);
    const r = rang(resultats, cas.attendu);
    if (r === null) {
      manques.push(cas);
      continue;
    }
    trouves++;
    sommeRangsTrouves += r;
    if (r <= 3) top3++;
    if (r <= 5) top5++;
  }
  const n = CAS.length;
  console.log(
    `${nom} : ${trouves}/${n} retrouvée(s) dans les 20 premiers, ${top5}/${n} dans les 5 premiers (${top3}/${n} dans les 3 premiers), rang moyen des trouvées ${trouves ? (sommeRangsTrouves / trouves).toFixed(1) : '—'}.`,
  );
  for (const m of manques.slice(0, 5)) console.log(`  manqué : « ${m.demande} » → ${m.attendu.join(', ')}`);
  return { top5: top5 / n };
}

console.log(`${CAS.length} cas-tests, sur une copie de ${source}.\n`);
await mesurer('Mots seuls', async (texte) => k.chercherUnites(texte, { projectId: PROJET_BELUGA, limite: 20 }));
const melee = await mesurer('Mots + sens', async (texte) => k.chercherUnitesMelees(texte, { projectId: PROJET_BELUGA, limite: 20 }));

if (!dejaCopie) fs.rmSync(JETABLE, { recursive: true, force: true });

if (melee.top5 < SEUIL_MIN_TOP5) {
  console.error(`\nÉCHEC : taux dans les 5 premiers de ${(melee.top5 * 100).toFixed(0)} %, sous le seuil de ${(SEUIL_MIN_TOP5 * 100).toFixed(0)} %.`);
  process.exit(1);
}
console.log(`\nOK : taux dans les 5 premiers de ${(melee.top5 * 100).toFixed(0)} %, au-dessus du seuil de ${(SEUIL_MIN_TOP5 * 100).toFixed(0)} %.`);
