#!/usr/bin/env node
/**
 * LES RETOUCHES DES PAGES DE SERVICE (carte du 31/10/2026), dans un vrai navigateur, sur un démon d'essai à base neuve :
 * la période sur la ligne du titre (Réseaux sociaux, Messagerie), le chevron du fil d'Ariane qui ne paraît qu'au
 * survol.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-retouches-pages-de-service.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7243);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.BELUGA_VERIF_CAPTURES;
const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-pages-service-', port: PORT });
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const attendre = async (fn, ms = 8000) => {
  for (const fin = Date.now() + ms; Date.now() < fin; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return true;
  return false;
};

let code = 1;
let navigateur;
try {
  if (!(await attendrePort())) throw new Error(`Le démon d’essai n’a pas démarré :\n${journal.join('')}`);
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), MAINTENANT, MAINTENANT + 3600_000, 'essai');
  /* Un client, sans quoi la Messagerie n'a pas de tableau à montrer. */
  db.prepare('INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le) VALUES (?, ?, ?, ?, ?, ?, 1, ?)').run('u-client', 'client-essai', 'client', 'Client d’essai', 'sel', 'empreinte', MAINTENANT);
  db.close();
  navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  const contexte = await navigateur.newContext({ viewport: { width: 1600, height: 1000 } });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const capture = async (nom) => CAPTURES && (await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) }));

  /* 1. Communication (qui a repris les Réseaux sociaux) : la période est sur la ligne du titre. */
  await page.goto(`${BASE}/#reseaux-sociaux`);
  const periodes = page.locator('[data-communication-entete] [data-communication-segment="periode"]');
  noter('1. Communication : la période est sur la ligne du titre', await attendre(async () => (await periodes.count()) === 1, 20000));
  const titre = await page.locator('[data-communication-entete] h1').first().boundingBox();
  const boite = await periodes.boundingBox();
  noter('1. … à droite du titre, à sa hauteur', !!titre && !!boite && boite.x > titre.x && Math.abs(boite.y + boite.height / 2 - (titre.y + titre.height / 2)) < 24);
  await capture('01-communication');

  /* 2. Le chevron du fil d'Ariane ne paraît qu'au survol. */
  const chevron = page.locator('[data-entete-de-zone] [data-chevron-de-cran]').first();
  await page.mouse.move(1500, 900);
  await page.waitForTimeout(300);
  const auRepos = (await chevron.boundingBox())?.width ?? 0;
  await page.locator('[data-entete-de-zone] [data-titre-bandeau]').first().hover();
  await page.waitForTimeout(300);
  const auSurvol = (await chevron.boundingBox())?.width ?? 0;
  noter('2. fil d’Ariane : chevron caché au repos, visible au survol', auRepos < 2 && auSurvol >= 10, `${auRepos} → ${auSurvol} px`);
  await capture('02-chevron-au-survol');

  /* 3. Messagerie : le sélecteur de période sur la ligne du titre — depuis le 14/11/2026 (carte « Services homogènes et
     centrés »), la rangée unique de la page de service, à droite du titre. */
  await page.goto(`${BASE}/#espace`);
  const ligne = page.locator('[data-droite-du-service] [data-selecteur-periode], [data-rangee-de-la-page] [data-selecteur-periode]');
  noter('3. Messagerie : la période sur la ligne du titre', await attendre(async () => (await ligne.count()) >= 1 && (await ligne.first().locator('button').count()) >= 4, 20000));
  await capture('03-messagerie');

  code = resultats.every((r) => r.ok) ? 0 : 1;
  console.log(`\n${resultats.filter((r) => r.ok).length}/${resultats.length} vérifications passent.`);
} catch (err) {
  console.error(err);
} finally {
  await navigateur?.close();
  process.exit(code);
}
