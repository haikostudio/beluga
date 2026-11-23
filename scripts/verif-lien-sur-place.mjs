#!/usr/bin/env node
/**
 * DANS L'APPLICATION INSTALLÉE, UN LIEN VERS UN FICHIER S'OUVRE SUR PLACE.
 *
 * Installée sur l'écran d'accueil d'un téléphone, l'application n'a ni barre
 * d'adresse ni bouton « retour » : un lien vers une pièce jointe remplaçait
 * tout l'écran par la page de téléchargement du système, qu'on ne pouvait plus
 * quitter. Ces liens s'ouvrent désormais dans une fenêtre de l'application
 * (`VisionneuseDeLien`), refermable comme les autres.
 *
 * Ce qui est relevé, dans un vrai navigateur à la taille d'un téléphone :
 *   1. INSTALLÉE : un lien de pièce jointe ne navigue plus, la fenêtre s'ouvre,
 *      l'image s'y voit sous son vrai nom, et Échap la referme ;
 *   2. INSTALLÉE : un lien vers un AUTRE site n'est pas retenu ;
 *   3. INSTALLÉE : le bouton « télécharger » d'un aperçu déjà ouvert enregistre
 *      le fichier sans rouvrir de fenêtre ;
 *   4. NAVIGATEUR ORDINAIRE : rien n'est retenu, le lien garde son comportement.
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve.
 * « Installée » se simule par `navigator.standalone`, comme le dit iOS.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-lien-sur-place.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7194);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-lien-sur-place-'));
const NOM = 'planche finale.png';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DOSSIER = path.join(TMP, 'projet');
const { DATA, journal, attendrePort } = demarrerDemonDEssai({ tmp: TMP, port: PORT, depot: false, dossiers: [DOSSIER] });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification des liens sur place',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai liens sur place',
    path: DOSSIER,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
  db.close();
}

/** Une vraie image, envoyée au démon comme le ferait la page. */
async function envoyerImage() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAP0lEQVR42u3OMQEAAAgDoC252H0M' +
      'Ywm4mUryJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgWQ0YMAAB8W8LqQAAAABJRU5ErkJggg==',
    'base64',
  );
  const reponse = await fetch(`${BASE}/api/upload?project=${PROJET_ID}`, {
    method: 'POST',
    headers: {
      cookie: `beluga_session=${JETON}`,
      'content-type': 'image/png',
      'x-file-name': encodeURIComponent(NOM),
    },
    body: png,
  });
  return (await reponse.json()).attachment?.id ?? null;
}

async function ouvrir(navigateur, installee) {
  const context = await navigateur.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: 'fr-CH',
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  await context.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  /* « INSTALLÉE », COMME LE DIT iOS : la page le lit sur `navigator.standalone`. */
  if (installee) {
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
    });
  }
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('#root > *').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(4_000);
  await page.keyboard.press('Escape');
  return { context, page, erreurs };
}

/**
 * Pose un lien d'essai dans la page et le clique. Un témoin, branché APRÈS
 * l'application, dit si le clic a été retenu — puis l'arrête lui-même, pour que
 * la page d'essai ne parte jamais ailleurs.
 */
async function cliquerUnLien(page, attributs) {
  return page.evaluate((attrs) => {
    document.querySelector('[data-lien-d-essai]')?.remove();
    const lien = document.createElement('a');
    for (const [cle, valeur] of Object.entries(attrs)) lien.setAttribute(cle, valeur);
    lien.setAttribute('data-lien-d-essai', '');
    lien.textContent = 'lien d’essai';
    lien.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999';
    document.body.appendChild(lien);
    return new Promise((resolve) => {
      lien.addEventListener('click', (event) => {
        const retenu = event.defaultPrevented;
        event.preventDefault();
        resolve(retenu);
      });
      lien.click();
    });
  }, attributs);
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const id = await envoyerImage();
  noter('décor : une image est jointe au projet d’essai', !!id);
  if (!id) process.exit(1);
  const adresse = `/api/attachment?id=${encodeURIComponent(id)}&download=1`;

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  try {
    /* ---------------- 1 à 3. L'application installée ---------------- */
    {
      const { context, page, erreurs } = await ouvrir(navigateur, true);
      const avant = page.url();
      const fenetre = page.locator('[data-visionneuse-de-lien]');

      /* 1. LE CAS DE LA CAPTURE : un lien de pièce jointe SANS attribut de téléchargement. */
      const retenu = await cliquerUnLien(page, { href: adresse });
      noter('installée : un lien de pièce jointe ne navigue plus', retenu === true && page.url() === avant);
      await page.locator('[data-visionneuse-de-lien="image"]').waitFor({ timeout: 15_000 }).catch(() => {});
      noter('installée : la fenêtre s’ouvre sur l’image', (await page.locator('[data-visionneuse-de-lien="image"]').count()) === 1);
      const image = fenetre.locator('img').first();
      await page.waitForFunction(() => {
        const img = document.querySelector('[data-visionneuse-de-lien] img');
        return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
      }, null, { timeout: 10_000 }).catch(() => {});
      noter(
        'installée : l’image s’y voit vraiment',
        (await image.count()) === 1 && (await image.evaluate((img) => img.naturalWidth)) > 0,
      );
      noter(
        'installée : la fenêtre porte le vrai nom du fichier et son bouton « Enregistrer »',
        (await fenetre.innerText()).includes(NOM) && (await fenetre.locator('[data-visionneuse-enregistrer]').count()) === 1,
      );
      await page.keyboard.press('Escape');
      await fenetre.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
      noter(
        'installée : Échap referme la fenêtre, et l’application est toujours là',
        (await fenetre.count()) === 0 && page.url() === avant && (await page.locator('#root > *').count()) > 0,
      );

      /* 2. UN AUTRE SITE n'est pas retenu : le système lui donne sa propre fenêtre. */
      const dehors = await cliquerUnLien(page, { href: 'https://exemple.invalid/page', target: '_blank' });
      noter('installée : un lien vers un autre site n’est pas retenu', dehors === false && (await fenetre.count()) === 0);
      const ecran = await cliquerUnLien(page, { href: '#projet/p-essai' });
      noter('installée : changer d’écran reste une navigation ordinaire', ecran === false);

      /* 3. LE BOUTON « TÉLÉCHARGER » D'UN APERÇU DÉJÀ OUVERT enregistre, sans seconde fenêtre. */
      const telechargement = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
      const direct = await cliquerUnLien(page, { href: adresse, download: NOM, 'data-enregistrer-direct': '' });
      const recu = await telechargement;
      noter(
        'installée : « télécharger » depuis un aperçu enregistre le fichier sous son nom, sans rouvrir de fenêtre',
        direct === true && recu?.suggestedFilename() === NOM && (await fenetre.count()) === 0,
        recu ? recu.suggestedFilename() : 'aucun fichier reçu',
      );
      /* 4. UN GESTE SANS LIEN (un bouton « Télécharger » qui demande d'abord un jeton,
         le PDF Marketing de la capture #7436) passe par `ouvrirFichierSurPlace`, qui
         prévient la visionneuse : la fenêtre s'ouvre, la page ne bouge pas. */
      await page.evaluate((a) => window.dispatchEvent(new CustomEvent('beluga:ouvrir-sur-place', { detail: { adresse: new URL(a, location.origin).href } })), adresse);
      await page.locator('[data-visionneuse-de-lien="image"]').waitFor({ timeout: 15_000 }).catch(() => {});
      noter('installée : un geste sans lien ouvre aussi la fenêtre refermable, la page ne bouge pas', (await fenetre.count()) === 1 && page.url() === avant);
      await page.keyboard.press('Escape');
      await fenetre.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
      noter('installée : elle se referme, l’application est toujours là', (await fenetre.count()) === 0 && (await page.locator('#root > *').count()) > 0);
      noter('installée : aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
      await context.close();
    }

    /* ---------------- 4. Le navigateur ordinaire ---------------- */
    {
      const { context, page } = await ouvrir(navigateur, false);
      const retenu = await cliquerUnLien(page, { href: adresse });
      noter(
        'navigateur ordinaire : le lien garde son comportement, aucune fenêtre ne s’ouvre',
        retenu === false && (await page.locator('[data-visionneuse-de-lien]').count()) === 0,
      );
      await context.close();
    }
  } finally {
    await navigateur.close().catch(() => {});
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
