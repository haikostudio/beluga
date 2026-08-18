#!/usr/bin/env node
/**
 * Bascule du compte système « paseo » vers « haiko ».
 *
 * CE N'EST PAS UN RENOMMAGE DANS LE CODE : « paseo » n'est pas un mot écrit
 * dans le projet, c'est l'IDENTITÉ UNIX qui fait tourner HaikoDev. Le compte
 * possède `/root/haikodev` et ses données, porte les identifiants des moteurs
 * (`~/.claude-accounts`), le script de publication et le veilleur de jetons.
 * Le renommer coupe le serveur et TOUS les agents en cours.
 *
 * D'où la forme de ce script : il MONTRE par défaut et n'écrit rien. Il faut
 * `--pour-de-vrai` pour qu'il agisse, et il REFUSE de partir si une tâche
 * tourne encore — la règle du projet interdit de couper le démon pendant un
 * travail.
 *
 *   node scripts/renommer-compte-en-haiko.mjs                 # montre, n'écrit rien
 *   node scripts/renommer-compte-en-haiko.mjs --pour-de-vrai  # bascule (root requis)
 *
 * CE QU'IL NE TOUCHE PAS, VOLONTAIREMENT : toute mention de « Paseo »
 * l'ANCIENNE APPLICATION — PLAN.md, les commentaires « piège Paseo »,
 * `reprise-paseo.mjs` qui lit son vrai dossier `/home/paseo/.paseo/tasks`.
 * Ce sont des faits historiques : les renommer rendrait la documentation
 * fausse.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const POUR_DE_VRAI = process.argv.includes('--pour-de-vrai');

const ANCIEN = 'paseo';
const NOUVEAU = 'haiko';
const ANCIEN_HOME = `/home/${ANCIEN}`;
const NOUVEAU_HOME = `/home/${NOUVEAU}`;
// Même convention que les autres scripts du projet : HAIKODEV_DATA désigne le
// dossier de données. Sert aussi à éprouver ce script sur une base jetable.
const BASE = `${process.env.HAIKODEV_DATA ?? '/root/haikodev/data'}/haikodev.db`;

/** Les services à coucher avant la bascule, dans cet ordre. */
const SERVICES = [
  'haikodev-watchdog.timer',
  'haikodev.service',
  'cerveau-cli-memory-watch.service',
  'cerveau-cli-memory-watch-root.service',
];

/**
 * Les fichiers de configuration qui écrivent `/home/paseo` EN DUR, hors du
 * dossier personnel. Recensés à la main le 18/08/2026 : un `sed` lâché sur
 * tout le disque toucherait des caches et des binaires.
 */
const FICHIERS_HORS_HOME = [
  '/etc/systemd/system/haikodev.service',
  '/etc/systemd/system/cerveau-cli-memory-watch.service',
  '/etc/systemd/system/cerveau-cli-memory-watch-root.service',
];

/** Le fichier du dépôt qui doit suivre, pour qu'une réinstallation reste juste. */
const FICHIER_DU_DEPOT = new URL('./haikodev.service', import.meta.url).pathname;

const dit = (...a) => console.log(...a);
const titre = (t) => dit(`\n=== ${t}`);

/** Une commande dont l'échec ne doit pas tuer le script. */
function essaie(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 1. Les contrôles d'avant-vol : tous doivent passer.                 */
/* ------------------------------------------------------------------ */

const obstacles = [];

titre('Contrôles d’avant-vol');

if (POUR_DE_VRAI && process.getuid() !== 0) {
  obstacles.push('il faut être root pour renommer un compte (usermod)');
}

const passwd = fs.readFileSync('/etc/passwd', 'utf8');
if (!new RegExp(`^${ANCIEN}:`, 'm').test(passwd)) {
  obstacles.push(`le compte « ${ANCIEN} » n’existe pas — bascule déjà faite ?`);
}
if (new RegExp(`^${NOUVEAU}:`, 'm').test(passwd)) {
  obstacles.push(`le compte « ${NOUVEAU} » existe déjà : il faudrait le retirer d’abord`);
}
if (fs.existsSync(NOUVEAU_HOME)) {
  obstacles.push(`${NOUVEAU_HOME} existe déjà : usermod refuserait d’y déplacer le dossier`);
}

// La règle du projet : on ne coupe jamais le démon pendant un travail.
let cartesEnCours = null;
try {
  const { default: Database } = await import('/root/haikodev/node_modules/better-sqlite3/lib/index.js');
  const db = new Database(BASE, { readonly: true });
  cartesEnCours = db
    .prepare("select title from cards where column_key = 'running'")
    .all()
    .map((r) => r.title);
  db.close();
} catch (e) {
  obstacles.push(`base illisible, impossible de garantir qu’aucune tâche ne tourne (${e.message})`);
}
if (cartesEnCours?.length) {
  obstacles.push(
    `${cartesEnCours.length} carte(s) encore en cours : ${cartesEnCours.join(' | ')}`,
  );
}

const processus = (essaie('ps', ['-u', ANCIEN, '-o', 'pid=,comm=']) ?? '')
  .split('\n')
  .filter(Boolean);
dit(`Processus tournant sous « ${ANCIEN} » : ${processus.length}`);
for (const p of processus.slice(0, 12)) dit(`  ${p.trim()}`);
if (processus.length > 12) dit(`  … et ${processus.length - 12} autres`);

if (obstacles.length) {
  titre('BASCULE IMPOSSIBLE');
  for (const o of obstacles) dit(`  ✗ ${o}`);
  dit('\nRien n’a été touché.');
  process.exit(1);
}
dit('  ✓ tous les contrôles passent');

/* ------------------------------------------------------------------ */
/* 2. Ce que la bascule ferait — annoncé avant d'agir.                 */
/* ------------------------------------------------------------------ */

titre('Ce que la bascule va faire');
dit(`  1. coucher : ${SERVICES.join(', ')}`);
dit(`  2. couper les ${processus.length} processus restants du compte`);
dit(`  3. usermod -l ${NOUVEAU} -d ${NOUVEAU_HOME} -m ${ANCIEN}  +  groupmod -n ${NOUVEAU} ${ANCIEN}`);
dit(`  4. réécrire ${ANCIEN_HOME} → ${NOUVEAU_HOME} dans :`);
for (const f of FICHIERS_HORS_HOME) dit(`       ${f}`);
dit('       la crontab de root');
dit(`       ${FICHIER_DU_DEPOT} (le dépôt suit, à enregistrer ensuite)`);
dit(`  5. chown -R ${NOUVEAU}:${NOUVEAU} /root/haikodev`);
dit('  6. daemon-reload, puis rallumer les services');
dit('  7. recenser ce qui cite ENCORE l’ancien chemin, sans y toucher');

if (!POUR_DE_VRAI) {
  titre('Essai à blanc — rien n’a été écrit');
  dit('Relance avec --pour-de-vrai (en root) quand aucune tâche ne tourne.');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* 3. La bascule.                                                      */
/* ------------------------------------------------------------------ */

const fait = (cmd, args) => {
  dit(`  $ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit' });
};

titre('1-2. Extinction');
for (const s of SERVICES) essaie('systemctl', ['stop', s]);
essaie('pkill', ['-u', ANCIEN]);
// usermod refuse tant qu'un processus vit : on laisse le noyau finir.
execFileSync('sleep', ['3']);
essaie('pkill', ['-9', '-u', ANCIEN]);
execFileSync('sleep', ['2']);

titre('3. Renommage du compte');
fait('usermod', ['-l', NOUVEAU, '-d', NOUVEAU_HOME, '-m', ANCIEN]);
fait('groupmod', ['-n', NOUVEAU, ANCIEN]);

titre('4. Réécriture des chemins écrits en dur');
const remplace = (chemin) => {
  if (!fs.existsSync(chemin)) return dit(`  – absent : ${chemin}`);
  const avant = fs.readFileSync(chemin, 'utf8');
  const apres = avant.split(ANCIEN_HOME).join(NOUVEAU_HOME);
  if (avant === apres) return dit(`  – rien à changer : ${chemin}`);
  fs.copyFileSync(chemin, `${chemin}.avant-haiko`);
  fs.writeFileSync(chemin, apres);
  dit(`  ✓ ${chemin}`);
};
for (const f of FICHIERS_HORS_HOME) remplace(f);
remplace(FICHIER_DU_DEPOT);

// Les units nomment aussi le compte, pas seulement son dossier.
for (const f of FICHIERS_HORS_HOME) {
  if (!fs.existsSync(f)) continue;
  const t = fs
    .readFileSync(f, 'utf8')
    .replace(/^User=paseo$/m, `User=${NOUVEAU}`)
    .replace(/^Group=paseo$/m, `Group=${NOUVEAU}`);
  fs.writeFileSync(f, t);
}
{
  const t = fs.readFileSync(FICHIER_DU_DEPOT, 'utf8')
    .replace(/^User=paseo$/m, `User=${NOUVEAU}`)
    .replace(/^Group=paseo$/m, `Group=${NOUVEAU}`);
  fs.writeFileSync(FICHIER_DU_DEPOT, t);
}

const cron = essaie('crontab', ['-l']);
if (cron?.includes(ANCIEN_HOME)) {
  fs.writeFileSync('/tmp/crontab-haiko', `${cron.split(ANCIEN_HOME).join(NOUVEAU_HOME)}\n`);
  fait('crontab', ['/tmp/crontab-haiko']);
}

titre('5. Propriété du projet');
fait('chown', ['-R', `${NOUVEAU}:${NOUVEAU}`, '/root/haikodev']);

titre('6. Rallumage');
fait('systemctl', ['daemon-reload']);
for (const s of [...SERVICES].reverse()) essaie('systemctl', ['start', s]);
execFileSync('sleep', ['5']);
dit(essaie('systemctl', ['is-active', 'haikodev.service']) ?? 'haikodev : état inconnu');

titre('7. Ce qui cite ENCORE l’ancien chemin (à regarder à la main)');
const reste = essaie('grep', ['-rIl', ANCIEN_HOME, '/etc', NOUVEAU_HOME, '--exclude=*.avant-haiko']);
dit(reste || '  (rien)');

titre('Terminé');
dit(`Enregistre ${FICHIER_DU_DEPOT} : le dépôt doit garder la même vérité que la machine.`);
