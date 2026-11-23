#!/usr/bin/env node
/**
 * L'ÉTAPE « VOTRE ORDINATEUR » DE LA MISE EN ROUTE, DANS UN VRAI NAVIGATEUR (carte « Liaison de l'extension Chrome
 * simplifiée », 20/11/2026) — sur un démon d'ESSAI monté depuis cette copie (base neuve, aucun moteur, aucun quota).
 *
 * La mise en route est posée « à faire » avec les trois premières questions répondues : la suivante doit être
 * « Votre ordinateur », juste après les noms, avec le MÊME parcours vertical que Réglages › Extension (lu sur le démon
 * d'essai, sans ordinateur relié). « Valider » attend un navigateur relié, le démon refuse « faite » sans lui, et
 * « Plus tard » la remet aux réglages (rappel dans Réglages › Installation) puis la discussion continue.
 *
 *   VERIF_CAPTURES=<dossier> node scripts/verif-mise-en-route-ordinateur.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7317);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.VERIF_CAPTURES || '/tmp/captures-mise-en-route-ordinateur';
fs.mkdirSync(CAPTURES, { recursive: true });

let echecs = 0;
let total = 0;
function noter(nom, ok, detail = '') {
  total += 1;
  if (!ok) echecs += 1;
  console.log(`${ok ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const { DATA, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-mise-en-route-ordinateur-', port: PORT, signaux: true });
if (!(await attendrePort())) {
  console.error(`Le démon d’essai n’a pas démarré :\n${journal.join('')}`);
  process.exit(1);
}

const jeton = crypto.randomBytes(32).toString('hex');
function poser(theme) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const T = Date.now();
  db.prepare('INSERT OR IGNORE INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai mise en route');
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify(theme), T);
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  reglages.assistantNom = reglages.assistantNom || 'Beluga';
  reglages.assistant = { statut: 'a-faire', etapes: { moteurs: 'faite', bienvenue: 'faite', assistant: 'faite' } };
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('settings', ?)").run(JSON.stringify(reglages));
  db.close();
}
function etapes() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const r = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}').assistant;
  db.close();
  return r;
}

const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  for (const [largeur, theme] of [
    [1440, 'sombre'],
    [1440, 'clair'],
    [390, 'sombre'],
    [390, 'clair'],
  ]) {
    poser(theme);
    const telephone = largeur === 390;
    const ctx = await navigateur.newContext({
      viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      isMobile: telephone,
      hasTouch: telephone,
      serviceWorkers: 'block',
      locale: 'fr-FR',
    });
    await ctx.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e?.message ?? e)));
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const carte = page.locator('[data-question="ordinateur"]');
    await carte.locator('[data-parcours-integre]').waitFor({ timeout: 60_000 }).catch(() => undefined);
    const ici = `[${largeur} ${theme}]`;
    noter(
      `${ici} la question suivant les noms est « Votre ordinateur »`,
      (await page.locator('[data-assistant-demarrage="1"]').getAttribute('data-etape').catch(() => null)) === 'ordinateur',
    );
    noter(
      `${ici} elle porte le parcours vertical, étape 1 en cours, sans « Plus tard » ni « Terminer » à lui`,
      (await carte.locator('[data-etape-connexion="installation"][data-etat="en-cours"]').count()) === 1 &&
        (await carte.locator('[data-parcours-integre] [data-assistant-plus-tard]').count()) === 0 &&
        (await carte.locator('[data-parcours-integre] [data-parcours-fermer]').count()) === 0,
    );
    noter(
      `${ici} « Valider » attend un navigateur relié, « Plus tard » est permis`,
      (await carte.locator('footer [data-assistant-continuer]').isDisabled().catch(() => false)) && (await carte.locator('footer [data-assistant-plus-tard]').count()) === 1,
    );
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(CAPTURES, `mise-en-route-ordinateur-${largeur}-${theme}.png`) });
    const deborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    noter(`${ici} rien ne déborde en largeur`, deborde <= 0, String(deborde));
    if (largeur === 1440 && theme === 'sombre') {
      /* Le démon refuse « faite » sans navigateur relié, même si l'écran le demandait. */
      const refus = await page.evaluate(
        (adresse) =>
          new Promise((resoudre) => {
            const ws = new WebSocket(adresse.replace(/^http/, 'ws') + '/ws');
            ws.onopen = () => ws.send(JSON.stringify({ id: 'essai', cmd: { type: 'installation.etape', etape: 'ordinateur', issue: 'faite' } }));
            ws.onmessage = (e) => {
              const m = JSON.parse(e.data);
              if (m.type === 'ack' && m.id === 'essai') {
                ws.close();
                resoudre(m.ok ? 'accepte' : String(m.error));
              }
            };
            setTimeout(() => resoudre('sans réponse'), 10_000);
          }),
        BASE,
      );
      noter('le démon refuse « faite » sans navigateur relié', /Aucun navigateur/.test(refus), refus);
      await carte.locator('footer [data-assistant-plus-tard]').click();
      await page.locator('[data-bulle-de-la-personne="ordinateur"][data-issue="passee"]').waitFor({ timeout: 20_000 }).catch(() => undefined);
      noter('« Plus tard » : la réponse s’écrit, la discussion passe à la suite', (await page.locator('[data-bulle-de-la-personne="ordinateur"][data-issue="passee"]').count()) === 1);
      noter('l’étape est notée « passée » (rappel dans les réglages)', etapes()?.etapes?.ordinateur === 'passee', JSON.stringify(etapes()));
    }
    noter(`${ici} aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await ctx.close();
  }
} finally {
  await navigateur.close();
}
console.log(`\n${total - echecs}/${total} contrôles verts — captures dans ${CAPTURES}`);
process.exit(echecs ? 1 : 0);
