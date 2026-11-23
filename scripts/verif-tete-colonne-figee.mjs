#!/usr/bin/env node
/**
 * LA TÊTE D'UNE COLONNE QUI PUBLIE NE BOUGE PAS QUAND LES CARTES DÉFILENT.
 *
 * Le geste de publication (le bouton « Déployer (n) », son chevron) était rendu
 * DANS la zone qui défile : dès qu'on descendait dans la liste des cartes, le
 * bouton sortait de l'écran. Il a d'abord été figé sous l'entête de colonne ;
 * depuis le 11/10/2026 il a QUITTÉ la colonne pour la barre d'en-tête de la
 * page : un bouton sur ordinateur (`[data-bloc-publication="to_deploy"]`, porté
 * là par `GestesDePage`), et sur téléphone le bouton à trois points de cette
 * même barre (`data-menu-general`), dont la première ligne est « Déployer ».
 *
 * Ce que le contrôle mesure, pour « À déployer », sur ordinateur puis sur
 * téléphone :
 *
 *  - la zone des cartes DÉFILE vraiment (sinon la mesure ne prouve rien) ;
 *  - l'entête de colonne et le geste de publication sont au MÊME endroit
 *    avant et après le défilement ;
 *  - le geste reste VISIBLE à l'écran, dans la barre d'en-tête (pas seulement
 *    immobile), et HORS de la zone qui défile.
 *
 * On mesure un ÉTAT (la même position, oui ou non), jamais une hauteur en
 * pixels attendue : la mise en page peut évoluer sans casser ce contrôle.
 *
 * Rien n'est écrit dans la base à part la session d'essai, retirée en partant.
 * (Refermer une carte restée ouverte, en revanche, efface le souvenir de cette
 * carte dans les réglages du serveur visé.)
 *
 *   HAIKO_TETE_URL=http://localhost:7099 node scripts/verif-tete-colonne-figee.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/* Le script juge le dépôt d'où il PART, jamais /root/beluga en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* On vise le serveur de DÉVELOPPEMENT : `BELUGA_URL`, posée pour les agents,
   désigne l'application DÉJÀ PUBLIÉE — on y verrait l'ancienne version. */
const BASE = process.env.HAIKO_TETE_URL || 'http://localhost:7099';
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';

/* LA BASE RÉELLEMENT SERVIE : `beluga.db` (`server/src/config.ts`, `cheminDeLaBase`). */
function cheminDeLaBase() {
  return path.join(DONNEES, 'beluga.db');
}

function ouvrirBase() {
  const require = createRequire(import.meta.url);
  return require(path.join(path.resolve(DONNEES, '..'), 'node_modules/better-sqlite3'))(cheminDeLaBase());
}

/* Une session d'une heure, fabriquée puis retirée. Le jeton est HACHÉ en base
   et n'est jamais réutilisé ; on ne reprend JAMAIS `BELUGA_TOKEN`. */
function poserSession() {
  const db = ouvrirBase();
  const jeton = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(jeton).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification tête de colonne figée',
  );
  db.close();
  return jeton;
}

function retirerSession(jeton) {
  const db = ouvrirBase();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(
    crypto.createHash('sha256').update(jeton).digest('hex'),
  );
  db.close();
}

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Mesure une colonne : sa tête, le geste de publication et la zone qui défile.
 * Rend `null` si la colonne n'est pas à l'écran.
 */
const RELEVE = (cle) => {
  const colonne = document.querySelector(`[data-column="${cle}"]`);
  if (!colonne) return null;
  const cadre = (element) => {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      left: Math.round(r.left),
      hauteur: Math.round(r.height),
      largeur: Math.round(r.width),
    };
  };
  /* La zone qui défile : le seul enfant de la colonne dont le contenu dépasse
     sa propre hauteur. On la retrouve par son ÉTAT, pas par une classe. */
  const zone = [...colonne.querySelectorAll('*')].find(
    (element) => element.scrollHeight > element.clientHeight + 4 && element.clientHeight > 80,
  );
  /* LE GESTE DE PUBLICATION DE CETTE COLONNE, là où il s'AFFICHE : le bouton du
     bloc (ou « Initier… » sans procédure), monté dans la barre d'en-tête sur
     ordinateur ; sur téléphone ce bloc reste monté sans rien dessiner, et c'est
     le bouton à trois points de la barre qui porte « Déployer ». */
  const affiche = (element) => element.getBoundingClientRect().height > 0;
  const bouton =
    [
      ...document.querySelectorAll(`[data-bloc-publication="${cle}"] [data-bouton-publication]`),
      ...document.querySelectorAll('[data-entete-de-zone] [data-initier-procedure]'),
      ...document.querySelectorAll('[data-entete-de-zone] [data-menu-general]'),
    ].find(affiche) ?? null;
  return {
    tete: cadre(colonne.querySelector(`[data-tete-colonne="${cle}"]`)),
    bouton: cadre(bouton),
    genre: !bouton ? null : bouton.hasAttribute('data-menu-general') ? 'bouton à trois points' : 'bouton',
    boutonDansLaZone: !!(zone && bouton && zone.contains(bouton)),
    boutonDansLaBarre: !!bouton?.closest('[data-entete-de-zone]'),
    defilement: zone ? Math.round(zone.scrollTop) : null,
    peutDefiler: !!zone,
    ecran: { largeur: window.innerWidth, hauteur: window.innerHeight },
  };
};

const DEFILER = (cle) => {
  const colonne = document.querySelector(`[data-column="${cle}"]`);
  if (!colonne) return null;
  const zone = [...colonne.querySelectorAll('*')].find(
    (element) => element.scrollHeight > element.clientHeight + 4 && element.clientHeight > 80,
  );
  if (!zone) return null;
  zone.scrollTop = zone.scrollHeight;
  return Math.round(zone.scrollTop);
};

async function jugerColonne(page, cle, libelle, contexte) {
  const avant = await page.evaluate(RELEVE, cle);
  if (!avant) {
    console.log(`  (${libelle} absente ${contexte} : rien à juger)`);
    return;
  }
  if (!avant.bouton) {
    console.log(`  (${libelle} ${contexte} : aucun geste de publication affiché, rien à juger)`);
    return;
  }
  noter(
    `${libelle} ${contexte} : le geste de publication est HORS de la zone qui défile, dans la barre d’en-tête`,
    !avant.boutonDansLaZone && avant.boutonDansLaBarre,
    `${avant.genre}${avant.peutDefiler ? '' : ' — la colonne ne défile pas encore'}`,
  );
  /* « L'ancre du déroulé est DANS la zone qui défile » n'est plus jugé : le
     déroulé a quitté la colonne, c'est une PAGE (`VoletDePublication`). */

  const defile = await page.evaluate(DEFILER, cle);
  if (defile === null || defile === 0) {
    console.log(`  (${libelle} ${contexte} : trop peu de cartes pour défiler — position non éprouvée)`);
    return;
  }
  await page.waitForTimeout(400);
  const apres = await page.evaluate(RELEVE, cle);
  noter(`${libelle} ${contexte} : la liste des cartes a bien défilé`, apres.defilement > 0, `${apres.defilement} px`);
  noter(
    `${libelle} ${contexte} : l’entête ne bouge pas d’un pixel`,
    avant.tete && apres.tete && avant.tete.top === apres.tete.top,
    `${avant.tete?.top} → ${apres.tete?.top}`,
  );
  noter(
    `${libelle} ${contexte} : le geste de publication reste à sa place`,
    !!apres.bouton && avant.bouton.top === apres.bouton.top && avant.bouton.left === apres.bouton.left,
    `${avant.bouton.left},${avant.bouton.top} → ${apres.bouton?.left},${apres.bouton?.top}`,
  );
  noter(
    `${libelle} ${contexte} : le geste reste visible à l’écran`,
    !!apres.bouton &&
      apres.bouton.hauteur > 0 &&
      apres.bouton.top >= 0 &&
      apres.bouton.top + apres.bouton.hauteur <= apres.ecran.hauteur &&
      apres.bouton.left >= 0 &&
      apres.bouton.left + apres.bouton.largeur <= apres.ecran.largeur,
    JSON.stringify(apres.bouton),
  );
}

/**
 * Une carte restée ouverte se ROUVRE seule au chargement d'un projet, en PAGE
 * par-dessus le tableau (`data-page-de-zone` — plus de voile à chercher) : elle
 * couvrirait ce qu'on mesure. Sur ordinateur, la flèche qui la referme est en
 * tête de la colonne de gauche ; sur téléphone, dans la barre de la page.
 */
async function refermerCeQuiTraine(page) {
  for (let essai = 0; essai < 3; essai += 1) {
    if (!(await page.locator('[data-page-de-zone]:visible').count())) break;
    const deLaColonne = page.locator('aside:has([data-colonne-de-page]) [data-menu-de-colonne]:visible').first();
    const deLaPage = page
      .locator('[data-page-de-zone] [data-retour-carte]:visible, [data-page-carte] [data-fil-d-ariane] [data-icone-du-cran]:visible')
      .first();
    if (await deLaColonne.count()) await deLaColonne.click();
    else if (await deLaPage.count()) await deLaPage.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  const jeton = poserSession();
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH' });
    await contexte.addCookies([
      { name: 'beluga_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="planned"]', { timeout: 30000 });
    await page.waitForTimeout(2500);
    await refermerCeQuiTraine(page);

    await jugerColonne(page, 'to_deploy', '« À déployer »', 'sur ordinateur');

    /* SUR TÉLÉPHONE, les colonnes se suivent dans une bande qu'on fait glisser
       (plus d'onglet de colonne) : on amène « À déployer » sous les yeux avant
       de la juger. */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1200);
    await refermerCeQuiTraine(page);
    /* La mise en production n'est liée à aucune colonne — un bouton de la barre
       d'en-tête, jugé par `verif-bandeau-production.mjs` : seule « À déployer »
       a un geste de publication à elle. */
    for (const [cle, libelle] of [['to_deploy', '« À déployer »']]) {
      await page.evaluate((c) => {
        document.querySelector(`[data-column="${c}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
      }, cle);
      await page.waitForTimeout(1200);
      const aLEcran = await page.evaluate((c) => {
        const r = document.querySelector(`[data-column="${c}"]`)?.getBoundingClientRect();
        return !!r && r.left >= 0 && r.right <= window.innerWidth + 1;
      }, cle);
      noter(`${libelle} sur téléphone : la colonne est amenée à l’écran`, aLEcran);
      await jugerColonne(page, cle, libelle, 'sur téléphone');
    }

    const SHOTS = path.join(RACINE, 'data', 'verification');
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'tete-colonne-figee.png') });

    noter('Aucune erreur JavaScript de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await navigateur.close();
    retirerSession(jeton);
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ÉCHEC :', error);
  process.exit(1);
});
