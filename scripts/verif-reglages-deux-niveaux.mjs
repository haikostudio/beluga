#!/usr/bin/env node
/**
 * LES RÉGLAGES À DEUX NIVEAUX (refonte du 21/11/2026), DANS UN VRAI NAVIGATEUR.
 *
 * Premier niveau : six rubriques et la recherche, sans défiler. Second niveau :
 * la colonne de gauche devient celle de la rubrique, « ‹ Réglages » dans
 * l'en-tête ramène au premier niveau, « Avancé » est replié. Sur téléphone,
 * trois crans et la flèche de l'en-tête remonte d'un cran. Les anciennes clés
 * de page (`extension`, `installation`, `langue`, `voix`, `capacite`) mènent à
 * leur nouvelle place. Captures 1440 et 390, clair et sombre.
 *
 * Il fabrique une session d'UNE HEURE, la retire en partant, et n'écrit rien
 * d'autre : le thème se pose sur la page seulement (jamais la préférence du
 * serveur). Il vise le serveur de DÉVELOPPEMENT par sa propre variable.
 *
 *   HAIKO_REGLAGES_URL=http://localhost:7099 VERIF_CAPTURES=<dossier> node scripts/verif-reglages-deux-niveaux.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const ADRESSE = process.env.HAIKO_REGLAGES_URL || 'http://localhost:7099';
const CAPTURES = process.env.VERIF_CAPTURES || '/tmp/reglages-deux-niveaux';
fs.mkdirSync(CAPTURES, { recursive: true });

const require = createRequire('/root/beluga/package.json');
const Database = require('better-sqlite3');
const base = new Database(cheminDeLaBaseServie());
const cookie = crypto.randomBytes(24).toString('hex');
const jeton = crypto.createHash('sha256').update(cookie).digest('hex');
const maintenant = Date.now();
base
  .prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)')
  .run(jeton, maintenant, maintenant + 3600_000, 'verif-reglages-deux-niveaux', 'admin-premier');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  for (const largeur of [1440, 390]) {
    const telephone = largeur === 390;
    for (const theme of ['clair', 'sombre']) {
      const ctx = await navigateur.newContext({
        viewport: { width: largeur, height: telephone ? 844 : 900 },
        isMobile: telephone,
        hasTouch: telephone,
        serviceWorkers: 'block',
      });
      await ctx.addCookies([{ name: 'beluga_session', value: cookie, url: ADRESSE }]);
      const page = await ctx.newPage();
      /* LE THÈME SE POSE SUR LE CANAL, JAMAIS EN BASE : la préférence reçue du serveur est réécrite en route, et
         aucune écriture de préférence ne repart (le thème de l'utilisateur reste le sien). */
      await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
        const serveur = ws.connectToServer();
        ws.onMessage((m) => {
          if (typeof m === 'string' && /"type":"prefs\.set"/.test(m)) return;
          serveur.send(m);
        });
        serveur.onMessage((m) => ws.send(typeof m === 'string' ? m.replace(/"theme":"(clair|sombre)"/g, `"theme":"${theme}"`) : m));
      });
      await page.addInitScript((th) => {
        try {
          localStorage.setItem('beluga-theme-flash', th);
        } catch {}
      }, theme);
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e)));
      const poserTheme = async () => {
        const sombre = await page.evaluate(() => document.documentElement.classList.contains('dark'));
        noter(`${largeur}/${theme} : le thème demandé est appliqué`, sombre === (theme === 'sombre'));
      };
      const nom = (n) => path.join(CAPTURES, `${n}-${largeur}-${theme}.png`);
      const pause = (ms) => page.waitForTimeout(ms);

      await page.goto(`${ADRESSE}/#reglages`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-rubriques-reglages]', { timeout: 45000 });
      await poserTheme();
      await pause(600);
      const rubriques = await page.locator('[data-rubrique-reglages]').count();
      noter(`${largeur}/${theme} : six rubriques au premier niveau`, rubriques === 6, String(rubriques));
      const tient = await page.evaluate(() => {
        const grille = document.querySelector('[data-rubriques-reglages]');
        const modale = document.querySelector('[data-modale-reglages]');
        if (!grille || !modale) return false;
        return grille.getBoundingClientRect().bottom <= modale.getBoundingClientRect().bottom + 1;
      });
      noter(`${largeur}/${theme} : les six rubriques tiennent sans défiler`, tient);
      await page.screenshot({ path: nom('1-rubriques') });

      // Recherche
      await page.fill('[data-recherche-reglages] input, input[data-recherche-reglages]', 'connect').catch(async () => {
        await page.locator('[data-recherche-reglages]').locator('input').first().fill('connect');
      });
      await pause(300);
      /* Beluga Connect vit dans la page unique « Ordinateurs » (21/11/2026) : la recherche y mène. */
      const trouve = await page.locator('[data-page-menu="ordinateurs"]').count();
      noter(`${largeur}/${theme} : « connect » trouve la page des ordinateurs (Beluga Connect)`, trouve > 0);
      if (largeur === 1440 && theme === 'clair') await page.screenshot({ path: nom('2-recherche') });
      await page.locator('[data-page-menu="ordinateurs"]').first().click();
      await page.waitForSelector('[data-page-ordinateurs]', { timeout: 20000 });
      noter(`${largeur}/${theme} : un résultat ouvre sa rubrique et sa page`, (await page.locator('[data-rubrique-ouverte="ordinateurs"]').count()) === 1);
      await pause(800);
      await page.screenshot({ path: nom('3-beluga-connect') });

      // Retour d'un cran sur téléphone, puis au premier niveau
      if (telephone) {
        await page.locator('[data-retour-menu-reglages="rubrique"]').click();
        await pause(300);
        noter(`${largeur}/${theme} : la flèche remonte à la liste de la rubrique`, await page.locator('[data-menu-reglages]').isVisible());
        await page.screenshot({ path: nom('4-liste-rubrique') });
        await page.locator('[data-retour-menu-reglages="rubriques"]').click();
      } else {
        await page.locator('[data-retour-rubriques-reglages]').click();
      }
      await pause(300);
      noter(`${largeur}/${theme} : « ‹ Réglages » ramène aux six rubriques`, (await page.locator('[data-rubriques-reglages]').count()) === 1);

      // Rubrique Serveur, Avancé replié puis ouvert
      await page.locator('[data-rubrique-reglages="serveur"]').click();
      await pause(400);
      noter(`${largeur}/${theme} : « Avancé » est replié à l'ouverture`, (await page.locator('[data-avance-reglages="replie"]').count()) === 1);
      await page.locator('[data-basculer-avance]').click();
      await pause(200);
      const avancees = await page.locator('[data-avance-reglages="ouvert"] [data-page-menu]').count();
      noter(`${largeur}/${theme} : « Avancé » ouvert montre ses deux pages`, avancees === 2, String(avancees));
      if (!telephone) {
        await page.waitForSelector('[data-reglages-serveur]', { timeout: 20000 }).catch(() => undefined);
        await pause(1200);
      }
      await page.screenshot({ path: nom('5-serveur-avance') });
      await page.locator('[data-page-menu="gestes-serveur"]').click();
      await page.waitForSelector('[data-reglages-gestes-serveur]', { timeout: 20000 });
      noter(`${largeur}/${theme} : la page des gestes garde le terminal`, (await page.locator('[data-terminal-bouton]').count()) === 1);
      await pause(400);
      await page.screenshot({ path: nom('6-gestes-serveur') });

      // Anciennes clés
      if (theme === 'clair') {
        for (const [ancienne, repere] of [
          ['extension', '[data-page-ordinateurs]'],
          ['installation', '[data-page-reglages-adresse]'],
          ['langue', '[data-langue-menu]'],
          ['capacite', '[data-reglages-serveur]'],
        ]) {
          await page.goto('about:blank');
          await page.goto(`${ADRESSE}/#reglages/${ancienne}`, { waitUntil: 'domcontentloaded' });
          const ok = await page.waitForSelector(repere, { timeout: 30000 }).then(() => true).catch(() => false);
          noter(`${largeur} : l'ancienne adresse « ${ancienne} » mène à sa page`, ok);
          if (ancienne === 'extension') {
            await pause(800);
            await page.screenshot({ path: nom('7-ordinateurs') });
          }
          if (ancienne === 'langue') {
            await pause(600);
            await page.screenshot({ path: nom('8-apparence') });
          }
        }
      }

      const deborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      noter(`${largeur}/${theme} : rien ne déborde en largeur`, deborde <= 0, String(deborde));
      noter(`${largeur}/${theme} : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
      await ctx.close();
    }
  }
} finally {
  await navigateur.close();
  base.prepare('DELETE FROM sessions WHERE token = ?').run(jeton);
  base.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôle(s) réussi(s). Captures : ${CAPTURES}`);
process.exit(echecs ? 1 : 0);
