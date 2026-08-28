#!/usr/bin/env node
/**
 * L'ASSISTANT DE DÉMARRAGE SUR UN SERVEUR NU, dans un vrai navigateur.
 *
 * `scripts/verif-connexion-compte.mjs` juge déjà l'assistant sur une machine où
 * les trois outils sont installés. Il reste le cas qu'aucune machine de travail
 * ne présente jamais : le serveur qui vient d'être monté, où RIEN n'est encore
 * là. C'est pourtant le seul cas qui compte — c'est celui de l'installation.
 *
 * Cinq choses se vérifient :
 *   1. sans aucun outil, l'assistant barre l'écran et le tableau est hors de portée ;
 *   2. les trois moteurs sont proposés, tous « à installer » ;
 *   3. chacun affiche la commande d'installation de son éditeur, en clair ;
 *   4. l'étape « connecter » est annoncée mais en attente : rien à connecter sans outil ;
 *   5. l'outil posé sur la machine ne réclame plus son installation, et une clé
 *      refusée ne fait pas passer son moteur pour « en ligne ».
 *
 *   node scripts/verif-assistant-moteurs.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve, un
 * HOME à lui et les trois binaires de moteur pointés vers un chemin qui
 * n'existe pas : les comptes RÉELS de la machine ne sont ni lus, ni touchés, et
 * aucune commande de moteur n'est lancée.
 */
import { chromium } from 'playwright';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* La racine du dépôt d'où part CE script : depuis une copie de travail, on juge
   le code de la copie, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7214);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-assistant-'));
const SHOTS = path.join(RACINE, 'data', 'verification');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const HOME = path.join(TMP, 'home');
const PROJETS = path.join(TMP, 'projets');
for (const dossier of [DATA, HOME, PROJETS]) fs.mkdirSync(dossier, { recursive: true });

/* AUCUN OUTIL SUR CETTE MACHINE : les trois binaires visent un chemin absent.
   C'est ce qui reproduit un serveur qui vient d'être monté. */
const NULLE_PART = path.join(TMP, 'nulle-part', 'aucun-outil');

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HOME,
    HAIKODEV_PORT: String(PORT),
    HAIKODEV_HOST: '127.0.0.1',
    HAIKODEV_DATA: DATA,
    HAIKODEV_PROJECTS_ROOT: PROJETS,
    HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
    HAIKODEV_CLAUDE_BIN: NULLE_PART,
    HAIKODEV_CODEX_BIN: NULLE_PART,
    HAIKODEV_CURSOR_BIN: NULLE_PART,
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

/** Une session d'une heure, et une base vide : aucun compte, aucun projet. */
function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const t = Date.now() - 60_000;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3600_000,
    'vérification assistant de démarrage',
  );
  for (const table of ['proposals', 'messages', 'agents', 'cards', 'projects', 'accounts']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  db.close();
}

fs.mkdirSync(SHOTS, { recursive: true });
if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}
poserLeDecor();

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});
const contexte = await navigateur.newContext({
  viewport: { width: 1400, height: 900 },
  locale: 'fr-CH',
  serviceWorkers: 'block',
});
await contexte.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
const page = await contexte.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });

/* Le catalogue des moteurs et le relevé des comptes arrivent après le premier
   envoi : l'assistant attend de les AVOIR avant de juger. */
await page.locator('[data-assistant-moteurs="1"]').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => undefined);

/* 1. L'écran est barré. */
const assistant = page.locator('[data-assistant-moteurs="1"]');
noter('sur un serveur sans aucun outil, l’assistant barre l’écran', (await assistant.count()) > 0);
await page.screenshot({ path: path.join(SHOTS, 'assistant-serveur-nu.png') });

/* 2. Les trois moteurs, tous « à installer ». */
const moteurs = page.locator('[data-moteur]');
noter('les trois moteurs sont proposés', (await moteurs.count()) === 3, `${await moteurs.count()} moteur(s)`);
for (const id of ['claude', 'codex', 'cursor']) {
  const etape = await page.locator(`[data-moteur="${id}"]`).getAttribute('data-etape');
  noter(`${id} est annoncé « à installer »`, etape === 'a-installer', etape ?? 'absent');
}

/* 3. La commande d'installation de chaque éditeur, écrite en clair. */
const attendues = {
  claude: 'claude.ai/install.sh',
  codex: '@openai/codex',
  cursor: 'cursor.com/install',
};
for (const [id, morceau] of Object.entries(attendues)) {
  const commande = (await page.locator(`[data-commande-installation="${id}"]`).textContent()) ?? '';
  noter(`${id} affiche sa commande d’installation`, commande.includes(morceau), commande.trim() || 'aucune');
}

/* 4. L'étape « connecter » est annoncée, mais en attente de l'outil. */
for (const id of ['claude', 'codex', 'cursor']) {
  const etat = await page.locator(`[data-moteur="${id}"] [data-etape-connexion]`).getAttribute('data-etape-connexion');
  noter(`${id} annonce l’étape de connexion, en attente`, etat === 'en-attente', etat ?? 'absente');
}
noter(
  'aucun bouton de connexion n’est proposé tant qu’aucun outil n’est là',
  (await page.locator('[data-connecter]').count()) === 0,
);

/*
 * 5. L'OUTIL ET LE COMPTE NE SE CONFONDENT PLUS. On rend l'outil Cursor présent
 * — un script qui répond `--version` — avec une clé qui, elle, sera REFUSÉE.
 * Deux promesses à tenir :
 *   - le moteur ne réclame plus une installation déjà faite (c'est ce que
 *     `EngineInfo.cliInstalle` sépare de `installed`) ;
 *   - une clé refusée ne le fait pas passer pour « en ligne » : l'assistant
 *     reste, et l'étape de connexion s'ouvre.
 * Le cas inverse — un moteur qui répond vraiment referme l'écran — se juge sans
 * navigateur (`server/src/test/assistant-moteurs.test.ts`) : aucun compte
 * valide ne peut être fabriqué ici sans toucher un vrai fournisseur.
 */
const FAUX_CURSOR = path.join(TMP, 'cursor-agent');
fs.writeFileSync(FAUX_CURSOR, '#!/bin/sh\necho "essai 0.0.0"\n');
fs.chmodSync(FAUX_CURSOR, 0o755);

await navigateur.close();
demon.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 1500));

const demon2 = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HOME,
    HAIKODEV_PORT: String(PORT + 1),
    HAIKODEV_HOST: '127.0.0.1',
    HAIKODEV_DATA: DATA,
    HAIKODEV_PROJECTS_ROOT: PROJETS,
    HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
    HAIKODEV_CLAUDE_BIN: NULLE_PART,
    HAIKODEV_CODEX_BIN: NULLE_PART,
    HAIKODEV_CURSOR_BIN: FAUX_CURSOR,
    CURSOR_API_KEY: 'cle-d-essai',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.on('exit', () => {
  try {
    demon2.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
});

const BASE2 = `http://127.0.0.1:${PORT + 1}`;
{
  const fin = Date.now() + 60_000;
  let ouvert = false;
  while (Date.now() < fin && !ouvert) {
    ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT + 1, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (!ouvert) await new Promise((r) => setTimeout(r, 500));
  }
  if (!ouvert) {
    console.error('Le second démon d’essai n’a pas démarré.');
    process.exit(1);
  }
}

const navigateur2 = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});
const contexte2 = await navigateur2.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
await contexte2.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE2, httpOnly: true, sameSite: 'Lax' }]);
const page2 = await contexte2.newPage();
await page2.goto(BASE2, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page2.waitForTimeout(15_000);
const etapeCursor = await page2.locator('[data-moteur="cursor"]').getAttribute('data-etape');
noter(
  'l’outil présent ne réclame plus son installation',
  (await page2.locator('[data-moteur="cursor"] [data-etape-installation="faite"]').count()) === 1,
  etapeCursor ?? 'absent',
);
noter(
  'l’étape de connexion de Cursor s’ouvre dès que l’outil est là',
  (await page2.locator('[data-moteur="cursor"] [data-etape-connexion="a-faire"]').count()) === 1,
);
noter(
  'une clé refusée ne fait pas passer le moteur pour « en ligne »',
  etapeCursor !== 'pret' && (await page2.locator('[data-assistant-moteurs="1"]').count()) === 1,
  etapeCursor ?? 'absent',
);
await page2.screenshot({ path: path.join(SHOTS, 'assistant-outil-pose.png') });

await navigateur2.close();
console.log(`\n${resultats.filter((r) => r.ok).length}/${resultats.length} contrôles passés`);
process.exit(resultats.every((r) => r.ok) ? 0 : 1);
