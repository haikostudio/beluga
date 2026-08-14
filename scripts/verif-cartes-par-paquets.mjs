#!/usr/bin/env node
/**
 * LES CARTES ARRIVENT PAR PAQUETS DE VINGT, ET LE COMPTEUR DIT LE TOTAL RÉEL —
 * vérifié dans un VRAI navigateur, sur son PROPRE démon (base neuve, dossier de
 * projets vide, port libre : le démon de production n'est pas touché, aucun
 * quota dépensé).
 *
 *   node scripts/verif-cartes-par-paquets.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7197);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-paquets-'));

/** Combien de cartes on pose dans la colonne « Planifié ». */
const CARTES = 75;
const PAQUET = 20;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

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

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
      db.close();
      if (table) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-paquets';

function poserLeProjetEtSesCartes() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification des paquets de cartes',
  );

  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Projet à beaucoup de cartes',
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

  const poser = db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, 'planned', ?, ?, ?, '{}', ?, ?)`,
  );
  db.transaction(() => {
    for (let i = 0; i < CARTES; i += 1) {
      poser.run(`c-paquet-${i}`, PROJET_ID, i, `Carte ${i}`, 'Carte d’essai', maintenant, maintenant);
    }
  })();
  db.close();
}

async function ouvrir(navigateur) {
  const contexte = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-column="planned"] [data-carte]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  return { page, erreurs };
}

const cartesPosees = (page) =>
  page.evaluate(() => document.querySelectorAll('[data-column="planned"] [data-carte]').length);

/** Le chiffre affiché à côté du titre de la colonne. */
const compteurDeLaColonne = (page) =>
  page.evaluate(() => {
    const colonne = document.querySelector('[data-column="planned"]');
    const titre = colonne?.querySelector('h2');
    return titre?.nextElementSibling?.textContent?.trim() ?? null;
  });

/** Faire défiler la colonne jusqu'en bas de ce qui est posé. */
async function defilerLaColonne(page) {
  await page.evaluate(() => {
    const colonne = document.querySelector('[data-column="planned"]');
    const zone = colonne?.querySelector('[data-carte]')?.closest('div[class*="overflow-y-auto"]');
    const defilante =
      zone ??
      Array.from(colonne?.querySelectorAll('div') ?? []).find((n) => n.scrollHeight > n.clientHeight + 10);
    if (defilante) defilante.scrollTop = defilante.scrollHeight;
  });
  await page.waitForTimeout(900);
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  if (!(await attendreLaBase())) {
    console.error(`La base d’essai est restée vide : le port ${PORT} est peut-être déjà pris.`);
    process.exit(1);
  }
  poserLeProjetEtSesCartes();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  try {
    const { page, erreurs } = await ouvrir(navigateur);

    const dabord = await cartesPosees(page);
    noter(
      `la colonne ne pose que son premier paquet de ${PAQUET} cartes`,
      dabord === PAQUET,
      `${dabord} carte(s) posée(s) sur ${CARTES}`,
    );

    const compteur = await compteurDeLaColonne(page);
    noter(
      'le compteur de la tête de colonne dit le TOTAL réel',
      compteur === String(CARTES),
      `compteur « ${compteur} », total ${CARTES}`,
    );

    const palier = await page.evaluate(
      () => document.querySelector('[data-palier-cartes="planned"]')?.getAttribute('data-cartes-restantes') ?? null,
    );
    noter(
      'le palier de chargement annonce ce qui reste',
      palier === String(CARTES - PAQUET),
      `palier « ${palier} », attendu ${CARTES - PAQUET}`,
    );

    await defilerLaColonne(page);
    const apres = await cartesPosees(page);
    noter(
      'le défilement fait arriver le paquet suivant',
      apres > dabord,
      `${dabord} carte(s) puis ${apres}`,
    );

    // Jusqu'au bout : plus aucun palier, et toutes les cartes posées.
    for (let i = 0; i < 6; i += 1) await defilerLaColonne(page);
    const auBout = await cartesPosees(page);
    const palierRestant = await page.evaluate(() => !!document.querySelector('[data-palier-cartes="planned"]'));
    noter(
      'au bout du défilement, toute la colonne est posée et le palier disparaît',
      auBout === CARTES && !palierRestant,
      `${auBout} carte(s) posée(s), palier ${palierRestant ? 'encore là' : 'parti'}`,
    );

    noter('aucune erreur de page', erreurs.length === 0, erreurs[0] ?? '');
    await page.context().close();
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log('');
  console.log(`${resultats.length - echecs.length}/${resultats.length} contrôle(s) au vert.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
