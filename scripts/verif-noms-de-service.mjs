#!/usr/bin/env node
/**
 * LE SERVICE, LE DÉPÔT, LA BASE ET LE CODE NE PORTENT QU'UN NOM : « BELUGA ».
 *
 * Le service s'appelle `beluga.service`, son surveillant `beluga-watchdog.*`, le
 * dépôt `haikostudio/beluga`, le fichier d'environnement `/etc/beluga.env` et la
 * base `data/beluga.db`. L'ancien nom du projet a été retiré partout, sans
 * aucune compatibilité gardée : ce contrôle ÉCHOUE dès qu'il reparaît dans un
 * fichier suivi du dépôt (hors `HISTORIQUE.md`, le journal des livraisons).
 *
 * L'ancien nom n'est jamais écrit ici en toutes lettres : il est recomposé, pour
 * que ce contrôle ne se trouve pas lui-même.
 *
 *   node scripts/verif-noms-de-service.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');
const ANCIEN = ['haiko', 'dev'].join('');

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

console.log('\nUn seul nom : beluga\n');

// 1. Les unités du dépôt existent sous leur nom.
for (const nom of [
  'scripts/beluga.service',
  'scripts/beluga-watchdog.service',
  'scripts/beluga-watchdog.timer',
  'scripts/beluga-watchdog.sh',
  'scripts/installer-services.sh',
]) {
  verifier(`${nom} existe`, fs.existsSync(path.join(RACINE, nom)));
}

// 2. L'unité charge le fichier d'environnement et garde sa protection mémoire.
const unite = lire('scripts/beluga.service');
verifier('l’unité charge /etc/beluga.env', unite.includes('EnvironmentFile=-/etc/beluga.env'));
verifier('l’unité garde OOMScoreAdjust=-500', unite.includes('OOMScoreAdjust=-500'));

// 3. Le surveillant relance beluga.service.
const veilleur = lire('scripts/beluga-watchdog.sh');
verifier('le surveillant relance beluga.service', /BELUGA_SERVICE:-beluga\.service/.test(veilleur));

// 4. Le garde du démon ne connaît qu'un nom de service.
const garde = lire('shared/src/garde-demon.ts');
verifier(
  'le garde du démon ne garde que beluga',
  /NOMS_DU_SERVICE\s*=\s*\[SERVICE_DU_DEMON\]/.test(garde),
);

// 5. L'installation refuse un dossier de carte, et le README passe par elle.
const installeur = lire('scripts/installer-services.sh');
verifier(
  'l’installation refuse un dossier de travail temporaire',
  installeur.includes('--git-common-dir') && installeur.includes('REFUS'),
);
const readme = lire('README.md');
verifier('le README installe par scripts/installer-services.sh', readme.includes('scripts/installer-services.sh'));
verifier('le README clone bien haikostudio/beluga', readme.includes('haikostudio/beluga.git'));

// 6. L'adresse du dépôt.
let adresse = '';
try {
  adresse = execFileSync('git', ['-C', RACINE, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
} catch {
  /* pas de dépôt distant : on le dit plutôt que de tomber */
}
verifier('l’adresse du dépôt nomme haikostudio/beluga', adresse.includes('haikostudio/beluga'), adresse || 'aucune adresse lue');

// 7. La base : un seul nom, et un fichier vide n'est jamais servi en silence.
const config = lire('server/src/config.ts');
verifier('le démon vise beluga.db', config.includes("path.join(dossierDonnees, 'beluga.db')"));
verifier(
  'le démon refuse une base vide quand une autre base pleine dort à côté',
  config.includes('function basesPleinesVoisines('),
);

// 8. AUCUNE MENTION DE L'ANCIEN NOM dans les fichiers suivis.
let restes = [];
try {
  const sortie = execFileSync(
    'git',
    ['-C', RACINE, 'grep', '-I', '-i', '-l', ANCIEN, '--', '.', ':!HISTORIQUE.md'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  restes = sortie.split('\n').filter(Boolean);
} catch (erreur) {
  // `git grep` rend 1 quand il ne trouve rien : c'est le cas attendu.
  if (erreur.status !== 1) restes = [`git grep a échoué (${erreur.status})`];
}
verifier('aucun fichier suivi ne porte l’ancien nom', restes.length === 0, restes.slice(0, 8).join(', ') || 'aucun');

console.log(`\n${ok}/${ok + ko} contrôles passés.\n`);
process.exit(ko === 0 ? 0 : 1);
