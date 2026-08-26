#!/usr/bin/env node
/**
 * Vérification des RÉGLAGES D'UN PROJET : on ouvre la fenêtre depuis la roue
 * dentée de la colonne de gauche, sur ordinateur ET sur téléphone, pour
 * plusieurs projets — dont un projet neuf sans aucun réglage enregistré.
 *
 * Le contrôle porte sur ce que voit l'utilisateur : la fenêtre s'affiche avec
 * son titre et ses champs, et la console du navigateur reste muette.
 *
 *   HAIKODEV_TOKEN=… HAIKODEV_URL=http://127.0.0.1:7099 node scripts/verif-reglages-projet.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { creerResultats } from './lib/verif-resultats.mjs';

const BASE = process.env.HAIKODEV_URL || 'http://127.0.0.1:7099';
const TOKEN = process.env.HAIKODEV_TOKEN;
const SHOTS = '/root/haikodev/data/verification';

const { results, record } = creerResultats();

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const fenetre = (page) => page.locator('[role="dialog"]').filter({ hasText: 'Réglages du projet' });

/** Ouvre la fenêtre pour le énième projet de la liste, et dit ce qu'on y voit. */
async function ouvrirReglages(page, index, erreurs) {
  erreurs.length = 0;
  // « :visible » compte pour de bon : sur téléphone la colonne de gauche existe
  // aussi en double, cachée, et ses lignes ne sont pas cliquables.
  const lignes = page.locator('[data-drag-kind="project"]:visible');
  const total = await lignes.count();
  if (index >= total) return null;
  const ligne = lignes.nth(index);
  const nom = (await ligne.innerText()).trim().split('\n')[0];
  await ligne.hover().catch(() => {});
  await ligne.locator('button[title="Réglages du projet"]').click({ force: true });
  await fenetre(page).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);

  const visible = await fenetre(page).isVisible().catch(() => false);
  const texte = visible ? await fenetre(page).innerText() : '';
  // Un projet neuf : rien d'enregistré, donc la proposition de créer une
  // adresse en ligne s'affiche à la place de l'adresse.
  const vierge = texte.includes("Pas encore d'adresse ?");
  // Une page vidée par un plantage : la racine React n'a plus rien dedans.
  const racineVide = await page.evaluate(() => (document.getElementById('root')?.childElementCount ?? 0) === 0);
  return { nom, visible, texte, vierge, racineVide, erreurs: [...erreurs] };
}

async function fermer(page) {
  await page.keyboard.press('Escape');
  await fenetre(page).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
}

/** Sur téléphone, la liste vit dans un panneau : on ne le rouvre que s'il est fermé. */
async function rouvrirPanneau(page, bouton) {
  if (!(await bouton.isVisible().catch(() => false))) return;
  const panneau = page.locator('[role="dialog"][aria-label="Projets"]');
  if (await panneau.isVisible().catch(() => false)) return;
  await bouton.click();
  await page.waitForTimeout(600);
}

async function passe(browser, titre, contexte, suffixe) {
  const context = await browser.newContext(contexte);
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
  await page.waitForTimeout(3500);

  // Sur téléphone la liste des projets vit dans un panneau latéral.
  const boutonProjets = page.locator('header button[aria-label="Projets"]');
  await rouvrirPanneau(page, boutonProjets);

  const nbProjets = await page.locator('[data-drag-kind="project"]:visible').count();
  record(`${titre} : la liste des projets est là`, nbProjets > 0, `${nbProjets} projets`);

  let vierges = 0;
  for (const index of [0, 1, 2, 3]) {
    const vu = await ouvrirReglages(page, index, erreurs);
    if (!vu) continue;
    const complet =
      vu.visible &&
      vu.texte.includes('Nom') &&
      vu.texte.includes('Moteur par défaut') &&
      vu.texte.includes('Publication') &&
      vu.texte.includes('Client et tarif');
    record(
      `${titre} : les réglages de « ${vu.nom} » s'affichent en entier`,
      complet && !vu.racineVide,
      vu.racineVide ? 'écran vide (la page a planté)' : vu.visible ? '' : 'fenêtre absente',
    );
    if (vu.vierge) vierges += 1;
    if (vu.erreurs.length) record(`${titre} : console muette pour « ${vu.nom} »`, false, vu.erreurs[0].slice(0, 220));
    else record(`${titre} : console muette pour « ${vu.nom} »`, true);
    await shot(page, `reglages-${suffixe}-${index}`);
    await fermer(page);
    await rouvrirPanneau(page, boutonProjets);
  }

  record(`${titre} : au moins un projet neuf, sans aucun réglage enregistré, s'affiche`, vierges > 0, `${vierges} projets vierges`);

  await context.close();
}

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });

  await passe(
    browser,
    'Ordinateur',
    { viewport: { width: 1440, height: 900 }, locale: 'fr-CH', ignoreHTTPSErrors: true, serviceWorkers: 'block' },
    'ordinateur',
  );
  await passe(
    browser,
    'Téléphone',
    {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      locale: 'fr-CH',
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    },
    'telephone',
  );

  await browser.close();

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
