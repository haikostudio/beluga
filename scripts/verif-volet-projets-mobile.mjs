#!/usr/bin/env node
/**
 * LE VOLET DES PROJETS S'OUVRE VRAIMENT SUR TÉLÉPHONE.
 *
 * Le bouton menu de la barre du haut (visible seulement sous `sm`) fait glisser
 * la liste des projets depuis la gauche. Ce panneau est enveloppé d'un filet :
 * si son contenu tombe, l'écran affiche « Liste des projets n'a pas pu
 * s'afficher » AU LIEU des projets — et le bouton paraît « bloqué » alors que
 * le clic a très bien fonctionné. C'est exactement la panne qu'on a corrigée.
 *
 * On juge donc trois choses, dans un vrai navigateur, en 390 px de large :
 *
 *   1. le bouton menu existe et le panneau s'ouvre ;
 *   2. le filet n'a RIEN attrapé — aucun message d'erreur dans le panneau ;
 *   3. la liste porte de vraies lignes de projet, pas un panneau vide ;
 *   4. poignées et réglages des lignes sont CACHÉS à l'ouverture, apparaissent
 *      au premier appui sur l'interrupteur de la tête de colonne, et se
 *      recachent au second ;
 *   5. sur un écran d'ordinateur, aucun interrupteur et les réglages restent
 *      posés dans les lignes, comme avant.
 *
 * SUR ORDINATEUR, LA LISTE DES PROJETS NE S'AFFICHE QUE SUR LES TABLEAUX DE
 * BORD (refonte du 11/10/2026) : dans un projet — où l'application s'ouvre — la
 * colonne de gauche porte les options du projet. Le point 5 remonte donc aux
 * tableaux de bord (`ouvrirLesTableauxDeBord`) avant de regarder les lignes.
 *
 *   HAIKO_VOLET_URL=http://localhost:7099 node scripts/verif-volet-projets-mobile.mjs
 *
 * Rien n'est écrit dans la base à part la session d'essai, retirée en partant.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';
import { ouvrirLesTableauxDeBord } from './lib/navigation.mjs';

/* La racine se déduit du script : lancé d'une copie de travail, il juge CE
   code-là, jamais le dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_VOLET_URL || 'http://localhost:7099';

/* La base réellement servie (`BELUGA_DATA` l'emporte), jamais un chemin écrit à la main. */
function base() {
  return new Database(cheminDeLaBaseServie());
}

/** Une session d'une heure : la colonne « token » garde le SHA-256 du cookie. */
function poserSession() {
  const db = base();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification volet projets mobile',
  );
  db.close();
  return { cookie, retirer: () => retirerSession(cookie) };
}

function retirerSession(cookie) {
  const db = base();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
  );
  db.close();
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  console.log(`Application visée : ${BASE}`);
  const session = poserSession();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 780 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    {
      name: 'beluga_session',
      value: session.cookie,
      url: new URL(BASE).origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  /* Une erreur d'affichage part au serveur : on l'attrape ici au passage, elle
     nomme la zone tombée mieux que n'importe quelle mesure de l'écran. */
  const remontees = [];
  const page = await context.newPage();
  page.on('request', (req) => {
    if (req.url().endsWith('/api/erreur')) remontees.push(req.postData() ?? '');
  });

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    page.setDefaultTimeout(8000);

    const bouton = page.locator('button[aria-label="Projets"]');
    const present = await bouton.count();
    record('le bouton menu des projets est là sur téléphone', present > 0);
    if (!present) return;

    await bouton.first().click();
    await page.waitForTimeout(1500);

    const etat = await page.evaluate(() => {
      const titres = [...document.querySelectorAll('*')].filter(
        (n) => n.children.length === 0 && /n'a pas pu s'afficher/.test(n.textContent ?? ''),
      );
      return {
        erreur: titres.map((n) => n.textContent?.trim()).join(' | '),
        lignes: document.querySelectorAll('[data-espace-dev], [data-drag-id]').length,
        ouvrirProjets: !!document.querySelector('[data-menu-dossier]'),
      };
    });

    record('aucun filet d’erreur dans le volet', !etat.erreur, etat.erreur || 'rien attrapé');
    record(
      'le volet montre la liste des projets',
      etat.ouvrirProjets && etat.lignes > 0,
      `${etat.lignes} ligne(s)`,
    );
    record(
      'aucune erreur d’affichage remontée au serveur',
      remontees.length === 0,
      remontees.join(' | ').slice(0, 300),
    );

    /* LES OUTILS DES LIGNES : cachés, puis montrés, puis recachés. « Visible »
       veut dire rendu dans la page (display), pas seulement présent. */
    const outils = () =>
      page.evaluate(() => {
        const rendus = (sel) => [...document.querySelectorAll(sel)].filter((n) => n.getClientRects().length > 0).length;
        return {
          /* La colonne de gauche existe en deux exemplaires (ordinateur et
             volet) : seul celui qui est RENDU compte. */
          interrupteur:
            [...document.querySelectorAll('[data-outils-projets]')]
              .find((n) => n.getClientRects().length > 0)
              ?.getAttribute('data-outils-projets') ?? null,
          reglages: rendus('[data-reglages-projet]'),
          poignees: rendus('[data-poignee-projet]'),
          groupes: rendus('[data-outil-groupe]'),
        };
      });
    const depart = await outils();
    record(
      'à l’ouverture, poignées et réglages sont cachés',
      depart.interrupteur === 'caches' && depart.reglages === 0 && depart.poignees === 0 && depart.groupes === 0,
      JSON.stringify(depart),
    );
    /* Un toast du vrai démon peut couvrir l'entête : le clic part sur le bouton lui-même. */
    await page.locator('[data-outils-projets]:visible').dispatchEvent('click');
    await page.waitForTimeout(400);
    const montres = await outils();
    record(
      'un appui sur l’interrupteur les fait apparaître',
      montres.interrupteur === 'visibles' && montres.reglages > 0 && montres.poignees > 0,
      JSON.stringify(montres),
    );
    /* Un toast du vrai démon peut couvrir l'entête : le clic part sur le bouton lui-même. */
    await page.locator('[data-outils-projets]:visible').dispatchEvent('click');
    await page.waitForTimeout(400);
    const recaches = await outils();
    record(
      'un second appui les recache',
      recaches.interrupteur === 'caches' && recaches.reglages === 0 && recaches.poignees === 0 && recaches.groupes === 0,
      JSON.stringify(recaches),
    );

    /* SUR ORDINATEUR, RIEN NE CHANGE : pas d'interrupteur, réglages posés. */
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(1200);
    /* La liste des projets n'est à l'écran que sur les tableaux de bord : dans
       un projet, la colonne porte ses options, et aucune ligne n'est rendue. */
    await ouvrirLesTableauxDeBord(page);
    await page.waitForTimeout(600);
    const ordinateur = await outils();
    record(
      'sur ordinateur, aucun interrupteur et les réglages restent dans les lignes',
      ordinateur.interrupteur === null && ordinateur.reglages > 0 && ordinateur.poignees > 0,
      JSON.stringify(ordinateur),
    );
  } finally {
    await browser.close();
    session.retirer();
  }
}

await main();

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
