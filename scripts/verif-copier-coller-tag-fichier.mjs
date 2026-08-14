#!/usr/bin/env node
/**
 * Copier un texte du champ de saisie contenant un tag « [fichier: …] », puis
 * le coller ailleurs, doit recréer la pièce jointe — pas seulement le texte
 * du tag.
 *
 * Se lance contre le serveur de développement :
 *   npm run dev --workspace web -- --port 7099
 *   node scripts/verif-copier-coller-tag-fichier.mjs
 */
import { chromium } from 'playwright';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';
const DB = process.env.HAIKODEV_DB || '/root/haikodev/data/haikodev.db';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function poserSession(db) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification copier-coller tag fichier',
  );
  return { cookie, empreinte };
}

function fabriqueImage() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAP0lEQVR42u3OMQEAAAgDoC252H0M' +
      'Ywm4mUryJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgWQ0YMAAB8W8LqQAAAABJRU5ErkJggg==',
    'base64',
  );
  // Le serveur DÉDOUBLONNE sur le contenu : une image identique à celle d'un
  // autre contrôle reviendrait sous SON nom, et le tag attendu ne serait
  // jamais écrit. Quelques octets propres à cet essai suffisent à l'éviter.
  const unique = Buffer.concat([png, Buffer.from(`\n${process.pid}-${Date.now()}\n`)]);
  const fichier = path.join(os.tmpdir(), 'capture-copier-coller-verif.png');
  fs.writeFileSync(fichier, unique);
  return fichier;
}

/** Copie la sélection [debut,fin) du champ, comme un vrai Ctrl+C. */
async function copierSelection(zone, debut, fin) {
  return zone.evaluate(
    (node, [d, f]) => {
      node.focus();
      node.setSelectionRange(d, f);
      const transfert = new DataTransfer();
      const evenement = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: transfert });
      node.dispatchEvent(evenement);
      return {
        texte: transfert.getData('text/plain'),
        jointes: transfert.getData('application/x-haikodev-fichiers'),
        defaut: !evenement.defaultPrevented,
      };
    },
    [debut, fin],
  );
}

/** Colle à la position `ou`, avec le contenu du presse-papiers simulé. */
async function collerA(zone, ou, presse) {
  return zone.evaluate(
    (node, [position, texte, jointes]) => {
      node.focus();
      node.setSelectionRange(position, position);
      const transfert = new DataTransfer();
      if (texte) transfert.setData('text/plain', texte);
      if (jointes) transfert.setData('application/x-haikodev-fichiers', jointes);
      const evenement = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfert });
      node.dispatchEvent(evenement);
    },
    [ou, presse.texte, presse.jointes],
  );
}

async function main() {
  const db = new Database(DB);
  const { cookie, empreinte } = poserSession(db);
  const image = fabriqueImage();

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
      await page.waitForTimeout(1500);
    }

    const ongletChef = page.getByRole('button', { name: 'Chef', exact: true }).first();
    if (await ongletChef.count()) {
      await ongletChef.click({ force: true });
      await page.waitForTimeout(2500);
    }

    // PIÈGE : plusieurs barres d'écriture coexistent (conversation, tiroir de
    // carte). Le champ de fichier doit être celui de la barre qu'on VOIT,
    // sinon le fichier arrive dans une barre invisible et aucun tag n'apparaît.
    const barre = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last();
    const zone = barre.locator('textarea').last();
    await zone.waitFor({ state: 'visible', timeout: 20000 });

    // Un fichier joint pour obtenir un vrai tag « [fichier: …] » avec sa pièce jointe.
    await zone.fill('Avant le fichier. Après le fichier.');
    await zone.press('Control+Home');
    for (let i = 0; i < 'Avant le fichier. '.length; i += 1) await zone.press('ArrowRight');
    const choix = barre.locator('input[data-composer-file]');
    await choix.setInputFiles(image);
    await page.waitForTimeout(3500);

    const texteInitial = await zone.inputValue();
    const marque = '[fichier: capture-copier-coller-verif.png]';
    const debutTag = texteInitial.indexOf(marque);
    record('Le tag du fichier est bien dans le texte de départ', debutTag !== -1, texteInitial);
    if (debutTag === -1) throw new Error('tag absent, essai interrompu');

    /* ---- 1. Copier la sélection contenant le tag emporte la pièce jointe ---- */
    const presse = await copierSelection(zone, debutTag, debutTag + marque.length);
    record('Copier le tag empêche la copie native (preventDefault)', presse.defaut === false);
    record('Le texte copié est bien le tag', presse.texte === marque, presse.texte);
    record('Le presse-papiers emporte la pièce jointe visée par le tag', Boolean(presse.jointes), presse.jointes?.slice(0, 80));

    let jointesJSON = [];
    try {
      jointesJSON = JSON.parse(presse.jointes || '[]');
    } catch {
      jointesJSON = [];
    }
    record(
      'La pièce jointe copiée porte le bon nom',
      jointesJSON[0]?.name === 'capture-copier-coller-verif.png',
      JSON.stringify(jointesJSON),
    );

    /* ---- 2. Retirer le fichier, puis coller le tag ailleurs le recrée ---- */
    await page.locator('button[title="Retirer ce fichier"]').first().click();
    await page.waitForTimeout(1200);
    const apresRetrait = await zone.inputValue();
    record("Le fichier est bien retiré avant l'essai de collage", !apresRetrait.includes('[fichier:'), apresRetrait);

    await zone.click();
    await zone.fill('Un nouveau texte, sans rien de collé. ');
    await page.waitForTimeout(300);
    const finTexte = (await zone.inputValue()).length;
    await collerA(zone, finTexte, presse);
    await page.waitForTimeout(3000);

    const texteApresCollage = await zone.inputValue();
    record(
      'Coller le tag copié réécrit le tag dans le texte',
      texteApresCollage.includes(marque),
      texteApresCollage,
    );
    const vignetteRecreee = page.locator('img[alt="capture-copier-coller-verif.png"]');
    record(
      'Coller le tag copié RECRÉE la pièce jointe (vignette visible)',
      (await vignetteRecreee.count()) > 0,
    );
    const pastilleRecreee = page.locator('button[title="capture-copier-coller-verif.png"]');
    record('La pastille du fichier réapparaît dans la barre', (await pastilleRecreee.count()) > 0);

    // On laisse la barre propre. Pas de clic : au centre du champ, c'est le
    // drapeau du fichier qu'on toucherait, et il se retire au clic.
    await zone.fill('');
    await page.waitForTimeout(1000);

    record('Aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } catch (souci) {
    console.error(souci);
    throw souci;
  } finally {
    await browser.close();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    db.close();
    fs.rmSync(image, { force: true });
  }

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
