#!/usr/bin/env node
/**
 * Bascule du compte système « paseo » vers « haiko ».
 *
 * CE N'EST PAS UN RENOMMAGE DANS LE CODE : « paseo » n'est pas un mot écrit
 * dans le projet, c'est l'IDENTITÉ UNIX qui fait tourner HaikoDev. Le compte
 * possède `/root/haikodev` et ses données, porte les identifiants des moteurs
 * (`~/.claude-accounts`, `~/.codex`), le script de publication et le veilleur
 * de jetons. Le renommer coupe le serveur et TOUS les agents en cours.
 *
 * D'où la forme de ce script : il MONTRE par défaut et n'écrit rien. Il faut
 * `--pour-de-vrai` pour qu'il agisse, et il REFUSE de partir si une tâche
 * tourne encore — la règle du projet interdit de couper le démon pendant un
 * travail.
 *
 *   node scripts/renommer-compte-en-haiko.mjs                      # montre, n'écrit rien
 *   node scripts/renommer-compte-en-haiko.mjs --montrer-les-fichiers # + liste les fichiers visés
 *   node scripts/renommer-compte-en-haiko.mjs --pour-de-vrai        # bascule (root requis)
 *
 * CE QUI CASSERAIT SANS LUI, recensé sur la machine le 18/08/2026 :
 *   – `/etc/sudoers.d/paseo` : sans reprise, le compte renommé PERD son sudo,
 *     dont tous les agents se servent.
 *   – `/var/spool/cron/crontabs/paseo` : `usermod` ne le renomme pas, les
 *     tâches planifiées du compte disparaissent en silence.
 *   – `accounts.data.configDir` en base : pointe sur `/home/paseo/.claude`,
 *     `/home/paseo/.codex`, `/home/paseo/.claude-accounts/secondary`. Sans
 *     reprise, les TROIS comptes moteurs perdent leurs identifiants et plus
 *     aucun agent ne démarre.
 *   – les hooks, réglages et exécutables du dossier personnel qui écrivent
 *     `/home/paseo` EN DUR : ils suivent le déménagement mais pointent encore
 *     l'ancien chemin.
 *
 * LES CINQ POINTS QUE LA BASCULE DU 18/08/2026 A LAISSÉS DERRIÈRE ELLE, et que
 * ce script reprend désormais tout seul (aucun ne se voit dans `git grep`) :
 *   – `~/.ssh/config` écrit `IdentityFile` en chemin ABSOLU. Le fichier suit le
 *     dossier personnel, son contenu non : plus aucune clé n'est trouvée et TOUT
 *     `git push` par SSH échoue, y compris l'étape « Envoi sur le dépôt » d'une
 *     publication (`no such identity: /home/paseo/.ssh/id_ed25519`).
 *   – `data/accounts/<id>/meta.json` porte `configDir` SUR LE DISQUE, à côté de
 *     la même valeur en base. `bootstrapAccounts` relit ce FICHIER
 *     (`server/src/accounts.ts`) : corriger la base seule tient jusqu'au premier
 *     redémarrage, où le compte moteur repart sur un dossier disparu.
 *   – `data/competences/*` sont des LIENS SYMBOLIQUES vers `~/.claude/skills/*`.
 *     `usermod` déplace la cible, jamais le lien : les compétences partagées
 *     deviennent des liens morts et le pool entier sort du service, sans une
 *     seule erreur visible.
 *   – `/etc/subuid` et `/etc/subgid` nomment le compte en tête de ligne et
 *     `usermod` ne les touche pas : sans reprise, le compte perd ses plages
 *     d'identifiants subordonnés, de quoi casser le bac à sable du chef.
 *   – les `Description=` des units et les commentaires du crontab nomment le
 *     compte. Cosmétique, mais c'est ce qu'un audit lit en premier.
 *
 * CE QU'IL NE TOUCHE PAS, VOLONTAIREMENT : toute mention de « Paseo »
 * l'ANCIENNE APPLICATION — PLAN.md, les commentaires « piège Paseo »,
 * `reprise-paseo.mjs` qui lit son vrai dossier `/home/paseo/.paseo/tasks`.
 * Ni l'HISTOIRE gardée en base (messages, descriptions de cartes, passages de
 * mémoire) ni les notes du dossier personnel (`memories/`, `plans/`, `tasks/`).
 * Ce sont des faits datés : les réécrire rendrait le récit faux.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const POUR_DE_VRAI = process.argv.includes('--pour-de-vrai');
const MONTRER_LES_FICHIERS = process.argv.includes('--montrer-les-fichiers');

const ANCIEN = 'paseo';
const NOUVEAU = 'haiko';
const ANCIEN_HOME = `/home/${ANCIEN}`;
const NOUVEAU_HOME = `/home/${NOUVEAU}`;
// Même convention que les autres scripts du projet : HAIKODEV_DATA désigne le
// dossier de données. Sert aussi à éprouver ce script sur une base jetable.
const DOSSIER_DONNEES = process.env.HAIKODEV_DATA ?? '/root/haikodev/data';
const BASE = `${DOSSIER_DONNEES}/haikodev.db`;
/** Les fiches d'identité des comptes moteurs, SUR LE DISQUE (doublon de la base). */
const DOSSIER_COMPTES = `${DOSSIER_DONNEES}/accounts`;
/** Les compétences partagées : un dossier de LIENS vers `~/.claude/skills/*`. */
const DOSSIER_COMPETENCES = `${DOSSIER_DONNEES}/competences`;
const SQLITE = '/root/haikodev/node_modules/better-sqlite3/lib/index.js';

/** Les services à coucher avant la bascule, dans cet ordre. */
const SERVICES = [
  'haikodev-watchdog.timer',
  'haikodev.service',
  'cerveau-cli-memory-watch.service',
  'cerveau-cli-memory-watch-root.service',
  'cerveau-whatsapp.service',
];

/**
 * Les fichiers de configuration qui écrivent `/home/paseo` EN DUR, hors du
 * dossier personnel. Recensés à la main : un `sed` lâché sur tout le disque
 * toucherait des caches et des binaires.
 */
const FICHIERS_HORS_HOME = [
  '/etc/systemd/system/haikodev.service',
  '/etc/systemd/system/cerveau-cli-memory-watch.service',
  '/etc/systemd/system/cerveau-cli-memory-watch-root.service',
  '/etc/systemd/system/cerveau-whatsapp.service',
];

/**
 * Les plages d'identifiants subordonnés : elles nomment le compte EN TÊTE DE
 * LIGNE et `usermod` ne les touche pas. Sans reprise, le compte les perd, et
 * avec elles le bac à sable qui garde le projet en lecture seule pour le chef.
 */
const FICHIERS_SUBID = ['/etc/subuid', '/etc/subgid'];

const SUDOERS_ANCIEN = `/etc/sudoers.d/${ANCIEN}`;
const SUDOERS_NOUVEAU = `/etc/sudoers.d/${NOUVEAU}`;
const CRON_ANCIEN = `/var/spool/cron/crontabs/${ANCIEN}`;
const CRON_NOUVEAU = `/var/spool/cron/crontabs/${NOUVEAU}`;

/** Le fichier du dépôt qui doit suivre, pour qu'une réinstallation reste juste. */
const FICHIER_DU_DEPOT = new URL('./haikodev.service', import.meta.url).pathname;

/**
 * Les zones du dossier personnel qui portent de la CONFIGURATION vivante.
 * Tout le reste — notes, sessions, journaux, caches, historiques — est de
 * l'HISTOIRE et se lit encore très bien avec l'ancien chemin.
 */
const ZONES_DU_HOME = [
  { dossier: '.claude/hooks', exts: ['.sh', '.py', '.json'], profondeur: 3 },
  { dossier: '.claude/watchdog', exts: ['.sh', '.py'], profondeur: 2 },
  { dossier: '.claude-accounts', exts: ['.json'], profondeur: 2, exclure: ['backups', 'projects', 'todos'] },
  { dossier: '.codex', exts: ['.toml', '.json'], profondeur: 6, exclure: ['sessions', 'memories', 'archives', 'logs', 'node_modules'] },
  { dossier: '.config', exts: ['.json', '.toml'], profondeur: 3 },
  { dossier: '.local/bin', exts: ['.py', '.sh', ''], profondeur: 1 },
  { dossier: '.haiko', exts: ['.env', '.cfg', '.bat', '.csh', '.fish', '.nu', ''], profondeur: 5, exclure: ['lib', 'lib64', 'share', '__pycache__', 'node_modules'] },
  { dossier: 'cerveau-whatsapp', exts: ['.mjs', '.js', '.json'], profondeur: 2, exclure: ['node_modules'] },
];

/** Les fichiers isolés du dossier personnel, nommés un par un. */
const FICHIERS_DU_HOME = [
  '.bashrc',
  '.profile',
  '.bash_profile',
  '.bash_aliases',
  '.claude/settings.json',
  // Le fichier qui a fait tomber la publication du 18/08/2026 : `IdentityFile`
  // y est écrit en chemin ABSOLU. Il déménage avec le dossier personnel, son
  // contenu continue de nommer l'ancien, et plus aucune clé SSH n'est trouvée.
  '.ssh/config',
];

/**
 * Les scripts du dossier personnel qui portent l'ancien nom DANS LEUR NOM.
 * Deux fichiers seulement les citent — le mot d'accueil des agents
 * (`.claude/hooks/ship-directive.sh`) et la table planifiée du compte — donc
 * les renommer se fait sans rien casser ailleurs.
 */
const SCRIPTS_RENOMMES = [
  ['paseo-app-autodeploy.sh', 'haiko-app-autodeploy.sh'],
  ['paseo-build-ram.sh', 'haiko-build-ram.sh'],
  ['paseo-idle-restart.sh', 'haiko-idle-restart.sh'],
  ['paseo-push.sh', 'haiko-push.sh'],
  ['paseo-restart-watchdog.sh', 'haiko-restart-watchdog.sh'],
  ['paseo-ship-now.sh', 'haiko-ship-now.sh'],
  ['paseo-auth-watchdog.sh', 'haiko-auth-watchdog.sh'],
];

/**
 * Le texte d'un fichier de configuration, mis à l'heure du nouveau compte :
 * le chemin du dossier personnel, puis le nom des scripts déplacés. Passer
 * TOUT par ici garantit qu'un fichier et la table planifiée qui l'appelle ne
 * peuvent pas diverger.
 */
function reecrire(texte) {
  let t = texte.split(ANCIEN_HOME).join(NOUVEAU_HOME);
  for (const [avant, apres] of SCRIPTS_RENOMMES) t = t.split(avant).join(apres);
  return t;
}

/**
 * Le nom du compte écrit EN CLAIR, hors chemin : la `Description=` d'une unit,
 * un commentaire de crontab. Purement cosmétique — mais c'est ce qu'un audit
 * lit en premier. Volontairement ÉTROIT : un « paseo → haiko » lâché partout
 * réécrirait les mentions de l'ANCIENNE APPLICATION Paseo, qui sont des faits.
 */
function nommeLeCompteEnClair(texte) {
  const mot = new RegExp(`\\b${ANCIEN}\\b`, 'g');
  return texte
    .split('\n')
    .map((l) => (/^(Description=|\s*#)/.test(l) ? l.replace(mot, NOUVEAU) : l))
    .join('\n');
}

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

/** Les fichiers d'une zone, sans suivre les liens ni descendre trop bas. */
function* fichiersDe(racine, { profondeur = 3, exclure = [], exts = null } = {}, niveau = 0) {
  let entrees;
  try {
    entrees = fs.readdirSync(racine, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entrees) {
    const p = path.join(racine, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (niveau + 1 > profondeur || exclure.includes(e.name)) continue;
      yield* fichiersDe(p, { profondeur, exclure, exts }, niveau + 1);
    } else if (e.isFile()) {
      if (exts && !exts.includes(path.extname(e.name))) continue;
      yield p;
    }
  }
}

/** Les fichiers du dossier personnel qui citent l'ancien chemin, texte seulement. */
function ciblesDuHome(home) {
  const vus = new Set();
  const candidats = [];
  for (const f of FICHIERS_DU_HOME) candidats.push(path.join(home, f));
  for (const e of fs.existsSync(home) ? fs.readdirSync(home) : []) {
    if (e.endsWith('.sh')) candidats.push(path.join(home, e));
  }
  for (const z of ZONES_DU_HOME) {
    for (const f of fichiersDe(path.join(home, z.dossier), z)) candidats.push(f);
  }
  const cibles = [];
  for (const f of candidats) {
    if (vus.has(f)) continue;
    vus.add(f);
    let stat;
    try {
      stat = fs.statSync(f);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > 2_000_000) continue;
    let brut;
    try {
      brut = fs.readFileSync(f);
    } catch {
      continue;
    }
    if (brut.includes(0)) continue; // binaire
    const texte = brut.toString('utf8');
    if (texte === reecrire(texte)) continue;
    cibles.push(f);
  }
  return cibles.sort();
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
  const { default: Database } = await import(SQLITE);
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

if (MONTRER_LES_FICHIERS) {
  const cibles = ciblesDuHome(fs.existsSync(NOUVEAU_HOME) ? NOUVEAU_HOME : ANCIEN_HOME);
  titre(`Fichiers de configuration du dossier personnel à réécrire : ${cibles.length}`);
  for (const f of cibles) dit(`  ${f}`);
}

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
dit(`  3b. renommer ${SCRIPTS_RENOMMES.length} scripts du dossier personnel (paseo-… → haiko-…)`);
dit(`  4. ${SUDOERS_ANCIEN} → ${SUDOERS_NOUVEAU} (sudo du compte), vérifié par visudo`);
dit(`  4b. ${FICHIERS_SUBID.join(', ')} : le compte en tête de ligne`);
dit(`  5. ${CRON_ANCIEN} → ${CRON_NOUVEAU} (tâches planifiées du compte)`);
dit(`  6. réécrire ${ANCIEN_HOME} → ${NOUVEAU_HOME} dans :`);
for (const f of FICHIERS_HORS_HOME) dit(`       ${f}`);
dit('       la crontab de root');
dit(`       ${FICHIER_DU_DEPOT} (le dépôt suit, s’il est là)`);
dit('       les hooks, réglages et exécutables du dossier personnel');
dit('  7. en base : le dossier de configuration des comptes moteurs (accounts.configDir)');
dit(`  7b. sur le disque : ${DOSSIER_COMPTES}/*/meta.json (le MÊME configDir, relu au démarrage)`);
dit(`  7c. ${DOSSIER_COMPETENCES}/* : refaire les liens des compétences partagées`);
dit(`  8. chown -R ${NOUVEAU}:${NOUVEAU} /root/haikodev`);
dit('  9. daemon-reload, puis rallumer les services');
dit(' 10. recenser ce qui cite ENCORE l’ancien chemin, sans y toucher');

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

titre('3b. Les scripts du dossier personnel qui portaient l’ancien nom');
{
  const dossiers = [NOUVEAU_HOME, path.join(NOUVEAU_HOME, '.claude/watchdog')];
  let n = 0;
  for (const [avant, apres] of SCRIPTS_RENOMMES) {
    for (const d of dossiers) {
      const src = path.join(d, avant);
      if (!fs.existsSync(src)) continue;
      fs.renameSync(src, path.join(d, apres));
      dit(`  ✓ ${src} → ${apres}`);
      n += 1;
    }
  }
  if (!n) dit('  – aucun script à renommer');
}

titre('4. Le sudo du compte');
if (fs.existsSync(SUDOERS_ANCIEN)) {
  const regle = fs
    .readFileSync(SUDOERS_ANCIEN, 'utf8')
    .replace(new RegExp(`^${ANCIEN}\\b`, 'gm'), NOUVEAU);
  fs.writeFileSync(SUDOERS_NOUVEAU, regle, { mode: 0o440 });
  fs.chmodSync(SUDOERS_NOUVEAU, 0o440);
  if (essaie('visudo', ['-c']) === null) {
    fs.unlinkSync(SUDOERS_NOUVEAU);
    dit(`  ✗ visudo REFUSE la nouvelle règle : ${SUDOERS_ANCIEN} laissé en place, à reprendre à la main`);
  } else {
    fs.renameSync(SUDOERS_ANCIEN, `${SUDOERS_ANCIEN}.avant-haiko`);
    // Un fichier de sauvegarde reste lu par sudo : il doit sortir du dossier.
    fs.renameSync(`${SUDOERS_ANCIEN}.avant-haiko`, `/root/sudoers-${ANCIEN}.avant-haiko`);
    dit(`  ✓ ${SUDOERS_NOUVEAU} (ancien mis de côté dans /root/sudoers-${ANCIEN}.avant-haiko)`);
    dit(`  ${essaie('visudo', ['-c']) ?? 'visudo muet'}`);
  }
} else {
  dit(`  – absent : ${SUDOERS_ANCIEN}`);
}

titre('4b. Les plages d’identifiants subordonnés');
for (const f of FICHIERS_SUBID) {
  if (!fs.existsSync(f)) {
    dit(`  – absent : ${f}`);
    continue;
  }
  const avant = fs.readFileSync(f, 'utf8');
  const apres = avant.replace(new RegExp(`^${ANCIEN}:`, 'gm'), `${NOUVEAU}:`);
  if (avant === apres) {
    dit(`  – rien à changer : ${f}`);
    continue;
  }
  fs.copyFileSync(f, `${f}.avant-haiko`);
  fs.writeFileSync(f, apres);
  dit(`  ✓ ${f}`);
}

titre('5. Les tâches planifiées du compte');
{
  const source = fs.existsSync(CRON_NOUVEAU) ? CRON_NOUVEAU : CRON_ANCIEN;
  if (fs.existsSync(source)) {
    const texte = nommeLeCompteEnClair(reecrire(fs.readFileSync(source, 'utf8')));
    fs.writeFileSync(CRON_NOUVEAU, texte, { mode: 0o600 });
    essaie('chown', [`${NOUVEAU}:crontab`, CRON_NOUVEAU]);
    fs.chmodSync(CRON_NOUVEAU, 0o600);
    if (source !== CRON_NOUVEAU) fs.unlinkSync(source);
    dit(`  ✓ ${CRON_NOUVEAU}`);
  } else {
    dit(`  – absent : ${CRON_ANCIEN}`);
  }
}

titre('6. Réécriture des chemins écrits en dur');
const remplace = (chemin) => {
  if (!fs.existsSync(chemin)) return dit(`  – absent : ${chemin}`);
  const avant = fs.readFileSync(chemin, 'utf8');
  const apres = reecrire(avant);
  if (avant === apres) return dit(`  – rien à changer : ${chemin}`);
  fs.copyFileSync(chemin, `${chemin}.avant-haiko`);
  fs.writeFileSync(chemin, apres);
  dit(`  ✓ ${chemin}`);
};
for (const f of FICHIERS_HORS_HOME) remplace(f);
remplace(FICHIER_DU_DEPOT);

// Les units nomment aussi le compte, pas seulement son dossier — dans
// `User=`/`Group=`, qui comptent, et dans leur `Description=`, qui ne compte
// que pour l'œil d'un auditeur. Les deux sont repris.
const nommeLeCompte = (f) => {
  if (!fs.existsSync(f)) return;
  const t = nommeLeCompteEnClair(
    fs
      .readFileSync(f, 'utf8')
      .replace(new RegExp(`^User=${ANCIEN}$`, 'm'), `User=${NOUVEAU}`)
      .replace(new RegExp(`^Group=${ANCIEN}$`, 'm'), `Group=${NOUVEAU}`),
  );
  fs.writeFileSync(f, t);
};
for (const f of FICHIERS_HORS_HOME) nommeLeCompte(f);
nommeLeCompte(FICHIER_DU_DEPOT);

const cron = essaie('crontab', ['-l']);
const cronRevu = cron === null ? null : nommeLeCompteEnClair(reecrire(cron));
if (cron && cron !== cronRevu) {
  fs.writeFileSync('/tmp/crontab-haiko', `${cronRevu}\n`);
  fait('crontab', ['/tmp/crontab-haiko']);
} else {
  dit('  – la crontab de root ne cite pas l’ancien compte');
}

titre('6b. La configuration du dossier personnel');
{
  const cibles = ciblesDuHome(NOUVEAU_HOME);
  for (const f of cibles) {
    try {
      const avant = fs.readFileSync(f, 'utf8');
      fs.writeFileSync(f, reecrire(avant));
      dit(`  ✓ ${f}`);
    } catch (e) {
      dit(`  ✗ ${f} : ${e.message}`);
    }
  }
  if (!cibles.length) dit('  – rien à réécrire');
}

titre('7. En base : les comptes moteurs suivent leur dossier');
try {
  const { default: Database } = await import(SQLITE);
  const db = new Database(BASE);
  const maj = db.prepare('update accounts set data = ? where id = ?');
  let n = 0;
  for (const l of db.prepare('select id, data from accounts').all()) {
    const avant = String(l.data ?? '');
    if (!avant.includes(ANCIEN_HOME)) continue;
    maj.run(avant.split(ANCIEN_HOME).join(NOUVEAU_HOME), l.id);
    n += 1;
    dit(`  ✓ ${l.id}`);
  }
  db.close();
  if (!n) dit('  – aucun compte à corriger');
} catch (e) {
  dit(`  ✗ ÉCHEC : ${e.message}`);
  dit('    Les moteurs ne trouveront plus leurs identifiants : à corriger à la main');
  dit('    (table accounts, champ data, clé configDir).');
}

titre('7b. Sur le disque : les fiches d’identité des comptes moteurs');
{
  let n = 0;
  let vus = 0;
  for (const e of fs.existsSync(DOSSIER_COMPTES) ? fs.readdirSync(DOSSIER_COMPTES) : []) {
    const meta = path.join(DOSSIER_COMPTES, e, 'meta.json');
    if (!fs.existsSync(meta)) continue;
    vus += 1;
    const avant = fs.readFileSync(meta, 'utf8');
    if (!avant.includes(ANCIEN_HOME)) continue;
    fs.copyFileSync(meta, `${meta}.avant-haiko`);
    fs.writeFileSync(meta, avant.split(ANCIEN_HOME).join(NOUVEAU_HOME));
    dit(`  ✓ ${meta}`);
    n += 1;
  }
  if (!vus) dit(`  – aucune fiche dans ${DOSSIER_COMPTES}`);
  else if (!n) dit(`  – ${vus} fiche(s) lue(s), aucune ne cite l’ancien dossier`);
}

titre('7c. Les liens des compétences partagées');
{
  let n = 0;
  let morts = 0;
  for (const e of fs.existsSync(DOSSIER_COMPETENCES) ? fs.readdirSync(DOSSIER_COMPETENCES) : []) {
    const lien = path.join(DOSSIER_COMPETENCES, e);
    let cible;
    try {
      if (!fs.lstatSync(lien).isSymbolicLink()) continue;
      cible = fs.readlinkSync(lien);
    } catch {
      continue;
    }
    if (!cible.startsWith(`${ANCIEN_HOME}/`)) continue;
    const neuve = NOUVEAU_HOME + cible.slice(ANCIEN_HOME.length);
    if (!fs.existsSync(neuve)) {
      dit(`  ✗ ${e} : la cible ${neuve} n’existe pas — lien laissé tel quel`);
      morts += 1;
      continue;
    }
    fs.unlinkSync(lien);
    fs.symlinkSync(neuve, lien);
    essaie('chown', ['-h', `${NOUVEAU}:${NOUVEAU}`, lien]);
    dit(`  ✓ ${e} → ${neuve}`);
    n += 1;
  }
  if (!n && !morts) dit('  – aucun lien à refaire');
  if (morts) dit(`  ${morts} lien(s) sans cible : le pool des compétences est incomplet, à reprendre à la main`);
}

titre('8. Propriété du projet');
fait('chown', ['-R', `${NOUVEAU}:${NOUVEAU}`, '/root/haikodev']);

titre('9. Rallumage');
fait('systemctl', ['daemon-reload']);
for (const s of [...SERVICES].reverse()) essaie('systemctl', ['start', s]);
execFileSync('sleep', ['5']);
for (const s of SERVICES) dit(`  ${s} : ${essaie('systemctl', ['is-active', s]) ?? 'inconnu'}`);

titre('10. Ce qui cite ENCORE l’ancien compte (à regarder à la main)');
const reste = essaie('grep', ['-rIl', ANCIEN_HOME, '/etc', '--exclude=*.avant-haiko']);
dit(reste || '  (rien dans /etc)');
const liensMorts = (fs.existsSync(DOSSIER_COMPETENCES) ? fs.readdirSync(DOSSIER_COMPETENCES) : []).filter(
  (e) => {
    const l = path.join(DOSSIER_COMPETENCES, e);
    try {
      return fs.lstatSync(l).isSymbolicLink() && !fs.existsSync(l);
    } catch {
      return false;
    }
  },
);
dit(liensMorts.length ? `  compétences en lien mort : ${liensMorts.join(', ')}` : '  (aucune compétence en lien mort)');

titre('Terminé');
