#!/usr/bin/env node
/**
 * LES SNAPSHOTS DES SITES EN PRODUCTION, dans un VRAI navigateur, sur son
 * PROPRE démon (base neuve, port libre, disque de stockage jetable : le démon
 * de production n'est pas touché, aucun moteur appelé, aucun quota dépensé).
 *
 * Ce qu'il exige, un contrôle par promesse de la carte :
 *
 *  1. la migration crée les tables des sites et des points de sauvegarde ;
 *  2. le bouton « Snapshot » est DANS la colonne de gauche et ouvre la fenêtre ;
 *  3. sans dossier de stockage réglé, la fenêtre le DIT au lieu d'empiler des échecs ;
 *  4. un site extérieur se crée avec sa base et ses fichiers, et paraît dans la liste ;
 *  5. « Sauvegarder » copie POUR DE VRAI la base et les fichiers sur le disque de stockage ;
 *  6. la fenêtre d'HISTORIQUE montre le point pris, sa date et le volume du site ;
 *  7. les projets du serveur sont proposés d'un clic, sans ressaisir leur nom.
 *
 *   node scripts/verif-snapshots.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKODEV_SNAPSHOTS_PORT || 7213);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-snapshots-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
/* Le « disque de stockage » : un dossier jetable qui joue le disque monté. */
const STOCKAGE = path.join(TMP, 'stockage');
/* Le site à sauvegarder : une base SQLite et un dossier de fichiers. */
const SITE = path.join(TMP, 'site');
for (const dossier of [DATA, PROJETS, STOCKAGE, SITE]) fs.mkdirSync(dossier, { recursive: true });

const BASE_DU_SITE = path.join(SITE, 'boutique.sqlite');
{
  const db = new Database(BASE_DU_SITE);
  db.exec('CREATE TABLE commandes (id INTEGER PRIMARY KEY, client TEXT)');
  db.prepare('INSERT INTO commandes (client) VALUES (?)').run('Chris');
  db.close();
}
const FICHIERS_DU_SITE = path.join(SITE, 'public');
fs.mkdirSync(FICHIERS_DU_SITE, { recursive: true });
fs.writeFileSync(path.join(FICHIERS_DU_SITE, 'index.html'), '<h1>Boutique</h1>\n'.repeat(200));

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HAIKODEV_PORT: String(PORT),
    HAIKODEV_HOST: '127.0.0.1',
    HAIKODEV_DATA: DATA,
    HAIKODEV_PROJECTS_ROOT: PROJETS,
    HAIKODEV_WEB: process.env.HAIKODEV_WEB_ESSAI || path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

const ranger = () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
};
process.on('exit', ranger);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    ranger();
    process.exit(130);
  });
}

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function attendreLesTables(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
      const sites = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='snapshot_sites'").get();
      const points = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='snapshot_points'").get();
      db.close();
      if (sites && points) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-snapshots';
const PROJET_NOM = 'Boutique en ligne';

function poserLeDecor({ avecStockage }) {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT OR REPLACE INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification des snapshots',
  );

  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(
    JSON.stringify({
      ...reglages,
      maxAgents: 0,
      // Le passage AUTOMATIQUE est éteint : ce contrôle vérifie les gestes, pas
      // l'horloge — un passage de nuit qui partirait au milieu fausserait tout.
      snapshotAuto: false,
      snapshotDossier: avecStockage ? STOCKAGE : '',
    }),
  );

  const dejaLa = db.prepare('SELECT 1 FROM projects WHERE id = ?').get(PROJET_ID);
  if (!dejaLa) {
    const projet = {
      id: PROJET_ID,
      name: PROJET_NOM,
      path: PROJETS,
      defaultEngine: 'claude',
      isSelf: false,
      rank: 1,
      archived: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
  }
  db.close();
}

/** Les points de sauvegarde tels que la base les porte à cet instant. */
function pointsEnBase() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const lignes = db.prepare('SELECT data FROM snapshot_points ORDER BY debut DESC').all();
  db.close();
  return lignes.map((l) => JSON.parse(l.data));
}

async function main() {
  if (!(await attendrePort())) throw new Error(`le démon d'essai n'a jamais ouvert le port ${PORT}`);
  if (!(await attendreLesTables())) {
    throw new Error('les tables des snapshots ne sont jamais apparues : la migration n’a pas tourné');
  }
  noter('La migration crée les tables des sites et des points de sauvegarde', true);

  // Premier temps : AUCUN dossier de stockage réglé.
  poserLeDecor({ avecStockage: false });

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-CH' });
    await contexte.addCookies([
      { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="notes"]', { timeout: 30000 });
    await page.waitForTimeout(600);

    /* 2. Le bouton vit dans la COLONNE DE GAUCHE et ouvre la fenêtre. */
    const bouton = page.locator('aside[data-zone="gauche"] [data-ouvrir-snapshots]');
    noter('Le bouton « Snapshot » est dans la colonne de gauche', (await bouton.count()) === 1);
    await bouton.click();
    const fenetre = page.locator('[role="dialog"][data-state="open"]', {
      has: page.locator('[data-snapshots-creer]'),
    });
    await fenetre.waitFor({ state: 'visible', timeout: 15000 });
    noter('La fenêtre des snapshots s’ouvre au clic', true);

    /* 3. Sans disque de stockage réglé, la fenêtre le DIT. */
    const avertissement = fenetre.locator('[data-snapshots-sans-destination]');
    noter(
      'Sans dossier de stockage réglé, la fenêtre le dit au lieu de se taire',
      (await avertissement.count()) === 1,
      (await avertissement.count()) ? (await avertissement.innerText()).trim() : 'aucun avertissement affiché',
    );

    /* On règle le disque de stockage, puis on recharge : l'avertissement part. */
    poserLeDecor({ avecStockage: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-column="notes"]', { timeout: 30000 });
    await page.click('aside[data-zone="gauche"] [data-ouvrir-snapshots]');
    await fenetre.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(400);
    noter(
      'Le dossier de stockage réglé fait disparaître l’avertissement',
      (await fenetre.locator('[data-snapshots-sans-destination]').count()) === 0,
    );

    /* 7. Les projets du serveur sont proposés d'un clic. */
    await fenetre.locator('[data-snapshots-creer]').click();
    const proposeLeProjet = await page.locator(`[data-snapshots-projet="${PROJET_ID}"]`).count();
    noter('Les projets de ce serveur sont proposés sans ressaisir leur nom', proposeLeProjet === 1);

    /* 4. Un site extérieur, avec sa base et ses fichiers. */
    await page.click('[data-snapshots-site-externe]');
    const fiche = page.locator('[role="dialog"][data-state="open"]', {
      has: page.locator('[data-snapshots-enregistrer]'),
    });
    await fiche.waitFor({ state: 'visible', timeout: 10000 });
    await fiche.locator('[data-snapshots-nom]').fill('Boutique — production');
    await fiche.locator('[data-snapshots-moteur]').selectOption('sqlite');
    await fiche.locator('[data-snapshots-base-nom]').fill(BASE_DU_SITE);
    await fiche.locator('[data-snapshots-moyen]').selectOption('local');
    await fiche.locator('[data-snapshots-chemin]').fill(FICHIERS_DU_SITE);
    await fiche.locator('[data-snapshots-enregistrer]').click();
    await fiche.waitFor({ state: 'hidden', timeout: 10000 });

    const lignes = page.locator('[data-snapshots-site]');
    await lignes.first().waitFor({ state: 'visible', timeout: 10000 });
    noter('Le site créé paraît dans la liste', (await lignes.count()) === 1);

    /* 5. « Sauvegarder » copie POUR DE VRAI. */
    await page.click('[data-snapshots-lancer]');
    const finPrise = Date.now() + 60000;
    let points = [];
    while (Date.now() < finPrise) {
      points = pointsEnBase();
      if (points.length) break;
      await page.waitForTimeout(500);
    }
    const point = points[0];
    noter('Le clic « Sauvegarder » pose un point de sauvegarde', !!point, point?.detail ?? 'aucun point enregistré');
    noter(
      'Le point est RÉUSSI : base et fichiers ont été pris',
      point?.statut === 'reussi',
      `statut=${point?.statut} détail=${point?.detail}`,
    );

    const dossierDuPoint = point?.chemin ?? '';
    const dansLeStockage = dossierDuPoint.startsWith(STOCKAGE);
    const baseCopiee = dossierDuPoint && fs.existsSync(path.join(dossierDuPoint, 'base.sqlite.gz'));
    const fichierCopie =
      dossierDuPoint && fs.existsSync(path.join(dossierDuPoint, 'fichiers', 'index.html'));
    noter('Le point est posé SUR le disque de stockage', dansLeStockage, dossierDuPoint);
    noter('La base du site est vraiment copiée (et compressée)', !!baseCopiee);
    noter('Les fichiers du site sont vraiment copiés', !!fichierCopie);
    noter(
      'Le volume mesuré n’est pas nul : ce qui est écrit est pesé',
      (point?.octetsBase ?? 0) > 0 && (point?.octetsFichiers ?? 0) > 0,
      `base=${point?.octetsBase} fichiers=${point?.octetsFichiers}`,
    );

    /* 6. La fenêtre d'HISTORIQUE. */
    await page.click('[data-snapshots-historique]');
    const historique = page.locator('[role="dialog"][data-state="open"]', {
      has: page.locator('[data-snapshots-point]'),
    });
    await historique.waitFor({ state: 'visible', timeout: 10000 });
    const texte = (await historique.innerText()).replace(/\s+/g, ' ');
    noter('L’historique montre le point pris', (await historique.locator('[data-snapshots-point]').count()) === 1);
    noter(
      'L’historique porte le volume total du site',
      /Total\s*:/.test(texte) && /(o|Ko|Mo|Go)\b/.test(texte),
      texte.slice(0, 160),
    );
    noter(
      'L’historique dit la date de la sauvegarde',
      /\d{1,2}\s+\p{L}+.*\d{2}:\d{2}/u.test(texte),
      texte.slice(0, 160),
    );

    const SHOTS = path.join(RACINE, 'data', 'verification');
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'snapshots.png') });

    noter('Aucune erreur JavaScript de page pendant le scénario', erreurs.length === 0, erreurs.join(' | '));
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  if (echecs.length) console.log('Journal du démon :\n' + journal.join(''));
  // On SORT explicitement : le démon d'essai tiendrait la boucle éveillée.
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ÉCHEC :', error);
  console.log('Journal du démon :\n' + journal.join(''));
  process.exit(1);
});
