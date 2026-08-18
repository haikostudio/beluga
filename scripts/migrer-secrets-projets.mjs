#!/usr/bin/env node
/**
 * MIGRATION UNIQUE : importe les fichiers .env réels des projets dans le
 * coffre-fort centralisé (table `secrets`), un accès de type « autre » par
 * fichier trouvé, rattaché au projet d'origine.
 *
 * Écarté volontairement : les fichiers `.example`/`.dev.example` (gabarits
 * sans valeur réelle) et les sauvegardes (`.backup*`, `.bak*`, valeurs
 * périmées) — rien n'est supprimé de leur emplacement d'origine, ils restent
 * lisibles là où ils sont.
 *
 * N'écrit QUE dans la table `secrets` ; ne touche à aucun autre fichier ni
 * dossier de projet.
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.HAIKODEV_DATA || path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'haikodev.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const projects = db.prepare('SELECT id, name, path FROM projects').all();

function fichiersEnvDun(racine) {
  const trouves = [];
  function explorer(dossier, profondeur) {
    if (profondeur > 3) return;
    let entrees;
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entrees) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.worktrees') continue;
      const chemin = path.join(dossier, e.name);
      if (e.isDirectory()) {
        explorer(chemin, profondeur + 1);
      } else if (e.isFile() && /^\.env(\..+)?$/.test(e.name)) {
        if (/\.example$/.test(e.name)) continue; // gabarit, pas un secret réel
        if (/\.(backup|bak)/i.test(e.name)) continue; // sauvegarde périmée
        trouves.push(chemin);
      }
    }
  }
  explorer(racine, 0);
  return trouves;
}

const maintenant = Date.now();
const insert = db.prepare(
  'INSERT INTO secrets (id, nom, type, project_id, champs, note, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
);

let total = 0;
for (const projet of projects) {
  const fichiers = fichiersEnvDun(projet.path);
  for (const fichier of fichiers) {
    const contenu = fs.readFileSync(fichier, 'utf8');
    if (!contenu.trim()) continue;
    const relatif = path.relative(projet.path, fichier) || path.basename(fichier);
    const champs = JSON.stringify({ valeur: contenu });
    insert.run(
      crypto.randomUUID(),
      relatif,
      'autre',
      projet.id,
      champs,
      `Migré automatiquement depuis ${fichier} (secrets déjà présents sur la machine, laissés en place).`,
      maintenant,
      maintenant,
    );
    total += 1;
    console.log(`+ ${projet.name} — ${relatif}`);
  }
}

console.log(`\n${total} fiche(s) importée(s) dans le coffre-fort.`);
