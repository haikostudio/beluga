#!/usr/bin/env node
/**
 * COMMUNICATION 2, DANS UN VRAI NAVIGATEUR (carte « Communication V2, simple et limpide », 08/11/2026).
 *
 * Démon à soi, base jetable, plafond d'agents à zéro : aucun moteur ne tourne, aucun quota n'est dépensé, aucun réseau
 * réel n'est appelé. Le TRAVAIL DU CHEF EN COULISSES est simulé par les lignes qu'il écrirait (fiche de la campagne,
 * publications en brouillon, visuels liés) : le contrôle prouve que l'écran ENVOIE la bonne demande (drapeau posé), puis
 * qu'il montre ce que le chef a préparé, et que chaque validation ne part qu'au clic.
 *
 *   node scripts/verif-communication-v2.mjs
 *   HAIKO_COMMUNICATION_V2_CAPTURES=/un/dossier node scripts/verif-communication-v2.mjs   # captures 1440/390, clair et sombre
 */
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_COMMUNICATION_V2_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.HAIKO_COMMUNICATION_V2_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok: !!ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
console.log(`  …  dépôt jugé : ${RACINE}`);

const { DATA, PROJETS, attendrePort, journal } = demarrerDemonDEssai({
  prefixe: 'verif-communication-v2-',
  port: PORT,
  depot: false,
  /* `BELUGA_COULISSES_ESSAI` : la demande au chef est GARDÉE en base, jamais envoyée à un moteur (une demande silencieuse
     ne passe pas par la file, le plafond d'agents ne la retient pas). */
  env: { BELUGA_ADRESSE_PUBLIQUE: BASE, BELUGA_MARKETING_NUIT: '0', BELUGA_PUBLICATION_SOCIALE: '0', BELUGA_COULISSES_ESSAI: '1', BELUGA_AGENT_DE_CAMPAGNE_SANS_MOTEUR: '1' },
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const jourLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dans = (n) => jourLocal(new Date(Date.now() + n * 86_400_000));
const base = () => new Database(path.join(DATA, 'beluga.db'));
const lire = (sql, ...args) => {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  try {
    return db.prepare(sql).get(...args);
  } finally {
    db.close();
  }
};
const lireTout = (sql, ...args) => {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};
const ecrire = (sql, ...args) => {
  const db = base();
  try {
    return db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
/** L'adresse sans la portée de la page de service (« ?projet=… », 20/11/2026). */
const sansPortee = (url) => url.replace(/\?projet=[^#]*$/, '');

async function jusquA(test, limite = 10_000) {
  const fin = Date.now() + limite;
  while (Date.now() < fin) {
    if (await test()) return true;
    await attendre(200);
  }
  return !!(await test());
}

/** Une commande du démon, par sa porte WebSocket, avec la session de l'essai. */
function commande(cmd) {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomUUID();
    const fin = setTimeout(() => (w.close(), reject(new Error('sans réponse'))), 30000);
    w.on('open', () => w.send(JSON.stringify({ id, cmd })));
    w.on('message', (brut) => {
      const ev = JSON.parse(String(brut));
      if (ev.type === 'ack' && ev.id === id) {
        clearTimeout(fin);
        w.close();
        ev.ok === false ? reject(new Error(ev.error)) : resolve(ev.data);
      }
    });
    w.on('error', reject);
  });
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
function poserUnePiece(db, id, projet, nom) {
  const dossier = path.join(DATA, 'attachments');
  fs.mkdirSync(dossier, { recursive: true });
  const alias = id.slice(0, 4);
  fs.writeFileSync(path.join(dossier, `${alias}-${nom}`), PNG);
  fs.writeFileSync(path.join(dossier, `${id}-${nom}`), PNG);
  const data = { id, projectId: projet, alias, name: nom, mime: 'image/png', size: PNG.length, sha: sha(id), createdAt: Date.now() };
  db.prepare('INSERT OR REPLACE INTO attachments (id, project_id, sha, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, projet, data.sha, JSON.stringify(data), data.createdAt);
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), maintenant, maintenant + 3600_000, 'vérification communication 2');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const projet = (id, nom, rapport) => {
    db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
      id,
      nom,
      path.join(PROJETS, id),
      JSON.stringify({ id, name: nom, path: path.join(PROJETS, id), defaultEngine: 'claude', branchesDePublication: {}, rank: 1000, archived: false, createdAt: maintenant, updatedAt: maintenant }),
      maintenant,
      maintenant,
    );
    fs.mkdirSync(path.join(PROJETS, id), { recursive: true });
    db.prepare(
      `INSERT INTO marketing_espaces (project_id, cle_suivi, origines, sources_ventes, objectifs, canaux, langue, fiche, cree_le, maj_le, rapport, rapport_le, recommandations_canaux, actif, etat_suivi)
       VALUES (?, ?, '[]', '[]', '[]', ?, 'fr', ?, ?, ?, ?, ?, ?, 1, 'verifie')`,
    ).run(
      id,
      `cle-${id}`,
      rapport ? '["instagram","tiktok"]' : '[]',
      rapport ? JSON.stringify({ cible: 'Les parents pressés', promesse: 'Des jouets qui durent dix ans.', ton: 'Chaleureux et simple', concurrents: ['Jouets Durables', 'Bois & Co'] }) : '{}',
      maintenant,
      maintenant,
      rapport,
      rapport ? maintenant : null,
      rapport
        ? JSON.stringify([
            { canal: 'instagram', pertinence: 'haute', raison: 'Les parents y cherchent des idées de cadeaux.' },
            { canal: 'tiktok', pertinence: 'haute', raison: 'Les démonstrations courtes y marchent bien.' },
            { canal: 'linkedin', pertinence: 'faible', raison: 'Peu de parents y cherchent des jouets.' },
          ])
        : '[]',
    );
  };
  projet('p-kipou', 'Kipou', '## Le produit\nDes jouets en bois.\n\n## Concurrence\nDeux marques proches, plus chères.\n');
  projet('p-lea', 'Boutique Léa', null);
  poserUnePiece(db, 'b1b1b1b1-0000-4000-8000-000000000001', 'p-kipou', 'visuel-1.png');
  poserUnePiece(db, 'b2b2b2b2-0000-4000-8000-000000000002', 'p-kipou', 'visuel-2.png');
  db.prepare(`INSERT INTO marketing_comptes (id, project_id, reseau, distant_id, nom, etat, jeton_ref, details, cree_le, maj_le) VALUES ('cp-insta', 'p-kipou', 'instagram', 'd1', '@kipou', 'relie', 'x', '{}', ?, ?)`).run(maintenant, maintenant);
  const message = db.prepare(`INSERT INTO marketing_messages (id, project_id, compte_id, reseau, genre, distant_id, fil, auteur, auteur_id, texte, instant, sortant, lu, contenu_id, brouillon, url) VALUES (?, 'p-kipou', 'cp-insta', 'instagram', ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, NULL)`);
  message.run('m-prive', 'message', 'd-m1', 'fil-sophie', 'Sophie M.', 'u1', 'Livrez-vous en Suisse ?', maintenant - 3600_000, 'Oui, partout en Suisse, en trois jours.');
  message.run('m-comment', 'commentaire', 'd-c1', 'pub1', 'Camille', 'u2', 'Il est en quel bois ?', maintenant - 7200_000, null);
  db.close();
}

const marquesParNom = async () => {
  const r = await commande({ type: 'communication.marques' });
  return Object.fromEntries(r.marques.map((m) => [m.nom, m]));
};
const drapeau = (genre) => lireTout("SELECT key, value FROM meta WHERE key LIKE 'communication.coulisses.marque.%' AND value != ''").find((l) => l.value.includes(`"genre":"${genre}"`));
const effacerLesDrapeaux = () => ecrire("UPDATE meta SET value = '' WHERE key LIKE 'communication.coulisses.%'");
const montrer = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function capturer(page, nom) {
  if (!CAPTURES) return;
  for (const sombre of [false, true]) {
    await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
    await attendre(250);
    await page.screenshot({ path: path.join(CAPTURES, `${nom}-${sombre ? 'sombre' : 'clair'}.png`) }).catch(() => {});
  }
  await page.evaluate(() => document.documentElement.classList.toggle('dark', false));
}
/** La part de la largeur du pied que prend un bouton (le grand bouton d'avance doit la remplir). */
/** Le groupe d'avance (#7ce7) : la flèche à gauche, le grand bouton à droite, même fond, même hauteur, 1 px entre eux. */
async function groupeDAvance(page, fleche, principal) {
  const r = await page.evaluate(
    ([f, p]) => {
      const a = document.querySelector(f);
      const b = document.querySelector(p);
      if (!a || !b) return null;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return { icone: Math.round(a.querySelector('svg')?.getBoundingClientRect().width ?? 0), fondA: getComputedStyle(a).backgroundColor, fondB: getComputedStyle(b).backgroundColor, eteint: b.disabled, ecart: rb.left - ra.right, hA: ra.height, hB: rb.height, haut: Math.abs(ra.top - rb.top) };
    },
    [fleche, principal],
  );
  /* Même fond tant que les deux servent ; le grand bouton ÉTEINT passe au gris franc, la flèche reste pleine (carte
     « Réponses mises en page et boutons contrastés »). */
  return { ok: !!r && (r.fondA === r.fondB || r.eteint) && !/rgba\(0, 0, 0, 0\)|transparent/.test(r.fondA) && Math.abs(r.ecart - 1) < 0.6 && Math.abs(r.hA - r.hB) < 0.6 && r.haut < 0.6 && r.icone >= 14, detail: JSON.stringify(r) };
}
async function partDuPied(page, selecteur) {
  return page.evaluate((sel) => {
    const b = document.querySelector(sel)?.getBoundingClientRect();
    const p = document.querySelector('[data-communication-pied-en-place]')?.getBoundingClientRect();
    return b && p ? b.width / (p.width - 32) : 0;
  }, selecteur);
}
/**
 * LA RAISON D'UN BOUTON ÉTEINT EST UNE INFOBULLE (09/11/2026) : portée par l'enveloppe du bouton
 * (`data-v2-raison-eteint` = la raison), JAMAIS écrite dans la page, et lue dans la bulle au survol.
 */
async function raisonEnBulle(page, conteneur, mot) {
  const env = page.locator(`${conteneur} [data-v2-raison-eteint]`).first();
  const raison = (await env.getAttribute('data-v2-raison-eteint').catch(() => null)) ?? '';
  const ecrite = raison ? await page.evaluate((r) => document.body.innerText.includes(r), raison) : true;
  await env.hover().catch(() => {});
  const bulle = await jusquA(async () => ((await page.locator('[role="tooltip"][data-infobulle]').innerText().catch(() => '')) ?? '').includes(mot), 4000);
  await page.mouse.move(2, 2);
  return { ok: raison.includes(mot) && !ecrite && bulle, detail: `raison=${raison} ecrite=${ecrite} bulle=${bulle}` };
}
/** Un bouton en icône seule : aucun texte lisible, mais un nom lu à voix haute. */
async function iconeSeule(page, selecteur) {
  const l = page.locator(selecteur);
  return (await l.count()) === 1 && (await l.innerText()).trim() === '' && !!(await l.getAttribute('aria-label'));
}
/** Un glisser au pointeur d'un élément vers un autre, par petits pas (le seuil de 5 px de `usePointerDrag`). */
async function glisser(page, de, vers) {
  const a = await de.boundingBox();
  const b = await vers.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 12, a.y + a.height / 2 + ((b.y + b.height / 2 - a.y - a.height / 2) * i) / 12);
  await page.mouse.up();
}

let navigateur;
try {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const marques = await marquesParNom();
  const kipou = marques['Kipou'];
  const lea = marques['Boutique Léa'];
  noter('la liste des marques porte les étapes de Communication 2 (campagnes prêtes comprises), sans avancement d’étude marketing', !!kipou?.v2 && !('analyse' in kipou.v2) && kipou.v2.reseauxChoisis === 2 && kipou.v2.comptesRelies === 1 && kipou.v2.campagnes === 0 && kipou.v2.campagnesPretes === 0, JSON.stringify(kipou?.v2));
  /* Un objectif déjà posé par l'outil Marketing reste en base, mais Communication 2 ne le propose plus (08/11/2026). */
  ecrire("INSERT INTO communication_objectifs (id, marque_id, titre, mesure, cible, echeance, pourquoi, statut, cree_le, maj_le) VALUES ('o-visites', ?, '300 visites en un mois', 'visites', 300, ?, 'Le site vend : plus de visites, plus de ventes.', 'actif', ?, ?)", kipou.id, dans(40), Date.now(), Date.now());

  navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => {
    erreurs.push(e.message);
    console.log(`  …  erreur de page : ${e.message}`);
  });

  /* ---- L'entrée « Tous les services » du menu à trois points de la colonne (la ligne « Services » a quitté la colonne,
     carte « Beluga piloté par des agents », 26/11/2026) ---- */
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const services = page.locator('[data-menu-dossier]').first();
  await services.waitFor({ state: 'visible', timeout: 30000 });
  await services.click();
  await page.locator('[data-tous-les-services]').first().click();
  await page.locator('[data-tous-les-services-panneau]').first().waitFor({ timeout: 8000 });
  const tuile = page.locator('[data-tous-les-services-panneau] [data-service-du-menu-colonne="communication2"]');
  noter('le menu n’a qu’un « Communication », sans « 2 »', (await tuile.count()) === 1 && (await tuile.innerText()).trim().startsWith('Communication') && !(await page.locator('[data-tous-les-services-panneau]').first().innerText()).match(/(Communication|Marketing) 2/), await tuile.innerText());
  noter('le Calendrier n’est plus au menu des services', (await page.locator('[data-tous-les-services-panneau] [data-service-du-menu-colonne="calendrier"]').count()) === 0);
  await tuile.click();
  /* L'ACCUEIL EST LA LISTE DES PROJETS QUI COMMUNIQUENT (carte « Fil d'Ariane et Communication repensés », 20/11/2026) :
     un projet ouvre ses campagnes, une campagne sa conversation et son suivi. Plus d'onglets Campagnes / Comptes /
     Réponses : les comptes reliés et les réponses vivent dans le menu « … » de la page d'un projet. */
  await page.waitForSelector('[data-v2-accueil]', { timeout: 20000 });
  noter('sans marque ouverte, la page liste les projets qui communiquent', (await page.getAttribute('[data-v2-accueil]', 'data-v2-accueil')) === 'projets' && (await jusquA(async () => (await page.locator(`[data-v2-accueil-projet="${kipou.id}"]`).count()) === 1)));
  noter('plus d’onglets Campagnes / Comptes / Réponses sur l’accueil', (await page.locator(['v2-accueil-onglet'].map((n) => `[data-${n}]`).join(', ')).count()) === 0);
  noter('ni chef flottant dans Communication 2 (le bouton du bord y ouvre l’assistant, 16/11/2026)', (await page.locator('[data-communication-rond-chef]').count()) === 0);
  await capturer(page, '01-marques-ordinateur');

  /* ---- La page d'un projet : ses campagnes, sans onglets ; Comptes reliés et Réponses au menu « … » ---- */
  await page.goto(`${BASE}/#communication/${kipou.id}`);
  noter('la marque s’ouvre sur la liste des campagnes', await jusquA(async () => (await page.locator('[data-communication2]').last().getAttribute('data-v2-page')) === 'campagnes'));
  noter('l’adresse de la page est à elle : #communication/<marque>', page.url().includes(`#communication/${kipou.id}`));
  noter('plus de rangée d’onglets ni de choix de la marque dans la page', (await page.locator(['v2-etapes-en-rangee', 'v2-choix-marque', 'v2-colonne'].map((n) => `[data-${n}]`).join(', ')).count()) === 0);
  noter('le menu « … » du projet porte « Comptes reliés » et « Réponses »', await jusquA(async () => (await page.locator('[data-v2-option="connexion"]').count()) + (await page.locator('[data-options-de-page="menu"], [data-options-de-zone]').count()) >= 1));

  /* ---- Les anciennes adresses : la page « Plan marketing » et l'étape « Réseaux » nue mènent aux campagnes ---- */
  await page.goto(`${BASE}/#communication/${kipou.id}/plan`);
  noter('une ancienne adresse du plan ouvre les campagnes', await jusquA(async () => (await page.locator('[data-communication2]').last().getAttribute('data-v2-page')) === 'campagnes'));
  noter('l’ancienne adresse du plan se corrige', await jusquA(() => sansPortee(page.url()).endsWith(`#communication/${kipou.id}/campagnes`)), page.url());
  noter('plus aucune page du plan ni bouton vers l’étude marketing', (await page.locator('[data-v2-plan], [data-v2-ouvrir-etude], [data-v2-lancer-plan], [data-v2-preparer-plan]').count()) === 0);
  await page.goto(`${BASE}/#communication/${kipou.id}/canaux`);
  noter('l’ancienne adresse de l’étape « Réseaux » ouvre les campagnes', await jusquA(async () => (await page.locator('[data-communication2]').last().getAttribute('data-v2-page')) === 'campagnes'));
  await page.goto(`${BASE}/#communication/${kipou.id}/canaux/reglages`);
  noter('les réglages avancés des réseaux restent joignables', await jusquA(async () => (await page.locator('[data-communication2]').last().getAttribute('data-v2-page')) === 'canaux'));

  /* ---- Les étapes s'ouvrent dans l'ordre : la connexion attend une campagne PRÊTE (tous ses visuels faits) ---- */
  await page.goto(`${BASE}/#communication/${lea.id}/connexion`);
  /* La page de service (par-dessus) porte la marque ; la zone garde, dessous, l'écran d'avant. */
  noter('une adresse vers la connexion, sans campagne prête, ouvre les campagnes', await jusquA(async () => (await page.locator('[data-communication2]').last().getAttribute('data-v2-page')) === 'campagnes'));
  noter('l’adresse se corrige sur l’étape ouverte', await jusquA(() => sansPortee(page.url()).endsWith(`#communication/${lea.id}/campagnes`)), page.url());
  noter('la barre d’étapes du haut a disparu', (await page.locator('[data-v2-etapes-du-haut], [data-v2-barre-rond], [data-tete-en-place]').count()) === 0);
  await capturer(page, '03-campagnes-premiere-etape-ordinateur');

  /* ---- Étape 2 : les campagnes — la liste et son chat ---- */
  await page.goto(`${BASE}/#communication/${kipou.id}/campagnes`);
  await page.waitForSelector('[data-v2-campagnes-vide]', { timeout: 15000 });
  noter('la première campagne se crée sans plan préalable', (await page.locator('[data-communication-pied-en-place] [data-v2-nouvelle-campagne]').count()) === 1 && (await page.locator('[data-v2-renvoi-plan], [data-v2-aller-au-plan]').count()) === 0);
  /* UN SEUL BOUTON EN BAS (10/11/2026, carte « Volet des campagnes comme un plan ») : « Créer une nouvelle campagne »,
     pleine largeur — plus de champ du chef, plus de « Suivant : Connexion », plus de bouton en haut. */
  noter('la liste des campagnes n’a plus de champ du chef ni de « Suivant »', (await page.locator('[data-v2-champ="campagnes"], [data-v2-barre-etapes], [data-v2-suivant]').count()) === 0);
  /* Pleine largeur = toute la colonne du pied (920 px au plus sur ordinateur, comme le contenu). */
  const partDeLaColonne = await page.evaluate(() => {
    const b = document.querySelector('[data-v2-nouvelle-campagne]')?.getBoundingClientRect();
    const c = document.querySelector('[data-communication-pied-en-place] > div')?.getBoundingClientRect();
    return b && c ? b.width / c.width : 0;
  });
  noter('« Créer une nouvelle campagne » est le seul bouton du bas, pleine largeur', (await page.locator('[data-v2-nouvelle-campagne]').count()) === 1 && (await page.locator('[data-v2-nouvelle-campagne]').innerText()).includes('Créer une nouvelle campagne') && partDeLaColonne >= 0.99, partDeLaColonne.toFixed(2));
  noter('plus de bouton « Nouvelle campagne » en haut', (await page.locator('[data-communication-entete-en-place] [data-v2-nouvelle-campagne], [data-gestes-de-page="barre"] [data-v2-nouvelle-campagne]').count()) === 0);
  /* ---- « NOUVELLE CAMPAGNE » = UNE CONVERSATION (10/11/2026) : le champ des agents, sans barre d'étapes en haut ---- */
  await page.locator('[data-v2-nouvelle-campagne]').click();
  await page.waitForSelector('[data-v2-nouvelle-conversation] [data-composer] textarea', { timeout: 15000 });
  noter('« Nouvelle campagne » ouvre le champ d’écriture des agents, en page', (await page.locator('[data-v2-nouvelle-conversation] [data-composer]').count()) === 1 && (await page.locator('[role="dialog"] [data-v2-nouvelle-conversation]').count()) === 0);
  noter('plus de barre d’étapes ni d’écrans de l’assistant en haut', (await page.locator('[data-v2-pas-assistant], [data-entete-haut], [data-v2-assistant], [data-v2-grille-periode]').count()) === 0);
  noter('plus de flèche de retour en haut de la création', (await page.locator('[data-communication2] [data-communication-retour-en-place]').count()) === 0);
  noter('le fil d’Ariane dit « Nouvelle campagne »', (await page.locator('[data-v2-cran-campagne="nouvelle"]').count()) === 1);
  await capturer(page, '04-nouvelle-campagne-ordinateur');
  /* LES RÉSEAUX SE CHOISISSENT AU DÉBUT DE CHAQUE CAMPAGNE (12/11/2026) : des cases au-dessus du champ, celles déjà
     choisies ou reliées cochées d'office ; sans aucun réseau, l'envoi est refusé et le texte rendu. */
  await page.waitForSelector('[data-v2-reseau-campagne]', { timeout: 15000 });
  const reseauxProposes = await page.$$eval('[data-v2-reseau-campagne]', (els) => els.map((e) => e.getAttribute('data-v2-reseau-campagne')));
  const reseauxCoches = (await page.getAttribute('[data-v2-reseaux-de-campagne]', 'data-v2-reseaux-de-campagne')) ?? '';
  noter('la nouvelle campagne demande ses réseaux, ceux de la marque cochés d’office', reseauxProposes.length >= 2 && reseauxCoches.includes('instagram'), JSON.stringify({ reseauxProposes, reseauxCoches }));
  const champNouvelle = page.locator('[data-v2-nouvelle-conversation] [data-composer] textarea').first();
  await champNouvelle.fill('Montrer nos jouets en bois aux parents avant Noël. Sur Instagram.');
  await page.locator('[data-v2-nouvelle-conversation] [data-composer-envoi]').click();
  await page.waitForFunction((m) => /#communication\/[^/]+\/campagnes\/[^/]+$/.test(location.hash) && !location.hash.endsWith('/nouvelle'), kipou.id, { timeout: 15000 });
  const campagne = lire('SELECT * FROM communication_campagnes WHERE marque_id = ? ORDER BY cree_le DESC', kipou.id);
  noter('la campagne naît au premier message, « en préparation », avec un titre provisoire', !!campagne && campagne.statut === 'preparation' && campagne.titre === 'Montrer nos jouets en bois aux parents avant Noël', JSON.stringify({ statut: campagne?.statut, titre: campagne?.titre }));
  noter('les réseaux cochés partent avec la campagne', reseauxCoches.split(',').filter(Boolean).every((r) => (campagne?.reseaux ?? '').includes(r)), campagne?.reseaux);
  const agentDeLaCampagne = lire('SELECT value FROM meta WHERE key = ?', `communication.chef.campagne.${campagne.id}`)?.value;
  noter('son agent naît avec elle, à l’adresse de la campagne', !!agentDeLaCampagne && JSON.parse(lire('SELECT data FROM agents WHERE id = ?', agentDeLaCampagne)?.data ?? '{}').service?.adresse === `communication2/${kipou.id}/campagnes/${campagne.id}`);
  noter('le message de la personne est sa première bulle, sans mot d’accueil', lireTout('SELECT role FROM messages WHERE agent_id = ?', agentDeLaCampagne).map((m) => m.role).join(',') === 'user');
  noter('aucun drapeau de coulisses : l’agent de la campagne peut poser ses questions', !drapeau('campagnes') && !drapeau('programme'));
  noter('aucun moteur n’est joint pendant le contrôle', !journal.join('').includes('fil du moteur reparti'));
  await page.waitForSelector(`[data-v2-campagne="${campagne.id}"] [data-v2-conversation-campagne="${agentDeLaCampagne}"]`, { timeout: 15000 });
  noter('la page de la campagne EST sa conversation : le fil des agents et son champ', await jusquA(async () => (await page.locator(`[data-v2-conversation-campagne="${agentDeLaCampagne}"] [data-composer]`).count()) === 1 && (await page.locator(`[data-v2-conversation-campagne="${agentDeLaCampagne}"]`).innerText()).includes('jouets en bois'), 15000));
  noter('plus de champ silencieux du chef sur la campagne', (await page.locator('[data-v2-champ="campagne"], [data-v2-champ="programme"]').count()) === 0);
  noter('le nom de la campagne est le dernier cran du fil d’Ariane', await jusquA(async () => (await page.locator(`[data-v2-cran-campagne="${campagne.id}"]`).count()) === 1));
  noter('pas de grand titre en doublon du fil d’Ariane', (await page.locator('[data-communication2] [data-communication-titre-en-place]').count()) === 0);
  /* Les réseaux choisis à la création sont DÉJÀ un point tranché du plan (12/11/2026) : le volet s'ouvre sur eux. */
  noter('les réseaux choisis sont déjà au plan : le volet s’ouvre', await jusquA(async () => (await page.getAttribute('[data-v2-campagne]', 'data-v2-volet')) === 'ouvert'), await page.getAttribute('[data-v2-campagne]', 'data-v2-volet'));

  /* LE VISUEL VIVANT (carte du 10/11/2026) : l'esquisse que le démon a dessinée pour l'agent rejoint SA discussion,
     devient l'image de la campagne, reste hors de Médias ; le suivi d'un média du Studio porte un BOUTON qui ouvre le
     Studio dans une nouvelle fenêtre. Le dessin lui-même (Codex) est prouvé par les tests du démon : ici, son résultat. */
  const projetDeLAgent = JSON.parse(lire('SELECT data FROM agents WHERE id = ?', agentDeLaCampagne)?.data ?? '{}').projectId;
  const esquisse = 'e5e5e5e5-0000-4000-8000-000000000005';
  {
    const db = base();
    poserUnePiece(db, esquisse, projetDeLAgent, 'esquisse-campagne-1.png');
    const maintenant = Date.now();
    db.prepare("INSERT INTO medias_livres (id, project_id, card_id, agent_id, attachment_id, genre, groupe, version, sujet, outil, legende, livre_le) VALUES ('ml-esquisse', ?, NULL, ?, ?, 'image', 'esquisse', 1, 'Esquisse 1', 'Esquisse de campagne — Codex du serveur, sans frais', 'Esquisse 1', ?)").run(projetDeLAgent, agentDeLaCampagne, esquisse, maintenant);
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(`communication.esquisse.${campagne.id}`, esquisse);
    const message = (id, contenu, pieces, decalage) =>
      db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at, a_questions, streaming) VALUES (?, ?, ?, ?, ?, 0, 0)').run(id, agentDeLaCampagne, 'assistant', JSON.stringify({ id, agentId: agentDeLaCampagne, role: 'assistant', content: contenu, attachments: pieces, createdAt: maintenant + decalage }), maintenant + decalage);
    message('msg-esquisse', 'Voici l’esquisse de l’idée : un jouet en bois au pied du sapin.', [esquisse], 1);
    message('msg-suivi-studio', '🖼️ **Image « Noël en bois » — Studio**\n\nÉtape : Brief — le directeur artistique cadre l’image dans le Studio.\n\n[Ouvrir dans le Studio](#studio/creation-essai)', [], 2);
    db.close();
  }
  await page.reload();
  await page.waitForSelector(`[data-v2-conversation-campagne="${agentDeLaCampagne}"]`, { timeout: 15000 });
  noter('l’esquisse se voit dans la discussion de la campagne', await jusquA(async () => (await page.locator(`[data-v2-conversation-campagne="${agentDeLaCampagne}"] img[src*="${esquisse}"]`).count()) >= 1, 15000));
  const boutonStudio = page.locator(`[data-v2-conversation-campagne="${agentDeLaCampagne}"] button[data-ouvrir-le-studio="creation-essai"]`);
  noter('le suivi du Studio porte un BOUTON « Ouvrir dans le Studio », plus un lien', await jusquA(async () => (await boutonStudio.count()) === 1) && (await boutonStudio.innerText()).includes('Ouvrir dans le Studio'));
  await capturer(page, 'campagne-esquisse-et-studio');
  const [fenetre] = await Promise.all([page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null), boutonStudio.click()]);
  noter('le bouton ouvre le Studio de la création dans une NOUVELLE fenêtre', !!fenetre && (await jusquA(() => fenetre.url().endsWith('#studio/creation-essai'), 5000)) && page.url().includes('#communication/'), fenetre?.url() ?? 'aucune fenêtre');
  await fenetre?.close();
  const listeAvecEsquisse = await commande({ type: 'communication.campagnes', marqueId: kipou.id }).catch(() => null);
  const ligneEsquisse = listeAvecEsquisse?.campagnes?.find((c) => c.id === campagne.id);
  noter('la dernière esquisse est l’image de la campagne dans la liste', ligneEsquisse?.apercu === esquisse, JSON.stringify({ apercu: ligneEsquisse?.apercu ?? null }));
  const mediasAvecEsquisse = await commande({ type: 'communication.medias', marqueId: kipou.id }).catch(() => null);
  noter('l’esquisse n’entre pas dans Médias', !!mediasAvecEsquisse && !JSON.stringify(mediasAvecEsquisse).includes(esquisse) && !lire('SELECT 1 FROM studio_medias WHERE attachment_id = ?', esquisse));

  /* L'agent tranche, réponse après réponse : le plan se remplit à droite. */
  await commande({ type: 'communication.campagne.ecrire', campagne: { id: campagne.id, titre: 'Noël en bois', typesMedias: ['image', 'carrousel'], quantiteMedias: 3, rythme: '3 par semaine', cible: 'Les parents pressés', reseaux: ['instagram'], debut: dans(1), fin: dans(12), message: 'Un jouet qui dure', ton: 'Chaleureux', appelAction: 'Découvrir la boutique', objectifChiffre: 300, mesure: 'visites', strategie: { idee: 'Faire connaître la boutique avant Noël', parcours: 'Découverte sur Instagram, puis visite de la boutique' } } });
  /* LE SUIVI EST OUVERT D'OFFICE (20/11/2026) ; les huit points et la stratégie vivent sous son volet « Plan ». */
  await page.locator('[data-v2-volet-du-suivi="plan"]').click().catch(() => undefined);
  noter('le volet « Plan » du suivi montre les huit points tranchés', await jusquA(async () => (await page.getAttribute('[data-v2-campagne]', 'data-v2-volet')) === 'ouvert' && (await page.locator('[data-v2-volet-campagne] [data-v2-fiche="0"]').count()) === 1, 15000));
  noter('la stratégie s’y lit par rubrique, ce qui reste à trancher en « — »', (await page.locator('[data-v2-rubrique="idee"][data-etat="tranchee"]').count()) === 1 && (await page.locator('[data-v2-rubrique="angles"][data-etat="a-trancher"]').count()) === 1 && (await page.getAttribute('[data-v2-volet-strategie]', 'data-v2-volet-strategie')) === '5');
  noter('le volet est en lecture seule : aucun champ ni « Retirer »', (await page.locator('[data-v2-volet-campagne] :is(input, textarea, [contenteditable="true"], [data-v2-retirer], [data-v2-jour-programme])').count()) === 0);
  noter('le volet est à droite de la conversation', await page.evaluate(() => {
    const v = document.querySelector('[data-v2-volet-campagne]')?.getBoundingClientRect();
    const c = document.querySelector('[data-v2-conversation-campagne]')?.getBoundingClientRect();
    return !!v && !!c && v.left >= c.right - 1 && v.width >= 300;
  }));
  /* LE VOLET D'UNE CAMPAGNE EST CELUI DU PLAN D'UNE CARTE (10/11/2026) : collé au bord droit, même largeur gardée
     (`width.document-de-carte`, 520 px au départ), même cadre gris et fenêtre arrondie, entête titre + croix. */
  const formeDuVolet = await page.evaluate(() => {
    const v = document.querySelector('[data-v2-volet-campagne]');
    const f = v?.querySelector('[data-v2-fenetre-du-volet]');
    const r = v?.getBoundingClientRect();
    const c = document.querySelector('[data-v2-conversation-campagne]')?.getBoundingClientRect();
    const fil = document.querySelector('[data-v2-conversation-campagne] [data-composer]')?.getBoundingClientRect();
    const sv = v ? getComputedStyle(v) : null;
    const sf = f ? getComputedStyle(f) : null;
    return {
      bord: r ? Math.round(window.innerWidth - r.right) : -1,
      largeur: r ? Math.round(r.width) : 0,
      fond: sv?.backgroundColor ?? '',
      marge: sv?.paddingTop ?? '',
      arrondi: sf?.borderTopLeftRadius ?? '',
      titre: v?.querySelector('[data-croix-du-volet="campagne"]') ? v.innerText.split('\n')[0] : '',
      centre: c && fil ? Math.abs((fil.left + fil.right) / 2 - (c.left + c.right) / 2) : 99,
    };
  });
  noter('le volet est collé au bord droit de l’écran', formeDuVolet.bord <= 1, JSON.stringify(formeDuVolet));
  noter('sa largeur de départ est celle du plan d’une carte (520 px)', formeDuVolet.largeur === 520, String(formeDuVolet.largeur));
  noter('même cadre que le plan : fond gris, marge de 8 px, fenêtre arrondie', formeDuVolet.fond !== 'rgba(0, 0, 0, 0)' && formeDuVolet.marge === '8px' && parseFloat(formeDuVolet.arrondi) >= 10, JSON.stringify(formeDuVolet));
  noter('l’entête du volet : « Suivi de la campagne » et sa croix', formeDuVolet.titre === 'Suivi de la campagne', formeDuVolet.titre);
  noter('le suivi : trois chiffres puis quatre volets — Programme, Calendrier, Réponses, Plan', (await page.locator('[data-v2-suivi-chiffres] [data-v2-chiffre]').count()) === 3 && (await page.locator('[data-v2-volet-du-suivi]').evaluateAll((n) => n.map((e) => e.getAttribute('data-v2-volet-du-suivi')).join(','))) === 'programme,calendrier,reponses,plan');
  noter('la conversation est centrée dans la place restante', formeDuVolet.centre <= 2, String(formeDuVolet.centre));
  /* DEPUIS LE 14/11/2026 : plus de barre vide au-dessus d'une campagne — le bouton du volet et les trois points sont en
     haut à droite du FIL, la rangée des étapes a disparu, et le parcours de la campagne est en bas, au-dessus du champ. */
  noter('les gestes de la campagne sont au « … » de la barre du fil, plus de ligne au-dessus de la conversation', (await page.locator('[data-gestes-de-page="barre-du-projet"] [data-options-de-page="menu"]').count()) === 1 && (await page.locator(['v2-sous-titre-campagne', 'v2-options-campagne'].map((n) => `[data-${n}]`).join(', ')).count()) === 0);
  noter('le parcours de la campagne est en bas, au-dessus du champ', await jusquA(async () => (await page.locator('[data-composer] [data-ligne-de-parcours="campagne"], [data-temoin-reflexion] [data-ligne-de-parcours="campagne"]').count()) === 1, 15000));
  /* La poignée : même geste que celui du plan d'une carte, la largeur suit, se garde, et le double-clic la rend. */
  const poignee = await page.locator('[data-document-poignee="v2-volet-campagne"]').boundingBox();
  if (poignee) {
    await page.mouse.move(poignee.x + poignee.width / 2, poignee.y + poignee.height / 2);
    await page.mouse.down();
    await page.mouse.move(poignee.x - 80, poignee.y + poignee.height / 2, { steps: 6 });
    await page.mouse.up();
  }
  const elargi = await page.evaluate(() => Math.round(document.querySelector('[data-v2-volet-campagne]')?.getBoundingClientRect().width ?? 0));
  noter('la poignée élargit le volet', elargi >= 590 && elargi <= 610, String(elargi));
  noter('la largeur se garde sous la mémoire du plan des cartes', await jusquA(() => Number(lire("SELECT value FROM preferences WHERE key = 'width.document-de-carte'")?.value ?? 0) >= 590));
  await page.locator('[data-document-poignee="v2-volet-campagne"]').dblclick();
  noter('le double-clic rend la largeur de départ', await jusquA(async () => Math.round((await page.locator('[data-v2-volet-campagne]').boundingBox())?.width ?? 0) === 520));
  const contenu = (id, titre, jour) =>
    ecrire(
      `INSERT INTO marketing_contenus (id, project_id, genre, canal, canaux, titre, texte, date_prevue, heure_prevue, etape, origine, campagne_id, cree_le, maj_le) VALUES (?, 'p-kipou', 'post', 'instagram', '["instagram"]', ?, 'Nos jouets en bois, faits pour durer.', ?, '18:00', 'brouillon', 'agent', ?, ?, ?)`,
      id,
      titre,
      jour,
      campagne.id,
      Date.now(),
      Date.now(),
    );
  const debut = dans(1);
  contenu('v2-p1', 'Le cheval à bascule', debut);
  contenu('v2-p2', 'Les cubes qui durent', dans(12));
  contenu('v2-p3', 'Coulisses de l’atelier', dans(2));
  await commande({ type: 'communication.campagne.ecrire', campagne: { id: campagne.id } });
  await page.locator('[data-v2-volet-du-suivi="programme"]').click().catch(() => undefined);
  noter('le programme paraît dans le volet', await jusquA(async () => (await page.locator('[data-v2-volet-programme="3"]').count()) === 1, 15000));
  const bulleProgramme = await page.locator('[data-v2-volet-programme] [data-v2-raison-eteint]').getAttribute('data-v2-raison-eteint').catch(() => null);
  noter('« Valider le programme » attend la stratégie complète, et le dit en infobulle', (await page.locator('[data-v2-valider-programme]').isDisabled()) && (bulleProgramme ?? '').includes('stratégie'), bulleProgramme ?? '');
  await commande({ type: 'communication.campagne.ecrire', campagne: { id: campagne.id, strategie: { angles: 'A : le jouet qui dure · B : le cadeau local', concurrence: 'Les grandes enseignes en plastique', preuves: '**Avis de parents** et *photos réelles* :\n- un jouet après deux ans\n- l’atelier en vidéo', budget: 'Aucun : tout en organique', indicateurs: '| Semaine | Visites visées | Ce qui compte pour juger la semaine |\n|---|---|---|\n| 1 | **50** | Premières visites venues d’Instagram |\n| 2 | 75 | Taux de clic sur le lien de la boutique |' } } });
  noter('la stratégie complète, « Valider le programme » s’allume, son coût dit avant (0 $)', await jusquA(async () => !(await page.locator('[data-v2-valider-programme]').isDisabled()), 15000) && (await page.locator('[data-v2-cout-visuels]').innerText()).includes('0 $'));
  /* LE TEXTE DE LA STRATÉGIE SE LIT COMME DANS LE CHAT (capture #4d55, 11/11/2026) : gras, italique, listes et
     tableaux mis en forme, jamais un « ** » ni un « |---| » brut, et le tableau défile chez lui sans élargir le volet. */
  await page.locator('[data-v2-volet-du-suivi="plan"]').click().catch(() => undefined);
  await page.waitForSelector('[data-v2-rubrique="indicateurs"] table', { timeout: 15000 }).catch(() => undefined);
  {
    const rendu = await page.locator('[data-v2-volet-strategie]').evaluate((e) => ({
      tableaux: e.querySelectorAll('[data-v2-rubrique="indicateurs"] [data-tableau-markdown] table').length,
      gras: e.querySelectorAll('[data-v2-rubrique="preuves"] strong, [data-v2-rubrique="indicateurs"] strong').length,
      italique: e.querySelectorAll('[data-v2-rubrique="preuves"] em').length,
      puces: e.querySelectorAll('[data-v2-rubrique="preuves"] li').length,
      texte: e.innerText,
      taille: parseFloat(getComputedStyle(e.querySelector('[data-v2-rubrique="preuves"] li') ?? e).fontSize),
    }));
    noter('la stratégie se lit comme dans le chat : tableau, gras, italique, liste, à la taille du volet', rendu.tableaux === 1 && rendu.gras >= 2 && rendu.italique === 1 && rendu.puces === 2 && rendu.taille <= 13.5, JSON.stringify({ ...rendu, texte: undefined }));
    noter('… sans aucun signe brut (« ** », « |---| »)', !/\*\*|\|\s*-{3}|^\s*-\s/m.test(rendu.texte), rendu.texte.slice(0, 120));
    const debord = await page.evaluate(() => {
      const v = document.querySelector('[data-v2-volet-campagne]')?.getBoundingClientRect();
      const t = document.querySelector('[data-v2-rubrique="indicateurs"] [data-tableau-markdown]')?.getBoundingClientRect();
      return { tableau: v && t ? Math.round(t.right - v.right) : null, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    noter('… et le tableau tient dans le volet, sans élargir la page', debord.page <= 0 && debord.tableau !== null && debord.tableau <= 1, JSON.stringify(debord));
    await page.locator('[data-v2-rubrique="indicateurs"]').scrollIntoViewIfNeeded().catch(() => undefined);
    await capturer(page, '06b-plan-de-campagne-mis-en-forme-ordinateur');
  }
  await capturer(page, '06-campagne-conversation-et-plan-ordinateur');

  /* Les visuels fabriqués, en attente : « Tout valider ». */
  ecrire("UPDATE marketing_contenus SET etape = 'a_valider' WHERE id IN ('v2-p1', 'v2-p2')");
  ecrire("INSERT INTO communication_media_contenu (contenu_id, attachment_id, cree_le) VALUES ('v2-p1', 'b1b1b1b1-0000-4000-8000-000000000001', ?), ('v2-p2', 'b2b2b2b2-0000-4000-8000-000000000002', ?)", Date.now(), Date.now());
  await commande({ type: 'communication.campagne.ecrire', campagne: { id: campagne.id } });
  await page.locator('[data-v2-volet-du-suivi="programme"]').click().catch(() => undefined);
  noter('« Tout valider » compte les visuels qui attendent', await jusquA(async () => (await page.locator('[data-v2-tout-valider="2"]').count()) === 1));
  /* Le volet Calendrier : le mois de la campagne, ses publications posées sur leur jour. */
  await page.locator('[data-v2-volet-du-suivi="calendrier"]').click();
  noter('le volet Calendrier pose les publications sur leur jour', await jusquA(async () => (await page.locator(`[data-v2-calendrier-campagne] [data-v2-jour] [data-v2-calendrier-publication]`).count()) >= 1));
  await capturer(page, '08-calendrier-de-la-campagne-ordinateur');
  await page.locator('[data-v2-volet-du-suivi="plan"]').click();
  noter('les résultats se lisent dans le volet Plan', await jusquA(async () => (await page.locator('[data-v2-volet-campagne] [data-v2-resultats]').count()) === 1));
  await page.locator('[data-v2-volet-du-suivi="programme"]').click();
  noter('plus de barre d’étapes en haut ; une campagne (page enfant) n’a pas de « Suivant » d’étape', (await page.locator('[data-v2-etapes-du-haut], [data-v2-barre-rond], [data-v2-pas-assistant]').count()) === 0 && (await page.locator('[data-v2-barre-etapes]').count()) === 0);
  await capturer(page, '07-campagne-ordinateur');
  await page.locator('[data-v2-volet-campagne] [data-v2-publication]').first().click();
  noter('un clic ouvre l’aperçu dans la feuille du bas', await jusquA(async () => (await page.locator('[data-v2-navigation-apercu]').count()) >= 1 && (await page.locator('[data-v2-apercu] [data-communication-apercu-post]').count()) === 1));
  noter('l’adresse suit l’aperçu ouvert', page.url().includes(`/pub/`));
  noter('la feuille porte « Valider », la retouche se demande à l’agent', (await page.locator('[data-v2-apercu] [data-v2-valider]').count()) === 1 && (await page.locator('[data-v2-apercu] [data-v2-champ="retouche"]').count()) === 0);
  const premiere = await page.locator('[data-v2-apercu]').getAttribute('data-v2-apercu');
  await page.keyboard.press('ArrowRight');
  noter('la flèche droite du clavier passe à la publication suivante', await jusquA(async () => (await page.locator('[data-v2-apercu]').getAttribute('data-v2-apercu').catch(() => premiere)) !== premiere));
  await capturer(page, '07b-campagne-apercu-ordinateur');
  await page.locator('[data-v2-apercu-precedent]').click();
  noter('« Précédente » ramène à la première', await jusquA(async () => (await page.locator('[data-v2-apercu]').getAttribute('data-v2-apercu').catch(() => null)) === premiere));
  await page.keyboard.press('Escape');
  noter('Échap referme la feuille d’aperçu', await jusquA(async () => (await page.locator('[data-v2-navigation-apercu]').count()) === 0));
  await page.locator('[data-v2-tout-valider="2"]').click();
  noter('« Tout valider » valide les deux visuels d’un coup', await jusquA(() => lireTout("SELECT etape FROM marketing_contenus WHERE id IN ('v2-p1', 'v2-p2')").every((l) => l.etape === 'pret')));

  /* Le volet se replie, et le pli est retenu. */
  await page.locator('[data-options-de-page="menu"]').first().click();
  await page.locator('[data-v2-plier-volet="ouvert"]').click();
  noter('le volet se replie d’un geste du « … »', await jusquA(async () => (await page.locator('[data-v2-volet-campagne]').count()) === 0));
  await page.reload({ waitUntil: 'domcontentloaded' });
  noter('le pli du volet est retenu après rechargement', await jusquA(async () => (await page.locator('[data-v2-rangee-campagne]').count()) === 1 && (await page.locator('[data-v2-volet-campagne]').count()) === 0, 15000));
  await page.locator('[data-options-de-page="menu"]').first().click();
  await page.locator('[data-v2-plier-volet="ferme"]').click();
  await jusquA(async () => (await page.locator('[data-v2-volet-campagne]').count()) === 1);

  /* L'ancienne adresse du programme ouvre la campagne, volet ouvert, et se corrige. */
  await page.goto(`${BASE}/#communication/${kipou.id}/campagnes/${campagne.id}/programme`);
  noter('l’ancienne adresse du programme ouvre la campagne et se corrige', await jusquA(async () => sansPortee(page.url()).endsWith(`/campagnes/${campagne.id}`) && (await page.locator('[data-v2-volet-campagne]').count()) === 1, 15000), page.url());

  /* Le menu « … » de la campagne : « Supprimer », avec sa confirmation. */
  await page.locator('[data-options-de-page="menu"]').first().click();
  noter('les trois points du fil proposent « Supprimer »', await jusquA(async () => (await page.locator('[data-v2-supprimer-campagne="pret"]').count()) === 1));
  await page.locator('[data-v2-supprimer-campagne="pret"]').click();
  noter('la confirmation dit ce qui sera annulé et que la campagne se récupère 30 jours', await jusquA(async () => (await page.locator(`[data-v2-confirmer-suppression="${campagne.id}"]`).count()) === 1) && (await page.locator('[data-v2-suppression-publications]').count()) === 1 && (await page.locator(`[data-v2-confirmer-suppression="${campagne.id}"]`).innerText()).includes('30 jours'));
  await capturer(page, '07c-campagne-confirmation-ordinateur');
  await page.keyboard.press('Escape');
  await jusquA(async () => (await page.locator('[data-v2-confirmer-suppression]').count()) === 0);

  /* Une campagne plus ancienne : son agent naît à la première ouverture, avec un mot d'accueil sans moteur. */
  await commande({ type: 'communication.campagne.ecrire', campagne: { marqueId: kipou.id, titre: 'Ancienne campagne', statut: 'en_cours' } });
  const ancienne = lire("SELECT id FROM communication_campagnes WHERE titre = 'Ancienne campagne'");
  await page.goto(`${BASE}/#communication/${kipou.id}/campagnes/${ancienne.id}`);
  const agentAncienne = await jusquA(() => !!lire('SELECT value FROM meta WHERE key = ?', `communication.chef.campagne.${ancienne.id}`), 15000);
  const idAncienne = lire('SELECT value FROM meta WHERE key = ?', `communication.chef.campagne.${ancienne.id}`)?.value;
  noter('une campagne plus ancienne retrouve son agent, avec un mot d’accueil sans moteur', agentAncienne && lireTout('SELECT role FROM messages WHERE agent_id = ?', idAncienne).map((m) => m.role).join(',') === 'assistant');
  noter('… et sa conversation s’affiche', await jusquA(async () => (await page.locator(`[data-v2-conversation-campagne="${idAncienne}"] [data-composer]`).count()) === 1, 15000));

  /* ---- La liste : clic droit « Supprimer », la corbeille, « Restaurer » ---- */
  await page.goto(`${BASE}/#communication/${kipou.id}/campagnes`);
  await page.waitForSelector(`[data-communication-ligne="${ancienne.id}"]`, { timeout: 15000 });
  noter('une campagne née en conversation porte « En préparation » dans la liste', (await page.locator(`[data-communication-ligne="${campagne.id}"]`).innerText()).includes('En préparation'));
  /* LES CAMPAGNES EN CARTES (12/11/2026, capture #aacc) : une grille, chaque campagne une carte avec son titre entier ;
     recherche et tri au-dessus. */
  /* LA BASCULE LIGNES / CARTES (14/11/2026) : le tableau par défaut, les cartes d'un clic, le choix retenu. */
  await page.locator('[data-bascule-tableau-cartes="vue-des-campagnes"] [data-onglet="cartes"]').first().click().catch(() => undefined);
  await jusquA(async () => (await page.locator('[data-v2-carte-campagne]').count()) >= 2);
  noter('la liste des campagnes est une grille de cartes', (await page.locator('[data-v2-campagnes] [data-tableau-cartes] [data-v2-carte-campagne]').count()) >= 2 && (await page.locator('[data-v2-campagnes] table').count()) === 0);
  /* LA RECHERCHE EST CELLE DE LA PAGE (20/11/2026) : sur la même ligne que la bascule, jamais une rangée de plus. */
  const rechercheDesCampagnes = page.locator('[data-v2-recherche-campagnes] input, input[data-v2-recherche-campagnes]').first();
  noter('la grille garde la recherche et le tri du tableau', (await rechercheDesCampagnes.count()) === 1 && (await page.locator('[data-tableau-bouton-tri="campagnes-v2"]').count()) === 1);
  await rechercheDesCampagnes.fill('Ancienne campagne');
  noter('la recherche filtre les cartes', await jusquA(async () => (await page.locator(`[data-v2-carte-campagne="${ancienne.id}"]`).count()) === 1 && (await page.locator(`[data-v2-carte-campagne="${campagne.id}"]`).count()) === 0), String(await page.locator('[data-v2-carte-campagne]').count()));
  await rechercheDesCampagnes.fill('');
  await jusquA(async () => (await page.locator('[data-v2-carte-campagne]').count()) >= 2);
  await capturer(page, '08-campagnes-en-cartes-ordinateur');
  const adresseDeLaListe = page.url();
  await page.locator(`[data-communication-ligne="${ancienne.id}"]`).click({ button: 'right' });
  noter('un clic droit sur une ligne ouvre son menu, sans ouvrir la campagne', await jusquA(async () => (await page.locator(`[data-v2-menu-ligne="${ancienne.id}"] [data-v2-menu-supprimer="pret"]`).count()) === 1) && page.url() === adresseDeLaListe);
  await capturer(page, '08a-campagnes-clic-droit-ordinateur');
  await page.locator('[data-v2-menu-supprimer="pret"]').click();
  await page.locator(`[data-v2-confirmer-suppression="${ancienne.id}"] [data-v2-confirmer-supprimer]`).click();
  noter('confirmée, la campagne quitte la liste et passe à la corbeille', await jusquA(async () => (await page.locator(`[data-communication-ligne="${ancienne.id}"]`).count()) === 0 && (await page.locator('[data-v2-corbeille-nombre="1"]').count()) === 1) && !!lire('SELECT supprime_le FROM communication_campagnes WHERE id = ?', ancienne.id)?.supprime_le);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-v2-corbeille="repliee"]', { timeout: 15000 });
  noter('la corbeille est repliée en bas de la liste, après rechargement aussi', (await page.locator(`[data-communication-ligne="${ancienne.id}"]`).count()) === 0);
  await page.locator('[data-v2-ouvrir-corbeille]').click();
  noter('la corbeille dit quand la campagne s’effacera', (await page.locator(`[data-v2-campagne-corbeille="${ancienne.id}"]`).innerText()).includes('Effacée pour de bon le'));
  await capturer(page, '08b-campagnes-corbeille-ordinateur');
  await page.locator(`[data-v2-campagne-corbeille="${ancienne.id}"]`).click({ button: 'right' });
  noter('le même menu au clic droit propose « Restaurer »', await jusquA(async () => (await page.locator('[data-v2-menu-restaurer="pret"]').count()) === 1));
  await page.locator('[data-v2-menu-restaurer="pret"]').click();
  noter('« Restaurer » la remet dans la liste', await jusquA(async () => (await page.locator(`[data-v2-campagnes] [data-communication-ligne="${ancienne.id}"]`).count()) === 1 && (await page.locator('[data-v2-corbeille]').count()) === 0, 15000));

  /* ---- L'ancien espace est retiré (11/11/2026) : son adresse ouvre la campagne ici ---- */
  await page.goto(`${BASE}/#communication/${kipou.id}/campagnes/${campagne.id}`);
  noter('l’ancienne adresse d’une campagne ouvre la campagne dans Communication', await jusquA(async () => (await page.evaluate(() => location.hash)) === `#communication/${kipou.id}/campagnes/${campagne.id}`, 15000), await page.evaluate(() => location.hash));
  await page.goto(`${BASE}/#communication/${kipou.id}/canaux/reglages`);
  noter('l’ancienne adresse des réglages avancés ouvre ceux de Communication', await jusquA(async () => (await page.locator('[data-v2-reglages-avances]').count()) === 1, 15000));

  /* ---- Le calendrier n'est plus une page (20/11/2026) : son ancienne adresse ouvre les campagnes du projet ---- */
  await page.goto(`${BASE}/#communication/${kipou.id}/calendrier`);
  noter('l’ancienne adresse du calendrier ouvre les campagnes du projet', await jusquA(async () => (await page.locator('[data-communication2]').last().getAttribute('data-v2-page')) === 'campagnes'));
  noter('l’adresse du calendrier se corrige', await jusquA(() => sansPortee(page.url()).endsWith(`#communication/${kipou.id}/campagnes`)), page.url());

  /* ---- Réponses : messages et commentaires réunis ---- */
  await page.goto(`${BASE}/#communication/${kipou.id}/reponses`);
  await page.waitForSelector('[data-v2-liste-reponses]', { timeout: 15000 });
  noter('« Réponses » a son chat, sans Précédent ni Suivant', (await page.locator('[data-v2-champ="reponses"]').count()) === 1 && (await page.locator('[data-v2-barre-etapes]').count()) === 0);
  noter('messages privés et commentaires sont dans une seule liste', (await page.locator('[data-v2-message]').count()) === 2);
  noter('la réponse proposée attend dans le champ, sans partir', await jusquA(async () => (await page.locator('[data-v2-champ-reponse]').inputValue()).includes('partout en Suisse')));
  await capturer(page, '09-reponses-ordinateur');
  await page.locator('[data-v2-message="m-comment"]').click();
  await page.waitForSelector('[data-v2-fil="m-comment"]', { timeout: 10000 });
  await page.locator('[data-v2-proposer-reponse]').click();
  noter('« Proposer une réponse » part au chef en coulisses, pour ce message', await jusquA(() => !!drapeau('reponse') && drapeau('reponse').value.includes('m-comment')));
  effacerLesDrapeaux();
  /* ---- Le bas de la liste des campagnes : un seul bouton (10/11/2026) ---- */
  await page.goto(`${BASE}/#communication/${kipou.id}/campagnes`);
  await page.waitForSelector('[data-communication-pied-en-place] [data-v2-nouvelle-campagne]', { timeout: 15000 });
  noter('Campagnes : ni flèche ni « Suivant », ni champ du chef, ni phrase sous le bouton', (await page.locator('[data-v2-barre-etapes], [data-v2-champ="campagnes"], p[data-v2-raison-eteint]').count()) === 0);
  noter('« Créer une nouvelle campagne » est NOIR en clair, comme les grands boutons d’avance', await page.evaluate(() => {
    const b = document.querySelector('[data-v2-nouvelle-campagne]');
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return !!b && getComputedStyle(b).opacity === '1' && !!accent;
  }));
  await capturer(page, '07d-campagnes-pied-ordinateur');
  await page.locator('[data-v2-nouvelle-campagne]').click();
  noter('le bouton du bas ouvre la conversation de création', await jusquA(async () => (await page.locator('[data-v2-nouvelle-conversation] [data-composer]').count()) === 1 && sansPortee(page.url()).endsWith(`#communication/${kipou.id}/campagnes/nouvelle`)), page.url());
  noter('rien ne déborde en largeur sur ordinateur', (await montrer(page)) === 0);

  /* ---- Étape 3 : la connexion (09/11/2026) — une ligne par réseau choisi, un agent dans Chrome ---- */
  await page.goto(`${BASE}/#communication/${kipou.id}/connexion`);
  await page.waitForSelector('[data-v2-liste-connexion]', { timeout: 15000 });
  const lignesCx = await page.$$eval('[data-v2-ligne-connexion]', (els) => els.map((e) => `${e.getAttribute('data-v2-ligne-connexion')}:${e.getAttribute('data-etat')}`));
  noter('la connexion liste les réseaux CHOISIS : Instagram connecté par la voie officielle, TikTok à connecter', lignesCx.join(',') === 'instagram:officiel,tiktok:a_connecter', lignesCx.join(','));
  noter('la connexion dit « Étape 2 sur 3 »', (await page.locator('[data-communication2]').last().innerText()).includes('Étape 2 sur 3'));
  noter('Instagram affiche « Publication officielle »', (await page.locator('[data-v2-ligne-connexion="instagram"]').innerText()).includes('Publication officielle'));
  noter('sans Chrome relié, la page le dit et propose de relier Chrome', (await page.locator('[data-v2-connexion-sans-chrome="aucun"] [data-v2-relier-chrome]').count()) === 1);
  noter('sans Chrome, « Connecter » est éteint et dit pourquoi au survol', (await page.locator('[data-v2-connecter="tiktok"]').isDisabled()) && ((await page.locator('[data-v2-ligne-connexion="tiktok"] span[title]').last().getAttribute('title')) ?? '').includes('Chrome'));
  noter('la connexion a son chat et son pied d’avance vers le calendrier', (await page.locator('[data-v2-pied] [data-v2-champ="connexion"]').count()) === 1 && (await page.locator('[data-v2-barre-etapes="connexion"] [data-v2-precedent="campagnes"]').count()) === 1 && !(await page.locator('[data-v2-suivant="calendrier"]').isDisabled()));
  await capturer(page, '16-connexion-ordinateur');
  /* Un réseau connecté par Chrome (la voie officielle refusée) : la ligne le dit. */
  ecrire(`INSERT INTO marketing_comptes (id, project_id, reseau, distant_id, nom, etat, jeton_ref, details, cree_le, maj_le) VALUES ('cp-tiktok', 'p-kipou', 'tiktok', 'chrome:@kipou', '@kipou', 'relie', NULL, '{"mode":"chrome","compteBeluga":"inconnu"}', ?, ?)`, Date.now(), Date.now());
  await page.reload();
  await page.waitForSelector('[data-v2-ligne-connexion="tiktok"][data-etat="chrome"]', { timeout: 15000 });
  noter('TikTok connecté par Chrome affiche « Publication par Chrome » et son compte', (await page.locator('[data-v2-ligne-connexion="tiktok"]').innerText()).includes('Publication par Chrome') && (await page.locator('[data-v2-ligne-connexion="tiktok"]').innerText()).includes('@kipou'));
  noter('tout est connecté : plus de bouton « Connecter »', (await page.locator('[data-v2-connecter], [data-v2-tout-connecter]').count()) === 0);
  noter('la connexion ne déborde pas sur ordinateur', (await montrer(page)) === 0);
  await capturer(page, '16b-connexion-chrome-ordinateur');

  /* ---- Le téléphone ---- */
  const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-CH' });
  await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const p2 = await tel.newPage();
  p2.on('pageerror', (e) => {
    erreurs.push(e.message);
    console.log(`  …  erreur de page (téléphone) : ${e.message}`);
  });
  await p2.goto(`${BASE}/#communication/${kipou.id}/campagnes`);
  await p2.waitForSelector('[data-v2-campagnes]', { timeout: 20000 });
  const bas = await p2.$$eval('[data-bouton-du-bas]', (els) => els.map((e) => e.getAttribute('data-bouton-du-bas')));
  noter('au téléphone, le bas mène aux trois pages du projet, sans Calendrier, ni « Plan » ni « Réseaux »', ['v2-campagnes', 'v2-connexion', 'v2-reponses'].every((g) => bas.includes(g)) && !bas.includes('v2-calendrier') && !bas.includes('v2-plan') && !bas.includes('v2-canaux'), bas.join(','));
  noter('au téléphone, « Créer une nouvelle campagne » est le seul bouton du bas, pleine largeur, et rien en haut', (await p2.locator('[data-v2-nouvelle-campagne]').count()) === 1 && (await p2.locator('[data-communication-pied-en-place] [data-v2-nouvelle-campagne]').count()) === 1 && (await partDuPied(p2, '[data-v2-nouvelle-campagne]')) >= 0.95 && (await p2.locator('[data-v2-barre-etapes], [data-v2-champ="campagnes"]').count()) === 0);
  noter('au téléphone, la liste des campagnes ne déborde pas', (await montrer(p2)) === 0);
  await capturer(p2, '10-campagnes-telephone');
  /* AU DOIGT, un appui long sur une ligne ouvre son menu, sans ouvrir la campagne. */
  const ligneTel = p2.locator(`[data-communication-ligne="${campagne.id}"]`).first();
  const boite = await ligneTel.boundingBox();
  if (boite) {
    const x = boite.x + boite.width / 2;
    const y = boite.y + boite.height / 2;
    await ligneTel.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: x, clientY: y, isPrimary: true, bubbles: true });
    await attendre(700);
    await ligneTel.dispatchEvent('pointerup', { pointerType: 'touch', clientX: x, clientY: y, isPrimary: true, bubbles: true });
  }
  noter('au téléphone, un appui long sur une campagne ouvre son menu, sans l’ouvrir', await jusquA(async () => (await p2.locator(`[data-v2-menu-ligne="${campagne.id}"]`).count()) === 1) && sansPortee(p2.url()).endsWith('/campagnes'), p2.url());
  await capturer(p2, '10b-campagnes-appui-long-telephone');
  await p2.goto(`${BASE}/#communication/${kipou.id}/campagnes/${campagne.id}`);
  await p2.waitForSelector('[data-v2-conversation-campagne] [data-composer]', { timeout: 15000 });
  noter('au téléphone, la campagne est sa conversation, le plan en feuille du bas', (await p2.getAttribute('[data-v2-campagne]', 'data-v2-volet')) === 'feuille' && (await p2.locator('[data-v2-volet-campagne]').count()) === 0);
  noter('au téléphone, la conversation tient dans la largeur', (await montrer(p2)) === 0);
  await capturer(p2, '11-campagne-conversation-telephone');
  /* Le plan s'ouvre depuis les trois points du haut (10/11/2026), plus d'un bouton dans la page. */
  noter('au téléphone, aucun bouton du plan ni « … » dans la page', (await p2.locator('[data-v2-campagne] [data-v2-ouvrir-volet], [data-v2-campagne] [data-options-de-page]').count()) === 0);
  await p2.locator('[data-trois-points-du-haut]').tap();
  await p2.waitForSelector('[data-menu-du-haut-telephone] [data-v2-ouvrir-volet]', { timeout: 10000 });
  noter('au téléphone, les trois points du haut portent « Le suivi de la campagne » et « Supprimer »', (await p2.locator('[data-menu-du-haut-telephone] [data-v2-supprimer-campagne]').count()) === 1);
  await capturer(p2, '11a-campagne-menu-du-haut-telephone');
  await p2.locator('[data-menu-du-haut-telephone] [data-v2-ouvrir-volet]').tap();
  noter('un appui ouvre le suivi de la campagne dans la feuille du bas', await jusquA(async () => (await p2.locator('[data-v2-feuille-volet]').count()) === 1 && (await p2.locator('[data-v2-volet-plan]').count()) === 1));
  await capturer(p2, '11b-campagne-plan-telephone');
  await p2.locator('[data-v2-volet-plan] [data-v2-publication]').first().tap();
  noter('un appui sur une publication ouvre son aperçu', await jusquA(async () => (await p2.locator('[data-v2-feuille-apercu]').count()) === 1));
  await capturer(p2, '11c-campagne-apercu-telephone');
  await p2.goto(`${BASE}/#communication/${kipou.id}/campagnes/nouvelle`);
  await p2.waitForSelector('[data-v2-nouvelle-conversation] [data-composer]', { timeout: 15000 });
  noter('au téléphone, la création en conversation tient dans la largeur, sans barre d’étapes', (await montrer(p2)) === 0 && (await p2.locator('[data-v2-pas-assistant], [data-entete-haut]').count()) === 0);
  await capturer(p2, '13-nouvelle-campagne-telephone');
  await p2.goto(`${BASE}/#communication/${kipou.id}/connexion`);
  await p2.waitForSelector('[data-v2-liste-connexion]', { timeout: 15000 });
  noter('au téléphone, la connexion tient dans la largeur', (await montrer(p2)) === 0);
  await capturer(p2, '16c-connexion-telephone');
  await tel.close();

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
} catch (err) {
  noter('le parcours est allé au bout', false, err?.stack?.split('\n').slice(0, 3).join(' ') ?? String(err));
} finally {
  await navigateur?.close().catch(() => {});
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
if (echecs.length) {
  console.log('Journal du démon (fin) :\n' + journal.join('').split('\n').slice(-25).join('\n'));
  process.exit(1);
}
process.exit(0);
