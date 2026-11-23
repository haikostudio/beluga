#!/usr/bin/env node
/**
 * « HAIKO CHAT » : L'ESPACE CLIENT A SON IDENTITÉ, ET LES PIEDS LEUR HAUTEUR.
 *
 *   npm run build && env -u BELUGA_TOKEN node scripts/verif-haiko-chat.mjs
 *
 * Ce qui est vérifié, sur un démon JETABLE (port libre, base neuve, aucun
 * moteur appelé) :
 *   1. DEUX FICHES D'INSTALLATION — `/manifest.json` rend « Haiko Chat » sur
 *      l'adresse cliente (`my.…`) et « Beluga Build » sur l'administration ;
 *   2. LE NOM DE LA PAGE — côté client, `<title>` et le nom d'application de
 *      l'iPhone disent « Haiko Chat », `/index.html` compris ; la page de
 *      connexion aussi ; l'administration ne change pas ;
 *   3. L'ENTÊTE CLIENT — plus aucun nom de personne (`[data-mon-nom]`) ;
 *   4. LES PIEDS — « Ajouter un client » a EXACTEMENT la hauteur d'une ligne de
 *      la liste « Clients » (ligne sans détail) — CE POINT ÉTAIT DÉJÀ ROUGE
 *      AVANT LA REFONTE (31,5 px contre 36) et le reste : il n'a pas été réparé ;
 *   5. L'ENGRENAGE — à droite du titre « Clients », il ouvre la gestion des
 *      accès (`[data-gestion-comptes]`) ;
 *   6. LES RÉGLAGES — la page « Accès clients » n'y existe plus ;
 *   7. LES DEUX ACCÈS DE PLUS — l'engrenage de la vue d'ensemble (un geste de la
 *      page : dans la barre d'en-tête, sur la ligne du titre, sur ordinateur ;
 *      en tête de la page, à droite, sur téléphone), et « Gérer les comptes »
 *      au pied de la liste « Clients », à côté de « Ajouter un client », qui
 *      referme la liste avant d'ouvrir la gestion ; au bureau ET sur un téléphone ;
 *
 * La Messagerie se rejoint par sa TUILE de la grille des services (bouton tout à
 * gauche du fil d'Ariane, ouvert au clic) ; la liste « Clients » est un panneau
 * ancré à son bouton, plus un tiroir.
 *   8. LES PROJETS ET L'INVITATION D'UN ACCÈS — les projets se choisissent dans
 *      une liste à cases filtrable (plus aucune grappe de boutons), un accès
 *      n'affiche QUE ses projets, et « Copier l'invitation » met dans le
 *      presse-papiers un message avec l'adresse, l'identifiant et le mot de
 *      passe — tiré à neuf, après confirmation, sur un accès existant.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { allerVers } from './lib/navigation.mjs';
import { cocherDansLaListe } from './lib/liste-deroulante.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_HAIKO_CHAT_PORT || 7237);
const HOTE_CLIENT = 'my.test';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, PROJETS, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-haiko-chat-',
  port: PORT,
  // Ce contrôle juge le NOM de l'espace client de l'installation d'origine : il
  // demande donc son identité, qu'un démon d'essai ne reprend plus d'office.
  env: { BELUGA_IDENTITE_REPRISE: '1' },
});
if (!(await attendrePort())) {
  console.error('le démon n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

/** Une requête brute, avec l'entête `Host` choisi — et la session si donnée. */
const lire = (route, hote, jeton) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: route,
        headers: { host: `${hote}:${PORT}`, ...(jeton ? { cookie: `beluga_session=${jeton}` } : {}) },
      },
      (res) => {
        let corps = '';
        res.setEncoding('utf8');
        res.on('data', (morceau) => (corps += morceau));
        res.on('end', () => resolve({ statut: res.statusCode, corps }));
      },
    );
    req.on('error', reject);
    req.end();
  });

/* ---------------- Le décor : un projet, un client, une session admin ---------------- */

const JETON = crypto.randomBytes(32).toString('hex');
const JETON_CLIENT = crypto.randomBytes(32).toString('hex');
const PROJET = 'p-haiko-chat';
{
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  const chemin = path.join(PROJETS, 'haiko-chat');
  fs.mkdirSync(chemin, { recursive: true });
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
    PROJET,
    'Projet Haiko Chat',
    chemin,
    0,
    JSON.stringify({ id: PROJET, name: 'Projet Haiko Chat', path: chemin, archived: false, createdAt: maintenant, updatedAt: maintenant }),
    maintenant,
    maintenant,
  );
  /* Sept projets de plus : la liste des projets d'un accès passe le seuil de sa recherche. */
  for (let n = 1; n <= 7; n++) {
    const id = `p-extra-${n}`;
    const dossier = path.join(PROJETS, id);
    fs.mkdirSync(dossier, { recursive: true });
    db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
      id,
      `Extra ${n}`,
      dossier,
      0,
      JSON.stringify({ id, name: `Extra ${n}`, path: dossier, archived: false, createdAt: maintenant, updatedAt: maintenant }),
      maintenant,
      maintenant,
    );
  }
  db.prepare(
    `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le)
     VALUES ('u-admin-essai', 'admin-essai', 'admin', 'Haiko', ?, 'x', 1, ?)`,
  ).run(crypto.randomBytes(16).toString('hex'), maintenant);
  /* Un client SANS projet : sa ligne de liste n'a pas de détail, donc la hauteur de référence. */
  db.prepare(
    `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le)
     VALUES ('u-client-essai', 'client-essai', 'client', 'Client d’essai', ?, 'x', 1, ?)`,
  ).run(crypto.randomBytes(16).toString('hex'), maintenant);
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(JETON).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'verif-haiko-chat',
    'u-admin-essai',
  );
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(JETON_CLIENT).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'verif-haiko-chat-client',
    'u-client-essai',
  );
  db.close();
}

/* ---------------- 1. Les deux fiches d'installation ---------------- */

const ficheClient = JSON.parse((await lire('/manifest.json', HOTE_CLIENT)).corps);
const ficheAdmin = JSON.parse((await lire('/manifest.json', '127.0.0.1')).corps);
noter(
  'l’adresse cliente donne la fiche « Haiko Chat », avec la baleine',
  ficheClient.name === 'Haiko Chat' &&
    ficheClient.short_name === 'Haiko Chat' &&
    ficheClient.icons?.some((i) => i.src === '/icon-512.png' && i.purpose === 'maskable'),
  `${ficheClient.name} / ${ficheClient.short_name}`,
);
noter('l’administration garde la fiche « Beluga Build »', ficheAdmin.name === 'Beluga Build', ficheAdmin.name);

/* ---------------- 2. Le nom de la page ---------------- */

const titre = (html) => html.match(/<title>([^<]*)<\/title>/)?.[1];
const nomIphone = (html) => html.match(/apple-mobile-web-app-title" content="([^"]*)"/)?.[1];
const entreeClient = (await lire('/', HOTE_CLIENT)).corps;
noter('la page de connexion cliente dit « Haiko Chat »', titre(entreeClient) === 'Haiko Chat' && entreeClient.includes('<h1>Haiko Chat</h1>'));
for (const route of ['/', '/index.html']) {
  const client = (await lire(route, HOTE_CLIENT, JETON)).corps;
  const admin = (await lire(route, '127.0.0.1', JETON)).corps;
  noter(
    `côté client, « ${route} » porte le titre et le nom d’iPhone « Haiko Chat »`,
    titre(client) === 'Haiko Chat' && nomIphone(client) === 'Haiko Chat',
    `${titre(client)} / ${nomIphone(client)}`,
  );
  noter(
    `côté administration, « ${route} » garde « Beluga Build »`,
    titre(admin) === 'Beluga Build' && nomIphone(admin) === 'Beluga',
    `${titre(admin)} / ${nomIphone(admin)}`,
  );
}

/* ---------------- Le navigateur ---------------- */

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', `--host-resolver-rules=MAP ${HOTE_CLIENT} 127.0.0.1`],
});
try {
  /* ---------------- 3. L'entête client, sans nom ---------------- */
  const contexteClient = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-CH' });
  await contexteClient.addCookies([{ name: 'beluga_session', value: JETON_CLIENT, domain: HOTE_CLIENT, path: '/' }]);
  const pageClient = await contexteClient.newPage();
  await pageClient.goto(`http://${HOTE_CLIENT}:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const entete = await pageClient
    .waitForSelector('[data-entete-espace]', { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  noter(
    'l’entête de l’espace client ne montre plus le nom de la personne',
    entete && (await pageClient.locator('[data-mon-nom]').count()) === 0,
    entete ? '' : 'entête introuvable',
  );
  noter('l’onglet du navigateur dit « Haiko Chat »', (await pageClient.title()) === 'Haiko Chat', await pageClient.title());
  await contexteClient.close();

  /* ---------------- 4 et 5. Le tiroir « Clients » ---------------- */
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'beluga_session', value: JETON, domain: '127.0.0.1', path: '/' }]);
  const page = await contexte.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  /* LA MESSAGERIE EST UNE TUILE DE LA GRILLE DES SERVICES (refonte du 11/10/2026),
     et le contenu d'un menu est DÉMONTÉ tant qu'il est fermé : on n'attend donc
     plus la tuile avant d'ouvrir la grille, on ouvre la grille puis on la clique. */
  await allerVers(page, 'espace-client');
  /* La Messagerie s'ouvre sur la VUE D'ENSEMBLE : on entre chez le client par sa fiche. */
  /* Sur ordinateur, les clients vivent dans la colonne de gauche ; sur téléphone, dans la page. */
  await page.waitForSelector('[data-choix-client], [data-fiche-client], [data-colonne-client]', { timeout: 30000 });
  if (!(await page.locator('[data-choix-client]').count())) {
    await page.locator('[data-colonne-client], [data-fiche-client]').first().click();
  }
  await page.waitForSelector('[data-choix-client]', { timeout: 30000 });
  await page.click('[data-choix-client]');
  await page.waitForSelector('[data-selecteur-option]', { timeout: 15000 });
  await page.waitForTimeout(400);

  const hauteurs = await page.evaluate(() => {
    const ligne = document.querySelector('[data-selecteur-option]')?.getBoundingClientRect().height;
    const pied = document.querySelector('[data-ajouter-client]')?.getBoundingClientRect().height;
    return { ligne, pied };
  });
  noter(
    '« Ajouter un client » a exactement la hauteur d’une ligne de la liste',
    Boolean(hauteurs.ligne) && Math.abs(hauteurs.ligne - hauteurs.pied) < 0.5,
    JSON.stringify(hauteurs),
  );

  const placeEngrenage = await page.evaluate(() => {
    const bouton = document.querySelector('[data-reglages-clients]');
    const titre = bouton?.closest('header')?.querySelector('h2, [id^="radix-"], span');
    if (!bouton || !titre) return null;
    return bouton.getBoundingClientRect().left >= titre.getBoundingClientRect().right - 1;
  });
  noter('l’engrenage est à droite du titre « Clients »', placeEngrenage === true, String(placeEngrenage));

  await page.click('[data-reglages-clients]');
  const gestion = await page
    .waitForSelector('[data-tiroir-acces-clients] [data-gestion-comptes]', { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  noter('l’engrenage ouvre la gestion des accès clients', gestion);
  const listeAcces = await page.evaluate(() =>
    Number(document.querySelector('[data-tiroir-acces-clients] [data-liste-acces]')?.getAttribute('data-liste-acces') ?? -1),
  );
  noter('la gestion liste le client existant', listeAcces >= 1, String(listeAcces));

  /* ---------------- 8. Les projets et l'invitation d'un accès ---------------- */
  await contexte.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${PORT}` });
  const tiroir = page.locator('[data-tiroir-acces-clients]');
  /* LE FORMULAIRE S'OUVRE DANS UN SECOND TIROIR, par le bouton « Ajouter » du pied. */
  await tiroir.locator('[data-ajouter-acces]').click();
  const formulaire = page.locator('[data-tiroir-nouvel-acces]');
  await formulaire.locator('[data-champ-identifiant]').waitFor({ timeout: 10000 });
  const pressePapiers = () => page.evaluate(() => navigator.clipboard.readText());
  noter(
    'le formulaire n’a plus de grappe de boutons de projets',
    (await formulaire.locator('[data-choix-projets] button[data-projet]').count()) === 0 &&
      (await formulaire.locator('[data-liste-deroulante="projets-acces"]').count()) === 1,
  );
  await formulaire.locator('[data-champ-identifiant]').fill('invite-essai');
  await formulaire.locator('[data-champ-nom]').fill('Invité Essai');
  const declencheurProjets = formulaire.locator('[data-liste-deroulante="projets-acces"]');
  await declencheurProjets.click();
  const recherche = page.locator('[data-liste-recherche="projets-acces"]');
  const filtre = await recherche
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(async () => {
      await recherche.fill('extra 3');
      await page.waitForTimeout(200);
      return page.locator('[data-liste-option]:visible').evaluateAll((n) => n.map((o) => o.getAttribute('data-liste-option')));
    })
    .catch(() => null);
  noter('la recherche filtre les projets', JSON.stringify(filtre) === '["p-extra-3"]', JSON.stringify(filtre));
  await page.locator('[data-liste-option="p-extra-3"]').click();
  await recherche.fill('');
  await page.locator(`[data-liste-option="${PROJET}"]`).click();
  const resteOuverte = await page.locator('[data-liste-option="p-extra-1"]').isVisible();
  const cochees = await page.locator('[data-liste-option][data-liste-choisie]').evaluateAll((n) => n.map((o) => o.getAttribute('data-liste-option')).sort());
  noter(
    'la liste reste ouverte et coche plusieurs projets',
    resteOuverte && JSON.stringify(cochees) === JSON.stringify(['p-extra-3', PROJET].sort()),
    `ouverte ${resteOuverte}, ${JSON.stringify(cochees)}`,
  );
  await page.keyboard.press('Escape');
  await page.locator('[data-liste-option]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  const pastilles = await formulaire.locator('[data-choix-projets] [data-projet]').count();
  noter('les projets retenus s’affichent en pastilles', pastilles === 2, String(pastilles));
  await page.screenshot({ path: '/tmp/verif-haiko-chat-choix-projets.png' });

  await formulaire.locator('[data-creer-acces]').click();
  await tiroir.locator('[data-mot-de-passe-montre]').waitFor({ timeout: 15000 });
  const premier = (await tiroir.locator('[data-mot-de-passe-montre] code').textContent())?.trim() ?? '';
  const ligne = tiroir.locator('[data-acces]', { hasText: 'invite-essai' });
  await ligne.waitFor({ timeout: 15000 });
  const portee = await ligne.locator('[data-portee]').evaluateAll((n) => n.map((o) => o.getAttribute('data-portee')).sort());
  noter(
    'l’accès créé n’affiche que ses deux projets',
    JSON.stringify(portee) === JSON.stringify(['p-extra-3', PROJET].sort()),
    JSON.stringify(portee),
  );
  const autreLigne = tiroir.locator('[data-acces="u-client-essai"] [data-portee]');
  noter('un accès sans projet n’affiche aucune pastille', (await autreLigne.count()) === 0, String(await autreLigne.count()));

  await tiroir.locator('[data-copier-invitation-montre]').click();
  await page.waitForTimeout(300);
  const invitation = await pressePapiers().catch((e) => `erreur ${e.message}`);
  noter(
    'l’invitation du mot de passe montré porte adresse, identifiant et mot de passe',
    invitation.includes('Identifiant : invite-essai') &&
      invitation.includes(`Mot de passe : ${premier}`) &&
      /Adresse : https:\/\//.test(invitation) &&
      invitation.startsWith('Bonjour Invité Essai'),
    invitation.slice(0, 80),
  );

  await ligne.locator('[data-copier-invitation]').click();
  const confirmer = page.getByRole('button', { name: 'Nouveau mot de passe et copier' });
  const demandee = await confirmer
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  noter('sur un accès existant, l’invitation demande confirmation', demandee);
  if (demandee) {
    await confirmer.click();
    await page.waitForFunction(
      (avant) => {
        const code = document.querySelector('[data-tiroir-acces-clients] [data-mot-de-passe-montre] code');
        return code && code.textContent.trim() !== avant;
      },
      premier,
      { timeout: 15000 },
    );
    await page.waitForTimeout(400);
    const second = (await tiroir.locator('[data-mot-de-passe-montre] code').textContent())?.trim() ?? '';
    const neuve = await pressePapiers().catch((e) => `erreur ${e.message}`);
    noter(
      'la confirmation tire un nouveau mot de passe et le copie dans l’invitation',
      second && second !== premier && neuve.includes(`Mot de passe : ${second}`) && neuve.includes('Identifiant : invite-essai'),
      neuve.slice(0, 80),
    );
  }

  await ligne.locator(`[data-retirer-projet="p-extra-3"]`).click();
  await page.waitForTimeout(800);
  const apresRetrait = await ligne.locator('[data-portee]').evaluateAll((n) => n.map((o) => o.getAttribute('data-portee')));
  await cocherDansLaListe(ligne.locator('[data-modifier-portee]'), ['p-extra-5', 'p-extra-6']);
  await page.waitForTimeout(800);
  const apresAjout = await ligne.locator('[data-portee]').evaluateAll((n) => n.map((o) => o.getAttribute('data-portee')).sort());
  noter(
    'la croix retire un projet et la liste à cases en ajoute plusieurs',
    JSON.stringify(apresRetrait) === JSON.stringify([PROJET]) &&
      JSON.stringify(apresAjout) === JSON.stringify([PROJET, 'p-extra-5', 'p-extra-6'].sort()),
    `${JSON.stringify(apresRetrait)} puis ${JSON.stringify(apresAjout)}`,
  );
  await page.screenshot({ path: '/tmp/verif-haiko-chat-acces.png' });
  await contexte.close();

  /* ---------------- 7. Les deux accès de plus ---------------- */
  for (const [nom, viewport] of [
    ['au bureau', { width: 1280, height: 800 }],
    ['sur téléphone', { width: 390, height: 844 }],
  ]) {
    /* On entre au format bureau, puis la fenêtre prend la taille visée : la
       mise en page suit la largeur. */
    const ctx = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-CH' });
    await ctx.addCookies([{ name: 'beluga_session', value: JETON, domain: '127.0.0.1', path: '/' }]);
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await allerVers(p, 'espace-client');
    await p.waitForSelector('[data-choix-client], [data-vue-accueil] [data-accueil-messagerie]', { timeout: 30000 });
    await p.setViewportSize(viewport);
    await p.waitForTimeout(400);
    if (await p.locator('[data-fil-d-ariane] [data-titre-bandeau][data-chemin-de-zone]').count()) await p.click('[data-fil-d-ariane] [data-titre-bandeau][data-chemin-de-zone]');
    /*
     * L'ENGRENAGE DE LA VUE D'ENSEMBLE EST UN GESTE DE LA PAGE (`GestesDePage`,
     * refonte du 11/10/2026 : « LA BARRE D'EN-TÊTE D'UNE PAGE : FIL D'ARIANE À
     * GAUCHE, GESTES ET « … » À DROITE »). Il a donc quitté le bloc du
     * graphique — qui n'est plus en tête de la page — :
     *  - SUR ORDINATEUR il monte dans la barre d'en-tête (`[data-gestes-de-page="barre"]`),
     *    sur la ligne du titre de la page (le dernier cran du fil d'Ariane), dans
     *    l'amas de boutons de droite ;
     *  - SUR TÉLÉPHONE « la barre n'a pas la place : ils restent en tête de la
     *    page, alignés à droite » (`[data-gestes-de-page="page"]`) — sous le
     *    titre de la page et avant tout son contenu. Il n'y est donc plus sur
     *    la ligne d'un titre : c'est la règle de la refonte, pas un oubli.
     * Dans les deux cas il n'est plus sous `[data-vue-accueil]` qu'au téléphone
     * (sur ordinateur c'est un portail vers la barre) : on attend la vue, puis lui.
     */
    const telephone = viewport.width < 640;
    const engrenage = await p
      .waitForSelector('[data-vue-accueil] [data-accueil-messagerie]', { timeout: 15000 })
      .then(() => p.waitForSelector('[data-reglages-accueil]', { state: 'visible', timeout: 15000 }))
      .then(() => true)
      .catch(() => false);
    const coin = await p.evaluate(() => {
      const bouton = document.querySelector('[data-reglages-accueil]');
      const zone = document.querySelector('[data-accueil-messagerie]')?.getBoundingClientRect();
      if (!bouton || !zone) return null;
      const bb = bouton.getBoundingClientRect();
      const milieu = (b) => b.top + b.height / 2;
      const barre = bouton.closest('[data-entete-de-zone]');
      if (barre) {
        const titre = barre.querySelector('[data-fil-d-ariane] [data-titre-bandeau]')?.getBoundingClientRect();
        if (!titre) return null;
        /* « À DROITE » : du bouton jusqu'au bord de la barre, que des boutons
           serrés — aucun vide de 24 px ou plus (la borne d'avant, inchangée). */
        const suivants = [...barre.querySelectorAll('button')]
          .map((b) => b.getBoundingClientRect())
          .filter((b) => b.width > 0 && b.left >= bb.right - 1)
          .sort((a, b) => a.left - b.left);
        let bord = bb.right;
        let vide = 0;
        for (const b of suivants) {
          vide = Math.max(vide, b.left - bord);
          bord = Math.max(bord, b.right);
        }
        vide = Math.max(vide, barre.getBoundingClientRect().right - bord);
        return {
          ou: 'barre',
          gestes: !!bouton.closest('[data-gestes-de-page="barre"]'),
          droite: Math.round(vide * 100) / 100,
          haut: Math.round(Math.abs(milieu(bb) - milieu(titre)) * 100) / 100,
          apresLeTitre: bb.left >= titre.right - 1,
        };
      }
      const titre = document.querySelector('[data-accueil-messagerie] [data-titre-de-page]')?.getBoundingClientRect();
      const contenu = document.querySelector('[data-accueil-messagerie] [data-fiches-clients], [data-accueil-messagerie] [data-bloc-graphique]')?.getBoundingClientRect();
      if (!titre || !contenu) return null;
      return {
        ou: 'page',
        gestes: !!bouton.closest('[data-vue-accueil] [data-gestes-de-page="page"]'),
        droite: Math.round((zone.right - bb.right) * 100) / 100,
        /* En tête de la page : sous son titre, avant son premier contenu. */
        sousLeTitre: bb.top >= titre.bottom - 1,
        avantLeContenu: bb.bottom <= contenu.top + 1,
      };
    });
    noter(
      telephone
        ? `${nom} : la vue d’ensemble porte un engrenage en tête de la page, à droite, avant tout contenu`
        : `${nom} : la vue d’ensemble porte un engrenage en haut à droite, sur la ligne du titre`,
      engrenage &&
        !!coin &&
        coin.gestes &&
        coin.droite < 24 &&
        (telephone
          ? coin.ou === 'page' && coin.sousLeTitre && coin.avantLeContenu
          : coin.ou === 'barre' && coin.haut < 16 && coin.apresLeTitre),
      JSON.stringify(coin),
    );
    await p.screenshot({ path: `/tmp/verif-haiko-chat-accueil-${viewport.width}.png` });
    if (engrenage) {
      await p.click('[data-reglages-accueil]');
      noter(
        `${nom} : cet engrenage ouvre la gestion des comptes`,
        await p
          .waitForSelector('[data-tiroir-acces-clients] [data-gestion-comptes]', { timeout: 15000 })
          .then(() => true)
          .catch(() => false),
      );
      await p.keyboard.press('Escape');
      await p.waitForSelector('[data-tiroir-acces-clients]', { state: 'detached', timeout: 10000 }).catch(() => {});
    }

    /* Le pied du tiroir « Clients » : entrer chez un client, ouvrir le choix. */
    await p.locator('[data-accueil-messagerie] [data-fiche-client], [data-colonne-client]').first().click().catch(() => {});
    await p.waitForSelector('[data-choix-client]', { timeout: 15000 }).catch(() => {});
    await p.click('[data-choix-client]');
    await p.waitForSelector('[data-gerer-les-comptes]', { timeout: 15000 });
    await p.waitForTimeout(400);
    const pied = await p.evaluate(() => {
      const ajouter = document.querySelector('[data-ajouter-client]')?.getBoundingClientRect();
      const gerer = document.querySelector('[data-gerer-les-comptes]')?.getBoundingClientRect();
      if (!ajouter || !gerer) return null;
      return {
        memeLigne: Math.abs(ajouter.top - gerer.top) < 1,
        aDroite: gerer.left >= ajouter.right - 1,
        hauteur: [ajouter.height, gerer.height],
        dansLaFenetre: gerer.right <= window.innerWidth,
      };
    });
    noter(
      `${nom} : « Gérer les comptes » est au pied, à droite de « Ajouter un client », même hauteur`,
      !!pied && pied.memeLigne && pied.aDroite && pied.dansLaFenetre && Math.abs(pied.hauteur[0] - pied.hauteur[1]) < 0.5,
      JSON.stringify(pied),
    );
    await p.screenshot({ path: `/tmp/verif-haiko-chat-pied-${viewport.width}.png` });
    await p.click('[data-gerer-les-comptes]');
    const ouverte = await p
      .waitForSelector('[data-tiroir-acces-clients] [data-gestion-comptes]', { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    await p.waitForTimeout(600);
    const choixFerme = (await p.locator('[data-selecteur-option]:visible').count()) === 0;
    noter(`${nom} : il referme le choix du client et ouvre la gestion des comptes`, ouverte && choixFerme, `gestion ${ouverte}, choix fermé ${choixFerme}`);
    await p.screenshot({ path: `/tmp/verif-haiko-chat-gestion-${viewport.width}.png` });
    /* La liste à cases s'ouvre PAR-DESSUS le tiroir des accès, et une coche ne referme ni l'une ni l'autre. */
    await p.click('[data-tiroir-acces-clients] [data-ajouter-acces]');
    await p.click('[data-tiroir-nouvel-acces] [data-liste-deroulante="projets-acces"]');
    const option = p.locator('[data-liste-option="p-extra-2"]');
    const cochee = await option
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(async () => {
        await option.click();
        await p.waitForTimeout(300);
        return (await option.isVisible()) && (await option.getAttribute('data-liste-choisie')) === '' && (await p.locator('[data-tiroir-acces-clients]').count()) === 1;
      })
      .catch(() => false);
    noter(`${nom} : la liste des projets s’ouvre par-dessus la gestion et reste ouverte à la coche`, cochee);
    await p.screenshot({ path: `/tmp/verif-haiko-chat-liste-projets-${viewport.width}.png` });
    await p.keyboard.press('Escape');
    await option.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(300);
    await p.keyboard.press('Escape');
    await p.waitForSelector('[data-tiroir-nouvel-acces]', { state: 'detached', timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(300);
    await p.keyboard.press('Escape');
    const refermee = await p
      .waitForSelector('[data-tiroir-acces-clients]', { state: 'detached', timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    noter(`${nom} : la gestion se referme, sans tiroir resté par-dessus`, refermee);
    await ctx.close();
  }

  /* ---------------- 6. Les réglages ---------------- */
  const { ARBORESCENCE_REGLAGES } = await import(path.join(RACINE, 'shared/dist/reglages-arborescence.js')).catch(() => ({}));
  const arbre = ARBORESCENCE_REGLAGES ?? null;
  const pages = arbre ? arbre.flatMap((rubrique) => rubrique.pages.map((p) => p.cle)) : null;
  noter(
    'la page « Accès clients » a quitté les réglages',
    Array.isArray(pages) && pages.length > 0 && !pages.includes('acces-clients'),
    pages ? pages.join(', ') : 'arborescence introuvable',
  );
} finally {
  await navigateur.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôle(s) réussi(s).`);
process.exit(echecs ? 1 : 0);
