#!/usr/bin/env node
/**
 * L'ENTÊTE ET LE PIED D'UNE FENÊTRE NE DÉFILENT JAMAIS : SEUL LE CORPS BOUGE.
 *
 * Avant, la fenêtre de base (`DialogContent`) mettait tout dans une seule zone
 * qui défile : dans les réglages d'un projet, le titre partait en haut et
 * « Enregistrer » se cachait tout en bas. Elle pose maintenant trois parties —
 * `DialogHeader`, un corps en `ZoneDefilement`, `DialogFooter` — et les tiroirs
 * aux boutons finaux posent le même pied APRÈS leur zone qui défile.
 *
 * Première moitié : la SOURCE (chaque écran migré garde son entête et son pied
 * hors de la zone qui défile). Seconde moitié : le NAVIGATEUR, sur ordinateur
 * et sur téléphone — la configuration du projet s'ouvre dans une fenêtre basse,
 * on s'y place sur la rubrique qui DÉBORDE (les rubriques sont courtes depuis
 * le découpage, et la première ne défile plus), le corps est défilé jusqu'en
 * bas, et le titre comme les boutons n'ont pas bougé d'un pixel.
 *
 * Il fabrique une session d'UNE HEURE (empreinte SHA-256 en base), la retire en
 * partant, et vise le serveur de DÉVELOPPEMENT par sa propre variable —
 * jamais `BELUGA_URL` ni `BELUGA_TOKEN`.
 *
 *   HAIKO_ENTETE_URL=http://localhost:7099 node scripts/verif-entete-pied-fixes.mjs
 *   HAIKO_ENTETE_SOURCE=1 node scripts/verif-entete-pied-fixes.mjs   # la source seule
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADRESSE = process.env.HAIKO_ENTETE_URL || 'http://localhost:7099';
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';

const echecs = [];
const constats = [];
const juger = (ok, message, detail = '') => (ok ? constats : echecs).push(detail ? `${message} — ${detail}` : message);
const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

/* ------------------------------------------------------------------ */
/* Première moitié : la SOURCE                                         */
/* ------------------------------------------------------------------ */

const ui = lire('web/src/components/ui/index.tsx');
const dialogue = ui.slice(ui.indexOf('export function DialogContent('), ui.indexOf('export function DialogContentLibre('));
juger(/export function DialogHeader\(/.test(ui) && /export function DialogFooter\(/.test(ui), 'les pièces DialogHeader et DialogFooter existent');
juger(
  /repartirEmplacements\(children\)/.test(dialogue) && dialogue.indexOf('{entete}') < dialogue.indexOf('<ZoneDefilement') &&
    dialogue.indexOf('{pied}') > dialogue.indexOf('</ZoneDefilement>'),
  'DialogContent pose l’entête AVANT la zone qui défile et le pied APRÈS',
);

/** Chaque écran migré : son pied (s'il en a un) vient après la DERNIÈRE zone qui défile qui le précède. */
const MIGRES = {
  'web/src/components/project-settings.tsx': { entete: true, pied: true },
  'web/src/components/sidebar.tsx': { entete: true, pied: true },
  'web/src/components/deploy-panel.tsx': { entete: true, pied: true },
  'web/src/components/anneau-contexte.tsx': { entete: true },
  'web/src/components/right-panel.tsx': { entete: true },
  'web/src/components/attachment-preview.tsx': { entete: true },
  'web/src/components/flux-en-points.tsx': { entete: true },
  'web/src/components/coffre-fort.tsx': { pied: true },
  'web/src/components/backups.tsx': { pied: true },
  'web/src/components/parcours-carte.tsx': { pied: true },
  'web/src/espace/nouvelle-demande.tsx': { pied: true },
};
for (const [fichier, attendu] of Object.entries(MIGRES)) {
  const source = lire(fichier);
  if (attendu.entete) juger(/<DialogHeader\b/.test(source), `${fichier} : entête fixe (DialogHeader)`);
  if (attendu.pied) {
    const pieds = [...source.matchAll(/<DialogFooter\b/g)].map((m) => m.index);
    juger(pieds.length > 0, `${fichier} : pied fixe (DialogFooter)`);
    /* Dans un TIROIR, le pied suit la fermeture de la zone qui défile : une
       ouverture de zone entre la dernière fermeture et le pied le mettrait dedans. */
    if (/<Drawer\b/.test(source)) {
      for (const position of pieds) {
        const avant = source.slice(0, position);
        const ouverture = avant.lastIndexOf('<ZoneDefilement');
        const fermeture = avant.lastIndexOf('</ZoneDefilement>');
        juger(ouverture < fermeture, `${fichier} : le pied de la ligne ${avant.split('\n').length} est hors de la zone qui défile`);
      }
    }
  }
}
juger(/data-fenetre-pied>\s*\{controls\}/.test(lire('web/src/components/tiroir-deploiement.tsx')), 'le tiroir de publication garde ses gestes en pied fixe');

/* ------------------------------------------------------------------ */
/* Seconde moitié : le NAVIGATEUR                                       */
/* ------------------------------------------------------------------ */

async function avecSession(travail) {
  const { default: crypto } = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ouvrir = () => require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie(DONNEES));
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrir();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification entête et pied fixes',
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

async function attendrePret(page) {
  for (let essai = 0; essai < 60; essai += 1) {
    if (await page.evaluate(() => window.belugaEssai?.pret?.() === true || !!document.querySelector('[data-reglages-projet]'))) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function refermerCeQuiTraine(page) {
  for (let essai = 0; essai < 6; essai += 1) {
    if (!(await page.locator('[role="dialog"]').count())) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
}

/** Les positions de l'entête, du pied et l'état du corps, dans la DERNIÈRE fenêtre ouverte. */
const mesurer = (page) =>
  page.evaluate(() => {
    const fenetres = [...document.querySelectorAll('[role="dialog"]')];
    const fenetre = fenetres[fenetres.length - 1];
    if (!fenetre) return null;
    const boite = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
    const corps = fenetre.querySelector('[data-fenetre-corps]');
    return {
      entete: boite(fenetre.querySelector('[data-fenetre-entete]')),
      pied: boite(fenetre.querySelector('[data-fenetre-pied]')),
      titre: boite(fenetre.querySelector('h2')),
      defile: corps ? corps.scrollHeight - corps.clientHeight : 0,
      scrollTop: corps?.scrollTop ?? 0,
      hauteurEcran: window.innerHeight,
    };
  });

/** Ouvre une rubrique — sur téléphone, il faut d'abord revenir à la liste. */
async function ouvrirRubrique(page, cle) {
  const item = page.locator(`[role="dialog"] [data-rubrique-config="${cle}"]`);
  if (!(await item.isVisible().catch(() => false))) {
    const retour = page.locator('[role="dialog"] [data-retour-menu-config]').first();
    if (await retour.count()) await retour.evaluate((el) => el.click());
    await page.waitForTimeout(400);
  }
  await item.evaluate((el) => el.click());
  await page.waitForTimeout(500);
}

/** Ouvre chaque rubrique et s'arrête sur celle dont le corps déborde le plus. */
async function plusLongueRubrique(page) {
  const cles = await page.locator('[role="dialog"] [data-rubrique-config]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-rubrique-config')),
  );
  let meilleure = null;
  let record = 0;
  for (const cle of cles) {
    await ouvrirRubrique(page, cle);
    const mesure = await mesurer(page);
    if ((mesure?.defile ?? 0) > record) {
      record = mesure.defile;
      meilleure = cle;
    }
  }
  if (!meilleure) return null;
  await ouvrirRubrique(page, meilleure);
  return `${meilleure} — ${Math.round(record)} px à dérouler`;
}

async function essayer(navigateur, session, nom, viewport, options = {}) {
  const contexte = await navigateur.newContext({ viewport, locale: 'fr-CH', serviceWorkers: 'block', ...options });
  const origine = new URL(ADRESSE).origin;
  await contexte.addCookies([{ name: 'beluga_session', value: session, url: origine, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  try {
    await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!(await attendrePret(page))) return juger(false, `${nom} : l’application ne s’est pas chargée`);
    await refermerCeQuiTraine(page);
    const bouton = page.locator('[data-reglages-projet]').first();
    if (!(await bouton.count())) return juger(false, `${nom} : aucun bouton de réglages de projet dans la colonne`);
    /* Le « ⋮ » d'une ligne de projet ouvre un MENU (archiver un projet, 20/11/2026) : « Réglages du projet » en est
       la première entrée. Celui de l'espace de développement ouvre toujours les réglages directement. */
    const avecMenu = await bouton.evaluate((el) => {
      if (!el.hasAttribute('data-menu-projet')) {
        el.click();
        return false;
      }
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      return true;
    });
    if (avecMenu) {
      await page.waitForSelector('[data-menu-reglages-projet]', { timeout: 10_000 });
      await page.locator('[data-menu-reglages-projet]').first().evaluate((el) => el.click());
    }
    await page.waitForSelector('[role="dialog"] [data-pied-reglages-projet]', { timeout: 15_000 });
    await page.waitForTimeout(700);

    /* LA CONFIGURATION EST UNE FENÊTRE À RUBRIQUES : chacune est courte, et la
       première ne déborde plus. On cherche donc la rubrique qui DÉBORDE
       vraiment — c'est la seule sur laquelle « le corps défile, l'entête et le
       pied ne bougent pas » veut dire quelque chose. */
    const rubrique = await plusLongueRubrique(page);
    juger(!!rubrique, `${nom} : une rubrique déborde, de quoi éprouver l’entête et le pied`, rubrique ?? '');
    if (!rubrique) return;

    const avant = await mesurer(page);
    juger(!!avant?.entete && !!avant?.pied, `${nom} : les réglages ont un entête et un pied`);
    if (!avant?.entete || !avant?.pied) return;
    juger(avant.defile > 20, `${nom} : le corps a vraiment de quoi défiler`, `${Math.round(avant.defile)} px`);
    juger(avant.pied.bottom <= avant.hauteurEcran + 1, `${nom} : le pied est dans l’écran`, `bas à ${Math.round(avant.pied.bottom)} / ${avant.hauteurEcran}`);

    await page.evaluate(() => {
      const fenetres = [...document.querySelectorAll('[role="dialog"]')];
      const corps = fenetres[fenetres.length - 1].querySelector('[data-fenetre-corps]');
      corps.scrollTop = corps.scrollHeight;
      corps.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(400);
    const apres = await mesurer(page);
    juger(apres.scrollTop > 0, `${nom} : le corps a défilé`, `${Math.round(apres.scrollTop)} px`);
    const bouge = (a, b) => Math.abs(a.top - b.top) > 0.5 || Math.abs(a.bottom - b.bottom) > 0.5;
    juger(!bouge(avant.titre, apres.titre), `${nom} : le titre n’a pas bougé`, `${Math.round(avant.titre.top)} → ${Math.round(apres.titre.top)}`);
    juger(!bouge(avant.pied, apres.pied), `${nom} : le pied n’a pas bougé`, `${Math.round(avant.pied.top)} → ${Math.round(apres.pied.top)}`);
    const enregistrer = page.locator('[role="dialog"] [data-pied-reglages-projet] button', { hasText: 'Enregistrer' });
    juger(await enregistrer.isVisible(), `${nom} : « Enregistrer » reste visible après le défilement`);
    await page.screenshot({ path: path.join(DONNEES, 'verification', `entete-pied-${nom}.png`) }).catch(() => undefined);
  } finally {
    await contexte.close();
  }
}

if (!process.env.HAIKO_ENTETE_SOURCE) {
  try {
    fs.mkdirSync(path.join(DONNEES, 'verification'), { recursive: true });
    const { chromium } = await import('playwright');
    await avecSession(async (session) => {
      const navigateur = await chromium.launch({ channel: 'chrome' });
      try {
        await essayer(navigateur, session, 'ordinateur', { width: 1280, height: 560 });
        await essayer(navigateur, session, 'telephone', { width: 390, height: 640 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      } finally {
        await navigateur.close();
      }
    });
  } catch (erreur) {
    juger(false, 'le navigateur n’a pas pu jouer le contrôle', String(erreur?.message ?? erreur).split('\n')[0]);
  }
}

for (const constat of constats) console.log(`  ✓ ${constat}`);
for (const echec of echecs) console.log(`  ✗ ${echec}`);
console.log(`\n${constats.length}/${constats.length + echecs.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
