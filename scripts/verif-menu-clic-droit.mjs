#!/usr/bin/env node
/**
 * LE MENU DU CLIC DROIT SUR UNE CARTE N'AGIT PAS TOUT SEUL.
 *
 *   node scripts/verif-menu-clic-droit.mjs
 *
 * Le clic droit se compose de DEUX événements natifs : l'enfoncement du
 * bouton droit (qui ouvre le menu, `contextmenu`) puis son RELÂCHEMENT
 * (`pointerup`). Le menu vient d'apparaître pile sous le curseur quand ce
 * relâchement survient : sans garde, la bibliothèque de menus le lit comme
 * le clic qui CHOISIT l'entrée qui s'y trouve, et l'action part sans second
 * clic volontaire (`web/src/components/board.tsx`, `onContextMenu`).
 *
 * Ce script reproduit le geste RÉEL à la souris (`page.mouse.down` /
 * `page.mouse.up`, bouton droit) — pas un raccourci de test — et vérifie
 * qu'aucune action n'est partie avant un second clic volontaire sur une
 * entrée du menu.
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve :
 * le démon de production n'est pas touché et aucun agent réel n'est lancé.
 */
import { chromium } from 'playwright';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur : lancé depuis
// une copie de travail, il jugerait sinon le code du dossier principal.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7193);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-menu-clic-droit-'));
const SHOTS = '/root/haikodev/data/verification';
fs.mkdirSync(SHOTS, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HAIKODEV_PORT: String(PORT),
    HAIKODEV_HOST: '127.0.0.1',
    HAIKODEV_DATA: DATA,
    HAIKODEV_PROJECTS_ROOT: PROJETS,
    HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

function nettoyer() {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.on('exit', nettoyer);

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

/* ------------------------------------------------------------------ */
/* Le décor : un projet, une carte en « Planifié »                     */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai-menu';
const CARTE_ID = 'c-essai-menu';
const CARTE_TITRE = 'Carte pour le menu du clic droit';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification menu clic droit',
  );

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai — menu clic droit',
    path: DEPOT,
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

  // Colonne « planned » : archivable, et une cible de déplacement au moins
  // (« running ») — de quoi peupler un vrai menu avec plusieurs entrées.
  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    title: CARTE_TITRE,
    description: 'Carte fabriquée par le script de vérification.',
    labels: [],
    column: 'planned',
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    estimate: { machineSeconds: 60, seniorHours: 0.5, confidence: 'medium', failed: false },
    scheduling: { asap: false, attempts: 1, restarts: 0, suspendu: false },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(carte.id, PROJET_ID, 'planned', 1, carte.title, JSON.stringify(carte), maintenant, maintenant);

  db.close();
}

const colonneDeLaCarte = () => {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const ligne = db.prepare('SELECT column_key FROM cards WHERE id = ?').get(CARTE_ID);
  db.close();
  return ligne?.column_key ?? null;
};

const carteExiste = () => {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const n = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE id = ?').get(CARTE_ID).n;
  db.close();
  return n > 0;
};

/* ------------------------------------------------------------------ */

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  await page.goto(`${BASE}/#projet/${PROJET_ID}`, { waitUntil: 'domcontentloaded' });
  const carteLocator = page.locator(`article[data-carte="${CARTE_ID}"]`);
  await carteLocator.waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);

  /* ---------- 1. Un vrai clic droit ouvre le menu, sans rien déclencher ---------- */

  const boite = await carteLocator.boundingBox();
  noter('la carte d’essai est visible sur le tableau', !!boite);
  if (!boite) {
    await navigateur.close();
    process.exit(1);
  }

  // Le point le plus exposé : près du coin haut-droit, là où le menu s'ouvre
  // (l'ancrage invisible), donc là où le relâchement du clic droit tombait
  // jusqu'ici sur la première entrée.
  const x = boite.x + boite.width - 12;
  const y = boite.y + 20;

  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  // Un vrai relâchement de souris n'est jamais instantané : la même durée
  // qu'un clic humain, le temps que le menu ait fini de s'ouvrir avant que
  // le bouton ne se relâche — c'est justement CE relâchement, tombé sur le
  // menu déjà là, qui déclenchait l'action à tort.
  await page.waitForTimeout(120);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(400);

  const menu = page.locator('[role="menu"]:visible');
  noter('le clic droit ouvre bien le menu', (await menu.count()) === 1);
  noter(
    'rien n’a bougé la carte : aucune action n’est partie toute seule au relâchement',
    colonneDeLaCarte() === 'planned',
    `colonne : ${colonneDeLaCarte()}`,
  );
  noter('la carte existe toujours (pas de suppression accidentelle)', carteExiste());
  await page.screenshot({ path: `${SHOTS}/menu-clic-droit-ouvert.png` });

  /* ---------- 2. Un second clic, volontaire, déclenche bien l'action ---------- */

  const archiver = menu.getByText('Archiver la carte', { exact: true });
  noter('l’entrée « Archiver » est proposée', await archiver.isVisible());
  await archiver.click();
  await page.waitForTimeout(800);

  noter(
    'un second clic, volontaire, sur une entrée du menu agit bien',
    colonneDeLaCarte() === 'archived',
    `colonne : ${colonneDeLaCarte()}`,
  );

  /* ---------- 3. Répété plusieurs fois : jamais d'accident ---------- */

  // On repose la carte en « planned » et on répète le geste plusieurs fois :
  // un défaut de timing n'apparaît pas toujours au premier essai.
  let accidents = 0;
  for (let essai = 0; essai < 5; essai += 1) {
    const db = new Database(path.join(DATA, 'haikodev.db'));
    db.prepare('UPDATE cards SET column_key = ? WHERE id = ?').run('planned', CARTE_ID);
    db.close();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await carteLocator.waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    const b = await carteLocator.boundingBox();
    await page.mouse.move(b.x + b.width - 12, b.y + 20);
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(120);
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(300);
    if (colonneDeLaCarte() !== 'planned') accidents += 1;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  noter('cinq clics droits de suite, jamais d’action déclenchée seule', accidents === 0, `${accidents}/5 accidents`);

  noter('aucune erreur dans la page', erreurs.length === 0, erreurs[0] ?? '');

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
  process.exit(echecs ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
