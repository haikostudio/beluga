#!/usr/bin/env node
/**
 * Le volet des quotas : chaque compte range ses explications derrière un « i »,
 * et un compte Cursor montre les chiffres de son tableau de bord.
 *
 * L'usage Cursor est lu EN DIRECT par le code de la branche (`server/dist`),
 * avec la clé du compte, puis glissé dans les messages du démon servi : un
 * démon en service tourne encore l'ancien code, et il ne se redémarre pas pour
 * un contrôle. Second passage : une clé refusée, lue elle aussi en direct.
 *
 *   npm run build:server
 *   HAIKO_VOLET_QUOTAS_URL=http://localhost:7099 node scripts/verif-volet-quotas-bulle.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

/* Le serveur de DÉVELOPPEMENT, jamais BELUGA_URL (l'application publiée). */
const BASE = process.env.HAIKO_VOLET_QUOTAS_URL || 'http://localhost:7099';
const CAPTURES = process.env.HAIKO_VOLET_QUOTAS_CAPTURES || '/tmp';
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_DE_DONNEES = process.env.BELUGA_DB || cheminDeLaBaseServie();
const CLE_CURSOR = process.env.HAIKO_CLE_CURSOR_FICHIER || '/root/beluga/data/accounts/cursor-cursor/api-key';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function jeton() {
  const db = new Database(BASE_DE_DONNEES);
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte, maintenant, maintenant + 3600_000, 'vérification bulle du volet des quotas',
  );
  db.close();
  return { token, empreinte };
}

function retirer(empreinte) {
  const db = new Database(BASE_DE_DONNEES);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

/** Remplace le crédit de chaque compte Cursor, où qu'il voyage dans le message. */
function greffer(objet, credit) {
  if (Array.isArray(objet)) return objet.forEach((x) => greffer(x, credit));
  if (!objet || typeof objet !== 'object') return;
  if (objet.engine === 'cursor' && typeof objet.id === 'string' && 'available' in objet) objet.credit = credit;
  for (const valeur of Object.values(objet)) greffer(valeur, credit);
}

async function parcours(navigateur, { nom, mobile, credit, attendu }, token) {
  const context = await navigateur.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  await page.routeWebSocket(/\/ws/, (ws) => {
    const serveur = ws.connectToServer();
    serveur.onMessage((message) => {
      try {
        const lu = JSON.parse(String(message));
        greffer(lu, credit);
        ws.send(JSON.stringify(lu));
      } catch {
        ws.send(message);
      }
    });
    ws.onMessage((message) => serveur.send(message));
  });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-essai="badge-quota"][data-compte]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  await page.locator('[data-essai="badge-quota"]').click();
  const carteCursor = page.locator('[data-essai="quota-cursor"]').first();
  await carteCursor.waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);

  const texteCursor = await carteCursor.innerText();
  for (const morceau of attendu.present) {
    noter(`${nom} : la carte Cursor montre « ${morceau} »`, texteCursor.includes(morceau), texteCursor.replace(/\n/g, ' · '));
  }
  for (const morceau of attendu.absent) {
    noter(`${nom} : la carte Cursor ne montre pas « ${morceau} »`, !texteCursor.includes(morceau));
  }
  if (attendu.jauges !== undefined) {
    const jauges = await carteCursor.locator('[role="progressbar"], .h-1').count();
    noter(`${nom} : ${attendu.jauges} jauge(s) sur la carte Cursor`, jauges === attendu.jauges, `${jauges}`);
  }

  // Le bouton « i » : à gauche des badges, et les explications hors du corps.
  const menu = page.locator('[role="menu"]').first();
  const boutons = menu.locator('[data-bulle-info-bouton]');
  const nombre = await boutons.count();
  noter(`${nom} : des comptes portent leur bouton « i »`, nombre > 0, `${nombre}`);
  const ordre = await boutons.evaluateAll((els) =>
    els.every((el) => el.nextElementSibling?.tagName === 'SPAN' && el.previousElementSibling?.classList.contains('truncate')),
  );
  noter(`${nom} : le « i » est posé entre le nom du compte et les badges`, ordre);
  const corps = await menu.innerText();
  noter(
    `${nom} : la légende des courbes a quitté le corps des cartes`,
    !/trait épais : la semaine|trait : la dépense relevée|fenêtre amorcée par le serveur|Travail enregistré ici/.test(corps),
  );

  await page.screenshot({ path: `${CAPTURES}/volet-quotas-${nom}.png` });
  if (nombre > 0) {
    const bouton = boutons.first();
    if (mobile) await bouton.tap();
    else await bouton.hover();
    const bulle = page.locator('[data-bulle-info]').first();
    const ouverte = await bulle.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    const texte = ouverte ? (await bulle.innerText()).trim() : '';
    noter(`${nom} : ${mobile ? "l'appui" : 'le survol'} ouvre la bulle, et elle a quelque chose à dire`, ouverte && texte.length > 0, texte.replace(/\n/g, ' · ').slice(0, 140));
    await page.screenshot({ path: `${CAPTURES}/volet-quotas-${nom}-bulle.png` });
    if (ouverte) {
      await bulle.click();
      await page.waitForTimeout(300);
      noter(`${nom} : un appui dans la bulle ne ferme pas le volet`, await menu.isVisible());
    }
  }
  noter(`${nom} : aucune erreur de page`, erreurs.length === 0, erreurs.join(' | '));
  await context.close();
}

async function main() {
  const { creditCursor } = await import(pathToFileURL(path.join(RACINE, 'server/dist/engines/cursor.js')).href);
  const cle = fs.readFileSync(CLE_CURSOR, 'utf8').trim();
  const reel = await creditCursor(cle);
  const refuse = await creditCursor('crsr_cette_cle_nexiste_pas');
  console.log('  usage lu en direct :', JSON.stringify(reel));
  noter('la clé du compte rend un usage lisible', !reel.indisponible && typeof reel.cursorPct === 'number');
  noter('une clé refusée rend une raison, jamais un chiffre', Boolean(refuse.indisponible) && refuse.cursorPct === undefined, refuse.indisponible);

  const pct = (v) => `${Math.round(v)} %`;
  const dollars = (c) => `${(c / 100).toLocaleString('fr-CH', { minimumFractionDigits: Number.isInteger(c / 100) ? 0 : 2 })} $`;
  const remise = new Date(reel.finDuCycle).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long' });
  const attenduReel = {
    present: [
      reel.forfait,
      'Modèles Cursor', pct(reel.cursorPct),
      'Autres modèles', pct(reel.autresPct),
      `Remise à zéro le ${remise}`,
      'À la demande', `${dollars(reel.demandeCentimes)} / ${dollars(reel.demandeLimiteCentimes)}`,
    ].filter(Boolean),
    absent: ["clé d'administration", 'USD'],
  };
  const attenduRefus = { present: ['refusé la clé'], absent: ['0 %', 'Modèles Cursor'], jauges: 0 };

  const { token, empreinte } = jeton();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    await parcours(navigateur, { nom: 'ordinateur', mobile: false, credit: reel, attendu: attenduReel }, token);
    await parcours(navigateur, { nom: 'telephone', mobile: true, credit: reel, attendu: attenduReel }, token);
    await parcours(navigateur, { nom: 'cle-refusee', mobile: false, credit: refuse, attendu: attenduRefus }, token);
  } finally {
    await navigateur.close();
    retirer(empreinte);
  }
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(echecs ? `\n${echecs} échec(s)` : '\nTout est bon.');
  process.exit(echecs ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
