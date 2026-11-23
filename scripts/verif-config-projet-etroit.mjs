#!/usr/bin/env node
/**
 * LA CONFIGURATION D'UN PROJET TIENT SUR UN TÉLÉPHONE.
 *
 * Sur petit écran, une colonne de menu à gauche ne tient pas : la fenêtre se
 * replie en DEUX TEMPS, comme les réglages généraux. On voit d'abord la liste
 * des rubriques ; on en choisit une, et son contenu occupe alors tout l'écran
 * avec un bouton de retour vers le menu.
 *
 * L'adresse suit de la même façon : un lien partagé ouvre bien la rubrique
 * attendue, quel que soit l'appareil — et sur téléphone, il ouvre DIRECTEMENT
 * son contenu, sans repasser par le menu.
 *
 * Session d'une heure fabriquée puis retirée, rien d'autre écrit en base, aucun
 * tour d'agent payé.
 *
 *   HAIKO_CONFIG_URL=http://localhost:7099 node scripts/verif-config-projet-etroit.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADRESSE = process.env.HAIKO_CONFIG_URL || 'http://localhost:7099';
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';

const echecs = [];
const constats = [];
const refuser = (message) => echecs.push(message);
const constater = (message) => constats.push(message);

async function avecSession(travail) {
  const { default: crypto } = await import('node:crypto');
  const { createRequire } = await import('node:module');
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
    'vérification étroite de la configuration d’un projet',
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
    if (await page.evaluate(() => window.belugaEssai?.pret?.() === true)) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function refermerCeQuiTraine(page) {
  for (let essai = 0; essai < 6; essai += 1) {
    const ouvert = await page.evaluate(
      () => document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length,
    );
    if (!ouvert && essai > 0) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }
}

async function auNavigateur() {
  const { chromium } = await import('playwright');
  return avecSession(async (session) => {
    const navigateur = await chromium.launch({ channel: 'chrome' });
    try {
      const contexte = await navigateur.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      });
      await contexte.addCookies([{ name: 'beluga_session', value: session, domain: 'localhost', path: '/' }]);
      const page = await contexte.newPage();
      try {
        await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      } catch (err) {
        return `serveur de développement injoignable sur ${ADRESSE} — ${err.message.split('\n')[0]}`;
      }
      if (!(await attendrePret(page))) return 'l’application étroite n’a jamais été prête';
      await refermerCeQuiTraine(page);

      const projets = await page.evaluate(() => window.belugaEssai.projets());
      if (!projets.length) return 'aucun projet en base : rien à configurer';
      const projet = projets[0];

      /* --- PREMIER TEMPS : la liste des rubriques occupe l'écran --------- */
      await page.evaluate(
        ([id]) => {
          window.location.hash = `projet/${id}/config`;
          window.dispatchEvent(new PopStateEvent('popstate'));
        },
        [projet.id],
      );
      await page.waitForSelector('[data-config-projet]', { timeout: 20_000 });
      await page.waitForTimeout(600);

      const menu = page.locator('[data-menu-config]');
      if (!(await menu.isVisible())) refuser('sur téléphone, la fenêtre ne s’ouvre pas sur le menu');
      else constater('sur téléphone, la fenêtre s’ouvre sur la liste des rubriques');

      /* --- SECOND TEMPS : la rubrique choisie recouvre le menu ----------- */
      await page.locator('[data-rubrique-config="deploiement"]').click();
      await page.waitForSelector('[data-rubrique-contenu="deploiement"]', { timeout: 10_000 });
      await page.waitForTimeout(400);
      if (await menu.isVisible()) refuser('sur téléphone, la rubrique ne recouvre pas le menu');
      else constater('sur téléphone, la rubrique choisie occupe tout l’écran');

      const retour = page.locator('[data-retour-menu-config]');
      if (!(await retour.isVisible())) {
        refuser('sur téléphone, le bouton de retour au menu est absent');
      } else {
        await retour.click();
        await page.waitForTimeout(400);
        if (!(await menu.isVisible())) refuser('le retour ne ramène pas au menu');
        else constater('le bouton de retour ramène à la liste des rubriques');
      }

      /* --- UN LIEN PARTAGÉ OUVRE DIRECTEMENT SA RUBRIQUE ---------------- */
      const neuf = await contexte.newPage();
      await neuf.goto(`${ADRESSE}/#projet/${projet.id}/config/production`, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
      if (!(await attendrePret(neuf))) {
        refuser('l’onglet neuf étroit n’a jamais été prêt');
      } else {
        try {
          await neuf.waitForSelector('[data-rubrique-contenu="production"]', { timeout: 20_000 });
          /* Et il ne repasse PAS par le menu : l'adresse désignait une
             rubrique précise, la montrer était tout l'intérêt du lien. */
          const menuNeuf = await neuf.locator('[data-menu-config]').isVisible();
          if (menuNeuf) refuser('un lien vers une rubrique retombe d’abord sur le menu');
          else constater('sur téléphone, un lien partagé ouvre directement sa rubrique');
        } catch {
          refuser('un lien partagé n’ouvre pas la rubrique attendue sur téléphone');
        }
      }
      await neuf.close();

      /* --- LE PIED RESTE ATTEIGNABLE : « Enregistrer » ne se cache pas --- */
      const pied = page.locator('[data-pied-reglages-projet]');
      if (!(await pied.isVisible())) refuser('le pied d’enregistrement n’est pas visible sur téléphone');
      else {
        const boite = await pied.boundingBox();
        const hauteur = page.viewportSize().height;
        if (!boite || boite.y + boite.height > hauteur + 1) {
          refuser('le pied d’enregistrement déborde sous l’écran du téléphone');
        } else {
          constater('« Enregistrer » reste dans l’écran du téléphone');
        }
      }

      return null;
    } finally {
      await navigateur.close();
    }
  });
}

try {
  const panne = await auNavigateur();
  if (panne) refuser(`la fenêtre étroite n'a PAS pu être mesurée : ${panne}`);
} catch (err) {
  refuser(`la mesure au navigateur est tombée — ${err.message.split('\n')[0]}`);
}

console.log('\nLA CONFIGURATION D’UN PROJET, SUR TÉLÉPHONE\n');
for (const ligne of constats) console.log(`  ✓ ${ligne}`);
if (echecs.length) {
  console.log('');
  for (const ligne of echecs) console.log(`  ✗ ${ligne}`);
  console.log(`\n${echecs.length} refus.`);
  process.exit(1);
}
console.log('\nTout tient.');
