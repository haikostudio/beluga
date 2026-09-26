#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/* ÉMONDER `dist/` AVANT DE CONSTRUIRE                                 */
/*                                                                     */
/* `tsc` ÉCRIT dans `dist/`, il n'en RETIRE jamais rien. Quand une      */
/* source disparaît — un test retiré exprès, un module fusionné        */
/* ailleurs — son fichier compilé, lui, RESTE. Et comme `npm test`     */
/* balaie `server/dist/test/*.test.js`, ce fantôme continue d'être     */
/* joué : il appelle une fonction qui n'existe plus et fait tomber     */
/* toute la publication, alors que le dépôt, lui, est juste.           */
/*                                                                     */
/* `dist/` étant hors dépôt, le fantôme ne se voit sur AUCUNE machine  */
/* neuve : il ne hante que les dossiers qui ont construit l'ancienne   */
/* version. D'où la règle : avant chaque construction, tout ce que     */
/* `dist/` porte et que `src/` ne justifie plus est retiré.            */
/*                                                                     */
/*   node scripts/emonder-dist.mjs <espace> [<espace>…]                */
/* ------------------------------------------------------------------ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt est celui d'où PART ce script, jamais un chemin personnel. */
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Ce que `tsc` produit, et rien d'autre : un fichier d'une autre      */
/* extension a été posé là par une autre main, on n'y touche pas.      */
const PRODUITS = ['.js.map', '.d.ts.map', '.d.ts', '.js', '.json'];

/** Le fichier compilé `relatif` a-t-il encore une source dans `src/` ? */
export function sourceExiste(src, relatif) {
  const produit = PRODUITS.find((p) => relatif.endsWith(p));
  if (!produit) return true; /* pas une sortie de tsc : on le laisse. */
  const tronc = relatif.slice(0, -produit.length);
  /* Un `.json` est COPIÉ tel quel ; le reste vient d'un `.ts`/`.tsx`. */
  const candidats = produit === '.json' ? ['.json'] : ['.ts', '.tsx', '.json'];
  return candidats.some((ext) => fs.existsSync(path.join(src, tronc + ext)));
}

/** Liste les fichiers de `dist/` que plus aucune source ne justifie. */
export function orphelins(dist, src) {
  if (!fs.existsSync(dist) || !fs.existsSync(src)) return [];
  const trouves = [];
  const descendre = (relatif) => {
    for (const entree of fs.readdirSync(path.join(dist, relatif), { withFileTypes: true })) {
      const suivant = relatif ? path.join(relatif, entree.name) : entree.name;
      if (entree.isDirectory()) descendre(suivant);
      else if (entree.isFile() && !sourceExiste(src, suivant)) trouves.push(suivant);
    }
  };
  descendre('');
  return trouves.sort();
}

/** Retire les orphelins de `dist/`, puis les dossiers restés vides. */
export function emonder(espace) {
  const dist = path.join(espace, 'dist');
  const src = path.join(espace, 'src');
  const retires = orphelins(dist, src);
  for (const relatif of retires) fs.rmSync(path.join(dist, relatif), { force: true });
  viderDossiers(dist);
  return retires;
}

function viderDossiers(dossier) {
  if (!fs.existsSync(dossier)) return;
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (!entree.isDirectory()) continue;
    const chemin = path.join(dossier, entree.name);
    viderDossiers(chemin);
    if (fs.readdirSync(chemin).length === 0) fs.rmdirSync(chemin);
  }
}

/* Lancé en commande : émonde chaque espace nommé et DIT ce qu'il retire. */
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const espaces = process.argv.slice(2);
  if (espaces.length === 0) {
    console.error('Usage : node scripts/emonder-dist.mjs <espace> [<espace>…]');
    process.exit(1);
  }
  for (const nom of espaces) {
    const espace = path.isAbsolute(nom) ? nom : path.join(racine, nom);
    for (const relatif of emonder(espace)) {
      console.log(`émondé  ${path.relative(racine, path.join(espace, 'dist', relatif))}`);
    }
  }
}
