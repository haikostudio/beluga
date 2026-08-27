#!/usr/bin/env node
/**
 * LA COLONNE DE GAUCHE : L'ICÔNE DE PLAN sur un projet dont un plan proposé
 * attend encore une décision — vérifié dans un VRAI navigateur, sur son PROPRE
 * démon (base neuve, dossier de projets vide, port libre : le démon de
 * production n'est pas touché, aucun quota dépensé).
 *
 * LA BORDURE BLANCHE N'EXISTE PLUS, et ce n'est pas une panne : les lignes de
 * projet sont NUES depuis le 13/08/2026 (« lignes de projet sans cadre ni
 * fond »), l'état ne vivant plus que sur l'icône de gauche et le repère de
 * droite. Ce contrôle a donc cessé de la réclamer — il vérifie en revanche
 * qu'AUCUNE bordure ne revient, pour que la règle des lignes nues tienne.
 *
 *   node scripts/verif-repere-plan.mjs
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
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7194);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-repere-plan-'));

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
const AGENT_ID = 'a-essai';
const TITRE = 'Essai — repère de plan';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification repère de plan',
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

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    role: 'cadrage',
    title: 'Chef d’essai',
    run: { engine: 'claude', thinking: 'none', mode: 'plan' },
    status: 'done',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, 'cadrage', 'done', JSON.stringify(agent), maintenant, maintenant);

  db.close();
}

function poserUnMessage({ content, plan, createdAt }) {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const message = {
    id: crypto.randomUUID(),
    agentId: AGENT_ID,
    role: 'assistant',
    content,
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    streaming: false,
    plan,
    createdAt,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id,
    AGENT_ID,
    'assistant',
    JSON.stringify(message),
    createdAt,
  );
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

/** Le repère du projet, tel qu'il paraît sur sa ligne de la colonne de gauche. */
async function etatDuRepere(page) {
  return page.evaluate((projectId) => {
    const ligne = document.querySelector(`[data-drag-id="${projectId}"]`);
    if (!ligne) return { trouve: false };
    return {
      trouve: true,
      planAttribut: ligne.getAttribute('data-projet-plan'),
      // La ligne doit rester NUE : aucun anneau, aucune bordure de couleur.
      ring: /\bring-|border-(?!transparent)/.test(ligne.className),
      badge: !!ligne.querySelector('[data-repere-plan]'),
    };
  }, PROJET_ID);
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const { page, erreurs } = await ouvrirLaColonne(navigateur);

  const auRepos = await etatDuRepere(page);
  noter('au repos, sans plan écrit, la ligne ne porte aucun repère', !auRepos.badge && !auRepos.ring, JSON.stringify(auRepos));

  poserUnMessage({ content: '## Faisabilité\n\nPossible.', plan: true, createdAt: Date.now() });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const avecPlan = await etatDuRepere(page);
  noter('un plan qui attend une décision pose son icône', avecPlan.badge, JSON.stringify(avecPlan));
  noter('…et la ligne reste NUE : aucune bordure ne revient', !avecPlan.ring, JSON.stringify(avecPlan));
  await page.screenshot({ path: path.join(TMP, 'repere-plan-allume.png') });

  poserUnMessage({ content: 'Vas-y, lance ce plan.', plan: false, createdAt: Date.now() + 1000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const apresValidation = await etatDuRepere(page);
  noter(
    'un message qui suit le plan (validé/refusé) éteint le repère',
    !apresValidation.ring && !apresValidation.badge,
    JSON.stringify(apresValidation),
  );
  await page.screenshot({ path: path.join(TMP, 'repere-plan-eteint.png') });

  poserUnMessage({ content: '## Faisabilité\n\nVersion 2.', plan: true, createdAt: Date.now() + 2000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const nouvellVersion = await etatDuRepere(page);
  noter(
    'une nouvelle version du plan rallume le repère',
    nouvellVersion.badge && !nouvellVersion.ring,
    JSON.stringify(nouvellVersion),
  );

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
