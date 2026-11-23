#!/usr/bin/env node
/**
 * Les BRANCHES D'ARBORESCENCE d'un projet réuni, dans la colonne de gauche :
 *  - un clic sur le NOM du projet réuni ouvre son tableau sans le déplier ni
 *    le replier (`data-ouvert` inchangé) ; seule la flèche de droite bascule ;
 *  - déplié, chaque membre garde son RETRAIT, et l'ARBRE EN TIRETS est revenu
 *    (demande du 23/11/2026, tracé A, `BranchesDArbre`) : un tiret horizontal
 *    s'arrête 2 px avant l'icône de CHAQUE membre, à mi-hauteur de sa ligne ;
 *  - les lignes gardent leur hauteur (MEM-2899).
 * L'état ouvert/replié de chaque projet réuni est rendu tel qu'il était trouvé.
 *
 * Session d'une heure fabriquée puis retirée (jeton HACHÉ), jamais BELUGA_URL :
 *   HAIKO_BRANCHES_URL=http://localhost:7099 node scripts/verif-branches-regroupement.mjs
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { cheminDeLaBaseServie } from './base-servie.mjs';

const BASE = process.env.HAIKO_BRANCHES_URL || 'http://localhost:7099';
const CAPTURES = process.env.HAIKO_BRANCHES_CAPTURES || '/tmp';
const PRINCIPAL = path.resolve(process.env.BELUGA_DATA || '/root/beluga/data', '..');

function base() {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(cheminDeLaBaseServie());
}

const cookie = crypto.randomBytes(24).toString('hex');
const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
{
  const d = base();
  const n = Date.now();
  d.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?,?,?,?)')
    .run(empreinte, n, n + 3600_000, 'vérif branches des projets réunis');
  d.close();
}
const retirerLaSession = () => {
  const d = base();
  d.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  d.close();
};

let echecs = 0;
const noter = (ok, texte) => { if (!ok) echecs += 1; console.log(`  ${ok ? ' OK  ' : 'ÉCHEC'} ${texte}`); };
const pres = (a, b, tol = 1.01) => Math.abs(a - b) <= tol;

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const aRestaurer = [];
let page;
try {
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
  await contexte.addCookies([{ name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);
  page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-regroupement-colonne]', { timeout: 30_000 });
  // Un volet (carte ouverte) peut se rouvrir au chargement : on le referme.
  const fermerLesVolets = async () => {
    for (let i = 0; i < 3 && (await page.locator('[role=dialog]').count()); i += 1) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
  };
  await fermerLesVolets();
  // MEM-2916 : la colonne est repliée au repos, le survol la déplie.
  await page.mouse.move(12, 400);
  await page.waitForTimeout(700);

  const ids = await page.$$eval('[data-regroupement-colonne]', (els) => els.map((e) => e.getAttribute('data-regroupement-colonne')));
  noter(ids.length > 0, `au moins un projet réuni (${ids.length})`);
  const ouvertDe = (id) => page.getAttribute(`[data-regroupement-colonne="${id}"]`, 'data-ouvert').then((v) => v === 'true');

  for (const id of ids) {
    const initial = await ouvertDe(id);
    const nom = page.locator(`[data-drag-id="${id}"] :is(a, button):has([data-pile-favicons])`);
    await fermerLesVolets();
    await page.mouse.move(12, 400);
    await nom.click();
    await page.waitForTimeout(300);
    await fermerLesVolets();
    await page.mouse.move(12, 400);
    noter((await ouvertDe(id)) === initial, `${id} : le clic sur le nom ne bascule pas (ouvert=${initial})`);

    if (!initial) {
      await page.click(`[data-deplier-regroupement="${id}"]`);
      await page.waitForTimeout(300);
      noter(await ouvertDe(id), `${id} : la flèche déplie`);
      aRestaurer.push(id);
    }
    // Sur le haut de la colonne, loin de la ligne : au repos, la poignée
    // cachée ne décale pas la pile, et la colonne reste dépliée.
    await page.mouse.move(12, 60);
    await page.waitForTimeout(300);

    console.log(`  (colonne : ${await page.getAttribute('[data-colonne-projets]', 'data-colonne-projets')})`);
    /* L'ARBRE EN TIRETS (23/11/2026) : chaque membre reçoit sa branche, calée sur son icône. */
    const mesure = await page.$eval(`[data-regroupement-colonne="${id}"]`, (racine) => {
      const pile = racine.querySelector('[data-pile-favicons]').getBoundingClientRect();
      const conteneur = racine.querySelector('[data-membres-regroupement]');
      const boite = conteneur.getBoundingClientRect();
      const membres = [...racine.querySelectorAll('[data-membres-regroupement] [data-membre-de]')];
      const d = conteneur.querySelector(':scope > [data-branches-d-arbre] path')?.getAttribute('d') ?? '';
      /* Les fins de tiret horizontal : « y H fin » de chaque segment du tracé. */
      const fins = [...d.matchAll(/([\d.]+)H([\d.]+)/g)].map((m) => ({ y: Number(m[1]), fin: Number(m[2]) }));
      const calees = membres.map((ligne) => {
        const icone = ligne.querySelector('[data-icone-de-branche]').getBoundingClientRect();
        const y = icone.top + icone.height / 2 - boite.top;
        const x = icone.left - boite.left;
        return fins.some((f) => Math.abs(f.y - y) <= 1.5 && Math.abs(f.fin - (x - 2)) <= 1.5);
      });
      return {
        branches: calees.filter(Boolean).length,
        retraits: membres.map((ligne) => ligne.querySelector('button > span').getBoundingClientRect().left - pile.left),
        hauteurs: membres.map((ligne) => ligne.getBoundingClientRect().height),
      };
    });
    noter(mesure.retraits.length > 0, `${id} : ${mesure.retraits.length} membre(s) déplié(s)`);
    noter(mesure.branches === mesure.retraits.length, `${id} : une branche en tirets calée sur chaque membre (${mesure.branches}/${mesure.retraits.length})`);
    noter(mesure.retraits.every((r) => r >= 8), `${id} : chaque membre garde son retrait (${mesure.retraits.map((r) => r.toFixed(0)).join(', ')} px)`);
    noter(mesure.hauteurs.every((h) => Math.round(h) === 34), `${id} : hauteur de ligne inchangée`);
  }

  const colonne = page.locator('aside[data-zone="gauche"]');
  // Colonne réduite à sa bande : aucune branche (MEM-2939).
  await page.mouse.move(900, 450);
  await page.waitForTimeout(900);
  if ((await page.getAttribute('[data-colonne-projets]', 'data-colonne-projets')) === 'reduite') {
    noter((await page.locator('[data-branches-d-arbre]').count()) === 0, 'bande seule : aucune branche');
    await colonne.screenshot({ path: `${CAPTURES}/branches-regroupement-bande.png` });
  }
  await page.mouse.move(12, 400);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${CAPTURES}/branches-regroupement.png`, clip: { x: 0, y: 0, width: 300, height: 900 } });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${CAPTURES}/branches-regroupement-sombre.png`, clip: { x: 0, y: 0, width: 300, height: 900 } });
  await page.emulateMedia({ colorScheme: 'light' });
  noter(erreurs.length === 0, `aucune erreur JavaScript de page ${erreurs.join(' | ')}`);
} finally {
  // Rendre l'état ouvert/replié trouvé en arrivant.
  for (const id of aRestaurer) {
    try {
      await page.mouse.move(12, 400);
      await page.click(`[data-deplier-regroupement="${id}"]`);
      await page.waitForTimeout(200);
    } catch {}
  }
  await navigateur.close();
  retirerLaSession();
}
console.log(echecs ? `\n${echecs} échec(s)` : '\nTout est bon.');
process.exit(echecs ? 1 : 0);
