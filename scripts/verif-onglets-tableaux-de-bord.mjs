#!/usr/bin/env node
/**
 * LES ONGLETS DES TABLEAUX DE BORD SUR TÉLÉPHONE (carte « En-tête collant et défilement des pages », 17/11/2026,
 * capture #b0b4) : « Tâches » vient AVANT « À déployer » et « Production », et le dernier onglet touché est retenu.
 *
 * Démon d'essai (base neuve, un projet et une carte « À déployer ») + serveur de développement de la copie branché
 * dessus. Jamais BELUGA_URL, jamais BELUGA_TOKEN. À 390 × 844 :
 *   1. ordre des boutons : Tâches, À déployer, Production ; sans préférence, la page s'ouvre sur « Tâches » ;
 *   2. un appui sur « Production » est écrit en base (`tableaux-de-bord.onglet-telephone`) ;
 *   3. recharger → « Production », sans montrer « Tâches » un instant (éclair : la barre attend les droits du compte) ;
 *   4. un autre appareil (contexte neuf, sans copie locale) → « Production », sans éclair ;
 *   5. une valeur abîmée en base → « Tâches » ;
 *   6. ordinateur (1440) : toujours aucune barre d'onglets.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-onglets-tableaux-de-bord.mjs
 *   VERIF_CAPTURES=/chemin  → captures 390 clair et sombre.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_ONGLETS_PORT || 7215);
const PORT_WEB = Number(process.env.BELUGA_ONGLETS_PORT_WEB || 7116);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });
const CLE = 'tableaux-de-bord.onglet-telephone';

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Le décor, écrit par le magasin du démon AVANT son lancement ---------------- */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-onglets-tdb-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(PROJETS, { recursive: true });
process.env.BELUGA_DATA = DATA;
process.env.BELUGA_PROJECTS_ROOT = PROJETS;
const shared = await import(path.join(RACINE, 'shared/dist/index.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));
const maintenant = Date.now();
const PROJET = 'p-onglets';
store.saveProject(shared.Project.parse({ id: PROJET, name: 'Onglets', path: PROJETS, createdAt: maintenant, updatedAt: maintenant }));
for (const [id, titre, colonne] of [
  ['c-a-deployer', 'Marge du pied', 'to_deploy'],
  ['c-planifiee', 'Volet des tâches', 'planned'],
]) {
  store.saveCard(shared.Card.parse({ id, projectId: PROJET, title: titre, column: colonne, position: 0, run: { engine: 'claude' }, createdAt: maintenant, updatedAt: maintenant }));
}
const jeton = crypto.randomBytes(32).toString('hex');
getDb()
  .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
  .run(crypto.createHash('sha256').update(jeton).digest('hex'), maintenant, maintenant + 3600_000, 'essai onglets tableaux de bord');
const poserPref = (cle, valeur) => getDb().prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(cle, JSON.stringify(valeur), Date.now());
const retirerPref = (cle) => getDb().prepare('DELETE FROM preferences WHERE key = ?').run(cle);
const lirePref = (cle) => {
  const ligne = getDb().prepare('SELECT value FROM preferences WHERE key = ?').get(cle);
  return ligne ? JSON.parse(ligne.value) : undefined;
};

/* ---------------- Le démon d'essai et le serveur de développement branché sur lui ---------------- */

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: { ...process.env, BELUGA_PORT: String(PORT), BELUGA_HOST: '127.0.0.1', BELUGA_DATA: DATA, BELUGA_PROJECTS_ROOT: PROJETS, BELUGA_WEB: path.join(RACINE, 'web', 'dist'), BELUGA_SANS_AMORCE: '1', BELUGA_URL: '', BELUGA_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));
const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'ignore', 'ignore'],
});
const nettoyer = () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
};
process.on('exit', nettoyer);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(1));

async function attendre(url, essais = 90) {
  for (let i = 0; i < essais; i += 1) {
    if (await fetch(url).then(() => true).catch(() => false)) return true;
    await pause(1000);
  }
  return false;
}

/** Chaque valeur prise par la barre d'onglets, dès son premier affichage : un éclair s'y lirait. */
const ESPION = () => {
  window.__ongletsVus = [];
  const noter = () => {
    const v = document.querySelector('[data-onglets-tableaux-de-bord]')?.getAttribute('data-onglets-tableaux-de-bord');
    if (v && window.__ongletsVus[window.__ongletsVus.length - 1] !== v) window.__ongletsVus.push(v);
  };
  new MutationObserver(noter).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-onglets-tableaux-de-bord'] });
};

async function nouveauContexte(navigateur, largeur = 390, hauteur = 844) {
  const contexte = await navigateur.newContext({
    viewport: { width: largeur, height: hauteur },
    isMobile: largeur < 640,
    hasTouch: largeur < 640,
    deviceScaleFactor: 2,
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
  await contexte.addInitScript(ESPION);
  return contexte;
}

async function allerALaPage(page) {
  await page.waitForSelector('nav[data-menu-bas], [data-page-en-route]', { timeout: 60_000 }).catch(() => undefined);
  await pause(1500);
  for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"]').count()); essai += 1) {
    await page.keyboard.press('Escape');
    await pause(400);
  }
  await page.waitForSelector('[data-onglets-tableaux-de-bord]', { timeout: 30_000 }).catch(() => undefined);
  await pause(800);
}

const etat = (page) =>
  page.evaluate(() => ({
    onglet: document.querySelector('[data-onglets-tableaux-de-bord]')?.getAttribute('data-onglets-tableaux-de-bord') ?? null,
    ordre: [...document.querySelectorAll('[data-onglets-tableaux-de-bord] [data-onglet]')].map((o) => o.getAttribute('data-onglet')),
    vus: [...(window.__ongletsVus ?? [])],
  }));

let navigateur;
try {
  if (!(await attendre(`http://127.0.0.1:${PORT}/`))) throw new Error('le démon d’essai n’a pas démarré :\n' + journal.join('').slice(-2000));
  if (!(await attendre(BASE))) throw new Error('le serveur de développement n’a pas démarré');
  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  for (const clarte of ['clair', 'sombre']) {
    console.log(`\n— Téléphone 390, ${clarte}`);
    poserPref('theme', clarte);
    retirerPref(CLE);
    const contexte = await nouveauContexte(navigateur);
    const page = await contexte.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await allerALaPage(page);
    let m = await etat(page);
    verifier('ordre : Tâches, À déployer, Production', m.ordre.join(',') === 'taches,a-deployer,production', m.ordre.join(','));
    verifier('sans préférence, la page s’ouvre sur « Tâches »', m.onglet === 'taches' && m.vus.join(',') === 'taches', m.vus.join(' → '));

    if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `onglets-taches-390-${clarte}.png`) });

    await page.locator('[data-onglets-tableaux-de-bord] [data-onglet="production"]').click();
    await pause(1200);
    m = await etat(page);
    verifier('un appui sur « Production » l’affiche', m.onglet === 'production');
    verifier('le choix est écrit en base', lirePref(CLE) === 'production', JSON.stringify(lirePref(CLE)));
    if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `onglets-production-390-${clarte}.png`) });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await allerALaPage(page);
    m = await etat(page);
    verifier('rechargée, la page se rouvre sur « Production », sans éclair', m.onglet === 'production' && m.vus.join(',') === 'production', m.vus.join(' → '));
    await contexte.close();

    const autre = await nouveauContexte(navigateur);
    const page2 = await autre.newPage();
    await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
    await allerALaPage(page2);
    m = await etat(page2);
    verifier('un autre appareil s’ouvre aussi sur « Production », sans éclair', m.onglet === 'production' && m.vus.join(',') === 'production', m.vus.join(' → '));
    await page2.locator('[data-onglets-tableaux-de-bord] [data-onglet="a-deployer"]').click();
    await pause(1200);
    verifier('« À déployer » est retenu à son tour', lirePref(CLE) === 'a-deployer', JSON.stringify(lirePref(CLE)));
    await autre.close();

    poserPref(CLE, 'onglet-disparu');
    const troisieme = await nouveauContexte(navigateur);
    const page3 = await troisieme.newPage();
    await page3.goto(BASE, { waitUntil: 'domcontentloaded' });
    await allerALaPage(page3);
    m = await etat(page3);
    verifier('une valeur abîmée en base retombe sur « Tâches »', m.onglet === 'taches', String(m.onglet));
    await troisieme.close();
  }

  console.log('\n— Ordinateur 1440');
  poserPref(CLE, 'production');
  const ordi = await nouveauContexte(navigateur, 1440, 900);
  const p = await ordi.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-page-en-route]', { timeout: 60_000 }).catch(() => undefined);
  await pause(2000);
  verifier('ordinateur : aucune barre d’onglets', (await p.locator('[data-onglets-tableaux-de-bord]').count()) === 0);
  await ordi.close();
} catch (err) {
  verifier('le contrôle a pu aller au bout', false, err instanceof Error ? err.message : String(err));
} finally {
  await navigateur?.close();
}

const echecs = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis.`);
process.exit(echecs ? 1 : 0);
