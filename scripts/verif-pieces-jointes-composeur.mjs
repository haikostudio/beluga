#!/usr/bin/env node
/**
 * Les pièces jointes AVANT l'envoi, sur un écran de téléphone :
 *  1. l'image jointe s'affiche en vignette, pas en nom de fichier ;
 *  2. un clic sur la vignette ouvre l'aperçu en grand (l'écran partagé) ;
 *  3. l'ancre « [fichier: …] » s'écrit dans la barre d'écriture, à l'endroit
 *     du curseur, et disparaît quand on retire le fichier ;
 *  4. la barre d'écriture reste utilisable : les vignettes ne mangent pas sa
 *     hauteur.
 *
 * Se lance contre le serveur de développement :
 *   npm run dev --workspace web -- --port 7099
 *   node scripts/verif-pieces-jointes-composeur.mjs
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// PIÈGE : HAIKODEV_URL désigne le démon (version publiée). L'essai a son nom.
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';
const DB = process.env.HAIKODEV_DB || '/root/haikodev/data/haikodev.db';
const SHOTS = '/root/haikodev/data/verification';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Une session d'essai : la colonne « token » garde le SHA-256 du cookie. */
function poserSession(db) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification pièces jointes',
  );
  return { cookie, empreinte };
}

/** Une petite image PNG bien réelle, pour voir une vraie vignette. */
function fabriqueImage() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAP0lEQVR42u3OMQEAAAgDoC252H0M' +
      'Ywm4mUryJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgWQ0YMAAB8W8LqQAAAABJRU5ErkJggg==',
    'base64',
  );
  const fichier = path.join(os.tmpdir(), 'capture-verif.png');
  fs.writeFileSync(fichier, png);
  return fichier;
}

async function main() {
  const db = new Database(DB);
  const { cookie, empreinte } = poserSession(db);
  const image = fabriqueImage();
  // Un fichier sans image possible : il doit garder son nom et son icône.
  const texteJoint = path.join(os.tmpdir(), 'notes-verif.txt');
  fs.writeFileSync(texteJoint, `Notes de vérification ${Date.now()}\n`);

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    // Sinon c'est la version publiée qui s'affiche.
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

    // Le tiroir de la dernière carte se rouvre tout seul : on le referme, la
    // vérification se fait dans la conversation du chef d'orchestre.
    if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
    }

    const ongletChef = page.getByRole('button', { name: 'Chef', exact: true }).first();
    if (await ongletChef.count()) {
      await ongletChef.click({ force: true });
      await page.waitForTimeout(2500);
    }

    const zone = page.locator('textarea:visible').last();
    await zone.waitFor({ state: 'visible', timeout: 20000 });

    const hauteurAvant = (await zone.boundingBox())?.height ?? 0;

    /* ---- 3. L'ancre se pose à l'endroit du curseur ---- */
    await zone.click();
    await zone.fill('Premier paragraphe.\n\nSecond paragraphe.');
    // Curseur posé au clavier, comme une vraie personne : fin de la première
    // phrase, deux lignes plus haut que la fin du texte.
    await zone.press('Control+Home');
    await zone.press('End');

    const choix = page.locator('input[type="file"]').last();
    await choix.setInputFiles(image);
    await page.waitForTimeout(3500);

    const texte = await zone.inputValue();
    record("L'ancre du fichier est écrite dans le texte", texte.includes('[fichier: capture-verif.png]'), texte.slice(0, 90));
    record(
      "L'ancre est posée à l'endroit du curseur, pas à la fin",
      texte.indexOf('[fichier:') < texte.indexOf('Second paragraphe'),
    );

    /* ---- 1. Une vignette, pas un nom de fichier ---- */
    const vignette = page.locator('img[alt="capture-verif.png"]').first();
    record("Le fichier image s'affiche en vignette", (await vignette.count()) > 0);

    /* ---- 4. La barre d'écriture garde sa hauteur ---- */
    const hauteurApres = (await zone.boundingBox())?.height ?? 0;
    const boite = await vignette.boundingBox();
    record(
      "La vignette ne mange pas la hauteur du champ de texte",
      hauteurApres >= hauteurAvant - 2 && (boite?.height ?? 99) <= 56,
      `champ ${Math.round(hauteurApres)} px, vignette ${Math.round(boite?.height ?? 0)} px`,
    );

    await page.screenshot({ path: `${SHOTS}/composeur-vignette-telephone.png` });

    /* ---- 2. L'aperçu s'ouvre au clic, avant tout envoi ---- */
    await vignette.click();
    await page.waitForTimeout(1500);
    const dialogue = page.locator('[role="dialog"]').filter({ hasText: 'capture-verif.png' }).first();
    const ouvert = await dialogue.isVisible().catch(() => false);
    record("Un clic sur la vignette ouvre l'aperçu en grand", ouvert);
    if (ouvert) {
      const grande = dialogue.locator('img').first();
      record("L'aperçu montre bien l'image", (await grande.count()) > 0);
      await page.screenshot({ path: `${SHOTS}/composeur-apercu-telephone.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }

    /* ---- 3 bis. Retirer le fichier retire son ancre ---- */
    await page.locator('button[title="Retirer ce fichier"]').first().click();
    await page.waitForTimeout(1200);
    const apresRetrait = await zone.inputValue();
    record("Retirer le fichier retire son ancre du texte", !apresRetrait.includes('[fichier:'), apresRetrait.slice(0, 90));
    record("Le reste du texte est intact", apresRetrait.includes('Premier paragraphe.') && apresRetrait.includes('Second paragraphe.'));
    record("La vignette disparaît avec le fichier", (await page.locator('img[alt="capture-verif.png"]').count()) === 0);

    /* ---- Un fichier sans image garde son nom, et effacer son ancre le retire ---- */
    await zone.click();
    await zone.fill('');
    await choix.setInputFiles(texteJoint);
    await page.waitForTimeout(3000);
    const avecAncre = await zone.inputValue();
    const pastille = page.locator('button[title="notes-verif.txt"]');
    record("Un fichier sans image garde son nom dans la barre", (await pastille.count()) > 0);
    if (avecAncre.includes('[fichier: notes-verif.txt]')) {
      await zone.fill('rien du tout');
      await page.waitForTimeout(1200);
      record("Effacer l'ancre retire la pièce jointe", (await pastille.count()) === 0);
    } else {
      record("Effacer l'ancre retire la pièce jointe", false, `ancre absente : « ${avecAncre} »`);
    }

    /* ---- Un fichier lâché sur les mots s'ancre à cet endroit ---- */
    await zone.click();
    await zone.fill('Premier paragraphe.\n\nSecond paragraphe.');
    await page.waitForTimeout(400);
    // Quelques octets en plus après la fin du PNG : l'image reste lisible mais
    // le serveur ne la confond pas avec la première (il dédoublonne par contenu).
    const octets = [...fs.readFileSync(image), 10, 11, 12];
    await zone.evaluate((node, contenu) => {
      const boite = node.getBoundingClientRect();
      const transfert = new DataTransfer();
      transfert.items.add(new File([new Uint8Array(contenu)], 'depot-verif.png', { type: 'image/png' }));
      // Tout au début de la PREMIÈRE ligne, loin de la fin du texte.
      const x = boite.left + 4;
      const y = boite.top + 10;
      for (const genre of ['dragover', 'drop']) {
        node.dispatchEvent(
          new DragEvent(genre, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfert }),
        );
      }
    }, octets);
    await page.waitForTimeout(3500);
    const apresDepot = await zone.inputValue();
    record(
      "Un fichier lâché sur les mots s'ancre à cet endroit, pas à la fin",
      apresDepot.startsWith('[fichier: depot-verif.png]') && apresDepot.trim().endsWith('Second paragraphe.'),
      apresDepot.replace(/\n/g, ' ').slice(0, 80),
    );

    /* ---- Survoler une vignette fait défiler le texte jusqu'à son ancre ---- */
    const lignes = Array.from({ length: 30 }, (_, i) => `Ligne ${i + 1} du texte de vérification.`).join('\n');
    await zone.fill(`${apresDepot.split('\n')[0]}\n${lignes}`);
    await page.waitForTimeout(600);
    const enBas = await zone.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      return { scrollTop: node.scrollTop, possible: node.scrollHeight - node.clientHeight };
    });
    if (enBas.possible > 20) {
      await page.locator('img[alt="depot-verif.png"]').first().hover();
      await page.waitForTimeout(900);
      const remonte = await zone.evaluate((node) => node.scrollTop);
      record(
        "Survoler la vignette fait défiler le texte jusqu'à son ancre",
        remonte < enBas.scrollTop - 20,
        `de ${Math.round(enBas.scrollTop)} px à ${Math.round(remonte)} px`,
      );
    } else {
      record("Survoler la vignette fait défiler le texte jusqu'à son ancre", false, 'le champ ne défile pas');
    }

    // On laisse la barre propre : aucun brouillon d'essai ne doit rester.
    await zone.fill('');
    await page.waitForTimeout(1200);

    record("Aucune erreur dans la page", erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } catch (souci) {
    await page.screenshot({ path: `${SHOTS}/composeur-echec.png` }).catch(() => {});
    throw souci;
  } finally {
    await browser.close();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    db.close();
    fs.rmSync(image, { force: true });
    fs.rmSync(texteJoint, { force: true });
  }

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
