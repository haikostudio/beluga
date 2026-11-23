#!/usr/bin/env node
/**
 * LA DEMANDE SE COPIE EN UN CLIC, IMAGES COMPRISES.
 *
 * Le bloc « Votre demande » d'une carte porte un bouton en haut à droite. Un
 * clic doit écrire DEUX représentations dans le presse-papiers : `text/plain`
 * pour un éditeur, `text/html` pour un courriel ou une page de notes — avec,
 * dans la seconde, les images EMBARQUÉES en `data:`.
 *
 * On juge un ÉTAT, jamais une hauteur : le bouton existe, le presse-papiers
 * porte les deux types, et l'image embarquée s'y retrouve quand la demande en
 * portait une. Le presse-papiers se relit par sa vraie API, avec la permission
 * accordée au contexte.
 *
 * Une session d'UNE HEURE est posée en base puis retirée ; rien d'autre n'est
 * écrit. Le serveur de DÉVELOPPEMENT est visé par sa propre variable :
 * `BELUGA_URL` désigne l'application déjà publiée et n'a rien à faire ici.
 *
 *   HAIKO_COPIE_URL=http://localhost:7099 node scripts/verif-copie-demande.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { cheminDeLaBaseServie, depotPrincipal } from './base-servie.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_COPIE_URL || 'http://localhost:7099';
const PRINCIPAL = depotPrincipal();
const FICHIER_BASE = cheminDeLaBaseServie();

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function base() {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(FICHIER_BASE);
}

function poserSession() {
  const db = base();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification copie de la demande',
  );
  db.close();
  return cookie;
}

function retirerSession(cookie) {
  const db = base();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
  );
  db.close();
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  console.log(`Adresse visée : ${BASE}`);
  const cookie = poserSession();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addCookies([
    { name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  page.setDefaultTimeout(15000);

  /* UNE CARTE QUI A DÉJÀ UNE DEMANDE. Toutes n'en portent pas : une carte
     jamais lancée n'a rien dans son journal, et son fil n'a donc aucun bloc de
     demande à copier. On ouvre donc les cartes du tableau l'une après l'autre
     jusqu'à en trouver une qui en porte un. */
  await page.locator('[data-carte]').first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => undefined);
  const cartes = await page.locator('[data-carte]').count();
  if (!cartes) {
    record('une carte à ouvrir', false, 'le projet affiché n’en porte aucune');
    await terminer(browser, cookie);
    return;
  }

  const bouton = page.locator('[data-copier-demande]').first();
  let trouve = false;
  for (let rang = 0; rang < Math.min(cartes, 8) && !trouve; rang += 1) {
    /* LE RAIL DÉFILE : une carte peut être hors de l'écran, et un clic dessus
       part alors dans le vide. On la ramène d'abord dans la fenêtre, puis on
       vise sa zone de texte — le milieu d'une vignette porte des boutons. */
    const vignette = page.locator('[data-carte]').nth(rang);
    await vignette.scrollIntoViewIfNeeded().catch(() => undefined);
    if (!(await vignette.isVisible().catch(() => false))) continue;
    await vignette.click({ timeout: 8000 }).catch(() => undefined);
    /* Le tiroir se remplit : on attend l'ÉTAT « chargé » (sa barre d'étapes),
       jamais un délai fixe. */
    await page.locator('[data-barre-etapes]').first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => undefined);
    /* LE POINT « DEMANDE » PEUT ÊTRE REPLIÉ : ses moments — donc le bloc de la
       demande et son bouton — ne sont dessinés qu'une fois le point ouvert. On
       l'ouvre avant de conclure qu'il n'y a rien à copier. */
    await bouton.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
    if (!(await bouton.count())) {
      const point = page.locator('[data-point="demande"]').first();
      if (await point.count()) {
        await point.scrollIntoViewIfNeeded().catch(() => undefined);
        await point.click({ timeout: 8000 }).catch(() => undefined);
        await bouton.waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
      }
    }
    trouve = (await bouton.count()) > 0;
    if (!trouve) await page.keyboard.press('Escape');
  }

  record('le bloc de demande porte son bouton de copie', trouve, `${cartes} carte(s) au tableau`);
  if (!trouve) {
    await terminer(browser, cookie);
    return;
  }

  await bouton.click();
  await page.waitForFunction(
    () => document.querySelector('[data-copier-demande]')?.getAttribute('data-copier-demande') !== 'encours',
    undefined,
    { timeout: 20000 },
  ).catch(() => undefined);
  record(
    'le bouton dit que la copie est faite',
    (await bouton.getAttribute('data-copier-demande')) === 'fait',
  );

  /* LE PRESSE-PAPIERS LUI-MÊME : les deux types, et rien d'inventé. */
  const contenu = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const types = items.flatMap((item) => item.types);
    const lire = async (type) => {
      const item = items.find((candidat) => candidat.types.includes(type));
      if (!item) return '';
      return (await item.getType(type)).text();
    };
    return { types, texte: await lire('text/plain'), html: await lire('text/html') };
  });

  record('le presse-papiers porte le texte brut', contenu.types.includes('text/plain'));
  record('le presse-papiers porte la version mise en forme', contenu.types.includes('text/html'));
  record('le texte brut n’est pas vide', contenu.texte.trim().length > 0, `${contenu.texte.length} signe(s)`);
  const images = (contenu.html.match(/<img src="data:image\//g) ?? []).length;
  /*
   * LE MARQUEUR DES PIÈCES N'EXISTE QUE S'IL Y EN A : `contenu-journal.tsx` ne
   * pose ce `data-contenu-pieces` qu'autour d'une liste de pièces. Le lire sans
   * l'avoir compté faisait attendre quinze secondes puis TOMBER le contrôle sur
   * une demande en texte seul — le cas le plus courant.
   */
  const marqueur = page.locator('[data-contenu-pieces]');
  const pieces = (await marqueur.count())
    ? await marqueur.first().getAttribute('data-contenu-pieces')
    : null;
  if (pieces && Number(pieces) > 0) {
    record('les images de la demande sont embarquées en data:', images > 0, `${images} image(s) pour ${pieces} pièce(s)`);
  } else {
    record('demande sans pièce jointe : rien à embarquer', true, 'la version mise en forme porte le texte seul');
  }
  record('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await terminer(browser, cookie);
}

async function terminer(browser, cookie) {
  await browser.close();
  retirerSession(cookie);
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  if (echecs.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
