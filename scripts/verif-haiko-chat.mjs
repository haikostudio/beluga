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
 *   5. PLUS AUCUNE GESTION DES COMPTES (24/11/2026) — ni engrenage, ni « Gérer
 *      les comptes », ni tiroir « Accès clients » ; « Ajouter un client » ouvre
 *      Réglages › Accès (contrôlé en entier par `verif-page-acces.mjs`) ;
 *   6. LES RÉGLAGES — la page « Accès clients » n'y existe plus ;
 *
 * La Messagerie se rejoint par sa TUILE de la grille des services (bouton tout à
 * gauche du fil d'Ariane, ouvert au clic) ; la liste « Clients » est un panneau
 * ancré à son bouton, plus un tiroir.
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

  /* ---------------- 5. Plus aucune gestion des comptes dans la Messagerie (24/11/2026) ---------------- */
  /* Les comptes se gèrent dans Réglages › Accès, projet par projet : ni engrenage, ni « Gérer les comptes », ni
     tiroir « Accès clients ». « Ajouter un client » ne fait plus qu'ouvrir les réglages sur « Accès ». */
  /* Les repères de l'ancienne gestion n'existent plus dans le code : on juge à ce qui se LIT à l'écran. */
  const restes = await page.evaluate(() => {
    const texte = document.body.innerText;
    return ['Gérer les comptes', 'Accès clients', 'Comptes du client'].filter((mot) => texte.includes(mot));
  });
  noter('la Messagerie ne porte plus aucune gestion des comptes', restes.length === 0, restes.join(', '));
  await page.click('[data-ajouter-client]');
  const versLesAcces = await page
    .waitForSelector('[data-modale-reglages] [data-page-reglages="acces"]', { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  noter('« Ajouter un client » ouvre Réglages › Accès', versLesAcces);
  await page.keyboard.press('Escape');
  await contexte.close();

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
