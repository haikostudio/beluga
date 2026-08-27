#!/usr/bin/env node
/**
 * Un clic sur une notification POUSSÉE (téléphone, application déjà ouverte
 * dans un autre onglet) doit emmener au bon endroit — exactement comme la
 * cloche du bandeau du haut (`verif-questions-en-attente.mjs`), mais par un
 * chemin différent : le service worker (`web/public/sw.js`) reçoit le clic et
 * poste un message à l'onglet ouvert, qui doit router avec la MÊME règle
 * (`client.allerVersDecision`, `web/src/lib/client.ts`) — carte si elle en a
 * une, sinon la conversation de l'agent.
 *
 * Le vrai Push API exige un abonnement et un aller-retour réseau chiffré,
 * hors de portée d'un script de vérification. On simule donc exactement ce
 * que fait `sw.js` à la réception d'un clic : poster un message
 * `{ type: 'OPEN_CARD', cardId, projectId, agentId }` sur
 * `navigator.serviceWorker` (un simple `EventTarget`, sans service worker
 * réel nécessaire pour ça) — c'est le geste qu'`app.tsx` écoute.
 *
 *   npm run build && node scripts/verif-notifications-poussees.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7193);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-notifs-poussees-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DOSSIER_A = path.join(TMP, 'projet-a');
const DOSSIER_B = path.join(TMP, 'projet-b');
// Un HOME vide, à soi : sans lui, le démon retrouve les vrais identifiants de
// la machine — inutile ici (aucune réponse n'est envoyée), mais par sécurité.
const HOME_VIDE = path.join(TMP, 'home');
for (const dossier of [DATA, PROJETS, DOSSIER_A, DOSSIER_B, HOME_VIDE]) fs.mkdirSync(dossier, { recursive: true });

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HOME: HOME_VIDE,
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
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_A = 'p-notifs-a';
const PROJET_B = 'p-notifs-b';
const CARD_ID = 'c-notifs-a';
const AGENT_TACHE = 'a-notifs-tache';
const AGENT_CHEF = 'a-notifs-chef';
const base = () => new Database(path.join(DATA, 'haikodev.db'));

const marque = Date.now();
const TEXTES = {
  carte: `Poussée ${marque} — quelle couleur pour le bouton ?`,
  conversation: `Poussée ${marque} — faut-il archiver ce projet ?`,
};

function inserProjet(db, id, nom, dossier, rang, maintenant) {
  const projet = {
    id,
    name: nom,
    path: dossier,
    defaultEngine: 'claude',
    isSelf: false,
    rank: rang,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification notifications poussées',
  );

  db.prepare('DELETE FROM projects').run();
  inserProjet(db, PROJET_A, `Essai poussées A ${marque}`, DOSSIER_A, 1, maintenant);
  inserProjet(db, PROJET_B, `Essai poussées B ${marque}`, DOSSIER_B, 2, maintenant);

  const carte = {
    id: CARD_ID,
    projectId: PROJET_A,
    column: 'running',
    position: 1,
    title: 'Carte en attente d’une décision',
    description: 'Carte en attente d’une décision',
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARD_ID, PROJET_A, 'running', 1, carte.title, JSON.stringify(carte), maintenant, maintenant);

  const agentTache = {
    id: AGENT_TACHE,
    projectId: PROJET_A,
    cardId: CARD_ID,
    role: 'task',
    title: 'Carte en attente d’une décision',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(agentTache.id, PROJET_A, CARD_ID, 'task', 'idle', JSON.stringify(agentTache), maintenant, maintenant);

  const agentChef = {
    id: AGENT_CHEF,
    projectId: PROJET_B,
    role: 'cadrage',
    title: `Chef d'orchestre — Essai poussées B ${marque}`,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(agentChef.id, PROJET_B, 'cadrage', 'idle', JSON.stringify(agentChef), maintenant, maintenant);

  db.close();
}

function poserQuestion(agentId, texte) {
  const db = base();
  const id = crypto.randomUUID();
  const message = {
    id,
    agentId,
    role: 'assistant',
    content: 'Question posée par le script de vérification.',
    steps: [],
    todos: [],
    proposals: [],
    questions: [
      { id: crypto.randomUUID(), question: texte, kind: 'text', options: [], allowFreeText: true, answerAttachments: [] },
    ],
    downloads: [],
    attachments: [],
    streaming: false,
    createdAt: Date.now(),
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    agentId,
    'assistant',
    JSON.stringify(message),
    message.createdAt,
  );
  db.close();
}

async function main() {
  if (!(await attendrePort())) {
    console.error(`Le démon d'essai n'a pas démarré :\n${journal.join('')}`);
    process.exit(1);
  }
  poserLeDecor();
  poserQuestion(AGENT_TACHE, TEXTES.carte);
  poserQuestion(AGENT_CHEF, TEXTES.conversation);
  await new Promise((r) => setTimeout(r, 1000));

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await navigateur.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    // Le vrai service worker n'a rien à faire ici : on simule seulement le
    // message qu'il poste à l'onglet ouvert.
    serviceWorkers: 'block',
  });
  await context.addCookies([{ name: 'haikodev_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on(
    'console',
    (m) => m.type() === 'error' && !/Failed to load resource.*503/.test(m.text()) && erreurs.push(m.text()),
  );

  const projetsOuverts = [];
  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      try {
        const msg = JSON.parse(frame.payload);
        const cmd = msg.cmd ?? msg;
        if (cmd.type === 'project.open') projetsOuverts.push(cmd.id);
      } catch {
        /* pas ce message */
      }
    });
  });

  // Un clic sur une notification poussée, simulé exactement comme `sw.js` le
  // fait pour un onglet déjà ouvert : un message posté sur
  // `navigator.serviceWorker` (un simple EventTarget, sans service worker
  // réel nécessaire pour le recevoir).
  const simulerClicNotification = (detail) =>
    page.evaluate((d) => {
      navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'OPEN_CARD', ...d } }));
    }, detail);

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    /* ---- 1. Notification d'une question de CARTE : projet + carte ---- */
    await simulerClicNotification({ projectId: PROJET_A, cardId: CARD_ID });
    await page.waitForTimeout(2000);
    noter('le clic ouvre bien le projet A', projetsOuverts.at(-1) === PROJET_A);
    noter('la question de la carte est visible', (await page.getByText(TEXTES.carte).count()) > 0);

    /* ---- 2. Notification d'une question du CHEF (sans carte) : projet
       + conversation ---- */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await simulerClicNotification({ projectId: PROJET_B, agentId: AGENT_CHEF });
    await page.waitForTimeout(2000);
    noter('le clic ouvre bien le projet B (pas resté sur A)', projetsOuverts.at(-1) === PROJET_B);
    noter(
      'le tiroir de la carte du projet A ne reste pas planté par-dessus la conversation',
      (await page.locator('[data-tags-carte]').count()) === 0,
    );
    noter('la question de conversation est visible', (await page.getByText(TEXTES.conversation).count()) > 0);

    noter('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
  } finally {
    await context.close();
    await navigateur.close().catch(() => {});
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
