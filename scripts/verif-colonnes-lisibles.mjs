#!/usr/bin/env node
/**
 * LES COLONNES DES LISTES SE LISENT EN ENTIER (carte « Audits absents et Sécurité sur mobile », 16/11/2026, capture
 * #ae71 : sur téléphone, le nom du projet coupé en « Be… », « À traiter » tronqué, une pagination pour une ligne).
 *
 * Ouvre chaque service à liste sur « Tous les projets », à 1440 px puis 390 px, et relève dans chaque tableau commun
 * (`[data-tableau]`) toute cellule dont un texte est coupé (`scrollWidth > clientWidth` sur un élément qui cache son
 * débordement). Contrôle aussi qu'une liste d'une seule page n'affiche ni « Lignes 10 20 50 » ni flèches de page, et que
 * rien ne déborde la page en largeur (le tableau glisse DANS son cadre).
 *
 * Vise le serveur de DÉVELOPPEMENT (`HAIKO_COLONNES_URL`, défaut http://localhost:7099), jamais `BELUGA_URL`.
 * La session d'une heure est fabriquée dans la base servie (jeton haché) et retirée à la fin. Captures dans
 * `HAIKO_COLONNES_CAPTURES` (défaut /tmp/colonnes-lisibles).
 */
import { porteeSurTousLesProjets } from './lib/navigation.mjs';
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const BASE = process.env.HAIKO_COLONNES_URL ?? 'http://localhost:7099';
const BASE_DE_DONNEES = process.env.HAIKO_COLONNES_DB ?? '/root/beluga/data/beluga.db';
const CAPTURES = process.env.HAIKO_COLONNES_CAPTURES ?? '/tmp/colonnes-lisibles';
const VUES = (process.env.HAIKO_COLONNES_VUES ?? 'securite,surveillance,backups,taches-recurrentes,statistiques,plaquettes').split(',');
const THEMES = (process.env.HAIKO_COLONNES_THEMES ?? 'theme-courant').split(',');
fs.mkdirSync(CAPTURES, { recursive: true });

const db = new Database(BASE_DE_DONNEES);
const jeton = crypto.randomBytes(24).toString('hex');
const hache = crypto.createHash('sha256').update(jeton).digest('hex');
const T = Date.now();
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(hache, T, T + 3600_000, 'essai colonnes', 'admin-premier');

let echecs = 0;
let reussites = 0;
const ok = (vrai, texte) => {
  if (vrai) reussites++;
  else echecs++;
  console.log(`${vrai ? '✓' : '✗'} ${texte}`);
};

async function ouvrir(page, vue) {
  const service = page.locator('[data-cran-a-menu="service-de-la-page"]').first();
  for (let essai = 0; essai < 3; essai++) {
    await page.goto('about:blank');
    await page.goto(`${BASE}/#${vue}`, { waitUntil: 'load' });
    if (await service.waitFor({ state: 'visible', timeout: 12_000 }).then(() => true, () => false)) break;
  }
  if (!(await service.isVisible())) return false;
  await choisirTousLesProjets(page);
  return page.locator('[data-tableau]').first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
}

/**
 * « Tous les projets » dans le cran de portée. Rejoué APRÈS le passage en téléphone : la préférence n'est pas écrite
 * (prefs.set intercepté), et la page peut revenir au seul projet actif — le relevé mesurait alors un état vide.
 */
async function choisirTousLesProjets(page) {
  /* Sur ordinateur : le nom du service dans le fil (20/11/2026) ; sur téléphone : le filtre des projets de la rangée. */
  if (await page.locator('[data-nom-du-cran="service-de-la-page"]:visible').count()) {
    await porteeSurTousLesProjets(page);
    return;
  }
  const portee = page.locator('[data-filtre-du-service-central] button:visible').first();
  for (let essai = 0; essai < 3; essai++) {
    if (!(await portee.isVisible().catch(() => false))) return;
    if (/Tous les projets|All projects/.test((await portee.textContent()) ?? '')) return;
    await portee.click();
    const option = page.locator('[data-liste-option=""]:visible').first();
    if (!(await option.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false))) return;
    await option.click();
    await page.waitForTimeout(500);
  }
}

/** Les textes coupés des tableaux visibles, et l'état du pied. */
async function releve(page) {
  return page.evaluate(() => {
    const coupes = [];
    for (const tableau of document.querySelectorAll('[data-tableau]')) {
      if (!(tableau instanceof HTMLElement) || !tableau.offsetParent) continue;
      /* Seul le tableau AU PREMIER PLAN compte : une page posée par-dessus en laisse d'autres dessous. */
      const cadre = tableau.getBoundingClientRect();
      const dessus = document.elementFromPoint(Math.min(innerWidth - 2, Math.max(1, cadre.left + Math.min(cadre.width / 2, 120))), Math.min(innerHeight - 2, Math.max(1, cadre.top + Math.min(cadre.height / 2, 60))));
      if (!dessus || !tableau.contains(dessus)) continue;
      for (const cellule of tableau.querySelectorAll('td, th, [data-ligne-de-tableau], [data-carte-chiffres]')) {
        for (const el of [cellule, ...cellule.querySelectorAll('*')]) {
          if (!(el instanceof HTMLElement) || !el.offsetParent) continue;
          const style = getComputedStyle(el);
          const cache = style.overflowX === 'hidden' || style.overflowX === 'clip' || style.textOverflow === 'ellipsis';
          if (cache && el.scrollWidth > el.clientWidth + 1 && el.textContent?.trim()) {
            coupes.push(`${tableau.getAttribute('data-tableau')} : « ${el.textContent.trim().slice(0, 40)} »`);
          }
        }
      }
    }
    const pieds = [...document.querySelectorAll('[data-tableau-pied]')].filter((p) => p instanceof HTMLElement && p.offsetParent);
    const paginationInutile = pieds.some((p) => {
      const pages = p.querySelector('[data-page]')?.getAttribute('data-page');
      return pages === '1/1';
    });
    return { coupes: [...new Set(coupes)], paginationInutile, deborde: document.documentElement.scrollWidth - innerWidth };
  });
}

const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  for (const theme of THEMES) {
    for (const [nom, taille] of [['ordinateur', { width: 1440, height: 900 }], ['telephone', { width: 390, height: 844 }]]) {
      const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', colorScheme: theme === 'clair' ? 'light' : 'dark' });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
      const page = await contexte.newPage();
      /* RIEN NE S'ÉCRIT DANS LA BASE SERVIE : la bascule tableau/cartes et la portée sont des préférences du serveur. */
      await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
        const serveur = ws.connectToServer();
        ws.onMessage((m) => {
          try {
            const type = JSON.parse(String(m))?.cmd?.type;
            if (type === 'prefs.set' || type === 'card.read' || type === 'card.update') return;
          } catch {}
          serveur.send(m);
        });
        serveur.onMessage((m) => ws.send(m));
      });
      for (const vue of VUES) {
        for (const mode of ['tableau', 'cartes']) {
          await page.setViewportSize({ width: 1440, height: 900 });
          if (!(await ouvrir(page, vue))) {
            console.log(`– ${vue} (${nom}) : aucune liste affichée, passé`);
            break;
          }
          /* Le mode se choisit à 1440 px (la bascule y est en vue), puis la page passe à la taille voulue. */
          const onglets = page.locator('[data-bascule-tableau-cartes] [role="tab"]:visible');
          await onglets.nth(1).waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {});
          const avecBascule = (await onglets.count()) >= 2;
          if (!avecBascule && mode === 'cartes') break;
          if (avecBascule) {
            for (let essai = 0; essai < 3; essai++) {
              const onglet = page.locator(`[data-bascule-tableau-cartes] [data-onglet="${mode}"]:visible`).first();
              await onglet.click({ timeout: 8_000 }).catch(() => {});
              if ((await onglet.getAttribute('aria-selected').catch(() => null)) === 'true') break;
            }
            await page.waitForTimeout(700);
          }
          if (nom === 'telephone') {
            await page.setViewportSize(taille);
            await page.waitForTimeout(600);
            await choisirTousLesProjets(page);
            await page.locator('[data-tableau]').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
            await page.waitForTimeout(1200);
          }
          /* Une silhouette de chargement ne prouve rien : on attend de VRAIES lignes, sinon l'essai est dit passé. */
          const lignes = page.locator('[data-tableau] [data-ligne-de-tableau]:visible, [data-tableau] [data-tableau-cartes] > *:visible');
          if (!(await lignes.first().waitFor({ state: 'visible', timeout: 25_000 }).then(() => true, () => false))) {
            console.log(`– ${vue} en ${mode} (${nom}) : aucune ligne chargée, passé`);
            await page.screenshot({ path: path.join(CAPTURES, `${vue}-${mode}-${nom}-${theme}-vide.png`) });
            continue;
          }
          await page.waitForTimeout(600);
          await page.mouse.move(2, 2);
          /* Un relevé sur une liste vidée entre-temps ne prouverait rien : il faut des lignes AU MOMENT du relevé. */
          if (!(await lignes.count())) {
            console.log(`– ${vue} en ${mode} (${nom}) : liste vidée avant le relevé, passé`);
            await page.screenshot({ path: path.join(CAPTURES, `${vue}-${mode}-${nom}-${theme}-vide.png`) });
            continue;
          }
          const r = await releve(page);
          const nomEssai = `${vue}${avecBascule ? ` en ${mode}` : ''} (${nom}, ${theme})`;
          ok(r.coupes.length === 0, `${nomEssai} : aucun texte coupé${r.coupes.length ? ` — ${r.coupes.slice(0, 6).join(' ; ')}` : ''}`);
          ok(!r.paginationInutile, `${nomEssai} : pas de pagination pour une seule page`);
          ok(r.deborde <= 0, `${nomEssai} : la page ne déborde pas en largeur (${r.deborde} px)`);
          await page.screenshot({ path: path.join(CAPTURES, `${vue}-${mode}-${nom}-${theme}.png`) });
        }
      }
      await contexte.close();
    }
  }
} finally {
  await navigateur.close();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(hache);
  db.close();
}
console.log(`\n${reussites} contrôles verts, ${echecs} en échec. Captures : ${CAPTURES}`);
process.exit(echecs ? 1 : 0);
