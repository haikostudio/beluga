#!/usr/bin/env node
/**
 * Le menu de choix du modèle dit-il la VÉRITÉ sur sa liste ?
 *
 * Deux choses se vérifient dans un vrai navigateur :
 *   1. tous les modèles rendus par le moteur sont proposés — aucun n'est
 *      escamoté par un homonyme (dédoublonnage par identifiant) ;
 *   2. quand le catalogue n'a pas pu être lu, le menu ANNONCE une liste de
 *      secours et en donne la cause, au lieu de laisser croire à une liste
 *      complète.
 *
 *   node scripts/verif-liste-modeles.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve ;
 * il garde le HOME de la machine pour que les comptes réels soient déclarés —
 * c'est ce qui décide si la liste est vraie ou de secours. Aucun moteur n'est
 * lancé, rien n'est publié.
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
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
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7198);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-modeles-'));
const SHOTS = path.join(RACINE, 'data', 'verification');

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
const AGENT_ID = 'a-chef-essai';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const t = Date.now() - 60_000;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3600_000,
    'vérification liste des modèles',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  for (const table of ['proposals', 'messages', 'agents', 'cards', 'projects']) db.prepare(`DELETE FROM ${table}`).run();

  const projet = {
    id: PROJET_ID,
    name: 'Essai modèles',
    path: DEPOT,
    defaultEngine: 'codex',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    role: 'orchestrator',
    title: 'Chef d’orchestre — Essai modèles',
    run: { engine: 'codex', thinking: 'medium', mode: 'direct' },
    status: 'done',
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, 'orchestrator', 'done', ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, JSON.stringify(agent), t, t);
  db.close();
}

fs.mkdirSync(SHOTS, { recursive: true });
if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}
poserLeDecor();

/* Ce que le serveur annonce : c'est la référence à laquelle comparer l'écran.
   On relit le catalogue avec le code du démon, sur les comptes de la machine. */
process.env.HAIKODEV_DATA = DATA;
const { listEngines } = await import(path.join(RACINE, 'server', 'dist', 'engines', 'index.js'));
const moteurs = await listEngines(true);
const codex = moteurs.find((e) => e.id === 'codex');
if (codex) {
  console.log(
    `Catalogue Codex du serveur : ${codex.models.length} modèle(s), liste ${codex.live ? 'du moteur' : 'de secours'}` +
      (codex.catalogError ? ` (${codex.catalogError})` : ''),
  );
}

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
await page.waitForTimeout(6000);

const chef = page.getByRole('button', { name: /^Chef/ });
if (await chef.count()) {
  await chef.first().click();
  await page.waitForTimeout(2000);
}

/* Le menu du modèle : le deuxième réglage de la barre d'écriture. */
const menu = page.locator('[data-selecteur="modele"]');
const ouvert = await menu.count();
noter('le menu de choix du modèle est à l’écran', ouvert > 0, `${ouvert} bouton(s)`);
if (ouvert) {
  await menu.first().click();
  await page.waitForTimeout(1200);
  const lignes = await page.locator('[role="menuitem"]').allTextContents();
  const repli = await page.locator('[data-repli="liste-de-secours"]').first();
  const aRepli = (await repli.count()) > 0;
  const texteRepli = aRepli ? (await repli.textContent())?.trim() : '';

  console.log(`Modèles affichés dans le menu : ${lignes.length}`);
  for (const ligne of lignes) console.log(`  · ${ligne.replace(/\s+/g, ' ').trim()}`);

  const attendus = codex?.models?.length ?? 0;
  noter(
    'le menu montre exactement les modèles du serveur',
    attendus > 0 && lignes.length === attendus,
    `${lignes.length} affiché(s) pour ${attendus} annoncé(s)`,
  );
  noter(
    'aucun modèle n’est escamoté par un homonyme',
    new Set((codex?.models ?? []).map((m) => m.id)).size === attendus,
    `${new Set((codex?.models ?? []).map((m) => m.id)).size} identifiants distincts`,
  );
  if (codex && !codex.live) {
    noter('la liste de secours est annoncée dans le menu', aRepli && /secours/i.test(texteRepli), texteRepli || 'rien');
  } else {
    noter('une liste venue du moteur n’affiche aucun avertissement', !aRepli, texteRepli || 'aucun');
  }
  await page.screenshot({ path: path.join(SHOTS, 'liste-modeles.png') });
}

await navigateur.close();
console.log(`\n${resultats.filter((r) => r.ok).length}/${resultats.length} contrôles passés`);
process.exit(resultats.every((r) => r.ok) ? 0 : 1);
