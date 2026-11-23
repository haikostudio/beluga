#!/usr/bin/env node
/**
 * LA PAGE SE REPOSE QUAND ON NE TOUCHE À RIEN — et les réglages s'ouvrent vite.
 *
 * Une zone qui défile avec sa barre dessinée (les bandes de cartes du tableau)
 * rendait un NOUVEL objet d'état à chaque mesure, et mesurait à chaque rendu :
 * rendu → mesure → nouvel état → rendu… sans fin. Rien ne bougeait à l'écran,
 * mais le processeur restait occupé à ~99 % au repos, et chaque clic (réglages
 * d'un projet, réglages généraux) attendait plusieurs secondes son tour.
 *
 * Ce que le script vérifie, dans un VRAI navigateur, sur son PROPRE démon
 * (base neuve, port libre, aucun quota dépensé), tableau garni de cartes :
 *   1. au repos, trois secondes de profil processeur sont MAJORITAIREMENT
 *      du repos (seuil : REPOS_MINIMUM) ;
 *   2. la configuration d'un projet (colonne de gauche) entre dans la page en
 *      moins de OUVERTURE_MAX_MS après le clic ;
 *   3. les réglages généraux (menu du haut) aussi.
 *
 *   node scripts/verif-page-au-repos.mjs
 *   node scripts/verif-page-au-repos.mjs --cartes 400
 *
 * Il sert le `web/dist` du dépôt d'où il part : construire avant.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_REPOS_PORT || 7197);
const BASE = `http://127.0.0.1:${PORT}`;
const i = process.argv.indexOf('--cartes');
const CARTES_D_ESSAI = i === -1 ? 120 : Number(process.argv[i + 1]);
const REPOS_MINIMUM = 0.7;
const OUVERTURE_MAX_MS = 800;

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-page-au-repos-',
  port: PORT,
  signaux: true,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-repos';
const COLONNES = ['planned', 'running', 'to_deploy', 'archived'];

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
      db.close();
      if (table) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function poserLeProjetEtSesCartes() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification de la page au repos',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const projet = {
    id: PROJET_ID,
    name: 'Projet au repos',
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
  const poser = db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (let n = 0; n < CARTES_D_ESSAI; n += 1) {
      poser.run(
        `c-repos-${n}`,
        PROJET_ID,
        COLONNES[n % COLONNES.length],
        n,
        `Carte au repos ${n}`,
        'Carte posée pour vérifier que la page se repose.',
        JSON.stringify({}),
        maintenant,
        maintenant,
      );
    }
  })();
  db.close();
}

/** La part de repos sur `dureeMs` de profil processeur (échantillons « (idle) »). */
async function partDeRepos(page, dureeMs) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  await page.waitForTimeout(dureeMs);
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.detach();
  const repos = new Set(profile.nodes.filter((n) => n.callFrame.functionName === '(idle)').map((n) => n.id));
  const total = profile.samples.length;
  const auRepos = profile.samples.filter((id) => repos.has(id)).length;
  return { total, auRepos, part: total ? auRepos / total : 0 };
}

/**
 * Le délai entre le clic et l'entrée de la fenêtre dans la page, mesuré DANS
 * la page (le clic et le chronomètre partent du même instant).
 */
const delaiDOuverture = (page, declencheur, cible) =>
  page.evaluate(
    ([declencheur, cible]) =>
      new Promise((resolve) => {
        const bouton = document.querySelector(declencheur);
        if (!bouton) return resolve(-1);
        const t0 = performance.now();
        const fini = () => {
          if (!document.querySelector(cible)) return false;
          observateur.disconnect();
          resolve(Math.round(performance.now() - t0));
          return true;
        };
        const observateur = new MutationObserver(fini);
        observateur.observe(document.body, { childList: true, subtree: true });
        bouton.click();
        if (!fini()) setTimeout(() => (observateur.disconnect(), resolve(99999)), 15000);
      }),
    [declencheur, cible],
  );

async function main() {
  if (!(await attendrePort())) throw new Error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  if (!(await attendreLaBase())) throw new Error(`La base d’essai est restée vide (port ${PORT} pris ?)`);
  poserLeProjetEtSesCartes();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  const echecs = [];
  try {
    const contexte = await navigateur.newContext({
      viewport: { width: 1600, height: 900 },
      locale: 'fr-CH',
      serviceWorkers: 'block',
    });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="planned"]', { timeout: 30000 });
    await page.waitForSelector('[data-carte^="c-repos-"]', { timeout: 30000 });
    await page.waitForTimeout(4000);

    const repos = await partDeRepos(page, 3000);
    const pourcent = Math.round(repos.part * 100);
    console.log(`  Repos sur 3 s de profil ........ ${pourcent} % (${repos.auRepos}/${repos.total} échantillons)`);
    if (repos.part < REPOS_MINIMUM) echecs.push(`la page ne se repose pas : ${pourcent} % de repos au lieu de ${REPOS_MINIMUM * 100} %`);

    /* Le « ⋮ » d'une ligne de projet ouvre un MENU (archiver un projet, 20/11/2026) : les réglages sont sa première
       entrée. Le menu s'ouvre d'abord, puis on chronomètre l'entrée « Réglages du projet ». */
    await page.locator(`[data-menu-projet="${PROJET_ID}"]`).evaluate((el) =>
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })),
    );
    await page.waitForSelector(`[data-menu-reglages-projet="${PROJET_ID}"]`, { timeout: 10000 });
    const projet = await delaiDOuverture(page, `[data-menu-reglages-projet="${PROJET_ID}"]`, '[data-config-projet]');
    console.log(`  Configuration du projet ........ ${projet} ms`);
    if (projet < 0 || projet > OUVERTURE_MAX_MS) echecs.push(`configuration du projet ouverte en ${projet} ms`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-config-projet]', { state: 'detached', timeout: 10000 });
    await page.waitForTimeout(800);

    await page.locator('button[aria-label="Menu"]').first().click();
    await page.waitForSelector('[data-reglages-menu]', { timeout: 10000 });
    const general = await delaiDOuverture(page, '[data-reglages-menu]', '[data-modale-reglages]');
    console.log(`  Réglages généraux .............. ${general} ms`);
    if (general < 0 || general > OUVERTURE_MAX_MS) echecs.push(`réglages généraux ouverts en ${general} ms`);

    if (erreurs.length) echecs.push(`erreurs de page : ${erreurs[0]}`);
    await contexte.close();
  } finally {
    await navigateur.close();
  }
  if (echecs.length) {
    for (const e of echecs) console.error(`  ÉCHEC : ${e}`);
    process.exit(1);
  }
  console.log('  OK : la page se repose et les réglages s’ouvrent aussitôt.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
