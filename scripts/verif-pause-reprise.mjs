#!/usr/bin/env node
/**
 * Mettre une tâche en PAUSE depuis sa conversation, et la REPRENDRE où elle
 * s'est arrêtée. Contrôle dans un vrai navigateur.
 *
 *   node scripts/verif-pause-reprise.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve :
 * le démon de production n'est pas touché. L'agent qui « travaille » est un
 * décor posé en base — aucun moteur n'est allumé, donc aucun quota dépensé.
 *
 * Ce qui est vérifié :
 *   1. pendant le travail, la bande du haut porte DEUX gestes : pause et arrêt ;
 *   2. un clic sur pause marque la carte (`scheduling.suspendu`), sans la
 *      déplacer, et vide ce qui attendait derrière ;
 *   3. la bande devient alors une bande de reprise, avec son bouton ;
 *   4. laissée seule, la carte ne repart pas : la marque tient.
 *
 * Le CLIC de reprise n'est pas rejoué ici : il rallumerait un vrai moteur et
 * dépenserait du quota. Il est verrouillé autrement, par
 * `server/src/test/pause-agent.test.ts` (même agent, même branche, marque
 * effacée par le seul geste).
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le dépôt d'où le script est lancé : un worktree se vérifie lui-même, jamais
// la copie du dossier partagé.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: Database } = await import(path.join(RACINE, 'node_modules/better-sqlite3/lib/index.js'));

const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7191);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-pause-'));

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
/* Le décor : un projet, une carte en travail, une demande en file     */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const CARTE_ID = 'c-essai';
const AGENT_ID = 'a-essai';
const TITRE = 'Carte d’essai — pause et reprise';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification pause',
  );

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai pause',
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
    cardId: CARTE_ID,
    role: 'task',
    title: TITRE,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'running',
    startedAt: maintenant,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, CARTE_ID, 'task', 'running', JSON.stringify(agent), maintenant, maintenant);

  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    title: TITRE,
    description: 'Carte fabriquée par le script de vérification.',
    labels: [],
    column: 'running',
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    scheduling: { asap: false, attempts: 1, restarts: 0, suspendu: false },
    github: { checks: [], commits: [], activity: [], branch: 'tache/essai-de-pause' },
    agentId: AGENT_ID,
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(carte.id, PROJET_ID, 'running', 1, carte.title, JSON.stringify(carte), maintenant, maintenant);

  // Une demande qui attend derrière : la pause doit la couper.
  const enFile = { id: 'q-essai', agentId: AGENT_ID, text: 'et après, fais ceci', attachments: [], position: 1, createdAt: maintenant };
  db.prepare('INSERT INTO queue (id, agent_id, position, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    enFile.id,
    AGENT_ID,
    1,
    JSON.stringify(enFile),
    maintenant,
  );

  db.close();
}

function lireCarte() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(CARTE_ID);
  db.close();
  return ligne ? JSON.parse(ligne.data) : null;
}

function tailleFile() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const ligne = db.prepare('SELECT COUNT(*) AS n FROM queue WHERE agent_id = ?').get(AGENT_ID);
  db.close();
  return ligne?.n ?? 0;
}

/* ------------------------------------------------------------------ */

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
  const bureau = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await bureau.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await bureau.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  // Ouvrir le tiroir de la carte : la bande de travail vit dans sa conversation.
  await page.locator(`article:has-text(${JSON.stringify(TITRE)})`).first().click();
  await page.waitForTimeout(3000);

  const boutonPause = page.getByRole('button', { name: /Mettre en pause/i }).first();
  const boutonArret = page.getByRole('button', { name: /Arrêter l’action|Arrêter l'action/i }).first();
  noter('pendant le travail, le bouton de pause est là', (await boutonPause.count()) > 0);
  noter('le bouton d’arrêt reste à côté : la pause ne le remplace pas', (await boutonArret.count()) > 0);
  await page.screenshot({ path: path.join(TMP, 'avant-pause.png') });

  await boutonPause.click();
  await page.waitForTimeout(3000);

  const carte = lireCarte();
  noter('la carte est marquée en pause', carte?.scheduling?.suspendu === true, `suspendu ${carte?.scheduling?.suspendu}`);
  noter('la pause ne déplace pas la carte', carte?.column === 'running', `colonne ${carte?.column}`);
  noter('la raison est écrite sur la carte', /pause/i.test(carte?.scheduling?.waitingReason ?? ''), carte?.scheduling?.waitingReason ?? '(aucune)');
  noter('ce qui attendait derrière a été coupé', tailleFile() === 0, `${tailleFile()} demande(s) en file`);

  const texte = await page.locator('body').innerText();
  noter('l’écran dit que le travail est en pause', /en pause/i.test(texte));

  const boutonReprise = page.getByRole('button', { name: /Reprendre où le travail/i }).first();
  noter('le bouton devient un bouton de reprise', (await boutonReprise.count()) > 0);
  noter('le bouton de pause a laissé la place', (await page.getByRole('button', { name: /Mettre en pause/i }).count()) === 0);
  await page.screenshot({ path: path.join(TMP, 'en-pause.png') });

  // Laissée seule, une carte en pause ne repart pas : l'ordonnanceur passe
  // toutes les quinze secondes, on lui laisse un tour entier.
  await page.waitForTimeout(20000);
  noter('laissée seule, la carte ne repart pas', lireCarte()?.scheduling?.suspendu === true);

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
