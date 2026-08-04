#!/usr/bin/env node
/**
 * Connecter un compte de moteur DEPUIS LES RÉGLAGES, dans un vrai navigateur.
 *
 * Quatre choses se vérifient :
 *   1. un compte dont la connexion ne tient plus le DIT et porte « Reconnecter » ;
 *   2. « Connecter un compte Codex » lance la vraie commande du moteur, et
 *      l'adresse à ouvrir comme le code à saisir s'affichent à l'écran ;
 *   3. une connexion abandonnée dit sa cause, en français, au lieu de se taire ;
 *   4. un compte qui n'a jamais abouti n'entre PAS dans la liste des comptes.
 *
 *   node scripts/verif-connexion-compte.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un HOME à lui : les comptes RÉELS de la machine ne sont ni lus, ni touchés,
 * ni déconnectés. La seule commande lancée est `codex login --device-auth`
 * dans un dossier temporaire, et elle est abandonnée avant d'aboutir.
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

/* La racine du dépôt d'où part CE script : depuis une copie de travail, on juge
   le code de la copie, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7203);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-connexion-'));
const SHOTS = path.join(RACINE, 'data', 'verification');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const HOME = path.join(TMP, 'home');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
/* Le coffre d'un compte déclaré mais JAMAIS connecté : aucun jeton dedans. */
const COFFRE_MORT = path.join(TMP, 'coffre-mort');
for (const dossier of [DATA, HOME, PROJETS, DEPOT, COFFRE_MORT]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HOME,
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

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const t = Date.now() - 60_000;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3600_000,
    'vérification connexion de compte',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  for (const table of ['proposals', 'messages', 'agents', 'cards', 'projects', 'accounts']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }

  /* Un compte déclaré dont le coffre est VIDE : sa connexion n'a jamais tenu. */
  const compte = {
    id: 'codex-mort',
    engine: 'codex',
    label: 'Codex — compte à reconnecter',
    priority: 90,
    configDir: COFFRE_MORT,
  };
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    compte.id,
    compte.engine,
    JSON.stringify(compte),
    t,
  );
  db.close();
}

function comptesDeclares() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const lignes = db.prepare('SELECT id FROM accounts').all().map((l) => l.id);
  db.close();
  return lignes;
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
await page.waitForTimeout(5000);

/* Réglages → onglet « Comptes » */
await page.getByRole('button', { name: 'Menu' }).first().click();
await page.waitForTimeout(600);
await page.getByRole('menuitem', { name: /Réglages/ }).first().click();
await page.waitForTimeout(1200);
await page.getByRole('tab', { name: 'Comptes' }).first().click();
await page.waitForTimeout(2500);

/* 1. Le compte dont la connexion ne tient plus le dit, et porte son bouton. */
const corps = await page.locator('body').textContent();
noter('un compte sans jeton annonce sa connexion absente', /jamais connecté/.test(corps ?? ''), '« jamais connecté »');
const reconnecter = page.getByRole('button', { name: /Reconnecter/ });
noter('ce compte porte un bouton « Reconnecter »', (await reconnecter.count()) > 0);

/* 2. Connecter un compte NEUF : la vraie commande du moteur est lancée. */
const bouton = page.getByRole('button', { name: /Connecter un compte Codex/ });
noter('l’onglet propose de connecter un compte Codex', (await bouton.count()) > 0);
await page.screenshot({ path: path.join(SHOTS, 'connexion-compte-avant.png') });

if (await bouton.count()) {
  await bouton.first().click();

  // Le moteur met quelques secondes à rendre son adresse : on l'attend.
  let lien = '';
  let code = '';
  const fin = Date.now() + 60_000;
  while (Date.now() < fin) {
    // Le lien est lu sur SON ancre : le texte entier de la page colle les
    // éléments les uns aux autres et l'adresse en ressortirait rallongée.
    const ancre = page.locator('a[href^="https://auth.openai.com"]');
    lien = (await ancre.count()) ? ((await ancre.first().getAttribute('href')) ?? '') : '';
    const texte = (await page.locator('body').textContent()) ?? '';
    code = texte.match(/[A-Z0-9]{4}-[A-Z0-9]{4,8}/)?.[0] ?? '';
    if (lien && code) break;
    await page.waitForTimeout(1500);
  }
  noter('l’adresse d’authentification s’affiche', !!lien, lien || 'aucune');
  noter('le code à saisir sur la page s’affiche', !!code, code || 'aucun');
  await page.screenshot({ path: path.join(SHOTS, 'connexion-compte-invite.png') });

  /* 3. Un échec se DIT : on abandonne, la cause doit s'écrire à l'écran. */
  const abandon = page.getByRole('button', { name: /Abandonner/ });
  noter('la connexion en cours peut être abandonnée', (await abandon.count()) > 0);
  if (await abandon.count()) {
    await abandon.first().click();
    let cause = '';
    const finAbandon = Date.now() + 20_000;
    while (Date.now() < finAbandon) {
      const texte = (await page.locator('body').textContent()) ?? '';
      if (/abandonnée à la demande/i.test(texte)) {
        cause = 'Connexion abandonnée à la demande.';
        break;
      }
      await page.waitForTimeout(800);
    }
    noter('la cause de l’échec s’affiche en français', !!cause, cause || 'rien à l’écran');
  }
  await page.screenshot({ path: path.join(SHOTS, 'connexion-compte-echec.png') });

  /* 4. Une tentative ratée ne laisse pas un compte fantôme dans la liste. */
  const declares = comptesDeclares();
  noter(
    'un compte jamais connecté n’entre pas dans la liste',
    declares.length === 1 && declares[0] === 'codex-mort',
    declares.join(', ') || 'aucun',
  );
}

await navigateur.close();
console.log(`\n${resultats.filter((r) => r.ok).length}/${resultats.length} contrôles passés`);
process.exit(resultats.every((r) => r.ok) ? 0 : 1);
