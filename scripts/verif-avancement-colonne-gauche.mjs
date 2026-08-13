#!/usr/bin/env node
/**
 * LA COLONNE DE GAUCHE : POURCENTAGE D'AVANCEMENT À DROITE D'UN PROJET EN
 * COURS — vérifié dans un VRAI navigateur, sur son PROPRE démon (base neuve,
 * dossier de projets vide, port libre : le démon de production n'est pas
 * touché, aucun quota dépensé).
 *
 *   node scripts/verif-avancement-colonne-gauche.mjs
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
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7195);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-avancement-gauche-'));

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

process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

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

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const CARD_ID = 'c-essai';
const AGENT_ID = 'a-essai';
const TITRE = 'Essai — pourcentage d’avancement';

function poserLeProjetEtLaCarte() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification avancement colonne de gauche',
  );

  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: TITRE,
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

  const carte = {
    id: CARD_ID,
    projectId: PROJET_ID,
    column: 'running',
    position: 1,
    title: 'Carte d’essai',
    description: 'Carte d’essai',
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARD_ID, PROJET_ID, 'running', 1, carte.title, JSON.stringify(carte), maintenant, maintenant);

  db.close();
}

function poserLAgent({ status, done, total }) {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();
  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    cardId: CARD_ID,
    role: 'task',
    title: 'Agent d’essai',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status,
    todos: total ? { done, total } : undefined,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(AGENT_ID, PROJET_ID, CARD_ID, 'task', status, JSON.stringify(agent), maintenant, maintenant);

  db.close();
}

async function ouvrirLaColonne(navigateur) {
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
  await page.waitForTimeout(2500);
  return { page, erreurs };
}

/** Le pourcentage tel qu'il paraît sur la ligne du projet, dans la colonne de gauche. */
async function pourcentDeLaLigne(page) {
  return page.evaluate((projectId) => {
    const ligne = document.querySelector(`[data-drag-id="${projectId}"]`);
    if (!ligne) return { trouve: false };
    const repere = ligne.querySelector('[data-avancement-projet]');
    return { trouve: true, texte: repere ? repere.textContent : null };
  }, PROJET_ID);
}

async function pourcentDuTableau(page) {
  return page.evaluate(() => {
    const repere = document.querySelector('[data-avancement-colonne="running"]');
    return repere ? repere.textContent : null;
  });
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeProjetEtLaCarte();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const { page, erreurs } = await ouvrirLaColonne(navigateur);

  const auRepos = await pourcentDeLaLigne(page);
  noter('sans agent au travail, rien ne s’affiche sur la ligne', auRepos.trouve && !auRepos.texte, JSON.stringify(auRepos));

  // L'agent démarre, sans encore avoir annoncé de liste de tâches : silence.
  poserLAgent({ status: 'running', done: 0, total: 0 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const sansListe = await pourcentDeLaLigne(page);
  noter('un agent au travail sans liste annoncée reste silencieux', !sansListe.texte, JSON.stringify(sansListe));

  // L'agent annonce sa liste : 3 étapes sur 6.
  poserLAgent({ status: 'running', done: 3, total: 6 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.click(`[data-drag-id="${PROJET_ID}"] button`);
  await page.waitForTimeout(1000);
  const enCours = await pourcentDeLaLigne(page);
  const duTableau = await pourcentDuTableau(page);
  noter('le pourcentage apparaît à droite de la ligne', enCours.texte === '50 %', JSON.stringify(enCours));
  noter('il suit le même chiffre que la tête de la colonne « En cours »', enCours.texte === duTableau, `ligne=${enCours.texte} tableau=${duTableau}`);
  await page.screenshot({ path: path.join(TMP, 'avancement-colonne-gauche.png') });

  // Le travail se termine : l'agent n'est plus « running ».
  poserLAgent({ status: 'done', done: 6, total: 6 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const termine = await pourcentDeLaLigne(page);
  noter('le pourcentage disparaît une fois le travail fini', !termine.texte, JSON.stringify(termine));

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(`(captures et journal dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
