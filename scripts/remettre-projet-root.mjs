#!/usr/bin/env node
/**
 * Remet le projet « Root » dans la colonne de gauche, sur un dossier de travail
 * qui ne dépend plus du dossier personnel d'un utilisateur.
 *
 * Constat : « Root » était déclaré sur `/home/paseo/rsd-work` — un dossier
 * personnel, exactement ce que la règle « rien du projet ne pointe vers le
 * dossier personnel d'un utilisateur » interdit (`CLAUDE.md`). Le dépôt de
 * travail a été déplacé sur `/root/root-storage-dashboard` ; la base, elle,
 * pointe encore sur l'ancien chemin, et le projet reste mis de côté
 * (`archived = 1`) depuis `scripts/retirer-projets-perimes.mjs`.
 *
 * Ce script écrit le NOUVEAU chemin (colonne `path` et champ `path` du JSON,
 * qui doivent rester d'accord) puis lève la mise de côté — exactement ce que
 * font « Modifier le projet » et « Remettre en service » dans les réglages.
 * Rien n'est supprimé, aucune carte ni conversation n'est touchée, aucun
 * fichier hors de la base n'est écrit.
 *
 * Garde-fou : le nouveau dossier doit exister ET être un dépôt git, sinon
 * `porteDuDepot` (`shared/src/branche-de-carte.ts`) refuserait toute carte
 * lancée là — on ne remet pas en service un projet qui ne pourrait pas
 * travailler.
 *
 * Rejouable : un projet déjà à jour est laissé tel quel.
 *
 *   node scripts/remettre-projet-root.mjs           # montre sans écrire
 *   node scripts/remettre-projet-root.mjs --ecrire  # applique
 *
 * La base visée est `HAIKODEV_DATA`, sinon le `data/` du dépôt d'où part le
 * script — lancé depuis une copie de travail, poser HAIKODEV_DATA=/root/haikodev/data.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Une copie de travail (`.worktrees/…`) n'installe pas les dépendances : on
// retombe alors sur celles du dossier principal, déduites de HAIKODEV_DATA.
function chargerSqlite() {
  const pistes = [path.join(racine, 'node_modules/better-sqlite3')];
  if (process.env.HAIKODEV_DATA) {
    pistes.push(path.join(path.dirname(process.env.HAIKODEV_DATA), 'node_modules/better-sqlite3'));
  }
  for (const piste of pistes) {
    if (fs.existsSync(piste)) return require(piste);
  }
  console.error(`ARRÊT : better-sqlite3 introuvable (cherché : ${pistes.join(', ')}).`);
  process.exit(1);
}
const Database = chargerSqlite();

const ECRIRE = process.argv.includes('--ecrire');
const DOSSIER_DONNEES = process.env.HAIKODEV_DATA ?? path.join(racine, 'data');
const BASE = path.join(DOSSIER_DONNEES, 'haikodev.db');

// L'identifiant sert de garde-fou : on ne touche qu'à CE projet-là, jamais à un
// homonyme.
const CIBLE = {
  nom: 'Root',
  id: '11130cfe-e143-4507-90a3-3f713d706dfc',
  ancienChemin: '/home/paseo/rsd-work',
  nouveauChemin: '/root/root-storage-dashboard',
};

if (!fs.existsSync(BASE)) {
  console.error(`ARRÊT : aucune base à ${BASE} — poser HAIKODEV_DATA sur le dossier data du démon.`);
  process.exit(1);
}

if (!fs.existsSync(path.join(CIBLE.nouveauChemin, '.git'))) {
  console.error(
    `ARRÊT : ${CIBLE.nouveauChemin} n'existe pas ou n'est pas un dépôt git — ` +
      'déplacer le dossier de travail avant de remettre le projet en service.',
  );
  process.exit(1);
}

const db = new Database(BASE);
const ligne = db.prepare('SELECT id, path, archived, data FROM projects WHERE id = ?').get(CIBLE.id);

if (!ligne) {
  console.error(`ARRÊT : ${CIBLE.nom} est absent de la base (${CIBLE.id}).`);
  db.close();
  process.exit(1);
}

const projet = JSON.parse(ligne.data);
const changements = [];
if (ligne.path !== CIBLE.nouveauChemin || projet.path !== CIBLE.nouveauChemin) {
  changements.push(`chemin : ${ligne.path} → ${CIBLE.nouveauChemin}`);
}
if (ligne.archived || projet.archived) {
  changements.push('mise de côté levée : le projet revient dans la colonne de gauche');
}

if (!changements.length) {
  console.log(`${CIBLE.nom} : déjà sur ${CIBLE.nouveauChemin} et en service — rien à faire.`);
} else {
  for (const c of changements) console.log(`${CIBLE.nom} : ${c}`);
  if (ECRIRE) {
    projet.path = CIBLE.nouveauChemin;
    projet.archived = false;
    projet.updatedAt = Date.now();
    db.prepare('UPDATE projects SET path = ?, archived = 0, data = ?, updated_at = ? WHERE id = ?').run(
      CIBLE.nouveauChemin,
      JSON.stringify(projet),
      projet.updatedAt,
      ligne.id,
    );
    console.log('\nAppliqué. Recharger la page pour le voir.');
  } else {
    console.log('\nRien écrit — relancer avec --ecrire pour appliquer.');
  }
}

db.close();
