#!/usr/bin/env node
/**
 * Vérification du glissement dans la colonne de gauche : en déplaçant un
 * projet sur toute la hauteur de la liste, AUCUNE ligne ne doit sauter.
 *
 * La règle contrôlée : rien n'est ajouté ni retiré à la liste pendant le
 * glissement (sa longueur ne bouge pas), les voisins se contentent de
 * descendre d'une hauteur de ligne, et l'emplacement visé est marqué d'un
 * trait fin — pas d'un cadre.
 *
 *   HAIKODEV_TOKEN=… HAIKODEV_URL=http://localhost:7131 node scripts/verif-glissement-projets.mjs
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.HAIKODEV_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';

/** Une session d'essai : la colonne « token » garde le SHA-256 du cookie. */
function poserSession() {
  const require = createRequire(import.meta.url);
  const db = require('/root/haikodev/node_modules/better-sqlite3')('/root/haikodev/data/haikodev.db');
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification glissement projets',
  );
  return cookie;
}

// La session est posée au DERNIER moment, juste avant d'ouvrir la page : le
// ménage des essais tourne en continu et emporterait une session posée trop tôt.

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Où chaque ligne se trouve VRAIMENT à l'écran, décalage compris. */
const places = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-drop-root]');
    const out = {};
    for (const el of root.querySelectorAll('[data-drag-id]')) {
      const rect = el.getBoundingClientRect();
      out[el.dataset.dragId] = Math.round(rect.top);
    }
    return { lignes: out, longueur: root.scrollHeight };
  });

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  const origine = new URL(BASE).origin;
  const token = process.env.HAIKODEV_TOKEN || poserSession();
  await context.addCookies([
    { name: 'haikodev_session', value: token, url: origine, httpOnly: true, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  try {
    await page.waitForSelector('[data-drop-root] [data-drag-id]', { timeout: 60000 });
  } catch (error) {
    await shot(page, 'glissement-projets-echec-chargement');
    console.log('DEBUG compte', await page.locator('[data-drop-root] [data-drag-id]').count());
    console.log('DEBUG texte', (await page.locator('body').innerText()).slice(0, 200));
    throw error;
  }
  await page.waitForTimeout(1200);

  const depart = await places(page);
  const ids = Object.keys(depart.lignes);
  record('La colonne des projets est peuplée', ids.length >= 3, `${ids.length} lignes`);

  /**
   * Promène une ligne de haut en bas de la liste, par petits pas, et relève à
   * chaque pas ce que voit l'utilisateur. On relâche à la place de départ : la
   * vérification ne réordonne rien.
   */
  async function promener(quoi, ligne) {
    const poignee = ligne.locator('[title="Glisser pour ranger"]').first();
    const boite = await poignee.boundingBox();
    const zone = await page.locator('[data-drop-root]').boundingBox();
    const hauteurAttendue = Math.round(await ligne.evaluate((el) => el.getBoundingClientRect().height) + 2);

    await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
    await page.mouse.down();
    // Franchement plus loin que le seuil de quelques pixels : la ligne se décroche.
    await page.mouse.move(boite.x + boite.width / 2, boite.y + 40, { steps: 4 });
    await page.waitForTimeout(250);
    record(
      `${quoi} : la ligne saisie reste estompée à sa place`,
      (await page.locator('[data-drop-root] .opacity-40').count()) > 0,
    );

    const bas = Math.min(zone.y + zone.height - 8, depart.lignes[ids[ids.length - 1]] + 60);
    const pas = [];
    for (let y = boite.y; y <= bas; y += 11) pas.push(y);
    for (let y = bas; y >= boite.y; y -= 11) pas.push(y);

    let longueurStable = true;
    const sautsInterdits = [];
    let traitVu = 0;
    let cadreVu = 0;
    let groupeEclaire = 0;

    for (const y of pas) {
      await page.mouse.move(boite.x + boite.width / 2, y);
      // On lit APRÈS la transition : la place finale de chaque ligne.
      await page.waitForTimeout(30);
      const etat = await places(page);
      if (etat.longueur !== depart.longueur) longueurStable = false;

      for (const id of ids) {
        const ecart = etat.lignes[id] - depart.lignes[id];
        // Une ligne est soit à sa place, soit descendue d'UNE hauteur de ligne.
        // Les valeurs intermédiaires de l'animation sont admises ; ce qui est
        // interdit, c'est de dépasser cette hauteur — c'était le saut d'avant.
        if (ecart < -1 || ecart > hauteurAttendue + 2) sautsInterdits.push(`${id}: ${ecart}px`);
      }

      // Une image prise EN PLEIN glissement, pas au retour : c'est là qu'on
      // voit le trait et l'espace ouvert.
      if (y === pas[Math.floor(pas.length / 4)]) {
        await shot(page, `glissement-${quoi.toLowerCase()}-en-cours`);
      }

      traitVu += await page.locator('[data-drop-root] .bg-warning').count();
      cadreVu += await page.locator('[data-drop-root] .border-dashed').count();
      groupeEclaire += await page.locator('[data-drop-group].bg-surface').count();
    }

    await shot(page, `glissement-${quoi.toLowerCase().replace(/\W+/g, '-')}`);
    record(`${quoi} : la liste garde sa longueur du début à la fin`, longueurStable);
    record(
      `${quoi} : aucune ligne ne saute au-delà d’une hauteur de ligne`,
      sautsInterdits.length === 0,
      sautsInterdits.slice(0, 4).join(', '),
    );
    record(`${quoi} : l’emplacement visé est marqué par un trait orange`, traitVu > 0, `${traitVu} relevés`);
    record(`${quoi} : plus aucun cadre en pointillés dans la liste`, cadreVu === 0, `${cadreVu} relevés`);
    record(
      `${quoi} : déposer dans un groupe éclaire le groupe`,
      groupeEclaire > 0,
      `${groupeEclaire} relevés`,
    );

    // On relâche à la place de départ : rien n'est réordonné.
    await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    const retour = await places(page);
    record(
      `${quoi} : tout revient à sa place au relâchement`,
      ids.every((id) => Math.abs(retour.lignes[id] - depart.lignes[id]) <= 1),
    );
  }

  // Cas 1 et 3 : un projet promené sur la liste, groupes compris.
  await promener('Projet', page.locator('[data-drop-root] [data-drag-kind="project"]').first());
  // Cas 2 : un groupe promené de la même façon.
  const groupes = page.locator('[data-drop-root] [data-drag-kind="group"]');
  if (await groupes.count()) await promener('Groupe', groupes.first());
  else record('Un groupe existe pour le second cas', false);

  // Le réglage système « réduire les animations » : le décalage devient immédiat.
  const transition = (page) =>
    page
      .locator('[data-drop-root] [data-drag-kind="project"]')
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return { duree: style.transitionDuration, quoi: style.transitionProperty };
      });
  const normale = await transition(page);
  record(
    'Le décalage dure environ 150 ms',
    normale.duree.startsWith('0.15') && normale.quoi.includes('transform'),
    `${normale.duree} sur ${normale.quoi}`,
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(200);
  const reduite = await transition(page);
  record(
    'Animations réduites : le décalage est immédiat',
    reduite.quoi === 'none' || reduite.duree.startsWith('0s'),
    `${reduite.duree} sur ${reduite.quoi}`,
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  record('Aucune erreur du navigateur', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await browser.close();
  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles passés`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
