#!/usr/bin/env node
/**
 * Vérification de deux repères de la barre du haut et des fenêtres :
 *  — le nom du projet ouvert s'affiche en haut, à côté du voyant de liaison ;
 *  — sur téléphone, une fenêtre de confirmation MONTE DEPUIS LE BAS : elle
 *    occupe toute la largeur et touche le bas de l'écran, au lieu de partir
 *    se coller au bord droit (l'animation écrasait le centrage).
 *
 *   HAIKODEV_TOKEN=… HAIKODEV_URL=http://localhost:7099 node scripts/verif-fenetres-bas.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.HAIKODEV_URL || 'http://localhost:7099';
const TOKEN = process.env.HAIKODEV_TOKEN;
const SHOTS = '/root/haikodev/data/verification';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 420, height: 900 },
    deviceScaleFactor: 2,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  const origine = new URL(BASE).origin;
  if (TOKEN) {
    await context.addCookies([
      { name: 'haikodev_session', value: TOKEN, url: origine, httpOnly: true, sameSite: 'Lax' },
    ]);
  }

  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // 1. Le nom du projet ouvert, dans la barre du haut.
  const entete = page.locator('header').first();
  const titre = entete.locator('span[title]').first();
  const nom = (await titre.count()) ? (await titre.textContent())?.trim() : '';
  record('le nom du projet est affiché en haut', !!nom, nom || 'aucun texte');

  await page.screenshot({ path: `${SHOTS}/fenetres-barre-haut.png` });

  // 2. Une fenêtre de confirmation : ouverte depuis le menu à trois points,
  //    par « Repartir de zéro » de la conversation du chef d'orchestre.
  // Un tiroir de carte peut être resté ouvert (reprise de l'endroit quitté).
  for (let essai = 0; essai < 4 && (await page.locator('[role="dialog"]').count()); essai++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
  record('aucun tiroir ne reste ouvert', (await page.locator('[role="dialog"]').count()) === 0);
  await page.locator('nav button', { hasText: 'Chef' }).last().click();
  await page.waitForTimeout(2000);
  const repartir = page.getByText('Repartir de zéro').first();
  if (await repartir.count()) {
    await repartir.click();
    await page.waitForTimeout(900);

    // La fenêtre de confirmation, reconnue à son titre : surtout pas le
    // dernier « dialog » venu, qui pourrait être un tiroir resté ouvert.
    const fenetre = page.locator('[role="dialog"]').filter({ hasText: 'Repartir sur une conversation' }).first();
    const boite = await fenetre.boundingBox();
    const ecran = page.viewportSize();
    if (boite) {
      const pleineLargeur = boite.width >= ecran.width - 4;
      const colleeEnBas = boite.y + boite.height >= ecran.height - 4;
      const dansLEcran = boite.x >= -1 && boite.x + boite.width <= ecran.width + 1;
      record('la fenêtre prend toute la largeur', pleineLargeur, `${Math.round(boite.width)} px sur ${ecran.width}`);
      record('la fenêtre est collée au bas de l’écran', colleeEnBas, `bas à ${Math.round(boite.y + boite.height)}`);
      record('la fenêtre ne déborde pas à droite', dansLEcran, `x = ${Math.round(boite.x)}`);
    } else {
      record('la fenêtre de confirmation est visible', false);
    }
    await page.screenshot({ path: `${SHOTS}/fenetres-confirmation-bas.png` });
  } else {
    record('bouton « Repartir de zéro » trouvé', false);
  }

  await browser.close();
  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
