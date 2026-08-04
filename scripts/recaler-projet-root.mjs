#!/usr/bin/env node
/**
 * Le projet Root pointe sur son VRAI dépôt.
 *
 * Constat : Root était déclaré sur `/var/www/root-storage-dashboard`, le dossier
 * SERVI — une copie publiée, qui n'est pas un dépôt git. Un agent lancé là n'a
 * pas de mémoire à lire, ne peut rien enregistrer et ne peut rien prouver : la
 * carte se termine sans qu'une ligne ait bougé. Le code de travail vit dans
 * `/home/paseo/rsd-work` (`api.py` + `index.html`, distant sur GitHub).
 *
 * Ce script recale le chemin déclaré et pose la commande de publication du
 * projet (`./publier.sh --ecrire`), sans laquelle publier serait REFUSÉ : le
 * nouveau dossier n'est servi par aucun serveur web et aucun service système ne
 * tourne dessus. Il ne touche NI au dossier publié, NI au contenu en ligne.
 *
 *   node scripts/recaler-projet-root.mjs           # montre sans écrire
 *   node scripts/recaler-projet-root.mjs --ecrire  # applique
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = require(path.join(racine, 'node_modules/better-sqlite3'));

const ECRIRE = process.argv.includes('--ecrire');
const NOM = 'Root';
const DEPOT = '/home/paseo/rsd-work';
const COMMANDE = './publier.sh --ecrire';
const DISTANT = 'git@github.com:haikostudio/root-storage-dashboard.git';

if (!fs.existsSync(path.join(DEPOT, '.git'))) {
  console.error(`ARRÊT : ${DEPOT} n'est pas un dépôt git — rien à recaler.`);
  process.exit(1);
}

const db = new Database(path.join(racine, 'data/haikodev.db'));
const ligne = db.prepare('SELECT id, data FROM projects WHERE name = ?').get(NOM);
if (!ligne) {
  console.error(`ARRÊT : aucun projet nommé « ${NOM} ».`);
  process.exit(1);
}

const projet = JSON.parse(ligne.data);
const avant = { path: projet.path, deployCommand: projet.deployCommand, gitRemote: projet.gitRemote };

projet.path = DEPOT;
projet.deployCommand = projet.deployCommand?.trim() || COMMANDE;
projet.gitRemote = projet.gitRemote || DISTANT;
projet.gitBranch = 'main';
projet.updatedAt = Date.now();

console.log(`dossier            ${avant.path} → ${projet.path}`);
console.log(`commande de publi. ${avant.deployCommand ?? '(aucune)'} → ${projet.deployCommand}`);
console.log(`dépôt distant      ${avant.gitRemote ?? '(aucun)'} → ${projet.gitRemote}`);

if (ECRIRE) {
  db.prepare('UPDATE projects SET path = ?, data = ?, updated_at = ? WHERE id = ?').run(
    projet.path,
    JSON.stringify(projet),
    projet.updatedAt,
    ligne.id,
  );
  console.log('\nÉcrit.');
} else {
  console.log('\nRien écrit — relancer avec --ecrire pour appliquer.');
}
db.close();
