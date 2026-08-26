#!/usr/bin/env node
/**
 * LE BROUILLON D'UNE NOTE APPARTIENT À SA COLONNE DE SON PROJET, PAS À
 * L'APPLICATION.
 *
 * Le composeur inline « Ajouter une note » (colonne « Notes ») n'est jamais
 * démonté quand on change de projet — seul le tableau qu'il habite l'est. Sans
 * un geste explicite, un titre ou une pièce jointe préparés pour le projet A
 * restaient dans le formulaire en ouvrant celui du projet B.
 *
 * Trois constats, dans un vrai navigateur :
 *  1. on ouvre « Ajouter une note » du projet A, on tape un titre et on joint
 *     un fichier ;
 *  2. on change de projet SANS créer la note : le formulaire ouvert chez B
 *     est VIERGE (pas rouvert, pas de titre ni de fichier hérités) ;
 *  3. de retour chez A, le formulaire est lui aussi reparti à zéro — rien
 *     n'est resté accroché nulle part.
 *
 * Se lance contre le serveur de développement :
 *   npm run dev --workspace web -- --port 7132
 *   node scripts/verif-note-jointes-isolees.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { creerResultats } from './lib/verif-resultats.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7132';
const DB = process.env.HAIKODEV_DB || '/root/haikodev/data/haikodev.db';

const { results, record } = creerResultats();

function poserSession(db) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification note isolée par projet',
  );
  return { cookie, empreinte };
}

const NOM_JOINT = 'notes-projet.txt';
function fabriqueFichier() {
  const fichier = path.join(os.tmpdir(), NOM_JOINT);
  fs.writeFileSync(fichier, `Contrôle pièce jointe de note — ${crypto.randomBytes(12).toString('hex')}\n`);
  return fichier;
}

/** Ouvre un projet par son NOM, depuis la colonne de gauche. */
async function ouvrirProjet(page, nom) {
  const ligne = page.locator('[data-drop-root] [data-drag-kind="project"]').filter({ hasText: nom }).first();
  await ligne.waitFor({ state: 'visible', timeout: 20000 });
  await ligne.click({ force: true });
  await page.waitForTimeout(1800);
}

async function ouvrirLaColonneNotes(page) {
  const bouton = page.getByRole('button', { name: 'Nouvelle note', exact: true }).first();
  await bouton.waitFor({ state: 'visible', timeout: 20000 });
  await bouton.click({ force: true });
  await page.waitForTimeout(500);
  const composeur = page.locator('[data-composer-ouvert="notes"]').first();
  await composeur.waitFor({ state: 'visible', timeout: 10000 });
  return composeur;
}

async function main() {
  const db = new Database(DB);
  const { cookie, empreinte } = poserSession(db);
  const joint = fabriqueFichier();

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
    }

    await page.waitForSelector('[data-drop-root] [data-drag-kind="project"]', { timeout: 20000 });
    const noms = (await page.locator('[data-drop-root] [data-drag-kind="project"]').allTextContents())
      .map((t) => t.trim())
      .filter(Boolean);
    const nomProjetA = noms[0];
    const nomProjetB = noms.find((n) => n !== nomProjetA);
    if (!nomProjetA || !nomProjetB) throw new Error('Moins de deux projets affichés.');

    await ouvrirProjet(page, nomProjetA);
    let composeur = await ouvrirLaColonneNotes(page);
    await composeur.locator('input[placeholder="Titre de la note…"]').fill('Note du projet A — ne doit pas voyager');
    await composeur.locator('input[data-note-file-input]').setInputFiles(joint);
    const jointePosee = await composeur
      .locator('[data-note-attachments]')
      .waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    record(`Le titre et le fichier sont posés dans « ${nomProjetA} »`, jointePosee);

    // On change de projet SANS créer la note.
    await ouvrirProjet(page, nomProjetB);
    const composeurAvantOuverture = await page.locator('[data-composer-ouvert="notes"]').count();
    record(
      `Changer de projet referme le formulaire ouvert (aucun résidu chez « ${nomProjetB} »)`,
      composeurAvantOuverture === 0,
    );

    composeur = await ouvrirLaColonneNotes(page);
    const titreChezB = await composeur.locator('input[placeholder="Titre de la note…"]').inputValue();
    const jointeChezB = await composeur.locator('[data-note-attachments]').count();
    record(
      `Le formulaire de « ${nomProjetB} » est vierge (titre)`,
      titreChezB === '',
      `titre : ${JSON.stringify(titreChezB)}`,
    );
    record(`Le formulaire de « ${nomProjetB} » est vierge (pièce jointe)`, jointeChezB === 0);
    await composeur.getByRole('button', { name: 'Annuler', exact: true }).click({ force: true });
    await page.waitForTimeout(400);

    await ouvrirProjet(page, nomProjetA);
    composeur = await ouvrirLaColonneNotes(page);
    const titreChezA = await composeur.locator('input[placeholder="Titre de la note…"]').inputValue();
    const jointeChezA = await composeur.locator('[data-note-attachments]').count();
    record(`De retour chez « ${nomProjetA} », le formulaire est REPARTI À ZÉRO (titre)`, titreChezA === '');
    record(`De retour chez « ${nomProjetA} », le formulaire est REPARTI À ZÉRO (pièce jointe)`, jointeChezA === 0);
    await composeur.getByRole('button', { name: 'Annuler', exact: true }).click({ force: true });
    await page.waitForTimeout(400);

    record('Aucune erreur de page pendant le contrôle', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    db.close();
  }

  const ratés = results.filter((r) => !r.ok);
  console.log(`\n${results.length - ratés.length}/${results.length} constats tenus — dépôt ${RACINE}`);
  process.exit(ratés.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
