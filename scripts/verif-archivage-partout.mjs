#!/usr/bin/env node
/**
 * ARCHIVER UNE CARTE, D'OÙ QUE CE SOIT, LA POSE EN TÊTE D'« ARCHIVÉ » —
 * et une carte archivée depuis longtemps se RETROUVE par la recherche.
 *
 *   node scripts/verif-archivage-partout.mjs
 *
 * Constat du 29/10/2026 : « quand je clique sur archiver, elle disparaît ». Le
 * script rejoue chaque chemin du geste dans un vrai navigateur (Chrome du
 * système), sur un projet dont « Archivé » compte déjà 45 cartes — plus de deux
 * paquets de vingt —, puis vérifie la colonne et la base :
 *
 *   1. menu clic droit d'une carte rendue d'« En cours » → la carte est la PREMIÈRE
 *      d'« Archivé », avant comme après rechargement, et sa position en base
 *      est la plus haute de la colonne ;
 *   2. glisser à la souris depuis « Demande » vers « Archivé » → idem ;
 *   3. menu d'une carte de la page « Tableaux de bord » → la carte est en tête
 *      de la colonne « Archiver » de la page ET en tête d'« Archivé » du projet ;
 *   4. téléphone (390 × 844, appui long) → idem ;
 *   5. la LOUPE d'« Archivé » retrouve la 40e carte (hors du premier paquet) par
 *      quelques mots de son titre, dit son rang, et l'ouvre d'un clic ;
 *   6. la recherche ne charge pas la colonne : avant comme après, l'écran ne
 *      tient qu'un paquet de cartes d'« Archivé ».
 *
 * Le script monte son PROPRE démon (base neuve, port libre) : le démon publié
 * n'est jamais touché, aucun moteur n'est lancé. Jamais `BELUGA_URL` ni
 * `BELUGA_TOKEN` : la session est fabriquée ici, son jeton haché, et le tout
 * disparaît avec le dossier temporaire.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_ARCHIVAGE_PORT || 7213);
const BASE = `http://127.0.0.1:${PORT}`;
const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-archivage-partout-', port: PORT });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const H = 3600_000;
const PROJET = 'p-archives';

function carte(db, id, column, title, position, extra = {}) {
  const c = {
    id, projectId: PROJET, title, description: 'Carte d’essai posée par verif-archivage-partout.', labels: [], column, position,
    origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt: position, updatedAt: position, ...extra,
  };
  db.prepare(
    'INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at, rangee_tableau_de_bord_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, PROJET, column, position, title, c.description, JSON.stringify(c), position, position, column === 'archived' ? position : null);
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + H, 'vérification archivage');
  db.prepare('DELETE FROM projects').run();
  const p = { id: PROJET, name: 'Archives', path: `${DEPOT}`, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: MAINTENANT, updatedAt: MAINTENANT };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, p.name, DEPOT, JSON.stringify(p), MAINTENANT, MAINTENANT);
  // 45 cartes archivées, plus récentes que les cartes à archiver : celles-ci
  // garderaient donc leur vieille position sous les deux premiers paquets.
  for (let i = 1; i <= 45; i += 1) {
    carte(db, `c-vieille-${i}`, 'archived', i === 40 ? 'Suivi du déploiement invisible' : `Carte d'essai — archivée ${i}`, MAINTENANT - i * 60_000);
  }
  carte(db, 'c-menu', 'running', "Carte d'essai — menu clic droit", MAINTENANT - 30 * 24 * H, { renduA: MAINTENANT - 30 * 24 * H });
  carte(db, 'c-glisse', 'planned', "Carte d'essai — glisser", MAINTENANT - 31 * 24 * H);
  carte(db, 'c-page', 'running', "Carte d'essai — page Tableaux de bord", MAINTENANT - 32 * 24 * H, { renduA: MAINTENANT - 32 * 24 * H });
  carte(db, 'c-telephone', 'running', "Carte d'essai — téléphone", MAINTENANT - 33 * 24 * H, { renduA: MAINTENANT - 33 * 24 * H });
  db.close();
}

function enBase(id) {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT column_key AS colonne, position FROM cards WHERE id = ?').get(id);
  const max = db.prepare("SELECT MAX(position) AS m FROM cards WHERE project_id = ? AND column_key = 'archived'").get(PROJET).m;
  db.close();
  return { ...ligne, enTete: ligne?.position === max };
}

/** L'identifiant de la PREMIÈRE carte posée dans « Archivé » du tableau. */
const premiereArchivee = (page) =>
  page.evaluate(() => document.querySelector('[data-column="archived"] article[data-carte]')?.getAttribute('data-carte') ?? null);
const nombreArchivees = (page) => page.evaluate(() => document.querySelectorAll('[data-column="archived"] article[data-carte]').length);

async function attendreEnTete(page, id, limiteMs = 6000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if ((await premiereArchivee(page)) === id) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

async function ouvrirLeTableau(page) {
  await page.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('[data-column="archived"] article[data-carte]').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
}

async function verifierEnTete(page, id, libelle) {
  noter(`${libelle} : la carte est en tête d'« Archivé »`, await attendreEnTete(page, id), `première : ${await premiereArchivee(page)}`);
  const base = enBase(id);
  noter(`${libelle} : en base, archivée et à la plus haute position`, base.colonne === 'archived' && base.enTete, JSON.stringify(base));
  await ouvrirLeTableau(page);
  noter(`${libelle} : toujours en tête après rechargement`, await attendreEnTete(page, id));
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const erreurs = [];
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1500, height: 950 }, locale: 'fr-CH', serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await ouvrirLeTableau(page);
    const avant = await nombreArchivees(page);
    noter('« Archivé » ne pose qu’un paquet de vingt au départ', avant === 20, `${avant} cartes posées`);

    /* 1. Menu clic droit. */
    const tuile = page.locator('article[data-carte="c-menu"]');
    await tuile.scrollIntoViewIfNeeded();
    await tuile.click({ button: 'right' });
    await page.waitForTimeout(300);
    await page.locator('[role="menu"]:visible').getByText('Archiver la carte', { exact: true }).click();
    await verifierEnTete(page, 'c-menu', 'menu clic droit');

    /* 2. Glisser à la souris vers « Archivé ». */
    const glisse = page.locator('article[data-carte="c-glisse"]');
    await glisse.scrollIntoViewIfNeeded();
    const b = await glisse.boundingBox();
    const cible = await page.locator('[data-column="archived"]').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + 18);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 12, b.y + 24, { steps: 3 });
    await page.mouse.move(cible.x + cible.width / 2, cible.y + 160, { steps: 16 });
    await page.mouse.up();
    await verifierEnTete(page, 'c-glisse', 'glisser vers Archivé');

    /* 3. La page « Tableaux de bord ». */
    await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded' });
    const tuilePage = page.locator('[data-colonne-en-route="actif"] [data-carte-en-route="c-page"], [data-colonne-en-route] article[data-carte="c-page"]').first();
    await tuilePage.waitFor({ timeout: 20_000 });
    await tuilePage.click({ button: 'right' });
    await page.waitForTimeout(300);
    const entree = page.locator('[role="menu"]:visible').getByText('Archiver la carte', { exact: true });
    if (await entree.count()) {
      await entree.click();
      const fin = Date.now() + 6000;
      let enTetePage = false;
      while (Date.now() < fin && !enTetePage) {
        enTetePage = await page.evaluate(() => {
          const premiere = document.querySelector('[data-colonne-en-route="archive"] [data-carte-en-route], [data-colonne-en-route="archive"] article[data-carte]');
          return (premiere?.getAttribute('data-carte-en-route') ?? premiere?.getAttribute('data-carte')) === 'c-page';
        });
        if (!enTetePage) await page.waitForTimeout(150);
      }
      noter('page Tableaux de bord : la carte est en tête de « Archiver »', enTetePage);
      await ouvrirLeTableau(page);
      noter('page Tableaux de bord : la carte est en tête d’« Archivé » du projet', await attendreEnTete(page, 'c-page'));
    } else {
      noter('page Tableaux de bord : le menu propose « Archiver la carte »', false);
    }

    /* 5. La loupe d'« Archivé ». */
    await page.locator(`[data-recherche-archives="${PROJET}"]`).click();
    await page.locator('[data-champ-recherche-archives]').fill('déploiement invisible');
    const trouvee = page.locator('[data-carte-trouvee="c-vieille-40"]');
    await trouvee.waitFor({ timeout: 8000 }).catch(() => {});
    noter('la recherche retrouve la 40e carte d’« Archivé »', (await trouvee.count()) === 1);
    const rangLu = (await trouvee.textContent().catch(() => '')) ?? '';
    noter('la recherche dit le rang de la carte dans la colonne', /4[0-4]e de la colonne/.test(rangLu), rangLu.trim());
    noter('la recherche ne fait pas descendre la colonne entière', (await nombreArchivees(page)) <= 20, `${await nombreArchivees(page)} posées`);
    await trouvee.click();
    await page.waitForFunction(() => location.hash.includes('/tache/c-vieille-40'), null, { timeout: 8000 }).catch(() => {});
    noter('un clic sur le résultat ouvre la carte', await page.evaluate(() => location.hash.includes('/tache/c-vieille-40')), await page.evaluate(() => location.hash));
    await contexte.close();

    /* 4. Téléphone : appui long. */
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-CH', serviceWorkers: 'block' });
    await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const pageTel = await tel.newPage();
    pageTel.on('pageerror', (e) => erreurs.push(String(e)));
    await pageTel.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const tuileTel = pageTel.locator('article[data-carte="c-telephone"]');
    await tuileTel.waitFor({ timeout: 30_000 });
    await tuileTel.scrollIntoViewIfNeeded();
    const bt = await tuileTel.boundingBox();
    const cdp = await tel.newCDPSession(pageTel);
    const point = { x: Math.round(bt.x + bt.width / 2), y: Math.round(bt.y + 20) };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await pageTel.waitForTimeout(900);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pageTel.waitForTimeout(400);
    const entreeTel = pageTel.locator('[role="menu"]:visible').getByText('Archiver la carte', { exact: true });
    noter('téléphone : l’appui long propose « Archiver la carte »', (await entreeTel.count()) === 1);
    if (await entreeTel.count()) {
      await entreeTel.click();
      await pageTel.waitForTimeout(800);
      const base = enBase('c-telephone');
      noter('téléphone : en base, archivée et à la plus haute position', base.colonne === 'archived' && base.enTete, JSON.stringify(base));
      await pageTel.reload({ waitUntil: 'domcontentloaded' });
      await pageTel.locator('[data-column="archived"] article[data-carte]').first().waitFor({ timeout: 30_000 }).catch(() => {});
      noter('téléphone : la carte est en tête d’« Archivé » après rechargement', (await premiereArchivee(pageTel)) === 'c-telephone');
    }
    await tel.close();
  } finally {
    await navigateur.close();
  }
  noter('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passées.`);
  process.exit(echecs ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
