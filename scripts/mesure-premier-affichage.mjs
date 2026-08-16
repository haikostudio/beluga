#!/usr/bin/env node
/**
 * COMBIEN DE TEMPS AVANT LA PREMIÈRE CARTE ?
 *
 * Ce script MESURE, il ne juge pas : il sert à comparer un avant et un après.
 * Il monte son PROPRE démon (base neuve, dossier de projets vide, port libre :
 * le démon de production n'est pas touché, aucun quota dépensé), pose un projet
 * avec ses cartes et beaucoup d'agents anciens, puis ouvre un vrai navigateur —
 * en simulant au besoin un téléphone et un réseau lent.
 *
 * Trois instants relevés, depuis l'ouverture de la page :
 *   - le premier envoi du serveur (« ready ») : rien ne s'affiche avant lui ;
 *   - l'arrivée des cartes (« project.snapshot ») ;
 *   - la première VRAIE carte posée à l'écran, silhouettes disparues.
 *
 * Et le POIDS de ce qui est descendu jusque-là, qui est l'autre moitié du
 * temps d'attente sur un téléphone.
 *
 *   node scripts/mesure-premier-affichage.mjs
 *   node scripts/mesure-premier-affichage.mjs --agents 1200 --cartes 60
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
const PORT = Number(process.env.HAIKODEV_MESURE_PORT || 7198);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mesure-affichage-'));

const argument = (nom, defaut) => {
  const i = process.argv.indexOf(nom);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : defaut;
};
/** Des agents ANCIENS, de projets qu'on n'ouvre pas : le poids du passé. */
const AGENTS = argument('--agents', 1000);
const CARTES = argument('--cartes', 50);
/** Un deuxième projet, qui porte les agents anciens sans être celui qu'on ouvre. */
const PROJET_ID = 'p-mesure';
const PROJET_VOISIN = 'p-mesure-voisin';

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

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'mesure du premier affichage',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const poserProjet = (id, nom, rang) => {
    const projet = {
      id,
      name: nom,
      path: DEPOT,
      defaultEngine: 'claude',
      isSelf: false,
      rank: rang,
      archived: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(id, nom, DEPOT, JSON.stringify(projet), maintenant, maintenant);
  };
  poserProjet(PROJET_ID, 'Projet ouvert', 0);
  poserProjet(PROJET_VOISIN, 'Projet voisin', 1);

  const poserCarte = db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, 'planned', ?, ?, ?, '{}', ?, ?)`,
  );
  const poserAgent = db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, 'task', 'done', ?, ?, ?)`,
  );
  // Un agent ancien porte son résumé de continuité : c'est ce qui pèse.
  const resume = 'Résumé de continuité de cet agent. '.repeat(20);
  const vieux = maintenant - 30 * 24 * 3600_000;
  db.transaction(() => {
    for (let i = 0; i < CARTES; i += 1) {
      poserCarte.run(`c-mesure-${i}`, PROJET_ID, i, `Carte ${i}`, 'Carte d’essai', maintenant, maintenant);
    }
    for (let i = 0; i < AGENTS; i += 1) {
      const agent = {
        id: `a-mesure-${i}`,
        projectId: PROJET_VOISIN,
        role: 'task',
        title: `Agent terminé n° ${i}`,
        run: { engine: 'claude', thinking: 'none', mode: 'direct' },
        status: 'done',
        workdir: `/root/essai/.worktrees/agent-${i}`,
        context: { tokens: 1000, window: 200000, ratio: 0.005, armed: true, pending: false, continuitySummary: resume },
        endedAt: vieux,
        createdAt: vieux,
        updatedAt: vieux,
      };
      poserAgent.run(agent.id, PROJET_VOISIN, JSON.stringify(agent), vieux, vieux);
    }
  })();
  db.close();
}

async function mesurer({ telephone, reseauLent }) {
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1400, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  if (reseauLent) {
    // Un réseau de téléphone ordinaire : le poids du premier envoi devient du temps.
    const session = await contexte.newCDPSession(page);
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
  }

  const instants = { ready: null, cartes: null };
  let octets = 0;
  const depart = Date.now();
  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      const charge = frame.payload;
      octets += typeof charge === 'string' ? Buffer.byteLength(charge) : charge.length;
      try {
        const event = JSON.parse(charge);
        if (event.type === 'ready' && instants.ready === null) instants.ready = Date.now() - depart;
        if (event.type === 'project.snapshot' && instants.cartes === null) instants.cartes = Date.now() - depart;
      } catch {
        /* pas du JSON : ignoré */
      }
    });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-carte]', { timeout: 60000 });
  const premiereCarte = Date.now() - depart;
  const silhouettes = await page.locator('[data-silhouette]').count();
  await navigateur.close();
  return { ...instants, premiereCarte, ko: Math.round(octets / 1024), silhouettes };
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  // Le décor est posé dans la base du démon déjà lancé : il la relit à chaque
  // demande, aucun redémarrage n'est nécessaire.
  poserLeDecor();

  console.log(`Décor : ${CARTES} cartes dans le projet ouvert, ${AGENTS} agents anciens dans un projet voisin.\n`);
  for (const cas of [
    { titre: 'ordinateur, réseau local', telephone: false, reseauLent: false },
    { titre: 'téléphone, réseau ordinaire', telephone: true, reseauLent: true },
  ]) {
    const m = await mesurer(cas);
    console.log(`  ${cas.titre}`);
    console.log(`    premier envoi (« ready »)      ${m.ready} ms`);
    console.log(`    cartes reçues                  ${m.cartes} ms`);
    console.log(`    première carte à l’écran       ${m.premiereCarte} ms`);
    console.log(`    descendu jusque-là             ${m.ko} Ko`);
    console.log(`    silhouettes restantes          ${m.silhouettes}\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
