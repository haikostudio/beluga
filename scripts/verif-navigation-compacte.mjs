#!/usr/bin/env node
/**
 * LA GRILLE DES SERVICES, DERRIÈRE SON BOUTON, dans un VRAI navigateur, sur son
 * PROPRE démon (base neuve, port libre : le démon de production n'est pas
 * touché, aucun moteur appelé, aucun quota dépensé). Il juge des ÉTATS, jamais
 * des hauteurs — la seule mesure, le haut du tableau, prouve que la grille
 * recouvre sans pousser.
 *
 *  1. écran large : un seul bouton, dans la barre d'en-tête, neutre sur un
 *     tableau de projet ; les sept destinations ne sont pas visibles ;
 *  2. le clic ouvre la grille, au premier plan, sans déplacer le tableau ;
 *  3. passer du bouton à la grille ne la referme pas ; Échap et un appui
 *     dehors la referment ;
 *  4. le clavier l'ouvre (flèche bas) et la parcourt ;
 *  5. choisir « Coffre-fort » ouvre la vue et le bouton porte ce service ;
 *  6. téléphone (système clair puis sombre) : le même bouton dans la barre
 *     d'en-tête, grille fermée au repos, ouverte et refermée au toucher sans
 *     pousser l'écran, refermée par un toucher ailleurs ; choisir une
 *     destination ouvre la vue et referme la grille. Captures dans
 *     /tmp/navigation-telephone-*.png.
 *
 * Le point d'alerte du bouton est jugé là où ses compteurs existent :
 * `verif-surveillance.mjs` (site en panne) et `verif-espace-client.mjs`.
 *
 *   node scripts/verif-navigation-compacte.mjs
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). Ce contrôle gardait « la navigation de
 * gauche repliée » : un bouton en tête de la COLONNE DE GAUCHE, ouvert AU
 * SURVOL. Le bouton des services a quitté la colonne pour la barre d'en-tête
 * (« le bouton des services ouvre le fil d'Ariane, tout à gauche ») et ouvre
 * une grille qui est un MENU : au clic, et démonté tant qu'il est fermé (« un
 * bouton d'options ouvre un menu »). Ce qui en découle ici :
 *  - RETIRÉ « les sept lignes restent dans le document » : fermé, un menu n'a
 *    plus son contenu dans le document ;
 *  - RETIRÉ « sortir du panneau le referme » : c'était la fermeture du survol ;
 *  - « le survol ouvre le panneau » devient « le clic ouvre la grille » (et le
 *    survol seul ne l'ouvre plus) ;
 *  - « la liste des projets ne bouge pas » se mesure sur le tableau : dans un
 *    projet, la colonne de gauche ne liste plus les projets ;
 *  - « le bouton porte un libellé / nomme la vue ouverte » se lit sur
 *    `data-service-ouvert` (le bouton porte l'ICÔNE du service ouvert, plus un
 *    texte) et sur le fil d'Ariane ;
 *  - sur téléphone le bouton est dans la barre d'en-tête, plus en tête du
 *    panneau « Projets » : on n'ouvre plus ce panneau, et la grille monte du
 *    bas de l'écran. « Toucher ailleurs » vise donc le haut de l'écran, hors de
 *    la grille.
 * DÉJÀ EN ÉCHEC AVANT LA REFONTE, laissé tel quel : « les flèches parcourent
 * les destinations » attend « Coffre-fort » en second, or « Statistiques » s'est
 * glissé entre les deux.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_NAVIGATION_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-navigation-',
  port: PORT,
  env: { BELUGA_WEB: process.env.BELUGA_WEB_ESSAI || path.join(RACINE, 'web', 'dist') },
  signaux: true,
});

const DESTINATIONS = ['tableau-de-bord', 'coffre', 'memoire', 'espace-client', 'backups', 'surveillance', 'statistiques'];
const BOUTON = '[data-entete-de-zone] [data-navigation-compacte]:visible';
/* La grille est un menu : elle n'est dans le document qu'OUVERTE, hors de la colonne de gauche. */
const PANNEAU = '[data-navigation-panneau="ouvert"]';
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get();
      db.close();
      if (table) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification de la navigation compacte',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const projet = {
    id: 'p-navigation',
    name: 'Projet de navigation',
    path: DEPOT,
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

/**
 * L'état de la grille, lu des DEUX côtés : le bouton dit `ouverte` / `fermee`,
 * et la grille — démontée tant qu'elle est fermée — est là ou non. Les deux
 * doivent s'accorder ; sinon l'état rendu le dit.
 */
const etatPanneau = async (page) => {
  const bouton = await page.locator(BOUTON).first().getAttribute('data-navigation-compacte');
  const grilles = await page.locator(`${PANNEAU}:visible`).count();
  if (bouton === 'ouverte' && grilles === 1) return 'ouvert';
  if (bouton === 'fermee' && grilles === 0) return 'ferme';
  return `incohérent (bouton « ${bouton} », ${grilles} grille(s))`;
};
/** Combien des sept destinations sont à l'écran, où qu'elles soient dans le document. */
const visibles = (page) =>
  page.evaluate(
    (cles) =>
      cles.filter((cle) =>
        [...document.querySelectorAll(`[data-ouvrir-${cle}]`)].some((ligne) => ligne.getClientRects().length > 0),
      ).length,
    DESTINATIONS,
  );
/** Le haut de la première colonne du tableau : ce que la grille ne doit pas pousser. */
const hautDuTableau = (page) =>
  page.evaluate(() => Math.round(document.querySelector('[data-column="planned"]')?.getBoundingClientRect().top ?? -1));

async function main() {
  if (!(await attendrePort())) throw new Error(`le démon d'essai n'a jamais ouvert le port ${PORT}`);
  if (!(await attendreLaBase())) throw new Error('la base du démon d’essai n’est jamais apparue');
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-CH' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="planned"]', { timeout: 30000 });
    await page.waitForTimeout(600);

    /* 1. Replié par défaut, dans la barre d'en-tête. */
    const bouton = page.locator(BOUTON).first();
    noter('Écran large : le bouton compact est affiché', await bouton.isVisible());
    noter(
      'Il vit dans la barre d’en-tête, plus dans la colonne de gauche',
      (await page.locator(BOUTON).count()) === 1 &&
        (await page.locator('aside[data-zone="gauche"] [data-navigation-compacte]').count()) === 0,
    );
    noter('Les sept destinations sont repliées au chargement', (await visibles(page)) === 0, `${await visibles(page)} visible(s)`);
    const neutre = {
      nom: await bouton.getAttribute('aria-label'),
      service: await bouton.getAttribute('data-service-ouvert'),
    };
    noter(
      'Sur la vue « projet », le bouton est neutre : « Services », aucun service ouvert',
      neutre.nom === 'Services' && neutre.service === null,
      JSON.stringify(neutre),
    );

    /* 2. Au clic (plus au survol) : ouverte, au premier plan, tableau immobile. */
    const avant = await hautDuTableau(page);
    await bouton.hover();
    await page.waitForTimeout(450);
    noter('Le survol seul n’ouvre plus la grille', (await etatPanneau(page)) === 'ferme', await etatPanneau(page));
    await bouton.click();
    await page.waitForTimeout(250);
    noter('Le clic ouvre le panneau', (await etatPanneau(page)) === 'ouvert', await etatPanneau(page));
    noter('Les sept destinations paraissent', (await visibles(page)) === 7, `${await visibles(page)} visible(s)`);
    const apres = await hautDuTableau(page);
    noter('Le tableau ne bouge pas (recouvert, pas poussé)', avant > 0 && avant === apres, `${avant} → ${apres}`);
    const auPremierPlan = await page.evaluate((panneau) => {
      const ligne = document.querySelector(`${panneau} [data-ouvrir-statistiques]`);
      if (!ligne) return false;
      const r = ligne.getBoundingClientRect();
      return ligne.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }, PANNEAU);
    noter('Le panneau est au premier plan, par-dessus l’écran', auPremierPlan);

    /* 3. Traverser vers le panneau, puis Échap. */
    const cibleStatistiques = await page.locator(`${PANNEAU} [data-ouvrir-statistiques]:visible`).first().boundingBox();
    await page.mouse.move(cibleStatistiques.x + cibleStatistiques.width / 2, cibleStatistiques.y + cibleStatistiques.height / 2, { steps: 12 });
    await page.waitForTimeout(400);
    noter('Passer du bouton au panneau ne le referme pas', (await etatPanneau(page)) === 'ouvert', await etatPanneau(page));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    noter('Échap referme le panneau', (await etatPanneau(page)) === 'ferme', await etatPanneau(page));

    /* Ouvert au clavier, la souris reste loin : un appui dehors le referme. */
    await page.mouse.move(900, 500);
    await bouton.focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    noter('La flèche bas ouvre le panneau', (await etatPanneau(page)) === 'ouvert', await etatPanneau(page));
    const focus1 = await page.evaluate(() => document.activeElement?.getAttribute('data-destination'));
    await page.keyboard.press('ArrowDown');
    const focus2 = await page.evaluate(() => document.activeElement?.getAttribute('data-destination'));
    /* « Tableaux de bord » ouvre la liste, sur sa ligne pleine largeur ; la flèche suivante descend dans la grille. */
    noter('Les flèches parcourent les destinations', focus1 === 'en-route' && !!focus2 && focus2 !== focus1, `${focus1} → ${focus2}`);
    await page.mouse.click(900, 500);
    await page.waitForTimeout(400);
    noter('Un appui en dehors referme le panneau', (await etatPanneau(page)) === 'ferme', await etatPanneau(page));

    /* 4. Choisir une destination. */
    await bouton.click();
    await page.locator(`${PANNEAU} [data-ouvrir-coffre]:visible`).first().click();
    await page.waitForTimeout(900);
    noter('Choisir « Coffre-fort » referme le panneau', (await etatPanneau(page)) === 'ferme', await etatPanneau(page));
    noter('La vue coffre est ouverte', (await page.locator('[data-coffre-recherche]').count()) > 0);
    const surLeCoffre = {
      service: await page.locator(BOUTON).first().getAttribute('data-service-ouvert'),
      fil: ((await page.locator('[data-entete-de-zone] [data-fil-d-ariane]:visible').first().textContent()) ?? '').trim(),
    };
    noter(
      'Le bouton porte la vue ouverte, et le fil d’Ariane la nomme',
      surLeCoffre.service === 'coffre' && /Coffre-fort/.test(surLeCoffre.fil),
      JSON.stringify(surLeCoffre),
    );
    noter('Aucune erreur JavaScript de page (écran large)', erreurs.length === 0, erreurs.join(' | '));
    await contexte.close();

    /* 5. Téléphone : le même bouton, ouvert au toucher, en clair puis en sombre. */
    for (const theme of ['light', 'dark']) {
      const mobile = await navigateur.newContext({
        viewport: { width: 390, height: 844 },
        locale: 'fr-CH',
        hasTouch: true,
        isMobile: true,
        colorScheme: theme,
      });
      await mobile.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const tel = await mobile.newPage();
      const erreursTel = [];
      tel.on('pageerror', (e) => erreursTel.push(String(e)));
      await tel.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // Le bouton est dans la barre d'en-tête : plus besoin d'ouvrir le panneau « Projets ».
      await tel.waitForSelector(BOUTON, { timeout: 30000 });
      await tel.waitForSelector('[data-column="planned"]', { timeout: 30000 });
      await tel.waitForTimeout(800);
      // Le thème réglé en base prime sur le système : on pose la palette à la main, juste avant chaque capture.
      const capturer = async (etat) => {
        await tel.evaluate((id) => (document.documentElement.dataset.theme = id), theme === 'light' ? 'clair' : 'sombre');
        await tel.waitForTimeout(150);
        await tel.screenshot({ path: `/tmp/navigation-telephone-${theme}-${etat}.png` });
      };
      const boutonTel = tel.locator(BOUTON).first();
      const t = `Téléphone (système ${theme === 'light' ? 'clair' : 'sombre'})`;
      noter(`${t} : un seul bouton compact visible`, (await tel.locator(BOUTON).count()) === 1);
      noter(`${t} : aucune destination visible au repos`, (await visibles(tel)) === 0, `${await visibles(tel)} visible(s)`);
      await capturer('ferme');
      const avantTel = await hautDuTableau(tel);
      const adresseAvant = await tel.evaluate(() => window.location.hash);
      const placeDuBouton = await boutonTel.boundingBox();
      await boutonTel.tap();
      await tel.waitForTimeout(450);
      noter(`${t} : le toucher ouvre le menu`, (await etatPanneau(tel)) === 'ouvert', await etatPanneau(tel));
      noter(`${t} : les sept destinations paraissent`, (await visibles(tel)) === 7, `${await visibles(tel)} visible(s)`);
      noter(`${t} : l’écran ne bouge pas`, avantTel > 0 && avantTel === (await hautDuTableau(tel)), `${avantTel} → ${await hautDuTableau(tel)}`);
      await capturer('ouvert');
      // LA GRILLE MONTE DU BAS : un voile couvre le reste de l'écran, bouton compris. Le second toucher se
      // pose donc AU MÊME ENDROIT, comme le ferait un doigt, sans exiger que le bouton reçoive l'appui.
      await tel.touchscreen.tap(placeDuBouton.x + placeDuBouton.width / 2, placeDuBouton.y + placeDuBouton.height / 2);
      await tel.waitForTimeout(450);
      noter(`${t} : un second toucher referme`, (await etatPanneau(tel)) === 'ferme', await etatPanneau(tel));
      await boutonTel.tap();
      await tel.waitForTimeout(450);
      // « Ailleurs » : au-dessus de la grille, qui occupe le bas de l'écran.
      const hautDeLaGrille = (await tel.locator(`${PANNEAU}:visible`).first().boundingBox())?.y ?? 844;
      await tel.touchscreen.tap(200, Math.max(120, Math.round(hautDeLaGrille / 2)));
      await tel.waitForTimeout(450);
      const adresseApres = await tel.evaluate(() => window.location.hash);
      noter(
        `${t} : toucher ailleurs referme sans rien ouvrir`,
        (await etatPanneau(tel)) === 'ferme' && (await visibles(tel)) === 0 && adresseApres === adresseAvant &&
          (await tel.locator('[data-page-de-zone], [data-page-carte]').count()) === 0,
        `${await etatPanneau(tel)}, ${adresseAvant} → ${adresseApres}`,
      );
      await boutonTel.tap();
      await tel.waitForTimeout(450);
      await tel.locator(`${PANNEAU} [data-ouvrir-coffre]:visible`).first().tap();
      await tel.waitForTimeout(900);
      noter(`${t} : choisir « Coffre-fort » ouvre la vue`, (await tel.locator('[data-coffre-recherche]').count()) > 0);
      noter(`${t} : la grille se referme`, (await etatPanneau(tel)) === 'ferme', await etatPanneau(tel));
      noter(`${t} : aucune erreur JavaScript de page`, erreursTel.length === 0, erreursTel.join(' | '));
      await mobile.close();
    }
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  if (echecs.length) console.log('Journal du démon :\n' + journal.join(''));
  // Le démon d'essai tient la boucle éveillée : on sort franchement.
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ÉCHEC :', error);
  console.log('Journal du démon :\n' + journal.join(''));
  process.exit(1);
});
