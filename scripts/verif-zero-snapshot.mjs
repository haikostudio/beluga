#!/usr/bin/env node
/**
 * PLUS AUCUN « SNAPSHOT » DANS LE DÉPÔT — la sauvegarde des sites dit « backup ».
 *
 * Le mot a été retiré partout le 10.09.2026 : tables, réglages, outils des
 * agents, commandes de l'écran, messages d'état du canal (`*.etat`), scripts,
 * règles et mémoire. Deux fichiers seulement ont le droit de le citer :
 *
 * - `server/src/passage-backups.ts`, le bloc ÉPHÉMÈRE qui retrouve ce qui a été
 *   écrit sous l'ancien nom (tables, registre des migrations, réglages, dossier
 *   de stockage, archives d'export) ;
 * - `HISTORIQUE.md`, le journal, qui ne se réécrit pas.
 *
 * Le contrôle lit le CONTENU et le NOM de chaque fichier suivi par git, et
 * vérifie que le passage est bien appelé là où il doit l'être.
 *
 *   node scripts/verif-zero-snapshot.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOT = /snapshot/i;
const TOLERES = new Set(['server/src/passage-backups.ts', 'HISTORIQUE.md', 'scripts/verif-zero-snapshot.mjs']);

let ok = 0;
let ko = 0;
function verifier(titre, condition, detail = '') {
  if (condition) {
    ok += 1;
    console.log(`  OK   ${titre}${detail ? ` — ${detail}` : ''}`);
  } else {
    ko += 1;
    console.log(` ÉCHEC ${titre}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\nLa sauvegarde des sites dit « backup », partout\n');

const fichiers = execFileSync('git', ['ls-files', '-z'], { cwd: RACINE, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const nomsFautifs = fichiers.filter((f) => MOT.test(f) && !TOLERES.has(f));
verifier('aucun fichier ne porte l’ancien mot dans son nom', !nomsFautifs.length, nomsFautifs.slice(0, 5).join(', '));

const contenusFautifs = [];
for (const fichier of fichiers) {
  if (TOLERES.has(fichier)) continue;
  const chemin = path.join(RACINE, fichier);
  let brut;
  try {
    brut = fs.readFileSync(chemin);
  } catch {
    continue; // fichier suivi mais retiré de la copie de travail
  }
  if (brut.includes(0)) continue; // binaire
  const texte = brut.toString('utf8');
  if (!MOT.test(texte)) continue;
  const ligne = texte.split('\n').findIndex((l) => MOT.test(l)) + 1;
  contenusFautifs.push(`${fichier}:${ligne}`);
}
verifier(
  'aucun fichier ne cite l’ancien mot (hors passage et historique)',
  !contenusFautifs.length,
  contenusFautifs.length ? `${contenusFautifs.length} fichier(s) : ${contenusFautifs.slice(0, 8).join(', ')}` : '',
);

const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');
verifier('le bloc de passage existe', fs.existsSync(path.join(RACINE, 'server/src/passage-backups.ts')));
verifier(
  'la base passe aux nouveaux noms AVANT les migrations',
  /passerLaBaseAuxBackups\(database\)[\s\S]*const dejaFaites/.test(lire('server/src/db.ts')),
);
verifier(
  'le dossier de stockage passe au nouveau nom au démarrage',
  /openDb\(\);\s*passerLeDossierDesBackups\(\);/.test(lire('server/src/main.ts')),
);
verifier(
  'une archive d’export d’avant est relue sous les noms d’aujourd’hui',
  /manifesteAuxNomsActuels\(/.test(lire('server/src/export-donnees.ts')),
);
verifier(
  'le passage a son test',
  fs.existsSync(path.join(RACINE, 'server/src/test/passage-backups.test.ts')),
);

console.log(`\n${ok} OK, ${ko} échec(s)\n`);
process.exit(ko ? 1 : 0);
