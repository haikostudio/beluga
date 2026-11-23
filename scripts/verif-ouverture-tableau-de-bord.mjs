#!/usr/bin/env node
/**
 * L'OUVERTURE DE L'APPLICATION, DANS UN VRAI NAVIGATEUR.
 *
 *  1. un démarrage sans adresse précise arrive sur « Tableaux de bord », sans
 *     qu'aucune adresse ou aucun écran de projet n'apparaisse avant ;
 *  2. il ne laisse rien derrière : pas d'entrée d'historique en plus ;
 *  3. une adresse précise garde son écran, un rechargement aussi ;
 *  4. Précédent depuis un service revient au tableau de bord, pas à un projet.
 *
 * Session d'une heure fabriquée puis retirée ; rien d'autre n'est écrit en base.
 * L'accès tiers, qui revient à `projet`, n'est pas rejoué ici.
 *
 *   npm run dev --workspace web -- --port 7116
 *   env -u BELUGA_TOKEN HAIKO_OUVERTURE_URL=http://localhost:7116 node scripts/verif-ouverture-tableau-de-bord.mjs
 */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const ADRESSE = process.env.HAIKO_OUVERTURE_URL || 'http://localhost:7116';
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';
const require = createRequire(import.meta.url);
const ouvrirBase = () => require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie(DONNEES));

const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) echecs.push(message);
};

const cookie = crypto.randomBytes(24).toString('hex');
const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
const db = ouvrirBase();
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(empreinte, Date.now(), Date.now() + 3_600_000, 'vérification de l’ouverture');
db.close();

const navigateur = await chromium.launch({ channel: 'chrome' });
const marque = () => document.querySelector('[data-ouvrir-en-route]')?.getAttribute('aria-current') === 'page';
try {
  for (const [nom, viewport] of [['ordinateur', { width: 1400, height: 900 }], ['téléphone', { width: 390, height: 780 }]]) {
    const contexte = await navigateur.newContext({ viewport, ...(nom === 'téléphone' ? { isMobile: true, hasTouch: true } : {}) });
    await contexte.addCookies([{ name: 'beluga_session', value: cookie, domain: 'localhost', path: '/' }]);
    /* Tout ce que l'adresse a valu depuis le premier script de la page, et toute écriture dans l'historique. */
    await contexte.addInitScript(() => {
      window.__adresses = [];
      const noter = () => window.__adresses.push(location.hash);
      for (const m of ['pushState', 'replaceState']) {
        const o = history[m].bind(history);
        history[m] = (...a) => { const r = o(...a); window.__adresses.push(`${m}:${location.hash}`); return r; };
      }
      noter();
    });
    const page = await contexte.newPage();
    await page.goto(ADRESSE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => location.hash === '#en-route', null, { timeout: 15_000 });
    await page.waitForTimeout(2500);
    const etat = await page.evaluate(() => ({ h: location.hash, t: history.length, a: window.__adresses }));
    verifier(etat.h === '#en-route', `${nom} : à froid, l’adresse est « Tableaux de bord » (${etat.h})`);
    verifier(!etat.a.some((x) => x.includes('projet')), `${nom} : aucune adresse de projet avant (${etat.a.join(' ')})`);
    verifier(!etat.a.some((x) => x.startsWith('pushState')), `${nom} : aucune entrée d’historique ajoutée`);
    if (nom === 'ordinateur') verifier(await page.evaluate(marque), `${nom} : la colonne marque « Tableaux de bord »`);

    await page.goto(`${ADRESSE}/#coffre`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    verifier((await page.evaluate(() => location.hash)).startsWith('#coffre'), `${nom} : une adresse précise garde son écran`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    verifier((await page.evaluate(() => location.hash)).startsWith('#coffre'), `${nom} : un rechargement garde son écran`);

    await page.goto(ADRESSE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => location.hash === '#en-route', null, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { location.hash = '#coffre'; });
    await page.waitForTimeout(1200);
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForTimeout(1200);
    const retour = await page.evaluate(() => location.hash);
    verifier(retour === '#en-route', `${nom} : Précédent revient au tableau de bord (${retour})`);
    await contexte.close();
  }
} finally {
  await navigateur.close();
  const fin = ouvrirBase();
  fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  fin.close();
}
if (echecs.length) {
  console.error(`\n${echecs.length} échec(s)`);
  process.exit(1);
}
console.log('\nOuverture : tout est bon.');
