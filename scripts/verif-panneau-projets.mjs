#!/usr/bin/env node
/**
 * Vérification au doigt du panneau latéral des projets, sur un écran de
 * téléphone : ouverture depuis le bouton en haut à gauche, choix d'un projet
 * qui referme, fermeture par le voile, et fermeture en tirant vers la gauche.
 *
 * Se lance contre le serveur de développement (vite), avec une session posée
 * dans la base juste pour l'essai :
 *   HAIKODEV_TOKEN=… node scripts/verif-panneau-projets.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.HAIKODEV_URL || 'http://127.0.0.1:7099';
const TOKEN = process.env.HAIKODEV_TOKEN;
const SHOTS = '/root/haikodev/data/verification';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const panneau = (page) => page.locator('[role="dialog"][aria-label="Projets"]');

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  // Un vrai téléphone : petit écran, doigt, densité de pixels.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    // On essaie la version en cours d'écriture : le service worker, lui, sert
    // la version publiée et masquerait le changement.
    serviceWorkers: 'block',
  });
  const origine = new URL(BASE).origin;
  if (TOKEN) {
    await context.addCookies([
      { name: 'haikodev_session', value: TOKEN, url: origine, httpOnly: true, sameSite: 'Lax' },
    ]);
  }

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  /* ---------- 1. La barre du bas n'a plus que deux boutons ---------- */
  const bas = page.locator('nav').last();
  const libelles = (await bas.innerText()).split('\n').map((t) => t.trim()).filter(Boolean);
  record(
    'Barre du bas : deux boutons seulement, Tableau et Chef',
    libelles.length === 2 && libelles.includes('Tableau') && libelles.includes('Chef'),
    libelles.join(' · '),
  );

  // Chacun occupe bien la moitié de la largeur.
  const largeurs = await bas.locator('button').evaluateAll((n) => n.map((b) => b.getBoundingClientRect().width));
  const moitie = largeurs.length === 2 && Math.abs(largeurs[0] - largeurs[1]) < 2 && largeurs[0] > 150;
  record('Barre du bas : les deux boutons se partagent la largeur', moitie, largeurs.map((l) => Math.round(l)).join(' + '));

  /* ---------- 2. Le bouton est en haut à GAUCHE ---------- */
  const bouton = page.locator('header button[aria-label="Projets"]');
  const boite = await bouton.boundingBox();
  record(
    'Le bouton des projets est tout en haut à gauche',
    !!boite && boite.x < 20 && boite.y < 60,
    boite ? `x=${Math.round(boite.x)} y=${Math.round(boite.y)}` : 'absent',
  );

  // L'icône « réseau » a été RETIRÉE de la barre : son information vit
  // désormais dans un simple point posé dans le coin du bouton menu.
  const reseau = await page.locator('header .lucide-network').count();
  record("L'icône de réseau ne prend plus de place dans la barre", reseau === 0, `${reseau} icône(s)`);

  // Le bouton porte une icône hamburger et le même cadre que ceux de droite.
  const hamburger = await bouton.locator('.lucide-menu').count();
  const cadres = await page.evaluate(() => {
    const menu = document.querySelector('header button[aria-label="Projets"]');
    const droite = document.querySelector('header button[aria-label="Menu"]');
    if (!menu || !droite) return null;
    const lire = (el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        bord: s.borderTopWidth + ' ' + s.borderTopColor,
        rayon: s.borderRadius,
        taille: `${Math.round(r.width)}x${Math.round(r.height)}`,
      };
    };
    return { menu: lire(menu), droite: lire(droite) };
  });
  const memeHabillage =
    !!cadres &&
    cadres.menu.bord === cadres.droite.bord &&
    cadres.menu.rayon === cadres.droite.rayon &&
    cadres.menu.taille === cadres.droite.taille;
  record('Le bouton porte une icône hamburger', hamburger === 1);
  record(
    'Le bouton a le MÊME habillage que ceux de droite (cadre, rayon, taille)',
    memeHabillage,
    cadres ? `${cadres.menu.taille} / ${cadres.droite.taille}` : 'boutons introuvables',
  );

  // Le point d'état est DANS le bouton, dans son coin haut droit.
  const point = await bouton.locator('[data-point-etat]').boundingBox();
  const dedans =
    !!point &&
    !!boite &&
    point.x >= boite.x &&
    point.y >= boite.y &&
    point.x + point.width <= boite.x + boite.width + 0.5 &&
    point.y + point.height <= boite.y + boite.height + 0.5 &&
    point.x > boite.x + boite.width / 2 &&
    point.y < boite.y + boite.height / 2;
  record(
    'Un point d’état est posé dans le coin haut droit du bouton, sans déborder',
    dedans,
    point ? `point x=${Math.round(point.x)} y=${Math.round(point.y)}` : 'absent',
  );
  await shot(page, 'panneau-01-barre-du-haut');

  /* ---------- 3. Ouverture au doigt ---------- */
  await bouton.tap();
  await page.waitForTimeout(500);
  const ouvert = await panneau(page).isVisible();
  const largeurPanneau = (await panneau(page).boundingBox())?.width ?? 0;
  record(
    'Un appui ouvre le panneau, qui recouvre une partie de l’écran',
    ouvert && largeurPanneau > 200 && largeurPanneau < 390,
    `${Math.round(largeurPanneau)} px de large`,
  );
  const voile = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('div')).find(
      (d) => getComputedStyle(d).position === 'fixed' && getComputedStyle(d).backgroundColor.includes('rgba(0, 0, 0'),
    );
    return !!el;
  });
  record('Un voile sombre s’étend derrière le panneau', voile);

  const listeVisible = await panneau(page).getByText('Projets', { exact: true }).first().isVisible();
  const nbProjets = await panneau(page).locator('[data-drag-kind="project"]').count();
  record('La liste des projets est celle d’avant, entière', listeVisible && nbProjets > 0, `${nbProjets} projets`);
  await shot(page, 'panneau-02-ouvert');

  /* ---------- 4. Choisir un projet referme ---------- */
  const premier = panneau(page).locator('[data-drag-kind="project"] button').first();
  const nom = (await premier.innerText()).trim();
  await premier.tap();
  await page.waitForTimeout(700);
  record('Choisir un projet referme le panneau', !(await panneau(page).isVisible()), nom.split('\n')[0]);
  await shot(page, 'panneau-03-apres-choix');

  /* ---------- 5. Fermeture par le voile ---------- */
  await bouton.tap();
  await page.waitForTimeout(500);
  await page.touchscreen.tap(370, 700); // à droite du panneau : le voile
  await page.waitForTimeout(600);
  record('Toucher le voile referme le panneau', !(await panneau(page).isVisible()));

  /* ---------- 6. Fermeture en tirant vers la gauche ---------- */
  await bouton.tap();
  await page.waitForTimeout(500);
  const boitePanneau = await panneau(page).boundingBox();
  const xPoignee = boitePanneau.x + boitePanneau.width - 6;
  await page.mouse.move(xPoignee, 500);
  await page.mouse.down();
  await page.mouse.move(xPoignee - 40, 500, { steps: 5 });
  await page.mouse.move(xPoignee - 160, 500, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  record('Tirer la poignée vers la gauche referme le panneau', !(await panneau(page).isVisible()));

  /* ---------- 7. Le tableau reste utilisable ---------- */
  await page.waitForTimeout(300);
  const colonnes = await page.locator('h2').allInnerTexts();
  record('Le tableau est bien là derrière', colonnes.length > 0, colonnes.slice(0, 3).join(' · '));
  await shot(page, 'panneau-04-tableau');

  record('Aucune erreur du navigateur', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await browser.close();

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} vérifications passées.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
