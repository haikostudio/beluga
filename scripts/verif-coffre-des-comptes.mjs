#!/usr/bin/env node
/**
 * LE COFFRE DE CHAQUE COMPTE CLAUDE TIENT-IL DEBOUT ?
 *
 * Un coffre de compte de relève partage ses dossiers avec le compte principal
 * par des liens symboliques ABSOLUS. Le jour où le dossier personnel déménage
 * (compte système renommé), ces liens meurent — et `tasks` avec eux. Le moteur
 * n'écrit alors plus sa liste de tâches (« ENOENT … /.lock » à chaque appel de
 * `TaskCreate`) et les TROIS affichages d'avancement s'éteignent en silence :
 * le volet au-dessus de la barre d'écriture, le pourcentage en tête de la
 * colonne « En cours » et celui de la ligne du projet.
 *
 * Ce contrôle ne lit que le disque : aucun moteur appelé, aucun jeton dépensé.
 *
 *   node scripts/verif-coffre-des-comptes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const BASE = process.env.HAIKODEV_DB || path.join('/root/haikodev/data', 'haikodev.db');

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

console.log(`Racine jugée : ${RACINE}`);
const db = new Database(BASE, { readonly: true });
const comptes = db
  .prepare("SELECT data FROM accounts WHERE engine = 'claude'")
  .all()
  .map((ligne) => JSON.parse(ligne.data));
db.close();

noter('au moins un compte Claude est déclaré', comptes.length > 0, `${comptes.length} compte(s)`);

for (const compte of comptes) {
  const coffre = compte.configDir;
  const nom = compte.label ?? compte.id;
  if (!coffre || !fs.existsSync(coffre)) {
    noter(`${nom} : son coffre existe`, false, coffre ?? 'aucun dossier');
    continue;
  }

  const morts = [];
  for (const entree of fs.readdirSync(coffre, { withFileTypes: true })) {
    if (!entree.isSymbolicLink()) continue;
    const chemin = path.join(coffre, entree.name);
    if (!fs.existsSync(chemin)) morts.push(`${entree.name} → ${fs.readlinkSync(chemin)}`);
  }
  noter(`${nom} : aucun lien mort dans le coffre`, morts.length === 0, morts.slice(0, 3).join(' | '));

  // Le dossier des tâches, celui qui porte la liste de sous-tâches de chaque
  // session : sans lui, plus aucun agent n'annonce ce qu'il fait.
  const taches = path.join(coffre, 'tasks');
  noter(`${nom} : le dossier des sous-tâches est accessible`, fs.existsSync(taches), taches);

  // Et il doit être ÉCRIVABLE : un dossier présent mais fermé donnerait la
  // même panne muette.
  let ecrivable = false;
  try {
    fs.accessSync(taches, fs.constants.W_OK);
    ecrivable = true;
  } catch {
    /* fermé */
  }
  noter(`${nom} : le dossier des sous-tâches est écrivable`, ecrivable);
}

const rates = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
process.exit(rates.length ? 1 : 0);
