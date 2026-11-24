#!/usr/bin/env node
/**
 * UNE ADRESSE POUR CHAQUE TIROIR, VÉRIFIÉE DANS UN VRAI NAVIGATEUR.
 *
 * Les formes d'adresse (« #espace/volet/acces-clients/nouvel-acces ») sont
 * verrouillées sans navigateur par `server/src/test/adresse-navigateur.test.ts`.
 * Ce contrôle-ci prouve l'autre moitié, dans un vrai navigateur :
 *
 *  1. un lien collé vers un tiroir l'ouvre, et recharger le garde ;
 *  2. un ancien lien vers les tiroirs des accès clients (partis de la Messagerie
 *     pour Réglages › Accès le 24/11/2026) ouvre la Messagerie sans tiroir ;
 *  3. un tiroir inconnu est ignoré, jamais bloquant.
 *
 *   npm run dev --workspace web -- --port 7099
 *   env -u BELUGA_TOKEN HAIKO_ADRESSES_URL=http://localhost:7099 node scripts/verif-tiroirs-adresses.mjs
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
 * LE MOT ATTENDU DANS L'ADRESSE pour chaque destination de la colonne. Il ne se
 * recopie pas : on le demande aux règles partagées, exactement comme
 * l'application. « projet » est à part — son adresse porte un identifiant, elle
 * ne se devine pas depuis la colonne.
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
  studio: construireFragment({ vue: 'studio' }),
};

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

/** Ouvre une destination de la colonne, menu déplié compris. */
async function ouvrirLaDestination(page, vue) {
  await ouvrirLaNavigation(page);
  await page.locator(`[data-destination="${vue}"]`).first().click();
}


/** Attend que le fragment vaille `mot` (sans le « # »). */
const attendreFragment = (page, mot, delai = 10_000) =>
  page
    .waitForFunction((cible) => window.location.hash.replace(/^#/, '') === cible, mot, { timeout: delai })
    .then(() => true)
    .catch(() => false);

/* UN TIROIR EST UNE PAGE OUVERTE PAR-DESSUS (`[data-page-de-zone]`) OU UNE
   FENÊTRE CENTRÉE — jamais la page du service lui-même : le coffre, les
   backups, la surveillance, les statistiques et le Studio sont eux aussi des
   fenêtres Radix (`[data-ecran-plein]`), et les compter ferait passer pour
   « tiroir ouvert » un service affiché sans rien par-dessus. */
const TIROIR = '[role="dialog"]:not([data-ecran-plein])';
const tiroirsOuverts = (page) => page.locator(TIROIR).count();

/** Referme ce que l'application a rouvert toute seule (la carte retenue du projet). */
async function refermerLesTiroirs(page) {
  for (let i = 0; i < 4 && (await tiroirsOuverts(page)); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

async function parcourir(page) {
  await attendreLApplication(page);
  await refermerLesTiroirs(page);

  /* ---------- Les anciens tiroirs des accès clients : ignorés, jamais bloquants ---------- */
  /* La gestion des comptes a quitté la Messagerie (24/11/2026, Réglages › Accès) : un ancien lien vers ses tiroirs
     ouvre la Messagerie, sans tiroir ni écran bloqué. */
  await page.goto(`${ADRESSE}/#espace/volet/acces-clients/nouvel-acces`, { waitUntil: 'domcontentloaded' });
  await attendreLApplication(page);
  await page.waitForTimeout(1500);
  if ((await tiroirsOuverts(page)) === 0) constater('un ancien lien vers les accès clients ouvre la Messagerie sans tiroir');
  else refuser('un ancien lien vers les accès clients a ouvert un tiroir');
  await refermerLesTiroirs(page);

  /* ---------- Les autres tiroirs : un lien collé les ouvre, recharger les garde ---------- */
  const AUTRES = [
    ['backups/volet/nouveau-site-backups', 'nouveau site de sauvegarde'],
    ['coffre/volet/archives-coffre', 'archives du coffre'],
    ['surveillance/volet/nouveau-site-surveillance', 'nouveau site surveillé'],
    ['statistiques/volet/nouveau-site-statistiques', 'nouveau site de statistiques'],
    ['studio/volet/nouvelle-creation-studio', 'nouvelle création du Studio'],
    ['tableau-de-bord/volet/notifications', 'notifications'],
    ['tableau-de-bord/volet/projets-du-serveur', 'projets du serveur'],
  ];
  for (const [mot, nom] of AUTRES) {
    await page.goto(`${ADRESSE}/#${mot}`, { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await attendreLApplication(page);
    const ouvert = await page
      .waitForSelector(TIROIR, { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    const gardee = (await fragment(page)) === mot;
    if (ouvert && gardee) {
      constater(`« ${nom} » : l’adresse « #${mot} » rouvre le tiroir après rechargement`);
    } else {
      refuser(`« ${nom} » : tiroir ${ouvert ? 'ouvert' : 'fermé'}, adresse « ${await fragment(page)} » au lieu de « ${mot} »`);
    }
    await page.keyboard.press('Escape');
    await page
      .waitForFunction(() => !window.location.hash.includes('/volet/'), null, { timeout: 4_000 })
      .catch(() => undefined);
    const refermee = await fragment(page);
    if (refermee.includes('/volet/')) refuser(`« ${nom} » : fermer le tiroir laisse « ${refermee} » dans l'adresse`);
  }

  /* ---------- Un tiroir inconnu ne bloque rien ---------- */
  await page.evaluate(() => {
    window.location.hash = 'espace/volet/n-existe-pas';
  });
  await page.waitForTimeout(1200);
  if ((await tiroirsOuverts(page)) === 0) constater('un tiroir inconnu est ignoré sans rien bloquer');
  else refuser('un tiroir inconnu a ouvert quelque chose');
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
      } catch (err) {
        if (process.env.HAIKO_ADRESSES_CAPTURE) await page.screenshot({ path: process.env.HAIKO_ADRESSES_CAPTURE });
        throw err;
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

console.log('\n— Adresses des tiroirs —\n');
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
