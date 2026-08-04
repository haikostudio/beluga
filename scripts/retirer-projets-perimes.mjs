#!/usr/bin/env node
/**
 * Retire de la colonne de gauche les deux projets hérités de l'ancien Paseo.
 *
 * Constat : « paseo » est déclaré sur un dossier qui n'existe plus — toute
 * carte lancée là échouerait à `porteDuDepot` (`shared/src/branche-de-carte.ts`),
 * qui refuse un projet sans dépôt git. « Root » est déclaré sur le dépôt de
 * travail du même ancien projet. Les deux étant marqués non archivés, ils
 * s'affichent encore dans la colonne de gauche.
 *
 * Ce script les MET DE CÔTÉ (`archived = 1`), exactement comme le bouton
 * « Mettre de côté » des réglages d'un projet (`project.archive`, `ws.ts`) :
 * rien n'est supprimé, ni le projet, ni ses cartes, ni ses conversations, et un
 * clic sur « Remettre en service » les rend à la liste. Aucun fichier hors du
 * dépôt HaikoDev n'est touché, ni les dépôts GitHub correspondants.
 *
 * Rejouable : un projet déjà mis de côté est laissé tel quel.
 *
 *   node scripts/retirer-projets-perimes.mjs           # montre sans écrire
 *   node scripts/retirer-projets-perimes.mjs --ecrire  # applique
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

// L'identifiant sert de garde-fou : on ne met de côté que CES projets-là, et
// jamais un futur homonyme.
const A_RETIRER = [
  { nom: 'paseo', id: 'cc112bcc-53b4-451b-9c02-c47037166258' },
  { nom: 'Root', id: '11130cfe-e143-4507-90a3-3f713d706dfc' },
];

if (!fs.existsSync(BASE)) {
  console.error(`ARRÊT : aucune base à ${BASE} — poser HAIKODEV_DATA sur le dossier data du démon.`);
  process.exit(1);
}

const db = new Database(BASE);
let aEcrire = 0;

for (const cible of A_RETIRER) {
  const ligne = db.prepare('SELECT id, archived, data FROM projects WHERE id = ?').get(cible.id);
  if (!ligne) {
    console.log(`${cible.nom.padEnd(6)} : absent de la base — rien à faire.`);
    continue;
  }
  if (ligne.archived) {
    console.log(`${cible.nom.padEnd(6)} : déjà mis de côté — rien à faire.`);
    continue;
  }

  const cartes = db
    .prepare('SELECT column_key, title FROM cards WHERE project_id = ? ORDER BY column_key')
    .all(ligne.id);
  const enCours = cartes.filter((c) => c.column_key !== 'archived');
  console.log(`${cible.nom.padEnd(6)} : à mettre de côté — ${cartes.length} carte(s), dont ${enCours.length} hors archive.`);
  for (const c of enCours) console.log(`         [${c.column_key}] ${c.title}`);

  if (ECRIRE) {
    const projet = JSON.parse(ligne.data);
    projet.archived = true;
    projet.updatedAt = Date.now();
    db.prepare('UPDATE projects SET archived = 1, data = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(projet),
      projet.updatedAt,
      ligne.id,
    );
  }
  aEcrire += 1;
}

if (!aEcrire) console.log('\nRien à changer.');
else if (ECRIRE) console.log(`\n${aEcrire} projet(s) mis de côté. Recharger la page pour le voir.`);
else console.log(`\n${aEcrire} projet(s) seraient mis de côté — relancer avec --ecrire.`);

db.close();
