#!/usr/bin/env node
/**
 * UNE ADRESSE PROPRE À CHAQUE ÉCRAN, VÉRIFIÉE DANS UN VRAI NAVIGATEUR.
 *
 * Les RÈGLES d'adresse (construire, relire, comparer, retomber proprement) sont
 * déjà verrouillées sans navigateur par `server/src/test/adresse-navigateur.test.ts`
 * — c'est là que se prouvent les formes, les aller-retours et les liens de
 * courriel figés. Ce contrôle-ci prouve l'autre moitié, celle qu'aucune
 * relecture ne peut tenir :
 *
 *  1. chacune des destinations de la grille des services CHANGE l'adresse quand
 *     on l'ouvre — c'était le trou : cinq services sur huit n'y laissaient rien ;
 *  2. RECHARGER ramène exactement au même endroit, au lieu de l'écran de départ ;
 *  3. le bouton PRÉCÉDENT ramène à l'écran d'avant, en UN seul appui — donc
 *     l'historique n'est pas encombré d'entrées inutiles ;
 *  4. une adresse qui vise un élément DISPARU ouvre l'écran parent, jamais un
 *     écran vide.
 *
 * Il fabrique une session d'une heure, la retire en partant, et n'écrit rien
 * d'autre en base. Il vise le serveur de DÉVELOPPEMENT par une variable à lui :
 * `BELUGA_URL` désigne l'application PUBLIÉE et n'a rien à faire ici.
 *
 *   npm run dev --workspace web -- --port 7099
 *   env -u BELUGA_TOKEN HAIKO_ADRESSES_URL=http://localhost:7099 node scripts/verif-adresses.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

/* La racine se déduit du script : lancé d'une copie de travail, il juge CE
   code-là, jamais le dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADRESSE = process.env.HAIKO_ADRESSES_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL, même quand
   ce script est lancé d'une copie de travail. */
const DONNEES = process.env.BELUGA_DATA || '/root/beluga/data';

const { VUES_CENTRALES } = await import(path.join(RACINE, 'shared/dist/vue-centrale.js'));

const echecs = [];
const constats = [];
const refuser = (message) => echecs.push(message);
const constater = (message) => constats.push(message);

/**
 * LE MOT ATTENDU DANS L'ADRESSE pour chaque destination de la grille des
 * services. Il ne se recopie pas : on le demande aux règles partagées,
 * exactement comme l'application. « projet » est à part — son adresse porte un
 * identifiant, elle ne se devine pas depuis la grille — et « en-route » aussi :
 * les tableaux de bord ne sont pas un service, ils n'ont pas de tuile.
 */
const { construireFragment } = await import(path.join(RACINE, 'shared/dist/adresse-navigateur.js'));
const MOT_DE_LA_DESTINATION = {
  'tableau-de-bord': construireFragment({ vue: 'tableau-de-bord' }),
  notes: construireFragment({ vue: 'notes' }),
  coffre: construireFragment({ vue: 'coffre' }),
  memoire: construireFragment({ vue: 'memoire' }),
  'espace-client': construireFragment({ vue: 'espace' }),
  backups: construireFragment({ vue: 'backups' }),
  surveillance: construireFragment({ vue: 'surveillance' }),
  marketing: construireFragment({ vue: 'marketing' }),
  studio: construireFragment({ vue: 'studio' }),
  statistiques: construireFragment({ vue: 'statistiques' }),
};

/**
 * Les vues centrales qui ne sont PAS des tuiles de la grille des services.
 * Leur adresse — et celle de la CARTE qu'on y ouvre — se prouve dans
 * `verif-adresses-des-cartes.mjs`, sur un démon d'essai.
 */
const HORS_DE_LA_GRILLE = new Set(['projet', 'en-route']);

/* UNE VUE QUI N'A PAS DE SCÉNARIO FAIT ÉCHOUER LE CONTRÔLE : ajouter une
   destination sans dire où s'écrit son adresse, c'est reproduire le trou. */
for (const vue of VUES_CENTRALES) {
  if (!HORS_DE_LA_GRILLE.has(vue) && !(vue in MOT_DE_LA_DESTINATION)) {
    refuser(`la vue « ${vue} » n'a aucun scénario d'adresse dans ce contrôle`);
  }
}

/**
 * Une session d'UNE HEURE, fabriquée puis retirée : la colonne `token` garde le
 * SHA-256 du cookie, jamais le cookie. C'est la seule écriture en base de tout
 * ce contrôle, et elle est défaite en partant.
 */
async function avecSession(travail) {
  const { default: crypto } = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ouvrir = () =>
    require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie(DONNEES));

  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrir();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification des adresses',
  );
  db.close();
  try {
    return await travail(cookie);
  } finally {
    const fin = ouvrir();
    fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    fin.close();
  }
}

/** Le fragment courant, sans son « # ». */
const fragment = (page) => page.evaluate(() => window.location.hash.replace(/^#/, ''));

/**
 * L'ADRESSE UNE FOIS POSÉE. Un service qui ouvre d'office son premier élément
 * l'écrit à la suite de son mot dès que ses données arrivent — la mémoire et sa
 * première fiche : « #memoire », puis « #memoire/fiche/00_principles ». Lire le
 * fragment au vol jugeait donc tantôt l'un, tantôt l'autre, selon la vitesse du
 * chargement. On attend qu'il ne bouge plus, et c'est CETTE adresse-là qu'un
 * rechargement doit rendre, au signe près.
 */
async function adressePosee(page, { calme = 800, limite = 10_000 } = {}) {
  let vu = await fragment(page);
  let depuis = Date.now();
  const fin = Date.now() + limite;
  while (Date.now() < fin && Date.now() - depuis < calme) {
    await page.waitForTimeout(100);
    const maintenant = await fragment(page);
    if (maintenant !== vu) {
      vu = maintenant;
      depuis = Date.now();
    }
  }
  return vu;
}

/** Cette adresse est-elle bien celle de la destination — son mot, ou un élément sous lui ? */
const dansLaDestination = (adresse, mot) => adresse === mot || adresse.startsWith(`${mot}/`);

/** ON ATTEND UN ÉTAT, PAS UNE DURÉE : le serveur de développement compile à la demande. */
async function attendreLApplication(page) {
  try {
    /* Le bouton des services, dans la barre d'en-tête : sa grille n'est dans
       le document qu'ouverte, c'est donc lui qui dit que l'application est là. */
    await page.waitForSelector('[data-entete-de-zone] [data-navigation-compacte]', { state: 'attached', timeout: 60_000 });
  } catch {
    const vu = await page.locator('body').innerText().catch(() => '(illisible)');
    throw new Error(`l'application ne s'est pas affichée — écran : « ${vu.slice(0, 200)} »`);
  }
}

/**
 * LES DESTINATIONS VIVENT DANS LA GRILLE DES SERVICES, ouverte par le bouton à
 * gauche du fil d'Ariane (`[data-navigation-compacte]`). L'ouvrir est un geste
 * d'affichage, pas une destination : elle n'a pas d'adresse, et elle se referme
 * dès qu'on choisit. Il faut donc la rouvrir avant chaque choix — une fois
 * qu'elle a fini de s'effacer : un clic pendant ce temps ne la rouvre pas.
 */
async function ouvrirLaNavigation(page) {
  if (await page.locator('[data-navigation-panneau="ouvert"]').count()) return;
  await page.locator('[data-navigation-panneau]').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
  await page.locator('[data-entete-de-zone] [data-navigation-compacte]:visible').last().click();
  await page.waitForSelector('[data-navigation-panneau="ouvert"]', { timeout: 10_000 });
}

/** Ouvre une destination de la grille, grille ouverte comprise. */
async function ouvrirLaDestination(page, vue) {
  await ouvrirLaNavigation(page);
  await page.locator(`[data-destination="${vue}"]`).first().click();
}

async function parcourir(page) {
  await attendreLApplication(page);

  /* ---------- 1. Chaque destination inscrit son adresse ---------- */
  const visitees = [];
  for (const vue of VUES_CENTRALES) {
    if (HORS_DE_LA_GRILLE.has(vue)) continue;
    await ouvrirLaNavigation(page);
    if (!(await page.locator(`[data-destination="${vue}"]`).count())) {
      refuser(`la destination « ${vue} » n'a aucune tuile dans la grille des services`);
      continue;
    }
    await ouvrirLaDestination(page, vue);
    const mot = MOT_DE_LA_DESTINATION[vue];
    await page
      .waitForFunction(
        (cible) => {
          const ici = window.location.hash.replace(/^#/, '');
          return ici === cible || ici.startsWith(`${cible}/`);
        },
        mot,
        { timeout: 10_000 },
      )
      .catch(() => undefined);
    const attendu = await adressePosee(page);
    if (!dansLaDestination(attendu, mot)) {
      refuser(`ouvrir « ${vue} » laisse l'adresse sur « ${attendu || '(vide)'} » au lieu de « ${mot} »`);
      continue;
    }
    visitees.push({ vue, attendu });

    /* ---------- 2. Recharger ramène au même endroit ---------- */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await attendreLApplication(page);
    const apres = await adressePosee(page);
    if (apres !== attendu) {
      refuser(`recharger sur « ${vue} » ramène à « ${apres || '(vide)'} » au lieu de « ${attendu} »`);
      continue;
    }
    /* L'ÉCRAN, PAS SEULEMENT L'ADRESSE : le bouton des services porte l'icône
       et le nom du service ouvert (`data-service-ouvert`), et sa tuile est
       marquée dans la grille (`aria-current`) — c'est la preuve que l'écran a
       suivi l'adresse. La tuile ne se lit que grille ouverte : on la laisse
       ouverte, le tour suivant y choisit. */
    const libelle = await page
      .locator('[data-entete-de-zone] [data-navigation-compacte]:visible')
      .last()
      .getAttribute('data-service-ouvert');
    await ouvrirLaNavigation(page);
    const surLEcran =
      (await page.locator(`[data-destination="${vue}"]`).first().getAttribute('aria-current')) === 'page';
    if (!surLEcran || libelle !== vue) {
      refuser(`après rechargement, « ${vue} » n'est pas la destination affichée (bouton des services : « ${libelle} »)`);
    } else {
      constater(`« ${vue} » : adresse « #${attendu} », retrouvée après rechargement`);
    }
  }

  /* ---------- 3. Le bouton Précédent, en UN appui ---------- */
  if (visitees.length >= 2) {
    /* On repart d'un parcours propre : deux destinations à la suite, sans
       rechargement entre les deux (un rechargement remplace l'entrée courante). */
    const [premiere, seconde] = visitees.slice(-2);
    await ouvrirLaDestination(page, premiere.vue);
    await page.waitForFunction((mot) => window.location.hash.replace(/^#/, '') === mot, premiere.attendu, {
      timeout: 10_000,
    });
    await adressePosee(page);
    await ouvrirLaDestination(page, seconde.vue);
    await page.waitForFunction((mot) => window.location.hash.replace(/^#/, '') === mot, seconde.attendu, {
      timeout: 10_000,
    });
    await adressePosee(page);
    await page.goBack();
    await page.waitForTimeout(400);
    const revenu = await fragment(page);
    if (revenu === premiere.attendu) {
      constater('un seul appui sur Précédent ramène à l’écran d’avant');
    } else {
      refuser(
        `Précédent ramène à « ${revenu || '(vide)'} » au lieu de « ${premiere.attendu} » : l'historique est encombré`,
      );
    }
  } else {
    refuser('moins de deux destinations visitées : le retour en arrière n’a pas pu être jugé');
  }

  /* ---------- 4. Un ÉLÉMENT ouvert a sa propre adresse, partageable ---------- */
  await ouvrirLaDestination(page, 'coffre');
  await page.waitForSelector('[data-coffre-acces]', { timeout: 20_000 }).catch(() => undefined);
  const fiches = page.locator('[data-coffre-acces]');
  if (await fiches.count()) {
    const id = await fiches.first().getAttribute('data-coffre-acces');
    await fiches.first().click();
    await page
      .waitForFunction((cible) => window.location.hash.replace(/^#/, '') === cible, `coffre/${id}`, {
        timeout: 10_000,
      })
      .catch(() => undefined);
    const vu = await fragment(page);
    if (vu !== `coffre/${id}`) {
      refuser(`ouvrir une fiche du coffre laisse l'adresse sur « ${vu || '(vide)'} »`);
    } else {
      /* L'ADRESSE SE PARTAGE : on la rouvre dans un ONGLET NEUF, et la fiche
         doit s'y retrouver avec son écran parent autour. */
      const neuf = await page.context().newPage();
      await neuf.goto(`${ADRESSE}/#${vu}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await neuf.waitForSelector('[data-coffre-nom]', { timeout: 30_000 }).catch(() => undefined);
      const rouverte = await neuf.locator('[data-coffre-nom]').count();
      const autour = await neuf.locator('[data-coffre-liste]').count();
      await neuf.close();
      if (rouverte && autour) {
        constater('l’adresse d’une fiche rouvre la fiche ET son écran parent dans un onglet neuf');
      } else {
        refuser('l’adresse d’une fiche ne rouvre pas la fiche avec son écran parent');
      }
    }
    /* On referme la fiche : l'adresse doit redevenir celle du coffre nu. */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  } else {
    constater('aucune fiche dans le coffre : l’adresse d’un élément n’a pas pu être jugée ici');
  }

  /* ---------- 5. Un élément disparu ouvre l'écran parent ---------- */
  await page.evaluate(() => {
    window.location.hash = 'coffre/fiche-qui-n-existe-pas';
  });
  await page.waitForTimeout(1500);
  const parent = await fragment(page);
  const surLeCoffre = parent.startsWith('coffre');
  /* L'écran parent est bien celui du coffre : le bouton des services le dit
     (la tuile, elle, n'est dans le document que grille ouverte). */
  const vide = await page.locator('[data-entete-de-zone] [data-navigation-compacte][data-service-ouvert="coffre"]').count();
  if (surLeCoffre && vide) {
    constater('une adresse qui vise un élément disparu reste sur son écran parent');
  } else {
    refuser(`une fiche inexistante laisse l'adresse sur « ${parent || '(vide)'} » au lieu du coffre`);
  }
}

async function auNavigateur() {
  const { chromium } = await import('playwright');
  try {
    return await avecSession(async (session) => {
      const navigateur = await chromium.launch({ channel: 'chrome' });
      const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
      await contexte.addCookies([
        { name: 'beluga_session', value: session, domain: 'localhost', path: '/' },
      ]);
      const page = await contexte.newPage();
      try {
        await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      } catch (err) {
        await navigateur.close();
        return `serveur de développement injoignable sur ${ADRESSE} — ${err.message.split('\n')[0]}`;
      }
      try {
        await parcourir(page);
      } finally {
        await navigateur.close();
      }
      return null;
    });
  } catch (err) {
    return `session d'essai impossible — ${err.message.split('\n')[0]}`;
  }
}

const empeche = await auNavigateur();

console.log('\n— Adresses propres à chaque écran —\n');
for (const ligne of constats) console.log(`  ✓ ${ligne}`);
if (empeche) {
  /* UN CONTRÔLE QUI N'A PAS PU TOURNER NE SE DÉCLARE PAS RÉUSSI. */
  console.error(`\n  ✗ ${empeche}\n`);
  process.exit(1);
}
if (echecs.length) {
  console.error('');
  for (const ligne of echecs) console.error(`  ✗ ${ligne}`);
  console.error(`\n${echecs.length} refus.\n`);
  process.exit(1);
}
console.log(`\n${constats.length} vérifications passées.\n`);
