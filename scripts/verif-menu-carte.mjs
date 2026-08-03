#!/usr/bin/env node
/**
 * Le tiroir d'une carte porte un bouton à TROIS POINTS en haut, à droite du
 * titre, et plus aucun bouton « Supprimer » en bas. Le menu doit contenir la
 * suppression, l'archivage et les colonnes de destination autorisées.
 *
 * Contrôlé sur les deux écrans : ordinateur (menu déroulant collé au bouton)
 * et téléphone (tiroir en bas, pleine largeur).
 *
 *   node scripts/verif-menu-carte.mjs
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

/* HAIKODEV_URL désigne le démon, qui sert la version PUBLIÉE : l'adresse
   d'essai a son propre nom et vise le serveur de développement. */
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';
const DB = process.env.HAIKODEV_DB || '/root/haikodev/data/haikodev.db';
const SHOTS = '/root/haikodev/data/verification';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Une session d'essai : la colonne « token » garde le SHA-256 du cookie. */
function poserSession(db) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification menu carte',
  );
  return cookie;
}

/** Une carte quelconque, dans un projet qui en a le plus. */
function choisirCarte(db) {
  return db
    .prepare(
      `SELECT c.id, c.title, c.project_id, c.column_key FROM cards c
       WHERE c.column_key != 'archived' ORDER BY c.updated_at DESC LIMIT 1`,
    )
    .get();
}

async function ouvrirCarte(context, carte, projetNom, mobile) {
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);

  // Le projet retenu de la veille n'est pas forcément celui de la carte.
  if (!(await page.locator(`article:has-text(${JSON.stringify(carte.title.slice(0, 30))})`).count())) {
    if (mobile) {
      await page.locator('header button[aria-label="Projets"]').click();
      await page.waitForTimeout(1200);
    }
    const ligne = page.getByText(projetNom, { exact: true }).first();
    await ligne.waitFor({ state: 'visible', timeout: 15000 });
    await ligne.click();
    await page.waitForTimeout(3000);
  }

  // Le tiroir de la dernière carte consultée peut déjà être ouvert : le
  // rouvrir d'un clic serait impossible, la carte étant sous le voile.
  const dejaOuvert = await page
    .locator('[role="dialog"]')
    .filter({ hasText: carte.title.slice(0, 30) })
    .count();
  if (!dejaOuvert) {
    const carteVue = page.locator('article').filter({ hasText: carte.title.slice(0, 30) }).first();
    await carteVue.waitFor({ state: 'visible', timeout: 15000 });
    await carteVue.click();
    await page.waitForTimeout(1800);
  }
  return { page, erreurs };
}

async function controler(page, erreurs, ecran) {
  const tiroir = page.locator('[role="dialog"]').last();

  /* ---------- Plus de « Supprimer » en bas ---------- */
  const piedSupprime = await tiroir.locator('footer button:has-text("Supprimer")').count();
  record(`${ecran} — plus de bouton « Supprimer » dans le pied`, piedSupprime === 0);

  /* ---------- Le bouton à trois points est en haut, à droite du titre ---------- */
  const bouton = tiroir.locator('button[aria-label="Autres actions"]');
  record(`${ecran} — un bouton à trois points est présent`, (await bouton.count()) === 1);
  if (!(await bouton.count())) return;

  const places = await tiroir.evaluate((node) => {
    const bouton = node.querySelector('button[aria-label="Autres actions"]');
    const titre = node.querySelector('h2, [id^="radix"][class*="leading-snug"]');
    const b = bouton?.getBoundingClientRect();
    const t = titre?.getBoundingClientRect();
    const cadre = node.getBoundingClientRect();
    return b && t ? { bx: b.x, by: b.y, tx: t.x, ty: t.y, droite: cadre.right - b.right } : null;
  });
  record(
    `${ecran} — le bouton est en haut, à droite du titre`,
    !!places && places.bx > places.tx && places.droite < 40 && Math.abs(places.by - places.ty) < 60,
    places ? `bouton x=${Math.round(places.bx)} · titre x=${Math.round(places.tx)}` : 'repères introuvables',
  );

  /* ---------- Le contenu du menu ---------- */
  await bouton.click();
  await page.waitForTimeout(900);
  const menu = page.locator('[role="menu"]').last();
  const texte = (await menu.textContent()) || '';
  record(`${ecran} — le menu propose la suppression`, /Supprimer la carte/.test(texte));
  record(`${ecran} — le menu propose l'archivage`, /Archiver la carte/.test(texte));
  record(`${ecran} — le menu propose de déplacer vers d'autres colonnes`, /Déplacer vers/.test(texte));

  const colonnes = ['Notes', 'À faire', 'Validé', 'Planifié', 'En cours', 'Terminé', 'À déployer'];
  const proposees = colonnes.filter((nom) => menu.locator(`[role="menuitem"]:text-is("${nom}")`));
  const items = await menu.locator('[role="menuitem"]').allTextContents();
  record(
    `${ecran} — au moins trois colonnes de destination`,
    items.filter((t) => colonnes.some((c) => t.trim() === c)).length >= 3,
    items.map((t) => t.trim()).join(' · '),
  );
  record(
    `${ecran} — « Archivé » n'est pas répété dans les destinations`,
    !items.some((t) => t.trim() === 'Archivé'),
  );

  /* ---------- La forme du menu selon l'écran ---------- */
  const forme = await menu.evaluate((node) => {
    const b = node.getBoundingClientRect();
    return { x: b.x, largeur: b.width, bas: window.innerHeight - b.bottom, ecran: window.innerWidth };
  });
  if (ecran === 'Téléphone') {
    record(
      'Téléphone — le menu est un tiroir pleine largeur en bas',
      forme.largeur >= forme.ecran - 2 && forme.bas < 4,
      `largeur ${Math.round(forme.largeur)}/${forme.ecran} · bas ${Math.round(forme.bas)}`,
    );
  } else {
    record(
      'Ordinateur — le menu reste un déroulant compact',
      forme.largeur < 420 && forme.largeur < forme.ecran / 2,
      `largeur ${Math.round(forme.largeur)}`,
    );
  }

  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/menu-carte-${ecran === 'Téléphone' ? 'telephone' : 'ordinateur'}.png` });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  record(`${ecran} — aucune erreur dans la console`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
}

/**
 * Le tableau : appui long (pointeur maintenu, sans bouger) et clic droit
 * ouvrent le même menu ; bouger avant l'échéance reste un glissement.
 */
async function controlerTableau(page, carte, ecran) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const tuile = page.locator('article').filter({ hasText: carte.title.slice(0, 30) }).first();
  await tuile.waitFor({ state: 'visible', timeout: 15000 });
  const boite = await tuile.boundingBox();
  const x = boite.x + boite.width / 2;
  const y = boite.y + 14;

  /* ---------- L'appui long ouvre le menu ---------- */
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(900);
  const menu = page.locator('[role="menu"]');
  const ouvert = await menu.count();
  await page.mouse.up();
  await page.waitForTimeout(400);
  record(`${ecran} — l'appui long sur une carte du tableau ouvre le menu`, ouvert > 0);

  if (ouvert) {
    const texte = (await menu.last().textContent()) || '';
    record(
      `${ecran} — c'est bien le même menu (archiver, supprimer, déplacer)`,
      /Archiver la carte/.test(texte) && /Supprimer la carte/.test(texte) && /Déplacer vers/.test(texte),
    );
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({
      path: `${SHOTS}/menu-tableau-${ecran === 'Téléphone' ? 'telephone' : 'ordinateur'}.png`,
    });
  }

  // Le tiroir de la carte ne doit PAS s'être ouvert derrière le menu.
  record(
    `${ecran} — l'appui long n'ouvre pas la carte par-dessous`,
    (await page.locator('[role="dialog"]:not([role="menu"])').count()) === 0,
  );

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  /* ---------- Bouger reste un glissement ---------- */
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.move(x, y + 60, { steps: 8 });
  await page.waitForTimeout(700);
  const menuPendantGlissement = await page.locator('[role="menu"]').count();
  await page.mouse.up();
  await page.waitForTimeout(400);
  record(`${ecran} — bouger la carte n'ouvre aucun menu`, menuPendantGlissement === 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

/** Une carte archivée doit pouvoir se rouvrir depuis son menu. */
async function controlerRouvrir(page, archivee) {
  if (!archivee) {
    record('Le menu d’une carte archivée propose « Rouvrir »', true, 'aucune carte archivée : contrôle sauté');
    return;
  }
  const colonne = page.locator('[data-column="archived"]');
  await colonne.scrollIntoViewIfNeeded();
  const tuile = colonne.locator('article').filter({ hasText: archivee.title.slice(0, 30) }).first();
  await tuile.waitFor({ state: 'visible', timeout: 15000 });
  await tuile.click({ button: 'right' });
  await page.waitForTimeout(700);
  const texte = (await page.locator('[role="menu"]').last().textContent()) || '';
  record('Le menu d’une carte archivée propose « Rouvrir »', /Rouvrir la carte/.test(texte));
  record("Une carte archivée ne propose plus de l'archiver", !/Archiver la carte/.test(texte));
  await page.screenshot({ path: `${SHOTS}/menu-carte-archivee.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function main() {
  const db = new Database(DB);
  const carte = choisirCarte(db);
  if (!carte) {
    console.error('Aucune carte dans la base.');
    process.exit(2);
  }
  const projet = db.prepare('SELECT name FROM projects WHERE id = ?').get(carte.project_id);
  const archivee = db
    .prepare("SELECT id, title FROM cards WHERE project_id = ? AND column_key = 'archived' ORDER BY updated_at DESC LIMIT 1")
    .get(carte.project_id);
  console.log(`Carte : « ${carte.title} » (${projet?.name}, colonne ${carte.column_key})`);
  const cookie = poserSession(db);

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });

  for (const ecran of ['Ordinateur', 'Téléphone']) {
    const mobile = ecran === 'Téléphone';
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 900 },
      deviceScaleFactor: mobile ? 3 : 1,
      isMobile: mobile,
      hasTouch: mobile,
      locale: 'fr-CH',
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    await context.addCookies([
      { name: 'haikodev_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    const { page, erreurs } = await ouvrirCarte(context, carte, projet?.name ?? 'HaikoDev', mobile);
    await controler(page, erreurs, ecran);
    await controlerTableau(page, carte, ecran);
    if (!mobile) await controlerRouvrir(page, archivee);
    await context.close();
  }

  await browser.close();
  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles au vert`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
