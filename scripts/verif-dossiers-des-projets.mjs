#!/usr/bin/env node
/*
 * CHAQUE PROJET DÉCLARÉ A-T-IL ENCORE SON DOSSIER, ET EST-CE UN DÉPÔT ?
 *
 * Constat qui a produit ce contrôle : les dossiers des projets vivent sur un
 * stockage distant monté sur la machine. Ce montage est tombé, et DIX-NEUF
 * projets d'un coup sont devenus injoignables — sans que rien ne le dise. Le
 * seul signe visible était, sur une carte qu'on tentait de lancer, la phrase
 * « ce projet n'est pas déclaré sur un dépôt git » : elle envoyait chercher un
 * réglage qui n'avait jamais bougé.
 *
 * Le contrôle lit la base, prend le chemin de chaque projet NON archivé et
 * demande son état réel au démon (`etatDuDossierDuProjet`, la fonction que la
 * porte du dépôt utilise elle-même — on teste ce qui tourne, pas une copie).
 *
 * Sortie 0 : tous les dossiers répondent et sont des dépôts.
 * Sortie 1 : au moins un est injoignable ou n'est pas un dépôt — la liste est
 * donnée, cause par cause.
 *
 * AUCUN moteur n'est appelé, rien n'est modifié : le contrôle ne fait que lire.
 * Il vise le dépôt d'où il PART, et charge `server/dist` de ce dépôt-là :
 * construire avant de lancer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const ici = path.dirname(fileURLToPath(import.meta.url));
const depot = path.resolve(ici, '..');

const dist = path.join(depot, 'server', 'dist', 'scheduler.js');
if (!fs.existsSync(dist)) {
  console.error(`✗ ${path.relative(depot, dist)} manque : lancer « npm run build:server » d'abord.`);
  process.exit(1);
}

const { etatDuDossierDuProjet } = await import(pathToFileURL(dist).href);

// La base du démon vit dans le dépôt PRINCIPAL, pas dans une copie de travail :
// une copie de carte n'a pas de `data/`. On remonte donc au dépôt d'origine.
const basesPossibles = [
  process.env.BELUGA_DB,
  path.join(depot, 'data', 'beluga.db'),
  cheminDeLaBaseServie(),
].filter(Boolean);
const { default: Database } = await import('better-sqlite3');

// Une copie de travail de carte porte un `data/beluga.db` VIDE, créé au
// passage des tests : prendre la première base existante y ferait conclure
// « aucun projet ». On retient donc la première base qui a VRAIMENT des projets.
function lireProjets(chemin) {
  try {
    const db = new Database(chemin, { readonly: true });
    const lignes = db
      .prepare('select id, name, path from projects where archived = 0 order by name')
      .all();
    db.close();
    return lignes;
  } catch {
    return [];
  }
}

let projets = [];
let base = null;
for (const candidat of basesPossibles) {
  if (!fs.existsSync(candidat)) continue;
  const lignes = lireProjets(candidat);
  if (lignes.length) {
    base = candidat;
    projets = lignes;
    break;
  }
}

if (!base) {
  console.error(
    '✗ aucune base du démon avec des projets : passer son chemin par BELUGA_DB.',
  );
  process.exit(1);
}

console.log(`Base lue : ${base} — ${projets.length} projet(s) actif(s).`);

const injoignables = [];
const sansDepot = [];

for (const projet of projets) {
  const etat = await etatDuDossierDuProjet(projet.path);
  if (etat === 'depot') {
    console.log(`  ok          ${projet.name} — ${projet.path}`);
  } else if (etat === 'injoignable') {
    injoignables.push(projet);
    console.log(`  INJOIGNABLE ${projet.name} — ${projet.path}`);
  } else {
    sansDepot.push(projet);
    console.log(`  SANS DÉPÔT  ${projet.name} — ${projet.path}`);
  }
}

console.log('');
if (injoignables.length) {
  console.log(
    `✗ ${injoignables.length} dossier(s) injoignable(s) : le disque ou le montage distant qui les porte ne répond pas.`,
  );
  console.log('  Les dépôts sont intacts — c\'est l\'accès depuis cette machine qui est tombé.');
}
if (sansDepot.length) {
  console.log(`✗ ${sansDepot.length} projet(s) déclaré(s) sur un dossier qui n'est pas un dépôt git.`);
  console.log('  Aucune carte ne peut y être lancée : déclarer le projet sur son dépôt de travail.');
}

if (!injoignables.length && !sansDepot.length) {
  console.log(`✓ ${projets.length} projet(s) : tous les dossiers répondent et sont des dépôts git.`);
  process.exit(0);
}
process.exit(1);
