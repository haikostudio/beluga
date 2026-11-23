#!/usr/bin/env node
/**
 * LE MENU DES PROJETS : UN TIROIR DU BAS SUR TÉLÉPHONE, RIEN DE CHANGÉ AU-DELÀ.
 *
 * Demande du 30/10/2026 : le panneau latéral passait sous la barre d'état ; sur
 * téléphone (moins de 640 px), il monte du bas, avec sa poignée et son voile.
 *
 *  1. à 390 × 844, zones sûres de 59 et 34 px posées, en clair et en sombre : le
 *     bouton du menu ouvre `[data-feuille-du-bas]`, le panneau latéral n'existe
 *     pas, le tiroir commence sous l'heure et finit au bas de l'écran ;
 *  2. son fond suit la colonne (`data-zone="gauche"`), sa liste défile dans une
 *     seule zone, le tiroir lui-même ne défile pas et rien ne déborde ;
 *  3. il se referme au voile, à la poignée tirée vers le bas, et sur chaque
 *     geste qui mène ailleurs : choix d'un projet, recherche, réglages ;
 *  4. à 800 px de large, aucun menu n'est à ouvrir : la colonne reste posée et
 *     aucune feuille n'apparaît.
 *
 * Démon d'essai à base neuve : aucun quota, la production n'est pas touchée.
 * Usage : npm run build && node scripts/verif-panneau-projets.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { poserZonesSures } from './lib/zone-sure.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7196);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-panneau-projets-'));
const DOSSIER = path.join(TMP, 'projet');
const { DATA, journal, attendrePort } = demarrerDemonDEssai({ tmp: TMP, port: PORT, depot: false, dossiers: [DOSSIER] });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const JETON = crypto.randomBytes(32).toString('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(JETON).digest('hex'), maintenant, maintenant + 3600_000, 'vérification du menu des projets',
  );
  db.prepare('DELETE FROM projects').run();
  for (let i = 1; i <= 30; i += 1) {
    const projet = { id: `p-${i}`, name: `Projet ${i}`, path: DOSSIER, defaultEngine: 'claude', isSelf: false, rank: i, archived: false, createdAt: maintenant, updatedAt: maintenant };
    db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
      projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant,
    );
  }
  db.close();
}

const feuilleDuMenu = (page) => page.locator('[data-feuille-du-bas]:has([data-menu-du-telephone])');
const ouvrir = async (page) => {
  await page.locator('button[aria-label="Projets"]').first().click();
  await feuilleDuMenu(page).waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(450);
};
const fermee = async (page) => {
  await feuilleDuMenu(page).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  return (await feuilleDuMenu(page).count()) === 0;
};

async function essaiTelephone(navigateur, theme) {
  const context = await navigateur.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'fr-CH', serviceWorkers: 'block', colorScheme: theme,
  });
  await context.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.stack || e)));
  page.on('console', (m) => m.type() === 'error' && /Dialog|aria|title/i.test(m.text()) && erreurs.push(m.text()));
  await poserZonesSures(page, { haut: 59, bas: 34 });
  const nom = theme === 'dark' ? 'sombre' : 'clair';
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('button[aria-label="Projets"]').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(800);
    await poserZonesSures(page, { haut: 59, bas: 34 });
    await page.evaluate((sombre) => {
      document.documentElement.dataset.theme = sombre ? 'sombre' : 'clair';
      document.documentElement.classList.toggle('dark', sombre);
    }, theme === 'dark');
    await ouvrir(page);

    const lu = await page.evaluate(() => {
      const f = document.querySelector('[data-feuille-du-bas]');
      const r = f.getBoundingClientRect();
      const colonne = f.querySelector('aside');
      const defilantes = Array.from(f.querySelectorAll('*')).filter((n) => {
        const s = getComputedStyle(n);
        return /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2 && n.clientHeight > 0;
      });
      return {
        haut: Math.round(r.top), bas: Math.round(r.bottom), ecran: window.innerHeight,
        panneauLateral: !!document.querySelector('[role="dialog"][aria-label="Projets"]'),
        poignee: !!f.querySelector('[data-poignee-tiroir]'),
        voile: !!document.querySelector('[data-voile-tiroir]'),
        fondFeuille: getComputedStyle(f).backgroundColor,
        fondColonne: colonne ? getComputedStyle(colonne).backgroundColor : null,
        hauteurColonne: colonne ? Math.round(colonne.getBoundingClientRect().height) : 0,
        hauteurFeuille: Math.round(r.height),
        defilantes: defilantes.length,
        feuilleDefile: f.scrollHeight > f.clientHeight + 1,
        debordeLargeur: f.scrollWidth > f.clientWidth + 1,
        projets: f.querySelectorAll('[data-drag-kind="project"]').length,
      };
    });
    noter(`${nom} : c'est une feuille du bas, plus le panneau latéral`, lu.poignee && lu.voile && !lu.panneauLateral, JSON.stringify(lu));
    noter(`${nom} : elle s'arrête sous l'heure et touche le bas`, lu.haut >= 59 && lu.bas === lu.ecran, `${lu.haut} → ${lu.bas} / ${lu.ecran}`);
    noter(`${nom} : son fond est celui de la colonne`, lu.fondFeuille === lu.fondColonne, `${lu.fondFeuille} / ${lu.fondColonne}`);
    noter(`${nom} : la liste des projets est là`, lu.projets === 30, `${lu.projets} projets`);
    noter(`${nom} : une seule zone qui défile, le tiroir ne défile pas`, lu.defilantes === 1 && !lu.feuilleDefile && !lu.debordeLargeur, `${lu.defilantes} zone(s)`);
    await page.screenshot({ path: `/tmp/menu-telephone-${nom}.png` });

    await page.touchscreen.tap(195, 20);
    noter(`${nom} : toucher le voile referme`, await fermee(page));

    await ouvrir(page);
    const poignee = await feuilleDuMenu(page).locator('[data-poignee-tiroir]').first().boundingBox();
    await page.mouse.move(195, poignee.y + 8);
    await page.mouse.down();
    await page.mouse.move(195, poignee.y + 200, { steps: 8 });
    await page.mouse.up();
    noter(`${nom} : tirer la poignée vers le bas referme`, await fermee(page));

    await ouvrir(page);
    await feuilleDuMenu(page).locator('[data-drag-kind="project"] button').first().click();
    noter(`${nom} : choisir un projet referme`, await fermee(page));

    await ouvrir(page);
    await feuilleDuMenu(page).getByRole('button', { name: /Rechercher|Chercher/ }).first().click();
    noter(`${nom} : la recherche referme le menu`, await fermee(page));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (await page.locator('[role="dialog"]').count()) {
      await page.locator('[role="dialog"] button[aria-label*="ermer"]').first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('button[aria-label="Projets"]').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(800);
    await ouvrir(page);
    await feuilleDuMenu(page).getByRole('button', { name: /Réglages/ }).first().click();
    noter(`${nom} : les réglages referment le menu`, await fermee(page));
    noter(`${nom} : aucune erreur du navigateur`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await context.close();
  }
}

async function essaiGrandEcran(navigateur) {
  const context = await navigateur.newContext({ viewport: { width: 800, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await context.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('aside[data-colonne-projets]').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(800);
    noter('grand écran : la colonne reste posée à gauche', (await page.locator('aside[data-colonne-projets]').first().boundingBox())?.x === 0);
    noter('grand écran : aucune feuille du menu', (await page.locator('[data-menu-du-telephone]').count()) === 0);
  } finally {
    await context.close();
  }
}

async function main() {
  if (!(await attendrePort())) {
    console.error(`Le démon d'essai n'a pas démarré :\n${journal.join('')}`);
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    await essaiTelephone(navigateur, 'light');
    await essaiTelephone(navigateur, 'dark');
    await essaiGrandEcran(navigateur);
  } finally {
    await navigateur.close().catch(() => {});
  }
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
