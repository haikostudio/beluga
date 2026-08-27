#!/usr/bin/env node
/**
 * LE POINT BLEU « TRAVAIL TERMINÉ » : à GAUCHE, à la place de l'icône d'état,
 * seulement quand plus rien ne tourne — et ÉTEINT par la simple VISITE du
 * projet, sans marquer les cartes comme lues (`shared/src/signal-projet.ts`,
 * `RepereRobot`/`ProjectRow` de `web/src/components/sidebar.tsx`) — vérifié
 * dans un VRAI navigateur, sur son PROPRE démon (base neuve, dossier de
 * projets vide, port libre : le démon de production n'est pas touché, aucun
 * quota dépensé).
 *
 *   node scripts/verif-point-bleu-gauche.mjs
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-point-bleu-'));

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
const CARD_ID = 'c-essai';
const TITRE = 'Essai — point bleu à gauche';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification point bleu',
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
    cardId: CARD_ID,
    role: 'task',
    title: 'Agent d’essai',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'done',
    createdAt: maintenant,
    updatedAt: maintenant,
    endedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, CARD_ID, 'task', 'done', JSON.stringify(agent), maintenant, maintenant);

  const carte = {
    id: CARD_ID,
    projectId: PROJET_ID,
    title: 'Carte d’essai',
    agentId: AGENT_ID,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, 'to_deploy', 1, ?, ?, ?, ?)`,
  ).run(CARD_ID, PROJET_ID, carte.title, JSON.stringify(carte), maintenant, maintenant);

  db.close();
}

function lireLastReadAt() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const row = db.prepare('SELECT last_read_at AS luA FROM cards WHERE id = ?').get(CARD_ID);
  db.close();
  return row?.luA ?? null;
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
      pointAGauche: !!ligne.querySelector('[data-repere-termine]'),
      pointADroite: !!ligne.querySelector('[data-signal-termine]'),
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

  const avecTravailRendu = await etatDuRepere(page);
  noter(
    'un travail terminé pas encore visité montre le point bleu À GAUCHE',
    avecTravailRendu.pointAGauche,
    JSON.stringify(avecTravailRendu),
  );
  noter(
    '…et plus À DROITE de la ligne',
    !avecTravailRendu.pointADroite,
    JSON.stringify(avecTravailRendu),
  );
  await page.screenshot({ path: path.join(TMP, 'point-bleu-allume.png') });

  const avantVisite = lireLastReadAt();
  noter('avant la visite, la carte ne porte encore aucun repère de lecture', avantVisite == null, String(avantVisite));

  await page.click(`[data-drag-id="${PROJET_ID}"] button:has-text("${TITRE}")`);
  await page.waitForTimeout(1200);

  const apresVisite = await etatDuRepere(page);
  noter('ouvrir le projet éteint le point bleu', !apresVisite.pointAGauche, JSON.stringify(apresVisite));

  const apresVisiteLastReadAt = lireLastReadAt();
  noter(
    'la visite ne marque PAS la carte comme lue (aucune carte cochée)',
    apresVisiteLastReadAt == null,
    String(apresVisiteLastReadAt),
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
