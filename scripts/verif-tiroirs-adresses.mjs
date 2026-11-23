#!/usr/bin/env node
/**
 * UNE ADRESSE POUR CHAQUE TIROIR, VÉRIFIÉE DANS UN VRAI NAVIGATEUR.
 *
 * Les formes d'adresse (« #espace/volet/acces-clients/nouvel-acces ») sont
 * verrouillées sans navigateur par `server/src/test/adresse-navigateur.test.ts`.
 * Ce contrôle-ci prouve l'autre moitié, sur le tiroir des accès clients de la
 * Messagerie :
 *
 *  1. ouvrir la liste écrit son adresse, avec des silhouettes avant les comptes
 *     et un bouton « Ajouter » dans le pied ;
 *  2. « Ajouter » ouvre le formulaire dans un SECOND tiroir, adressable aussi ;
 *  3. recharger rouvre les deux tiroirs ; un lien collé dans un onglet neuf aussi ;
 *  4. Précédent ferme le tiroir du dessus en UN appui, et fermer au clic ne
 *     laisse aucune entrée d'historique en trop ;
 *  5. un tiroir inconnu est ignoré, jamais bloquant.
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

  /* ---------- Les accès clients : une liste, des silhouettes, un second tiroir ---------- */
  /* On entre par l'ADRESSE : c'est elle qu'on éprouve, et le menu replié peut
     être recouvert par la carte que l'application rouvre d'elle-même. */
  await page.goto(`${ADRESSE}/#espace`, { waitUntil: 'domcontentloaded' });
  await attendreLApplication(page);
  await attendreFragment(page, 'espace');
  const engrenage = page.locator('[data-reglages-accueil], [data-reglages-clients]').first();
  await engrenage.waitFor({ timeout: 30_000 });

  /* La silhouette doit paraître AVANT la liste : on guette les deux dans la page. */
  await page.evaluate(() => {
    window.__vu = { silhouette: false, liste: false, silhouetteAvantListe: false };
    const guetter = () => {
      const silhouette = !!document.querySelector('[data-silhouette="acces-clients"]');
      const liste = !!document.querySelector('[data-liste-acces]');
      if (silhouette) window.__vu.silhouette = true;
      if (liste && !window.__vu.liste) {
        window.__vu.liste = true;
        window.__vu.silhouetteAvantListe = window.__vu.silhouette;
      }
    };
    new MutationObserver(guetter).observe(document.body, { childList: true, subtree: true });
  });
  await engrenage.click();
  await attendreFragment(page, 'espace/volet/acces-clients');
  await page.waitForSelector('[data-liste-acces]', { timeout: 30_000 });
  const vu = await page.evaluate(() => window.__vu);
  if (vu.silhouetteAvantListe) constater('la liste des accès montre ses silhouettes avant l’arrivée des comptes');
  else refuser('la liste des accès n’a montré aucune silhouette avant ses comptes');

  const f1 = await fragment(page);
  if (f1 !== 'espace/volet/acces-clients') refuser(`ouvrir les accès laisse l'adresse sur « ${f1} »`);
  else constater(`le tiroir des accès a son adresse « #${f1} »`);
  if (await page.locator('[data-tiroir-acces-clients] [data-formulaire-compte]').count()) {
    refuser('le formulaire de nouvel accès est encore dans la liste (il doit s’ouvrir dans un tiroir)');
  }
  if (!(await page.locator('[data-tiroir-acces-clients] [data-ajouter-acces]').count())) {
    refuser('le bouton « Ajouter » est absent du pied du tiroir des accès');
  } else constater('un bouton « Ajouter » tient le pied du tiroir des accès');

  /* ---------- Le second tiroir, par-dessus ---------- */
  await page.locator('[data-ajouter-acces]').first().click();
  const ok2 = await attendreFragment(page, 'espace/volet/acces-clients/nouvel-acces');
  if (!ok2) refuser(`« Ajouter » laisse l'adresse sur « ${await fragment(page)} »`);
  await page.waitForSelector('[data-tiroir-nouvel-acces] [data-formulaire-compte]', { timeout: 10_000 }).catch(() => undefined);
  if (!(await page.locator('[data-tiroir-nouvel-acces] [data-formulaire-compte]').count())) {
    refuser('le formulaire de nouvel accès ne s’ouvre pas dans un second tiroir');
  } else constater('le formulaire de nouvel accès s’ouvre dans un second tiroir par-dessus la liste');

  /* ---------- Recharger : les DEUX tiroirs reviennent ---------- */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await attendreLApplication(page);
  await page.waitForSelector('[data-tiroir-nouvel-acces] [data-formulaire-compte]', { timeout: 30_000 }).catch(() => undefined);
  const apres = await fragment(page);
  const liste = await page.locator('[data-tiroir-acces-clients]').count();
  const formulaire = await page.locator('[data-tiroir-nouvel-acces] [data-formulaire-compte]').count();
  if (apres === 'espace/volet/acces-clients/nouvel-acces' && liste && formulaire) {
    constater('recharger rouvre la liste des accès ET le formulaire par-dessus');
  } else {
    refuser(`après rechargement : adresse « ${apres} », liste ${liste}, formulaire ${formulaire}`);
  }

  /* ---------- Précédent ferme le tiroir du dessus, en UN appui ---------- */
  await page.goBack();
  await page.waitForTimeout(600);
  const f3 = await fragment(page);
  const reste = await page.locator('[data-tiroir-nouvel-acces]').count();
  const listeEncore = await page.locator('[data-tiroir-acces-clients]').count();
  if (f3 === 'espace/volet/acces-clients' && !reste && listeEncore) {
    constater('un appui sur Précédent referme le formulaire et laisse la liste');
  } else {
    refuser(`Précédent : adresse « ${f3} », formulaire ${reste}, liste ${listeEncore}`);
  }

  /* ---------- Fermer au clic revient d'un cran, sans empiler ---------- */
  await page.locator('[data-ajouter-acces]').first().click();
  await attendreFragment(page, 'espace/volet/acces-clients/nouvel-acces');
  await page.locator('[data-tiroir-nouvel-acces] button[title]').first().click();
  await attendreFragment(page, 'espace/volet/acces-clients');
  await page.goBack();
  await page.waitForTimeout(600);
  const f4 = await fragment(page);
  if (f4 === 'espace') constater('fermer un tiroir au clic ne laisse aucune entrée en trop dans l’historique');
  else refuser(`fermer au clic puis Précédent mène à « ${f4} » au lieu de « espace »`);

  /* ---------- Un lien collé dans un onglet neuf ---------- */
  const neuf = await page.context().newPage();
  await neuf.goto(`${ADRESSE}/#espace/volet/acces-clients/nouvel-acces`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await attendreLApplication(neuf);
  await neuf.waitForSelector('[data-tiroir-nouvel-acces] [data-formulaire-compte]', { timeout: 30_000 }).catch(() => undefined);
  const collee = await neuf.locator('[data-tiroir-nouvel-acces] [data-formulaire-compte]').count();
  await neuf.close();
  if (collee) constater('un lien collé dans un onglet neuf ouvre les deux tiroirs');
  else refuser('un lien collé dans un onglet neuf n’ouvre pas les deux tiroirs');

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
