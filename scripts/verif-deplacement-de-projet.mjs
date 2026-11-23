#!/usr/bin/env node
/**
 * UNE CARTE CHANGE DE PROJET — LES DEUX GESTES, DANS UN VRAI NAVIGATEUR.
 *
 *   node scripts/verif-deplacement-de-projet.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * trois projets — dont l'espace de développement de l'application : le démon de
 * production n'est pas touché, aucun quota n'est dépensé, aucun agent réel n'est
 * lancé.
 *
 * Ce qui est vérifié, à l'écran et en base :
 *   1. LE MENU — le clic droit sur une carte de « Demande » ouvre une entrée
 *      « Déplacer vers un autre projet » qui déroule les projets d'accueil,
 *      SANS le projet courant comme destination cliquable ;
 *   2. LE DÉPLACEMENT PAR LE MENU — la carte disparaît du tableau de départ et
 *      se retrouve dans le projet d'accueil, à la MÊME étape, sans un seul
 *      rechargement de page ;
 *   3. LE GLISSEMENT — une seconde carte, tirée du tableau et relâchée sur la
 *      ligne d'un projet de la colonne de gauche, part de la même façon ; la
 *      ligne visée s'éclaire pendant le geste (voir « RECALÉ » plus bas : depuis
 *      la refonte, ce geste n'a plus de ligne où lâcher) ;
 *   4. LE REFUS SE VOIT AVANT LE CLIC — une carte déjà travaillée (branche
 *      posée) garde son entrée de menu, mais ÉTEINTE, et elle ne bouge pas ;
 *   5. L'ESPACE DE DÉVELOPPEMENT, DANS LES DEUX SENS — il figure dans la liste
 *      des destinations, sa ligne ancrée reçoit une carte glissée, et une carte
 *      qui y vit en ressort par le menu.
 *
 * Les règles pures sont verrouillées ailleurs :
 * `server/src/test/deplacement-de-projet.test.ts` (chaque cas autorisé et
 * refusé) et `server/src/test/deplacement-vers-projet.test.ts` (le déplacement
 * complet en base, et les refus qui ne déplacent rien).
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). La colonne de gauche suit le lieu : elle
 * ne liste les projets que sur la page « Tableaux de bord » (`#en-route`) ; dans
 * un projet elle porte ses options, sous une flèche qui y remonte
 * (`[data-menu-de-colonne]`). On ouvre donc un projet en remontant d'abord à
 * la liste (`ouvrirLeProjet`).
 *
 * CE QUI NE TIENT PLUS À L'ÉCRAN, ET QUE LE CONTRÔLE LAISSE EN ÉCHEC : le
 * GLISSEMENT d'une carte vers un autre projet (points 3 et 5). Le mécanisme est
 * intact (`resolve` de `board.tsx`, `[data-projet-cible]`, `useGlissementDeCarte`)
 * mais, tableau affiché, la liste des projets est cachée derrière les options
 * du projet : carte en vol, il n'y a aucune ligne où la lâcher. Le geste est
 * joué quand même — la ligne visée se cherche EN PLEIN VOL, pour qu'une colonne
 * qui la montrerait pendant le geste suffise à faire repasser ces points.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

/* Le dépôt d'où PART ce script, jamais `/root/beluga` en dur : lancé depuis la
   copie de travail d'une carte, il jugerait sinon le code du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_DEPLACEMENT_PORT || 7211);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-deplacement-projet-',
  port: PORT,
});

/* ------------------------------------------------------------------ */
/* Le décor : trois projets, cinq cartes, une session d'une heure      */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

const SOURCE = { id: 'p-depart', nom: 'Projet de départ' };
const CIBLE = { id: 'p-accueil', nom: 'Projet d’accueil' };
/* L'espace de développement de l'application : une ligne ANCRÉE en tête de la
   colonne de gauche, hors du rangement — mais une destination comme une autre. */
const ESPACE_DEV = { id: 'p-self', nom: 'Beluga' };
const PAR_LE_MENU = { id: 'c-menu', titre: 'Carte déplacée par le menu' };
const PAR_LE_GESTE = { id: 'c-geste', titre: 'Carte déplacée à la souris' };
const DEJA_TRAVAILLEE = { id: 'c-travaillee', titre: 'Carte déjà travaillée' };
const VERS_LE_DEV = { id: 'c-vers-dev', titre: 'Carte glissée dans l’espace de développement' };
const DEPUIS_LE_DEV = { id: 'c-depuis-dev', titre: 'Carte sortie de l’espace de développement' };

const base = (readonly = false) =>
  new Database(path.join(DATA, 'beluga.db'), readonly ? { readonly: true } : undefined);

function ecrireProjet(db, projet, rang, isSelf = false) {
  const maintenant = Date.now();
  const valeur = {
    id: projet.id,
    name: projet.nom,
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf,
    rank: rang,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(valeur.id, valeur.name, valeur.path, JSON.stringify(valeur), maintenant, maintenant);
}

function ecrireCarte(db, carte, projetId, extra = {}) {
  const maintenant = Date.now();
  const valeur = {
    id: carte.id,
    projectId: projetId,
    title: carte.titre,
    description: 'Carte fabriquée par le script de vérification.',
    labels: [],
    column: 'planned',
    position: maintenant,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none' },
    scheduling: { asap: false, attempts: 0, restarts: 0, suspendu: false },
    excludedFromDeploy: false,
    horsTache: false,
    codeDejaEnregistre: false,
    createdAt: maintenant,
    updatedAt: maintenant,
    ...extra,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(valeur.id, projetId, valeur.column, valeur.position, valeur.title, JSON.stringify(valeur), maintenant, maintenant);
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification déplacement de projet',
  );
  /* Aucun agent réel : le plafond est à zéro, rien ne peut démarrer. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  ecrireProjet(db, SOURCE, 1);
  ecrireProjet(db, CIBLE, 2);
  ecrireProjet(db, ESPACE_DEV, 3, true);

  ecrireCarte(db, PAR_LE_MENU, SOURCE.id);
  ecrireCarte(db, PAR_LE_GESTE, SOURCE.id);
  ecrireCarte(db, VERS_LE_DEV, SOURCE.id);
  ecrireCarte(db, DEPUIS_LE_DEV, ESPACE_DEV.id);
  /* Une branche posée = un travail déjà fait : la carte ne peut plus partir. */
  ecrireCarte(db, DEJA_TRAVAILLEE, SOURCE.id, { github: { branch: 'tache/deja-travaillee-ab12' } });
  db.close();
}

/** Dans quel projet, et dans quelle colonne, la carte est-elle rangée ? */
function ouEstLaCarte(id) {
  const db = base(true);
  const ligne = db.prepare('SELECT project_id, column_key FROM cards WHERE id = ?').get(id);
  db.close();
  return ligne ? { projet: ligne.project_id, colonne: ligne.column_key } : null;
}

/* ------------------------------------------------------------------ */
/* Les gestes à l'écran                                                */
/* ------------------------------------------------------------------ */

const carteDuTableau = (page, carte) => page.locator(`[data-carte="${carte.id}"]`);

/** Le clic droit ouvre le menu de la carte, exactement comme à la main. */
async function ouvrirLeMenu(page, carte) {
  const vue = carteDuTableau(page, carte);
  await vue.waitFor({ state: 'visible', timeout: 20000 });
  await vue.click({ button: 'right' });
  await page.waitForTimeout(700);
  return page.locator('[role="menu"]').last();
}

async function fermerLeMenu(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

/** Ce que rend le glissement quand la ligne du projet visé n'est pas à l'écran, carte en vol. */
const LIGNE_ABSENTE = 'ligne-absente';
const MOTIF_LIGNE_ABSENTE =
  'carte en vol, la ligne du projet visé n’est pas affichée : dans un projet, la colonne de gauche porte ses options, plus la liste des projets';

/**
 * Glisser une carte du tableau jusqu'à la LIGNE D'UN PROJET de la colonne de
 * gauche. Le tableau n'utilise pas le glisser-déposer natif : il suit les
 * événements de pointeur, et c'est donc eux qu'on émet.
 *
 * LA LIGNE VISÉE SE CHERCHE EN PLEIN VOL, une fois la carte décollée : depuis
 * la refonte, la colonne de gauche d'un projet porte ses options, et la liste
 * des projets — toujours montée — n'y est pas affichée au repos. Si aucune
 * ligne AFFICHÉE ne porte le projet pendant le geste, il n'y a nulle part où
 * lâcher : la carte est reposée d'où elle vient, et le glissement rend
 * `LIGNE_ABSENTE` au lieu de viser une ligne que personne ne voit.
 */
async function glisserVersLeProjet(page, carte, projetId) {
  const vue = carteDuTableau(page, carte);
  await vue.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const depart = await vue.boundingBox();
  if (!depart) throw new Error('carte introuvable à l’écran');

  const x0 = depart.x + depart.width / 2;
  const y0 = depart.y + 12;

  /* L'ÉCLAIRAGE SE LIT EN PLEIN GESTE : on s'arrête à mi-course sur la ligne,
     on regarde, puis on relâche. */
  const eclairage = await page.evaluate(
    async ([ax, ay, cible, absente]) => {
      const commun = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
      const pause = (ms) => new Promise((r) => setTimeout(r, ms));
      const bouger = (x, y) => window.dispatchEvent(new PointerEvent('pointermove', { ...commun, clientX: x, clientY: y }));
      const depuis = document.elementFromPoint(ax, ay);
      depuis?.dispatchEvent(new PointerEvent('pointerdown', { ...commun, clientX: ax, clientY: ay }));
      // La carte décolle : quelques pas vers la colonne de gauche.
      let x = ax;
      for (let i = 1; i <= 4; i += 1) {
        x = ax - i * 12;
        bouger(x, ay);
        await pause(30);
      }
      await pause(250);
      const ligne = [...document.querySelectorAll(`[data-projet-cible="${cible}"]`)].find(
        (noeud) => noeud.getBoundingClientRect().height > 0,
      );
      if (!ligne) {
        // Nulle part où lâcher : la carte revient d'où elle est partie.
        bouger(ax, ay);
        await pause(60);
        window.dispatchEvent(new PointerEvent('pointerup', { ...commun, buttons: 0, clientX: ax, clientY: ay }));
        return absente;
      }
      const boite = ligne.getBoundingClientRect();
      const bx = boite.left + boite.width / 2;
      const by = boite.top + boite.height / 2;
      for (let i = 1; i <= 12; i += 1) {
        bouger(x + ((bx - x) * i) / 12, ay + ((by - ay) * i) / 12);
        await pause(30);
      }
      await pause(250);
      const vu = ligne.getAttribute('data-projet-survole') ?? null;
      window.dispatchEvent(new PointerEvent('pointerup', { ...commun, buttons: 0, clientX: bx, clientY: by }));
      return vu;
    },
    [x0, y0, projetId, LIGNE_ABSENTE],
  );
  await page.waitForTimeout(2000);
  return eclairage;
}

/** Ce que le contrôle écrit à côté d'un point du glissement. */
const detailDuGeste = (eclairage) => (eclairage === LIGNE_ABSENTE ? MOTIF_LIGNE_ABSENTE : `repère lu : ${eclairage}`);
/** Sans ligne où lâcher, rien ne partira : inutile d'attendre la base quinze secondes. */
const delaiApresLeGeste = (eclairage) => (eclairage === LIGNE_ABSENTE ? 2000 : 15000);

/**
 * OUVRIR UN PROJET PAR SA LIGNE DE LA COLONNE DE GAUCHE. Elle n'est affichée
 * que sur la page de tous les projets : depuis un tableau, la flèche en tête
 * de la colonne y remonte d'abord (`[data-menu-de-colonne]`).
 */
async function ouvrirLeProjet(page, projetId) {
  const ligne = page.locator(`aside[data-zone="gauche"] [data-projet-cible="${projetId}"]`).first();
  if (!(await ligne.isVisible().catch(() => false))) {
    await page.locator('[data-menu-de-colonne]:visible').first().click();
    await ligne.waitFor({ state: 'visible', timeout: 15000 });
  }
  await ligne.locator('button').first().click();
  await page.waitForSelector('[data-column="planned"]', { state: 'visible', timeout: 20000 });
}

/** Attendre un état de la base plutôt qu'un délai fixe. */
async function attendre(condition, limiteMs = 15000, pasMs = 250) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, pasMs));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le contrôle                                                         */
/* ------------------------------------------------------------------ */

let navigateur = null;

async function controler() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  navigateur = await chromium.launch({ channel: 'chrome' });
  /* SANS SERVICE WORKER : à sa prise de contrôle l'application se recharge
     (`controllerchange`, `web/src/main.tsx`), et ce rechargement peut tomber à
     l'instant où l'adresse « #en-route » n'est pas encore réécrite — on
     atterrit alors dans un projet au lieu de la page de tous les projets. */
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, domain: '127.0.0.1', path: '/' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (err) => erreurs.push(String(err)));

  /* On part de la page de tous les projets — la colonne de gauche y liste les
     projets —, puis on ouvre le projet de DÉPART par sa ligne : c'est là que
     les trois cartes vivent. */
  await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector(`aside[data-zone="gauche"] [data-projet-cible="${SOURCE.id}"]`, { state: 'visible', timeout: 30000 });
  await ouvrirLeProjet(page, SOURCE.id);
  await page.waitForTimeout(2000);
  await carteDuTableau(page, PAR_LE_MENU).waitFor({ state: 'visible', timeout: 20000 });

  /* -------- 1. L'entrée de menu et ses destinations -------- */

  let menu = await ouvrirLeMenu(page, PAR_LE_MENU);
  const entree = menu.locator('[data-menu-changer-de-projet]');
  noter('le menu d’une carte porte « Déplacer vers un autre projet »', (await entree.count()) === 1);
  noter(
    'l’entrée est active sur une carte jamais travaillée',
    (await entree.getAttribute('data-disabled')) === null,
  );

  await entree.hover();
  await page.waitForTimeout(700);
  const destinations = page.locator('[data-projet-destination]');
  const listees = await destinations.evaluateAll((noeuds) =>
    noeuds.map((n) => ({ id: n.getAttribute('data-projet-destination'), eteinte: n.hasAttribute('data-disabled') })),
  );
  noter(
    'le projet d’accueil est proposé, et cliquable',
    listees.some((d) => d.id === CIBLE.id && !d.eteinte),
    JSON.stringify(listees),
  );
  noter(
    'le projet courant n’est jamais une destination cliquable',
    !listees.some((d) => d.id === SOURCE.id && !d.eteinte),
  );
  /* L'ESPACE DE DÉVELOPPEMENT EST UNE DESTINATION COMME UNE AUTRE. Il était
     écarté de la liste avant même qu'on applique la règle. */
  noter(
    'l’espace de développement est proposé, et cliquable',
    listees.some((d) => d.id === ESPACE_DEV.id && !d.eteinte),
    JSON.stringify(listees),
  );

  /* -------- 2. Le déplacement par le menu -------- */

  await destinations.filter({ hasText: CIBLE.nom }).first().click();
  const partie = await attendre(() => ouEstLaCarte(PAR_LE_MENU.id)?.projet === CIBLE.id);
  noter('le menu déplace la carte dans le projet d’accueil', partie, JSON.stringify(ouEstLaCarte(PAR_LE_MENU.id)));
  noter('la carte garde son étape à l’arrivée', ouEstLaCarte(PAR_LE_MENU.id)?.colonne === 'planned');

  await page.waitForTimeout(1200);
  noter(
    'elle a disparu du tableau de départ, sans rechargement',
    (await carteDuTableau(page, PAR_LE_MENU).count()) === 0,
  );

  /* -------- 3. Le glissement sur la colonne de gauche -------- */

  const eclairage = await glisserVersLeProjet(page, PAR_LE_GESTE, CIBLE.id);
  noter('la ligne visée s’éclaire pendant le geste', eclairage === 'acceptee', detailDuGeste(eclairage));
  const glissee = await attendre(() => ouEstLaCarte(PAR_LE_GESTE.id)?.projet === CIBLE.id, delaiApresLeGeste(eclairage));
  noter('le glissement déplace la carte', glissee, JSON.stringify(ouEstLaCarte(PAR_LE_GESTE.id)));
  noter(
    'la carte glissée a disparu du tableau de départ',
    (await carteDuTableau(page, PAR_LE_GESTE).count()) === 0,
  );

  /* -------- 3 bis. Le glissement sur la ligne ANCRÉE de l'espace dev -------- */

  const eclairageDev = await glisserVersLeProjet(page, VERS_LE_DEV, ESPACE_DEV.id);
  noter(
    'la ligne de l’espace de développement s’éclaire pendant le geste',
    eclairageDev === 'acceptee',
    detailDuGeste(eclairageDev),
  );
  const entreeDev = await attendre(() => ouEstLaCarte(VERS_LE_DEV.id)?.projet === ESPACE_DEV.id, delaiApresLeGeste(eclairageDev));
  noter('une carte glissée ENTRE dans l’espace de développement', entreeDev, JSON.stringify(ouEstLaCarte(VERS_LE_DEV.id)));

  /* -------- 4. Le refus se voit AVANT le clic -------- */

  menu = await ouvrirLeMenu(page, DEJA_TRAVAILLEE);
  const eteinte = menu.locator('[data-menu-changer-de-projet]');
  noter('une carte déjà travaillée garde l’entrée, éteinte', (await eteinte.getAttribute('data-disabled')) !== null);
  const motif = await eteinte.getAttribute('title');
  noter('l’entrée éteinte dit pourquoi', !!motif && /travaillée/.test(motif), motif ?? 'sans motif');
  await fermerLeMenu(page);
  noter('elle n’a pas bougé', ouEstLaCarte(DEJA_TRAVAILLEE.id)?.projet === SOURCE.id);

  /* -------- 5. On SORT de l'espace de développement, par le menu -------- */

  await ouvrirLeProjet(page, ESPACE_DEV.id);
  await page.waitForTimeout(2500);
  const menuDev = await ouvrirLeMenu(page, DEPUIS_LE_DEV);
  const entreeDepuisDev = menuDev.locator('[data-menu-changer-de-projet]');
  noter(
    'une carte de l’espace de développement peut changer de projet',
    (await entreeDepuisDev.getAttribute('data-disabled')) === null,
  );
  await entreeDepuisDev.hover();
  await page.waitForTimeout(900);
  /* Les menus déjà refermés laissent leurs noeuds derrière eux : on ne vise que
     les destinations RÉELLEMENT visibles, celles du menu ouvert à l'instant. */
  const destinationDeSortie = page
    .locator('[data-projet-destination]:visible')
    .filter({ hasText: CIBLE.nom })
    .first();
  /*
   * LE POINTEUR SUIT LE CHEMIN D'UNE VRAIE MAIN : du déclencheur jusqu'à
   * l'entrée du sous-menu, puis appui. Un `click()` de la bibliothèque attend
   * que l'élément soit IMMOBILE, et ce sous-menu-là se replace tant que le
   * pointeur n'est pas entré dedans : l'attente ne finissait jamais.
   */
  const boite = await destinationDeSortie.boundingBox();
  if (!boite) throw new Error('destination de sortie introuvable à l’écran');
  await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2, { steps: 8 });
  await page.waitForTimeout(400);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const sortie = await attendre(() => ouEstLaCarte(DEPUIS_LE_DEV.id)?.projet === CIBLE.id);
  noter('elle en SORT vers un autre projet', sortie, JSON.stringify(ouEstLaCarte(DEPUIS_LE_DEV.id)));

  /* -------- Les deux tableaux, une fois le geste passé -------- */

  await ouvrirLeProjet(page, CIBLE.id);
  await page.waitForTimeout(2500);
  noter(
    'les deux cartes déplacées sont bien dans le projet d’accueil',
    (await carteDuTableau(page, PAR_LE_MENU).count()) === 1 &&
      (await carteDuTableau(page, PAR_LE_GESTE).count()) === 1,
  );

  noter('aucune erreur de page pendant le contrôle', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
}

try {
  await controler();
} catch (err) {
  noter('le contrôle est allé au bout', false, String(err?.message ?? err));
} finally {
  await navigateur?.close().catch(() => {});
}

const rates = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - rates.length}/${resultats.length} vérifications passées.`);
if (rates.length) {
  console.log('\nJournal du démon :\n' + journal.join('').split('\n').slice(-25).join('\n'));
}
process.exit(rates.length ? 1 : 0);
