#!/usr/bin/env node
/**
 * LES FICHIERS JOINTS ET LE BROUILLON APPARTIENNENT À L'AGENT, PAS À
 * L'APPLICATION.
 *
 * Avant cette carte, la liste des pièces jointes en attente dans le composeur
 * était un simple état local du composant : elle ne se rechargeait ni ne se
 * vidait quand on changeait de projet ou de conversation. Joindre un fichier
 * dans le Chef d'un projet, puis ouvrir le Chef d'un AUTRE projet, faisait
 * réapparaître le même fichier — prêt à partir au mauvais agent.
 *
 * Trois constats, dans un vrai navigateur :
 *  1. un fichier joint au Chef d'un projet A écrit son tag dans le champ ;
 *  2. ouvrir le Chef d'un projet B ne montre AUCUNE de ces pièces jointes ;
 *  3. revenir au projet A retrouve le fichier ET son tag, intacts.
 *
 * Se lance contre le serveur de développement :
 *   npm run dev --workspace web -- --port 7131
 *   node scripts/verif-jointes-suivent-agent.mjs
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
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7131';
const DB = process.env.HAIKODEV_DB || '/root/haikodev/data/haikodev.db';

const lisible = (valeur) => (valeur || '').replace(/ /g, ' ');

const { results, record } = creerResultats();

function poserSession(db) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification pièces jointes par agent',
  );
  return { cookie, empreinte };
}

const NOM_JOINT = 'notes-agent.txt';
function fabriqueFichier() {
  const fichier = path.join(os.tmpdir(), NOM_JOINT);
  fs.writeFileSync(fichier, `Contrôle pièce jointe par agent — ${crypto.randomBytes(12).toString('hex')}\n`);
  return fichier;
}

async function champVisible(page) {
  const barre = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last();
  const zone = barre.locator('textarea').last();
  await zone.waitFor({ state: 'visible', timeout: 20000 });
  return { barre, zone };
}

async function ouvrirLeChef(page) {
  // La conversation permanente du chef est un ONGLET (rôle « tab »), pas un
  // simple bouton — seul le menu du téléphone en fait un vrai bouton.
  const ongletChef = page.getByRole('tab', { name: 'Chef', exact: true }).first();
  if (await ongletChef.count()) {
    await ongletChef.click({ force: true });
    await page.waitForTimeout(1500);
    return;
  }
  const boutonChef = page.locator('[data-menu-bas]').getByRole('button', { name: 'Chef' }).first();
  if (await boutonChef.count()) {
    await boutonChef.click({ force: true });
    await page.waitForTimeout(1500);
  }
}

/** Ouvre un projet par son NOM, depuis la colonne de gauche. */
async function ouvrirProjet(page, nom) {
  const ligne = page.locator('[data-drop-root] [data-drag-kind="project"]').filter({ hasText: nom }).first();
  await ligne.waitFor({ state: 'visible', timeout: 20000 });
  await ligne.click({ force: true });
  await page.waitForTimeout(1800);
}

async function texteDuChamp(page) {
  const { zone } = await champVisible(page);
  return lisible(await zone.inputValue());
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

    // Deux projets RÉELLEMENT affichés dans la colonne de gauche — jamais
    // devinés, la liste dépend du compte connecté. Seules les lignes de
    // PROJET comptent, pas les en-têtes de groupe.
    await page.waitForSelector('[data-drop-root] [data-drag-kind="project"]', { timeout: 20000 });
    const noms = (
      await page.locator('[data-drop-root] [data-drag-kind="project"]').allTextContents()
    )
      .map((t) => t.trim())
      .filter(Boolean);
    const nomProjetA = noms[0];
    const nomProjetB = noms.find((n) => n !== nomProjetA);
    if (!nomProjetA || !nomProjetB) throw new Error('Moins de deux projets affichés dans la colonne de gauche.');
    const projetA = { name: nomProjetA };
    const projetB = { name: nomProjetB };

    await ouvrirProjet(page, projetA.name);
    await ouvrirLeChef(page);
    const { barre, zone } = await champVisible(page);

    // On part d'un champ propre, sinon un brouillon d'un essai précédent fausse le constat.
    await zone.fill('');
    await page.waitForTimeout(400);

    await barre.locator('input[data-composer-file]').setInputFiles(joint);
    const tagEcrit = await page
      .waitForFunction(
        (nom) => {
          const champs = Array.from(document.querySelectorAll('textarea')).filter((t) => t.offsetParent !== null);
          const z = champs[champs.length - 1];
          return Boolean(z && z.value.replace(/ /g, ' ').includes(`[fichier: ${nom}]`));
        },
        NOM_JOINT,
        { timeout: 45000 },
      )
      .then(() => true)
      .catch(() => false);
    record(`Le fichier joint au Chef de « ${projetA.name} » écrit son tag`, tagEcrit);

    // Le temps que la persistance (débounce 600 ms) parte vers le serveur.
    await page.waitForTimeout(1200);

    await ouvrirProjet(page, projetB.name);
    await ouvrirLeChef(page);
    const texteChezB = await texteDuChamp(page);
    record(
      `Le Chef de « ${projetB.name} » ne voit AUCUNE pièce jointe de « ${projetA.name} »`,
      !texteChezB.includes(NOM_JOINT),
      `champ : ${JSON.stringify(texteChezB).slice(0, 80)}`,
    );
    const { barre: barreB } = await champVisible(page);
    const jointesB = await barreB.locator('[data-composer-file]').count().catch(() => 0);
    const pastillesB = await barreB.evaluate((el) => el.textContent || '').catch(() => '');
    record(
      `Aucune pastille de pièce jointe visible chez « ${projetB.name} »`,
      !pastillesB.includes(NOM_JOINT),
    );

    await ouvrirProjet(page, projetA.name);
    await ouvrirLeChef(page);
    const texteChezA = await texteDuChamp(page);
    record(
      `De retour chez « ${projetA.name} », le tag du fichier est toujours là`,
      texteChezA.includes(`[fichier: ${NOM_JOINT}]`),
      `champ : ${JSON.stringify(texteChezA).slice(0, 80)}`,
    );

    // On efface ce qu'on a posé, pour ne rien laisser traîner.
    const { zone: zoneA } = await champVisible(page);
    await zoneA.fill('');
    await page.waitForTimeout(1200);

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
