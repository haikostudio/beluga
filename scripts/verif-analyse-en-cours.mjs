#!/usr/bin/env node
/**
 * En conditions réelles : on crée une carte d'essai, on la valide, et SANS la
 * lancer on regarde sa conversation. Elle doit dire qu'une analyse est en
 * cours, puis afficher le compte rendu complet dès qu'il est écrit.
 *
 *   node scripts/verif-analyse-en-cours.mjs
 *
 * La carte d'essai est supprimée à la fin : le tableau ne se remplit pas.
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

// HAIKODEV_URL désigne le démon (version publiée) : l'essai a son propre nom.
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://127.0.0.1:7099';
const DB = process.env.HAIKODEV_DB || '/root/haikodev/data/haikodev.db';
const PROJET = process.env.HAIKODEV_PROJET || 'HaikoDev';
const SHOTS = '/root/haikodev/data/verification';
const TITRE = `Vérification automatique — analyse lisible ${Date.now().toString().slice(-5)}`;

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const db = new Database(DB);
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    Date.now(),
    Date.now() + 3600_000,
    'vérification analyse en cours',
  );

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.getByText(PROJET, { exact: true }).first().click();
    await page.waitForTimeout(2500);
    if (await page.locator('[role="dialog"]').count()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }

    /* ---------- Une carte d'essai, créée comme n'importe qui ---------- */
    const colonne = page.locator('[data-column="todo"]');
    await colonne.scrollIntoViewIfNeeded();
    await colonne.getByRole('button').first().click();
    await page.waitForTimeout(500);
    await colonne.locator('input').fill(TITRE);
    await colonne.locator('textarea').fill(
      "Carte d'essai : vérifier que le compte rendu de l'analyse se lit avant le lancement. Ne rien modifier dans le projet.",
    );
    await colonne.getByRole('button', { name: 'Ajouter la tâche' }).click();
    await page.waitForTimeout(2500);

    const vignette = page.locator('article').filter({ hasText: TITRE }).first();
    await vignette.waitFor({ state: 'visible', timeout: 20000 });
    await vignette.click();
    await page.waitForTimeout(1500);

    const tiroir = page.locator('[role="dialog"]').last();
    await tiroir.getByRole('button', { name: /Valider/ }).click();
    await page.waitForTimeout(2500);

    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/analyse-en-cours-debut.png` });

    const pendantAnalyse = await tiroir.innerText();
    record(
      "Une carte en cours d'analyse le dit dans sa conversation",
      /Analyse en cours|Analyse de la carte|réfléchit|Lecture de la mémoire/i.test(pendantAnalyse),
      pendantAnalyse.replace(/\s+/g, ' ').slice(0, 90),
    );
    record(
      "La conversation n'annonce plus « aucun agent »",
      !/Aucun agent n'a encore travaillé/.test(pendantAnalyse),
    );

    /* ---------- On attend la fin, sans jamais lancer la tâche ---------- */
    let texte = '';
    for (let i = 0; i < 60; i += 1) {
      await page.waitForTimeout(5000);
      // Le tiroir peut disparaître (rechargement de la page en développement) :
      // on le rouvre plutôt que d'abandonner la vérification.
      if (!(await tiroir.count())) {
        const encore = page.locator('article').filter({ hasText: TITRE }).first();
        if (await encore.count()) {
          await encore.click();
          await page.waitForTimeout(2000);
        }
        continue;
      }
      texte = await tiroir.innerText();
      if (/Estimation développeur senior/i.test(texte)) break;
    }
    await page.screenshot({ path: `${SHOTS}/analyse-en-cours-fin.png` });

    record(
      "Le compte rendu d'analyse s'affiche sans avoir lancé la tâche",
      /Analyse de la demande/i.test(texte) && /Estimation développeur senior/i.test(texte),
      `${texte.length} signes`,
    );
    record(
      "L'agent d'analyse est nommé au-dessus de son compte rendu",
      /analyse de la carte/i.test(texte),
    );
    record('Aucune erreur dans la console', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

    /* ---------- La carte d'essai ne reste pas sur le tableau ---------- */
    await tiroir.getByRole('button', { name: /Supprimer/ }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Supprimer la carte/ }).click();
    await page.waitForTimeout(2000);
    record(
      "La carte d'essai a été retirée du tableau",
      (await page.locator('article').filter({ hasText: TITRE }).count()) === 0,
    );
  } finally {
    await browser.close();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    const reste = db.prepare('SELECT id FROM cards WHERE title = ?').all(TITRE);
    if (reste.length) console.log(`Carte d'essai encore présente : ${reste.map((r) => r.id).join(', ')}`);
    db.close();
  }

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles au vert`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
