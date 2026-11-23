#!/usr/bin/env node
/**
 * L'APPLICATION ROUVRE TOUJOURS, MÊME APRÈS UNE COUPURE DU TÉLÉPHONE.
 *
 * Demande du 26/10/2026 : à la réouverture sur iPhone, Safari affichait parfois
 * « Un problème récurrent est survenu » (page tuée pendant son démarrage). Ce
 * contrôle rejoue, dans un iPhone émulé (WebKit) et sur son PROPRE démon :
 *
 *   1. un démarrage normal pose le marqueur « démarrage en cours », puis
 *      l'efface une fois le premier état reçu et resté stable ;
 *   2. un marqueur laissé par une page morte en route fait démarrer ALLÉGÉ :
 *      la copie locale est jetée au lieu d'être relue ;
 *   3. la pastille d'un projet demande une MINIATURE (`w=`), jamais l'icône
 *      entière (2048 px = 16 Mo d'image décodée).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-demarrage-allege.mjs
 *
 * Règles : `shared/src/demarrage-allege.ts`.
 */
import { webkit, devices } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_DEMARRAGE_PORT || 7241);
const BASE = `http://127.0.0.1:${PORT}`;
const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-demarrage-allege-', port: PORT });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET = 'p-demarrage';
const CLE_MARQUEUR = 'beluga.demarrage-en-cours';
const CLE_COPIE = 'beluga.dernier-etat';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push(ok);
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

async function attendreLaBase(limiteMs = 30_000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const pret = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cards'").get();
      db.close();
      if (pret) return true;
    } catch {
      /* la base n'existe pas encore */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t, t + 3_600_000, 'contrôle du démarrage allégé');
  const projet = { id: PROJET, name: 'Projet du démarrage', path: DEPOT, favicon: `/api/favicon?project=${PROJET}&t=1`, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: t, updatedAt: t };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, DEPOT, JSON.stringify(projet), t, t);
  db.prepare(`INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at) VALUES ('c-demarrage', ?, 'planned', 0, 'Carte du démarrage', '', '{}', ?, ?)`).run(PROJET, t, t);
  db.close();
  /* Une icône de 1024 px, comme celles que le démon rapporte des sites. */
  fs.mkdirSync(path.join(DATA, 'favicons'), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=1024x1024', '-frames:v', '1', path.join(DATA, 'favicons', `${PROJET}.png`)]);
}

let code = 1;
let navigateur;
try {
  if (!(await attendreLaBase())) throw new Error('la base du démon d’essai n’apparaît pas');
  poserLeDecor();
  await attendrePort();
  navigateur = await webkit.launch();
  const contexte = await navigateur.newContext({ ...devices['iPhone 13'], locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  const icones = [];
  page.on('request', (r) => { if (r.url().includes('/api/favicon')) icones.push(r.url()); });

  await page.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByText('Carte du démarrage').first().waitFor({ timeout: 30_000 });
  noter('1. le démarrage pose son marqueur', !!(await page.evaluate((c) => localStorage.getItem(c), CLE_MARQUEUR)));
  await page.waitForTimeout(10_000);
  noter('1. …et l’efface une fois le premier état stable', (await page.evaluate((c) => localStorage.getItem(c), CLE_MARQUEUR)) === null);
  noter('1. la copie locale est écrite', ((await page.evaluate((c) => localStorage.getItem(c), CLE_COPIE)) ?? '').length > 0);

  /* LA PAGE MEURT EN ROUTE : le marqueur reste. Au chargement suivant, la copie est jetée. */
  /* Le canal est coupé pour ce chargement : seule la copie pourrait dessiner le tableau. */
  await page.evaluate((c) => localStorage.setItem(c, String(Date.now())), CLE_MARQUEUR);
  await page.routeWebSocket(/\/ws$/, () => {});
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4_000);
  const copieJetee = await page.evaluate((c) => localStorage.getItem(c) === null, CLE_COPIE);
  const dessineeDeLaCopie = (await page.getByText('Carte du démarrage').count()) > 0;
  noter('2. après une coupure, le démarrage suivant jette la copie locale', copieJetee && !dessineeDeLaCopie);
  /* Le canal revient (nouvel onglet, même stockage) : le tableau s'affiche, le marqueur s'efface. */
  await page.close();
  const suite = await contexte.newPage();
  suite.on('pageerror', (e) => erreurs.push(String(e)));
  await suite.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await suite.getByText('Carte du démarrage').first().waitFor({ timeout: 30_000 });
  noter('2. …et le tableau s’affiche quand même', true);
  await suite.waitForTimeout(10_000);
  noter('2. …puis le marqueur s’efface', (await suite.evaluate((c) => localStorage.getItem(c), CLE_MARQUEUR)) === null);

  /* La colonne des projets, sur grand écran : la pastille de chaque projet. */
  const bureau = await contexte.browser().newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await bureau.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const grande = await bureau.newPage();
  grande.on('request', (r) => { if (r.url().includes('/api/favicon')) icones.push(r.url()); });
  await grande.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await grande.getByText('Carte du démarrage').first().waitFor({ timeout: 30_000 });
  await grande.waitForTimeout(1_500);
  noter('3. la pastille demande une miniature, jamais l’icône entière', icones.length > 0 && icones.every((u) => /[?&]w=\d+/.test(u)), icones[0] ?? 'aucune demande');
  const tailleAffichee = await grande.evaluate(() => {
    const img = document.querySelector('img[data-favicon-projet]');
    return img ? img.naturalWidth : 0;
  });
  noter('3. …et reçoit une image à sa taille', tailleAffichee > 0 && tailleAffichee <= 160, `${tailleAffichee} px de large`);
  noter('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));
  code = resultats.every(Boolean) ? 0 : 1;
  console.log(`\n${resultats.filter(Boolean).length}/${resultats.length} contrôles réussis`);
} catch (err) {
  console.error(' ÉCHEC', err?.message ?? err);
  console.error(journal?.() ?? '');
} finally {
  await navigateur?.close().catch(() => {});
  process.exit(code);
}
