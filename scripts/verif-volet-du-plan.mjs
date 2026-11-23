#!/usr/bin/env node
/**
 * LE FIL D'UNE CARTE, DANS UN VRAI NAVIGATEUR (carte « Outils visibles et
 * boutons des plans », 18/11/2026) :
 *   1. une longue compréhension se lit en ENTIER — plus de mention
 *      « … signes de plus, non conservés dans le journal » ;
 *   2. aucun outil n'est dit « Je me sers d'un outil du projet » ni
 *      « 1 outil utilisé » : chacun est nommé ;
 *   3. le volet du plan porte en haut à droite « Copier » et « Télécharger »
 *      (menu PDF / Markdown), sur ordinateur comme sur téléphone, sans débord.
 *
 * Vise le serveur de développement de la copie (jamais l'application publiée) :
 *   HAIKO_PLAN_URL=http://localhost:7099 HAIKO_PLAN_CARTE=<id> node scripts/verif-volet-du-plan.mjs
 * Les captures vont dans HAIKO_PLAN_CAPTURES (défaut : /tmp/verif-volet-du-plan).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const ADRESSE = process.env.HAIKO_PLAN_URL || 'http://localhost:7099';
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';
const SORTIE = process.env.HAIKO_PLAN_CAPTURES || '/tmp/verif-volet-du-plan';
const require = createRequire(import.meta.url);
const ouvrirLaBase = () => require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie(DONNEES));

const echecs = [];
const constater = (m) => console.log(`  OK   ${m}`);
const refuser = (m) => {
  echecs.push(m);
  console.log(`  ÉCHEC ${m}`);
};

/* La carte visée : celle donnée, sinon la dernière qui porte un plan. */
const base = ouvrirLaBase();
const carte = process.env.HAIKO_PLAN_CARTE
  ? base.prepare('SELECT id, project_id FROM cards WHERE id = ?').get(process.env.HAIKO_PLAN_CARTE)
  : base
      .prepare("SELECT id, project_id FROM cards WHERE json_array_length(json_extract(data, '$.parcours.plans')) > 0 ORDER BY updated_at DESC LIMIT 1")
      .get();
base.close();
if (!carte) {
  console.log('aucune carte avec un plan : rien à juger');
  process.exit(0);
}

const cookie = crypto.randomBytes(24).toString('hex');
const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
{
  const db = ouvrirLaBase();
  const colonnes = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  const maintenant = Date.now();
  if (colonnes.includes('user_id')) {
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(
      empreinte, maintenant, maintenant + 3_600_000, 'vérification du volet du plan', 'admin-premier',
    );
  } else {
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
      empreinte, maintenant, maintenant + 3_600_000, 'vérification du volet du plan',
    );
  }
  db.close();
}

fs.mkdirSync(SORTIE, { recursive: true });
const navigateur = await chromium.launch({ channel: 'chrome' });

async function poserLeTheme(page, sombre) {
  await page.evaluate((s) => {
    document.documentElement.classList.toggle('dark', s);
    document.documentElement.style.colorScheme = s ? 'dark' : 'light';
  }, sombre);
  await page.waitForTimeout(300);
}

async function parcourir(nom, options) {
  const contexte = await navigateur.newContext({ ...options, serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: cookie, domain: 'localhost', path: '/' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto(`${ADRESSE}/#projet/${carte.project_id}/tache/${carte.id}`, { waitUntil: 'domcontentloaded' });
  const encart = page.locator('[data-encart-du-plan]').last();
  await encart.waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForTimeout(1500);

  const texte = await page.locator('body').innerText();
  /* LA DERNIÈRE COMPRÉHENSION se lit en entier : la carte la garde, même quand
     son jalon a été coupé par l'ancien plafond. Une version PLUS ANCIENNE
     coupée avant la correction ne se rattrape pas (la carte ne la garde plus). */
  const derniere = page.locator('[data-moment="comprehension"]').last();
  const texteDerniere = (await derniere.count()) ? await derniere.innerText() : '';
  if (/non conservés dans le journal/.test(texteDerniere)) refuser(`${nom} : la dernière compréhension est encore coupée`);
  else constater(`${nom} : la dernière compréhension se lit en entier (${texteDerniere.length} signes)`);
  if (/Je me sers (d’un|\d+ fois d’un) outil du projet|\b\d+ outils? utilisés?\b/.test(texte)) {
    refuser(`${nom} : un outil est encore dit sans son nom`);
  } else constater(`${nom} : aucun outil anonyme dans le fil`);

  for (const sombre of [false, true]) {
    await poserLeTheme(page, sombre);
    const suffixe = `${nom}-${sombre ? 'sombre' : 'clair'}`;
    await page.screenshot({ path: path.join(SORTIE, `fil-${suffixe}.png`) });
  }
  await poserLeTheme(page, false);

  if ((await encart.getAttribute('data-encart-ouvert')) === null) await encart.click();
  const copier = page.locator('[data-plan-copier]:visible');
  const exporter = page.locator('[data-plan-exporter]:visible');
  await exporter.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  if ((await copier.count()) && (await exporter.count())) constater(`${nom} : « Copier » et « Télécharger » dans l'entête du volet`);
  else refuser(`${nom} : les boutons du volet du plan manquent (copier ${await copier.count()}, télécharger ${await exporter.count()})`);
  const deborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (deborde > 0) refuser(`${nom} : la page déborde de ${deborde} px`);
  for (const sombre of [false, true]) {
    await poserLeTheme(page, sombre);
    await page.mouse.move(5, 5);
    await page.screenshot({ path: path.join(SORTIE, `volet-${nom}-${sombre ? 'sombre' : 'clair'}.png`) });
  }
  if (await exporter.count()) {
    await exporter.first().focus();
    await page.keyboard.press('Enter');
    const pdf = page.locator('[data-plan-export="pdf"]');
    await pdf.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    if (await pdf.count()) constater(`${nom} : le menu propose PDF et Markdown`);
    else refuser(`${nom} : le menu de téléchargement ne s'ouvre pas`);
    await page.screenshot({ path: path.join(SORTIE, `menu-${nom}-sombre.png`) });
    await page.keyboard.press('Escape');
  }
  if (erreurs.length) refuser(`${nom} : erreurs de page — ${erreurs.join(' | ')}`);
  await contexte.close();
}

try {
  console.log(`\nVOLET DU PLAN — carte ${carte.id}\n`);
  await parcourir('ordinateur', { viewport: { width: 1440, height: 900 } });
  await parcourir('telephone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
} finally {
  await navigateur.close();
  const db = ouvrirLaBase();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}
console.log(echecs.length ? `\n${echecs.length} échec(s).` : `\nTout est vert. Captures : ${SORTIE}`);
process.exit(echecs.length ? 1 : 0);
