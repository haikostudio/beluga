#!/usr/bin/env node
/**
 * Vérification du tiroir des réglages : il s'ouvre bien en TIROIR (poignée en
 * haut, collé au bas de l'écran), ses onglets répondent, la barre de capacité
 * n'est plus rouge quand il reste de la place, et « Ce qui a été consommé »
 * porte sa description et de vrais noms de projets.
 *
 *   HAIKODEV_TOKEN=… HAIKODEV_URL=http://127.0.0.1:7099 node scripts/verif-reglages.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { creerResultats } from './lib/verif-resultats.mjs';

const BASE = process.env.HAIKODEV_URL || 'http://127.0.0.1:7099';
const TOKEN = process.env.HAIKODEV_TOKEN;
const SHOTS = '/root/haikodev/data/verification';

const { results, record } = creerResultats();

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
    // Sinon c'est la version PUBLIÉE qui s'affiche, pas celle qu'on vérifie.
    serviceWorkers: 'block',
  });
  const origine = new URL(BASE).origin;
  if (TOKEN) {
    await context.addCookies([
      { name: 'haikodev_session', value: TOKEN, url: origine, httpOnly: true, sameSite: 'Lax' },
    ]);
  }

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);

  // Le menu à trois points de la barre du haut réunit son, thème et réglages.
  await page.locator('header button').last().click();
  await page.waitForTimeout(700);
  await page.getByText('Réglages', { exact: true }).first().click();
  await page.waitForTimeout(2500);

  const tiroir = page.locator('[role="dialog"]').last();
  record('le tiroir des réglages est ouvert', await tiroir.isVisible());

  // Un tiroir est collé au bas de l'écran ; une fenêtre flotte au milieu.
  const boite = await tiroir.boundingBox();
  const hauteur = page.viewportSize().height;
  record(
    'il est collé au bas de l’écran (tiroir, pas fenêtre)',
    !!boite && boite.y + boite.height >= hauteur - 4,
    boite ? `bas à ${Math.round(boite.y + boite.height)} pour ${hauteur}` : 'introuvable',
  );

  const onglets = ['Système', 'Fonctionnement', 'Comptes', 'Voix', 'Consommation', 'Sauvegardes'];
  for (const titre of onglets) {
    record(`onglet « ${titre} » présent`, (await tiroir.getByRole('tab', { name: titre }).count()) > 0);
  }

  // La barre de capacité : rouge seulement si plus rien ne peut démarrer.
  const phrase = (await tiroir.locator('text=/peuvent encore démarrer|peut encore démarrer|Départs suspendus|Plus aucun agent/').first().textContent()) ?? '';
  const barre = tiroir.locator('.rounded-full.bg-raised > div').first();
  const classes = (await barre.getAttribute('class')) ?? '';
  const largeur = await barre.evaluate((node) => node.style.width);
  const placeLibre = /peuvent encore démarrer|peut encore démarrer/.test(phrase);
  record(
    'la barre n’est pas rouge quand il reste de la place',
    !placeLibre || !classes.includes('bg-danger'),
    `${phrase.trim()} · largeur ${largeur} · ${classes.includes('bg-danger') ? 'rouge' : 'neutre'}`,
  );
  record('la barre n’est pas pleine quand il reste de la place', !placeLibre || largeur !== '100%', `largeur ${largeur}`);

  await tiroir.screenshot({ path: `${SHOTS}/reglages-systeme.png` });

  // Fonctionnement : chaque champ porte son explication.
  await tiroir.getByRole('tab', { name: 'Fonctionnement' }).click();
  await page.waitForTimeout(900);
  const aides = await tiroir.locator('p.text-\\[12\\.5px\\]').count();
  record('les champs sont expliqués', aides >= 8, `${aides} explications`);
  record(
    'plus d’étiquette énigmatique « Pendant (minutes) »',
    (await tiroir.getByText('Pendant (minutes)', { exact: true }).count()) === 0,
  );
  await tiroir.screenshot({ path: `${SHOTS}/reglages-fonctionnement.png` });

  // Consommation : description sous le titre, et des noms de projets.
  await tiroir.getByRole('tab', { name: 'Consommation' }).click();
  await page.waitForTimeout(2500);
  record(
    'le bloc consommé est expliqué',
    (await tiroir.getByText(/mesure d'usage, pas une facture/).count()) > 0,
  );
  record(
    'plus aucune ligne « projet retiré »',
    (await tiroir.getByText('projet retiré', { exact: true }).count()) === 0,
  );
  await tiroir.screenshot({ path: `${SHOTS}/reglages-consommation.png` });

  record('aucune erreur dans la console', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));

  await browser.close();

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles au vert`);
  console.log(`captures dans ${SHOTS}`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
