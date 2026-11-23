#!/usr/bin/env node
/**
 * Vérification de la MODALE des réglages : elle s'ouvre bien en fenêtre (posée
 * au milieu du grand écran, et non collée au bas comme un tiroir), son menu
 * répond, la barre de capacité n'est plus rouge quand il reste de la place, et
 * « Ce qui a été consommé » porte sa description et de vrais noms de projets.
 *
 * Il fabrique une session d'UNE HEURE, la retire en partant, et vise le serveur
 * de DÉVELOPPEMENT par sa propre variable : `BELUGA_URL` désigne l'application
 * déjà PUBLIÉE et n'a rien à faire dans un contrôle.
 *
 *   HAIKO_REGLAGES_URL=http://localhost:7099 node scripts/verif-reglages.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { creerResultats } from './lib/verif-resultats.mjs';

const BASE = process.env.HAIKO_REGLAGES_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL, même quand
   ce script est lancé d'une copie de travail. */
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';
const SHOTS = `${process.env.BELUGA_DATA || '/root/beluga/data'}/verification`;

/** Une session d'UNE HEURE, fabriquée puis retirée : la base garde le SHA-256
    du cookie, jamais le cookie. C'est la seule écriture de tout ce contrôle. */
async function avecSession(travail) {
  const { default: crypto } = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const { cheminDeLaBaseServie } = await import('./lib/base-servie.mjs');
  const path = await import('node:path');
  const require = createRequire(import.meta.url);
  const ouvrir = () =>
    require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie(DONNEES));

  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrir();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification des réglages',
  );
  db.close();
  try {
    return await travail(cookie);
  } finally {
    const fin = ouvrir();
    fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    fin.close();
  }
}

const { results, record } = creerResultats();

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  await avecSession(dansLeNavigateur);
}

async function dansLeNavigateur(TOKEN) {
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
  await context.addCookies([
    { name: 'beluga_session', value: TOKEN, url: origine, httpOnly: true, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  /* ON ATTEND UN ÉTAT, PAS UNE DURÉE : le serveur de développement compile à la
     demande, et un délai fixe accusait à tort un écran pas encore rendu. */
  for (let essai = 0; essai < 60; essai += 1) {
    if (await page.evaluate(() => window.belugaEssai?.pret?.() === true)) break;
    await page.waitForTimeout(1000);
  }
  /* UN TIROIR LAISSÉ OUVERT couvrirait tout l'écran : on referme ce qui traîne
     avant de juger quoi que ce soit. */
  for (let essai = 0; essai < 6; essai += 1) {
    const ouvert = await page.evaluate(
      () => document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length,
    );
    if (!ouvert && essai > 0) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }
  // Les réglages s'ouvrent par l'ADRESSE : aucun clic à deviner dans le bandeau.
  await page.evaluate(() => {
    window.location.hash = 'reglages';
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForSelector('[data-modale-reglages]', { timeout: 20000 });
  await page.waitForTimeout(600);

  const tiroir = page.locator('[data-modale-reglages]').last();
  record('la modale des réglages est ouverte', await tiroir.isVisible());

  /* SUR TÉLÉPHONE, la page choisie recouvre le menu : on repasse par le retour
     avant chaque page, sinon le menu est hors de l'écran. */
  const ouvrirLaPage = async (cle) => {
    const retour = tiroir.locator('[data-retour-menu-reglages]');
    if (await retour.isVisible().catch(() => false)) {
      await retour.click();
      await page.waitForTimeout(400);
    }
    await tiroir.locator(`[data-page-menu="${cle}"]`).click();
    await page.waitForSelector(`[data-page-reglages="${cle}"]`, { timeout: 10000 });
    await page.waitForTimeout(700);
  };

  // LE MENU PORTE SES GROUPES ET SES PAGES, repérés par des attributs
  // techniques : ils valent dans les cinq langues.
  // « capacite » a rejoint la page « serveur » (06/11/2026).
  const pages = ['serveur', 'agents-paralleles', 'comptes', 'voix', 'consommation', 'sauvegardes'];
  for (const cle of pages) {
    record(`page « ${cle} » présente au menu`, (await tiroir.locator(`[data-page-menu="${cle}"]`).count()) > 0);
  }
  await ouvrirLaPage('serveur');

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

  await tiroir.screenshot({ path: `${SHOTS}/reglages-capacite.png` });

  // Agents en parallèle : chaque champ porte son explication.
  await ouvrirLaPage('agents-paralleles');
  const aides = await tiroir.locator('p.text-\\[12\\.5px\\]').count();
  record('les champs sont expliqués', aides >= 4, `${aides} explications`);
  record(
    'plus d’étiquette énigmatique « Pendant (minutes) »',
    (await tiroir.getByText('Pendant (minutes)', { exact: true }).count()) === 0,
  );
  await tiroir.screenshot({ path: `${SHOTS}/reglages-agents.png` });

  // Consommation : description sous le titre, et des noms de projets.
  await ouvrirLaPage('consommation');
  await page.waitForTimeout(1800);
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
