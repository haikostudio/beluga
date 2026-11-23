#!/usr/bin/env node
/**
 * LA CONFIGURATION D'UN PROJET S'OUVRE POUR N'IMPORTE QUEL PROJET.
 *
 * Ce contrôle-ci ne juge pas le détail d'une rubrique — c'est le travail de
 * `verif-config-projet.mjs` (ordinateur) et `verif-config-projet-etroit.mjs`
 * (téléphone), qui creusent UN projet. Il vérifie l'autre moitié : que la
 * fenêtre tient debout sur PLUSIEURS projets, dont un projet neuf où rien
 * n'est encore enregistré, sur ordinateur ET sur téléphone, sans une seule
 * erreur dans la console.
 *
 * LA LISTE DES PROJETS SE LIT UNE FOIS, AU DÉPART. Sur ordinateur, la colonne
 * de gauche suit le lieu (refonte du 11/10/2026) : elle ne montre la liste des
 * projets que sur les tableaux de bord, et ouvrir la configuration d'un projet
 * par son adresse fait ENTRER dans ce projet — la liste n'est alors plus à
 * l'écran. On remonte donc d'abord aux tableaux de bord
 * (`ouvrirLesTableauxDeBord`), on relève les projets, puis on ouvre la
 * configuration de chacun. Sur téléphone, la liste vit toujours dans le
 * panneau « Projets » de la barre d'en-tête.
 *
 * C'est exactement ce qu'une fenêtre à rubriques peut casser en silence : une
 * rubrique qui suppose un dépôt, une adresse ou un client, et qui se vide sur
 * le premier projet qui n'en a pas.
 *
 * Il fabrique une session d'UNE HEURE (empreinte SHA-256 en base), la retire
 * en partant, et vise le serveur de DÉVELOPPEMENT par sa propre variable :
 * `BELUGA_URL` désigne l'application DÉJÀ PUBLIÉE et n'a rien à faire ici.
 *
 *   HAIKO_REGLAGES_URL=http://localhost:7099 node scripts/verif-reglages-projet.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { creerResultats } from './lib/verif-resultats.mjs';
import { cheminDeLaBaseServie, dossierDesDonnees } from './lib/base-servie.mjs';
import { ouvrirLesTableauxDeBord } from './lib/navigation.mjs';

const BASE = process.env.HAIKO_REGLAGES_URL || 'http://localhost:7099';
const SHOTS = path.join(dossierDesDonnees(), 'verification');

/* Les rubriques, lues dans le SOCLE PARTAGÉ : en ajouter une ici serait la
   seule façon d'oublier de la juger. */
const { RUBRIQUES_CONFIG_PROJET } = await import(
  new URL('../shared/dist/config-projet-rubriques.js', import.meta.url).href
);

const { results, record } = creerResultats();

function ouvrirBase() {
  return new Database(cheminDeLaBaseServie());
}

function poserSession() {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrirBase();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification configuration des projets',
  );
  db.close();
  return {
    cookie,
    retirer: () => {
      const fin = ouvrirBase();
      fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
      fin.close();
    },
  };
}

async function shot(page, nom) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${nom}.png`) }).catch(() => undefined);
}

const fenetre = (page) => page.locator('[data-config-projet]');

/** Les projets que la liste montre À L'ÉCRAN, dans l'ordre : leur identifiant et leur nom. */
const lireLesProjets = (page) =>
  page.locator('[data-drag-kind="project"]:visible').evaluateAll((els) =>
    els.map((el) => ({ id: el.getAttribute('data-drag-id'), nom: el.innerText.trim().split('\n')[0] })),
  );

/**
 * Ouvre la configuration d'un projet PAR SON ADRESSE, parcourt toutes ses
 * rubriques et dit ce qu'on y a vu. L'adresse, plutôt que la ligne « Réglages
 * du projet » : le contrôle porte sur la fenêtre, pas sur le chemin qui y mène.
 */
async function parcourirRubriques(page, projet, erreurs) {
  erreurs.length = 0;
  if (!projet) return null;
  const { id, nom } = projet;

  await page.evaluate((projet) => {
    window.location.hash = `projet/${projet}/config`;
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, id);
  await fenetre(page).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);

  const visible = await fenetre(page).isVisible().catch(() => false);
  if (!visible) return { nom, visible, vides: ['la fenêtre ne s’est pas ouverte'], racineVide: false, erreurs: [...erreurs] };

  const vides = [];
  for (const rubrique of RUBRIQUES_CONFIG_PROJET) {
    /* Sur téléphone la rubrique recouvre le menu : il faut y revenir d'abord. */
    const item = page.locator(`[data-rubrique-config="${rubrique.cle}"]`);
    if (!(await item.isVisible().catch(() => false))) {
      const retour = page.locator('[data-retour-menu-config]').first();
      if (await retour.count()) await retour.evaluate((el) => el.click());
      await page.waitForTimeout(350);
    }
    await item.evaluate((el) => el.click()).catch(() => {});
    await page.waitForTimeout(400);
    const texte = await page
      .locator(`[data-rubrique-contenu="${rubrique.cle}"]`)
      .innerText()
      .catch(() => '');
    if (texte.trim().length < 20) vides.push(rubrique.cle);
  }

  // Une page vidée par un plantage : la racine React n'a plus rien dedans.
  const racineVide = await page.evaluate(() => (document.getElementById('root')?.childElementCount ?? 0) === 0);
  return { nom, visible, vides, racineVide, erreurs: [...erreurs] };
}

async function fermer(page) {
  await page.keyboard.press('Escape');
  await fenetre(page).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
}

/** Sur téléphone, la liste vit dans un panneau : on ne le rouvre que s'il est fermé. */
async function rouvrirPanneau(page, bouton) {
  if (!(await bouton.isVisible().catch(() => false))) return;
  const panneau = page.locator('[data-feuille-du-bas]:has([data-menu-du-telephone])');
  if (await panneau.isVisible().catch(() => false)) return;
  await bouton.click();
  await page.waitForTimeout(600);
}

async function passe(browser, session, titre, contexte, suffixe) {
  const context = await browser.newContext(contexte);
  await context.addCookies([
    { name: 'beluga_session', value: session, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Sur téléphone la liste des projets vit dans un panneau latéral.
  const boutonProjets = page.locator('header button[aria-label="Projets"]');
  await rouvrirPanneau(page, boutonProjets);
  /* Sur ordinateur, l'application s'ouvre DANS un projet : la colonne de gauche
     porte ses options, pas la liste. Elle revient sur les tableaux de bord. */
  if (!(await boutonProjets.isVisible().catch(() => false))) {
    await ouvrirLesTableauxDeBord(page).catch(() => undefined);
    await page.waitForTimeout(400);
  }

  const projets = await lireLesProjets(page);
  record(`${titre} : la liste des projets est là`, projets.length > 0, `${projets.length} projets`);

  let jugés = 0;
  for (const index of [0, 1, 2, 3]) {
    const vu = await parcourirRubriques(page, projets[index], erreurs);
    if (!vu) continue;
    jugés += 1;
    record(
      `${titre} : les ${RUBRIQUES_CONFIG_PROJET.length} rubriques de « ${vu.nom} » ont toutes du contenu`,
      vu.visible && vu.vides.length === 0 && !vu.racineVide,
      vu.racineVide
        ? 'écran vide (la page a planté)'
        : vu.vides.length
          ? `vides : ${vu.vides.join(', ')}`
          : '',
    );
    if (vu.erreurs.length) record(`${titre} : console muette pour « ${vu.nom} »`, false, vu.erreurs[0].slice(0, 220));
    else record(`${titre} : console muette pour « ${vu.nom} »`, true);
    await shot(page, `config-projet-${suffixe}-${index}`);
    await fermer(page);
    await rouvrirPanneau(page, boutonProjets);
  }

  record(`${titre} : plusieurs projets ont été jugés`, jugés >= 2, `${jugés} projets`);

  await context.close();
}

async function main() {
  const session = poserSession();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });

  try {
    await passe(
      browser,
      session.cookie,
      'Ordinateur',
      { viewport: { width: 1440, height: 900 }, locale: 'fr-CH', ignoreHTTPSErrors: true, serviceWorkers: 'block' },
      'ordinateur',
    );
    await passe(
      browser,
      session.cookie,
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
  } finally {
    await browser.close();
    session.retirer();
  }

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
