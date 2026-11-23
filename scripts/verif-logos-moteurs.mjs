#!/usr/bin/env node
/**
 * LE LOGO OFFICIEL DE CHAQUE MOTEUR, À GAUCHE DU NOM DE SON COMPTE.
 *
 * Trois promesses, jugées dans un vrai navigateur, sur les comptes réels :
 *
 *  1. dans le VOLET DES QUOTAS comme dans RÉGLAGES › COMPTES, chaque ligne
 *     porte un logo, posé À GAUCHE du nom et sur la même rangée ;
 *  2. ce logo est celui de la MARQUE du moteur (Claude, OpenAI pour Codex,
 *     Cursor, Xiaomi pour MiMo, Gemini) — le repli neutre ne sert qu'à un
 *     moteur ajouté depuis les réglages ;
 *  3. dans les DEUX palettes (clair, sombre — l'apparence est noir et blanc
 *     depuis la refonte du 11/10/2026, les dix autres palettes ont disparu),
 *     un logo d'une seule teinte (OpenAI, Cursor) reste lisible sur son fond :
 *     figé en noir, il disparaîtrait en sombre. Un logo en couleurs, lui, ne
 *     change pas de teinte d'une palette à l'autre.
 *
 * LE CHEMIN VERS RÉGLAGES › COMPTES : le bouton « Menu » du bandeau n'existe
 * plus. Les réglages s'ouvrent par leur bouton, au pied de la colonne de
 * gauche (`[data-reglages-menu]`), puis la page « comptes » de la fenêtre.
 *
 * Le script fabrique une session d'une heure, la retire en partant, ne clique
 * sur aucun interrupteur et ne relit aucun quota : il regarde.
 *
 *   npm run dev --workspace web -- --port 7099
 *   HAIKO_LOGOS_URL=http://localhost:7099 node scripts/verif-logos-moteurs.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

/* Le serveur de DÉVELOPPEMENT, jamais BELUGA_URL (l'application publiée). */
const BASE = process.env.HAIKO_LOGOS_URL || 'http://localhost:7099';
const CAPTURES = process.env.HAIKO_LOGOS_CAPTURES || '/tmp/verif-logos-moteurs';
const BASE_DE_DONNEES = process.env.BELUGA_DB || cheminDeLaBaseServie();

/** Le logo attendu par moteur ; tout autre moteur garde le repli neutre. */
const LOGO_ATTENDU = {
  claude: 'claude',
  codex: 'openai',
  cursor: 'cursor',
  mimo: 'xiaomi',
  'ext-google-gemini': 'gemini',
};
const UNE_SEULE_TEINTE = ['openai', 'cursor'];

/** Les deux palettes (`shared/src/themes.ts`) : l'identifiant posé sur la page, et sa clarté. */
const PALETTES = [
  ['sombre', true], ['clair', false],
];

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function ouvrirSession() {
  const db = new Database(BASE_DE_DONNEES);
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte, maintenant, maintenant + 3600_000, 'vérification des logos des moteurs',
  );
  db.close();
  return { token, empreinte };
}

function retirerSession(empreinte) {
  const db = new Database(BASE_DE_DONNEES);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

const poserPalette = (page, [id, sombre]) =>
  page.evaluate(
    ({ id, sombre }) => {
      document.documentElement.dataset.theme = id;
      document.documentElement.classList.toggle('dark', sombre);
    },
    { id, sombre },
  );

/**
 * Ce que montre chaque ligne de compte : son moteur, le logo posé, sa place
 * par rapport au nom, et — pour juger la lisibilité — sa teinte et celle du
 * premier fond opaque sous lui.
 */
function lireLesLignes(page, selecteurDeLigne) {
  return page.evaluate((selecteur) => {
    /* Une couleur calculée n'est pas toujours écrite « rgb(…) » (`color(srgb …)`,
       `oklab(…)` pour un fond mélangé) : on la fait PEINDRE, puis on lit le point. */
    const toile = document.createElement('canvas');
    toile.width = toile.height = 1;
    const pinceau = toile.getContext('2d', { willReadFrequently: true });
    const enRvb = (couleur) => {
      pinceau.clearRect(0, 0, 1, 1);
      pinceau.fillStyle = couleur;
      pinceau.fillRect(0, 0, 1, 1);
      return [...pinceau.getImageData(0, 0, 1, 1).data];
    };
    const fondSous = (noeud) => {
      for (let n = noeud; n; n = n.parentElement) {
        const fond = enRvb(getComputedStyle(n).backgroundColor);
        if (fond[3] > 230) return fond;
      }
      return [255, 255, 255, 255];
    };
    return [...document.querySelectorAll(selecteur)].map((ligne) => {
      const logo = ligne.querySelector('[data-logo-moteur]');
      const nom = ligne.querySelector('[data-nom-compte]');
      const boiteLogo = logo?.getBoundingClientRect();
      const boiteNom = nom?.getBoundingClientRect();
      return {
        moteur: ligne.getAttribute('data-moteur') ?? ligne.getAttribute('data-moteur-ajoute'),
        nom: nom?.textContent?.trim() ?? null,
        logo: logo?.getAttribute('data-logo-moteur') ?? null,
        largeur: boiteLogo?.width ?? 0,
        aGauche: !!boiteLogo && !!boiteNom && boiteLogo.right <= boiteNom.left + 0.5,
        memeRangee:
          !!boiteLogo && !!boiteNom &&
          Math.abs(boiteLogo.top + boiteLogo.height / 2 - (boiteNom.top + boiteNom.height / 2)) <= 3,
        teinte: logo ? enRvb(getComputedStyle(logo).color) : null,
        fond: logo ? fondSous(logo) : null,
      };
    });
  }, selecteurDeLigne);
}

function luminance([r, v, b]) {
  const canal = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(v) + 0.0722 * canal(b);
}
function contraste(a, b) {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (clair + 0.05) / (sombre + 0.05);
}

/** Les trois promesses, sur un écran donné. */
async function jugerUnEcran(page, ecran, selecteurDeLigne) {
  const lignes = await lireLesLignes(page, selecteurDeLigne);
  noter(`${ecran} : des lignes de compte sont affichées`, lignes.length > 0, `${lignes.length} ligne(s)`);
  for (const ligne of lignes) {
    const qui = `${ecran} · ${ligne.nom ?? '?'} (${ligne.moteur})`;
    noter(`${qui} : un logo à gauche du nom, sur la même rangée`, ligne.aGauche && ligne.memeRangee && ligne.largeur >= 12);
    const attendu = LOGO_ATTENDU[ligne.moteur] ?? 'neutre';
    noter(`${qui} : c'est le logo « ${attendu} »`, ligne.logo === attendu, `affiché : ${ligne.logo}`);
  }

  const faibles = [];
  for (const palette of PALETTES) {
    await poserPalette(page, palette);
    for (const ligne of await lireLesLignes(page, selecteurDeLigne)) {
      if (!UNE_SEULE_TEINTE.includes(ligne.logo)) continue;
      const rapport = contraste(ligne.teinte, ligne.fond);
      if (rapport < 4.5) faibles.push(`${palette[0]} · ${ligne.logo} ${rapport.toFixed(1)} (${ligne.teinte.slice(0, 3)} sur ${ligne.fond.slice(0, 3)})`);
    }
  }
  noter(`${ecran} : les logos d'une seule teinte restent lisibles dans les deux palettes`, faibles.length === 0, faibles.join(', '));
  return lignes;
}

const session = ouvrirSession();
fs.mkdirSync(CAPTURES, { recursive: true });
const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const contexte = await navigateur.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'beluga_session', value: session.token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  /* Les couleurs d'une palette s'installent en fondu : lue en plein fondu, une
     teinte déjà changée se compare à un fond qui ne l'est pas encore. */
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  await page.waitForSelector('[data-essai="badge-quota"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  const palettesDeCapture = [['clair', false], ['sombre', true]];

  /* LE TABLEAU : le logo ouvre le titre des cartes au travail. */
  for (const palette of palettesDeCapture) {
    await poserPalette(page, palette);
    await page.screenshot({ path: path.join(CAPTURES, `tableau-${palette[0]}.png`) });
  }
  const surLesCartes = await page.evaluate(() =>
    [...document.querySelectorAll('[data-icone-moteur] [data-logo-moteur]')].map((n) => n.getAttribute('data-logo-moteur')),
  );
  console.log(`  (tableau : ${surLesCartes.length} carte(s) au travail — ${[...new Set(surLesCartes)].join(', ') || 'aucun logo à juger'})`);

  /* LE VOLET DES QUOTAS. */
  await page.locator('[data-essai="badge-quota"]').click();
  await page.waitForSelector('[data-carte-quota]', { timeout: 20000 });
  await page.waitForTimeout(600);
  const duVolet = await jugerUnEcran(page, 'Volet des quotas', '[data-carte-quota]');
  for (const palette of palettesDeCapture) {
    await poserPalette(page, palette);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(CAPTURES, `volet-${palette[0]}.png`) });
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  /* RÉGLAGES › COMPTES. */
  if ((await page.locator('[data-assistant-moteurs="1"]').count()) > 0) {
    await page.locator('[data-assistant-reglages="1"]').first().click();
  } else {
    await page.locator('[data-reglages-menu]:visible').first().click();
  }
  await page.locator('[data-page-menu="comptes"]').first().click({ timeout: 30000 });
  await page.waitForSelector('[data-ligne-compte]', { timeout: 20000 });
  await page.waitForTimeout(600);
  /* Les comptes, puis les moteurs ajoutés depuis les réglages (dont Gemini). */
  const desReglages = await jugerUnEcran(page, 'Réglages › Comptes', '[data-ligne-compte], [data-moteur-ajoute]');
  for (const palette of palettesDeCapture) {
    await poserPalette(page, palette);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(CAPTURES, `comptes-${palette[0]}.png`) });
  }

  const vus = new Set([...duVolet, ...desReglages].map((l) => l.logo));
  const jamaisVus = Object.values(LOGO_ATTENDU).filter((logo) => !vus.has(logo));
  console.log(`  (logos rencontrés : ${[...vus].join(', ')}${jamaisVus.length ? ` — sans compte ici, donc non jugés : ${jamaisVus.join(', ')}` : ''})`);
  noter('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));
} finally {
  await navigateur.close();
  retirerSession(session.empreinte);
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérification(s) réussie(s). Captures : ${CAPTURES}`);
process.exit(echecs.length ? 1 : 0);
