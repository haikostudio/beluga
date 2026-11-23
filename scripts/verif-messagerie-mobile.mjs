#!/usr/bin/env node
/**
 * LA MESSAGERIE DE L'ESPACE CLIENT, SUR UN ÉCRAN DE TÉLÉPHONE.
 *
 *   npm run build && node scripts/verif-messagerie-mobile.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve, un
 * compte client et un compte Haiko fabriqués pour l'occasion. Il ouvre ensuite
 * Chrome à 390 × 844 — la taille d'un téléphone — et rejoue le parcours des
 * DEUX côtés : celui du client (`my.test`) et celui de Haiko.
 *
 * Ce qui est vérifié :
 *   1. LE RAIL — les quatre colonnes sont là ENSEMBLE, chacune large de presque
 *      tout l'écran, ancrée centrée ; plus aucun onglet de colonne ;
 *   2. L'ANCRAGE — le rail s'arrête pilé sur une colonne, jamais entre deux ;
 *   3. LE GLISSER AU BORD — une demande tenue près du bord fait défiler le
 *      rail, et se dépose dans la colonne d'à côté. Le geste s'émet en
 *      événements de POINTEUR et sonde son point d'appui, comme les autres
 *      contrôles de glissement du projet ;
 *   4. LA FICHE EN PAGE — la fiche s'ouvre dans le `Drawer` de l'application,
 *      qui rend désormais une PAGE couvrant tout l'écran (refonte du
 *      11/10/2026), et se referme par la flèche de retour de sa barre. Les
 *      règles de l'ancien tiroir montant (voile, air autour de la poignée,
 *      fermeture en la tirant vers le bas) sont parties avec lui ;
 *   5. LE NON-DÉBORDEMENT — aucun élément ne dépasse la largeur de l'écran ;
 *   6. LE MENU DES CLIENTS — vu comme Haiko, la colonne « Clients » a laissé la
 *      place à un sélecteur posé dans le fil d'Ariane de la barre d'en-tête
 *      (avec la cloche du client et le menu de l'espace, sur UN rang), sa liste
 *      monte du bas dans un panneau, et l'espace du client prend toute la largeur.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_MOBILE_PORT || 7217);
/** L'adresse cliente, ramenée sur la machine par le résolveur du navigateur. */
const HOTE = 'my.test';
const TELEPHONE = { width: 390, height: 844 };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-messagerie-mobile-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
for (const dossier of [DATA, PROJETS]) fs.mkdirSync(dossier, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

let demon = null;
let navigateur = null;
const journal = [];

function nettoyer() {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.on('exit', nettoyer);

/* ------------------------------------------------------------------ */
/* Le démon                                                            */
/* ------------------------------------------------------------------ */

demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

async function attendrePort(limiteMs = 90000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

if (!(await attendrePort())) {
  console.error('le démon n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Le décor : un projet, un client, un Haiko                           */
/* ------------------------------------------------------------------ */

const PROJET = 'p-mobile';
const CLIENT = { identifiant: 'client-mobile', motDePasse: 'mot-de-passe-essai-2026' };
const HAIKO = { identifiant: 'haiko-mobile', motDePasse: 'mot-de-passe-haiko-2026' };

{
  const comptes = await import(path.join(RACINE, 'server/dist/comptes.js'));
  process.env.BELUGA_DATA = DATA;

  fs.mkdirSync(path.join(PROJETS, 'mobile'), { recursive: true });
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
    PROJET,
    'Projet mobile',
    path.join(PROJETS, 'mobile'),
    0,
    JSON.stringify({
      id: PROJET,
      name: 'Projet mobile',
      path: path.join(PROJETS, 'mobile'),
      archived: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
    maintenant,
    maintenant,
  );

  const poser = (id, compte, role, nom) => {
    const sel = crypto.randomBytes(16);
    db.prepare(
      `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(id, compte.identifiant, role, nom, sel.toString('hex'), comptes.empreinte(compte.motDePasse, sel), maintenant);
    db.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').run(id, PROJET);
  };
  poser('u-client', CLIENT, 'client', 'Client mobile');
  poser('u-haiko', HAIKO, 'admin', 'Haiko');
  db.close();
}

/* ------------------------------------------------------------------ */
/* Le navigateur, à taille de téléphone                                */
/* ------------------------------------------------------------------ */

const RACINE_CLIENTE = `http://${HOTE}:${PORT}`;
const RACINE_HAIKO = `http://127.0.0.1:${PORT}`;

navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', `--host-resolver-rules=MAP ${HOTE} 127.0.0.1`],
});

const contexte = await navigateur.newContext({
  viewport: TELEPHONE,
  locale: 'fr-CH',
  // Un vrai téléphone : le doigt, pas la souris.
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

/* ------------------------------------------------------------------ */
/* Les outils du parcours                                              */
/* ------------------------------------------------------------------ */

/** Ce qui dépasse la largeur de l'écran, hors zones qui défilent exprès. */
async function cequiDeborde(surCettePage) {
  return surCettePage.evaluate(() => {
    const coupables = [];
    const large = window.innerWidth;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const boite = el.getBoundingClientRect();
      if (boite.width === 0 || boite.height === 0) continue;
      if (boite.right <= large + 1 && boite.left >= -1) continue;
      // Un enfant d'une zone qui défile a le DROIT de sortir du cadre : c'est
      // tout l'objet d'un rail. On ne juge que ce qui déborde de la PAGE.
      let parent = el.parentElement;
      let dansUneZoneQuiDefile = false;
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflowX === 'hidden') {
          dansUneZoneQuiDefile = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (dansUneZoneQuiDefile) continue;
      coupables.push(
        `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''} → ${Math.round(boite.left)}…${Math.round(boite.right)}`,
      );
      if (coupables.length >= 4) break;
    }
    return { coupables, pageLarge: document.documentElement.scrollWidth, ecran: large };
  });
}

/**
 * LE GLISSEMENT S'ÉMET EN ÉVÉNEMENTS DE POINTEUR, et sonde son point d'appui :
 * la souris de Playwright n'émet rien d'exploitable ici, et la cible se lit par
 * `elementFromPoint` — exactement ce que fait le code de production.
 */
async function prendreEtPorterAuBord(idDemande) {
  return page.evaluate(async ({ idDemande }) => {
    const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
    const vignette = document.querySelector(`[data-demande="${idDemande}"]`);
    const rail = document.querySelector('[data-rail-colonnes]');
    if (!vignette || !rail) throw new Error('vignette ou rail introuvable');
    const depart = vignette.getBoundingClientRect();
    const px = depart.left + depart.width / 2;
    const py = depart.top + 10;
    const emettre = (type, cx, cy, sur) =>
      sur.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: cx,
          clientY: cy,
          button: 0,
          pointerType: 'touch',
        }),
      );
    // LE POINT D'APPUI EST SONDÉ : sans la vignette réellement sous le doigt,
    // le geste ne partirait pas et le contrôle mentirait.
    const appui = document.elementFromPoint(px, py);
    if (!appui || !appui.closest(`[data-demande="${idDemande}"]`)) {
      throw new Error('la vignette n’est pas sous le point de prise');
    }
    const avant = rail.scrollLeft;
    // L'APPUI LONG ARME LA PRISE : on tient le doigt immobile, puis on bouge.
    emettre('pointerdown', px, py, appui);
    await attendre(600);
    const armee = document.querySelectorAll('[data-vignette-tenue]').length;
    if (!armee) throw new Error('l’appui long n’a pas armé le glisser');
    emettre('pointermove', px + 40, py + 20, window);
    await attendre(20);
    // On tient la vignette contre le bord DROIT et on ne bouge plus : c'est le
    // rail qui doit défiler tout seul.
    const y = window.innerHeight / 2;
    emettre('pointermove', window.innerWidth - 12, y, window);
    await attendre(700);
    const apres = rail.scrollLeft;
    // On lâche là où le doigt est resté : la cible a été relue à chaque pas.
    const colonne = document.elementFromPoint(window.innerWidth - 12, y)?.closest('[data-colonne-kanban]');
    emettre('pointerup', window.innerWidth - 12, y, window);
    return { avant, apres, colonne: colonne?.dataset.colonneKanban ?? null };
  }, { idDemande });
}

async function creerUneDemande(titre) {
  await page.click('[data-nouvelle-demande]');
  await page.waitForSelector('[data-choix-modele]');
  await page.click('[data-modele="vierge"]');
  await page.waitForSelector('[data-formulaire-demande]');
  await page.fill('[data-champ-titre]', titre);
  await page.click('[data-creer-demande]');
  await page.waitForTimeout(1200);
}

/* ------------------------------------------------------------------ */
/* 1. Côté client : la porte, puis le rail                             */
/* ------------------------------------------------------------------ */

await page.goto(RACINE_CLIENTE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[name="username"]', CLIENT.identifiant);
await page.fill('input[name="password"]', CLIENT.motDePasse);
await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type="submit"]')]);
const entre = await page
  .waitForSelector('[data-espace-client]', { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
noter('l’espace du client s’ouvre sur un écran de téléphone', entre, entre ? '' : erreurs.slice(0, 2).join(' | '));
if (!entre) {
  console.error('\n--- démon ---\n' + journal.join('').slice(-2000));
  process.exit(1);
}

await creerUneDemande('Refaire la page d’accueil');
await creerUneDemande('Changer les photos');

const rail = await page.locator('[data-rail-colonnes]').count();
noter('les colonnes vivent dans un RAIL, pas dans des onglets', rail === 1, `rails : ${rail}`);
noter(
  'la rangée d’onglets de colonnes a disparu',
  (await page.locator('[data-onglet-colonne]').count()) === 0,
);
noter(
  'les QUATRE colonnes sont montées ensemble',
  (await page.locator('[data-colonne-kanban]').count()) === 4,
  String(await page.locator('[data-colonne-kanban]').count()),
);

const mesureDuRail = await page.evaluate(() => {
  const zone = document.querySelector('[data-rail-colonnes]');
  const wagons = Array.from(document.querySelectorAll('[data-colonne-kanban]'));
  if (!zone || !wagons.length) return null;
  const styleZone = getComputedStyle(zone);
  const styleWagon = getComputedStyle(wagons[0]);
  return {
    ancrage: styleZone.scrollSnapType,
    ancrageWagon: styleWagon.scrollSnapAlign,
    partDeLEcran: wagons[0].getBoundingClientRect().width / window.innerWidth,
    // La suivante doit DÉPASSER en amorce : sinon rien ne dit qu'il y en a d'autres.
    amorce: wagons[1].getBoundingClientRect().left < window.innerWidth - 4,
    defilable: zone.scrollWidth > zone.clientWidth + 10,
  };
});
noter(
  'chaque colonne prend presque tout l’écran, la suivante en amorce',
  !!mesureDuRail &&
    mesureDuRail.partDeLEcran > 0.75 &&
    mesureDuRail.partDeLEcran < 0.95 &&
    mesureDuRail.amorce === true,
  mesureDuRail ? `part : ${mesureDuRail.partDeLEcran.toFixed(2)}` : 'rail introuvable',
);
noter(
  'le rail ANCRE ses colonnes, une par écran',
  !!mesureDuRail && /mandatory/.test(mesureDuRail.ancrage) && mesureDuRail.ancrageWagon === 'center',
  mesureDuRail ? `${mesureDuRail.ancrage} / ${mesureDuRail.ancrageWagon}` : '',
);
noter('le rail défile bien horizontalement', mesureDuRail?.defilable === true);

/* Les points sous le rail disent où l'on est, et y mènent d'un doigt. */
noter(
  'un point par colonne dit où l’on se trouve',
  (await page.locator('[data-point-rail]').count()) === 4,
  String(await page.locator('[data-point-rail]').count()),
);
await page.click('[data-point-rail="en-cours"]');
await page.waitForTimeout(700);
const ancrePilee = await page.evaluate(() => {
  const zone = document.querySelector('[data-rail-colonnes]');
  const wagon = document.querySelector('[data-colonne-kanban="en-cours"]');
  if (!zone || !wagon) return null;
  // ANCRÉE PILÉE, ET CENTRÉE : le milieu de la colonne tombe sur le milieu du
  // rail. Un arrêt entre deux colonnes se verrait ici, en dizaines de pixels.
  const rail = zone.getBoundingClientRect();
  const boite = wagon.getBoundingClientRect();
  return Math.abs(boite.left + boite.width / 2 - (rail.left + rail.width / 2));
});
noter(
  'toucher un point amène la colonne, ancrée pilée',
  ancrePilee !== null && ancrePilee < 12,
  `écart au centre : ${ancrePilee === null ? '?' : Math.round(ancrePilee)} px`,
);
noter(
  'et le point de la colonne vue est le seul allumé',
  (await page.locator('[data-point-actif]').count()) === 1,
);

await page.click('[data-point-rail="a-faire"]');
await page.waitForTimeout(700);

/* ------------------------------------------------------------------ */
/* 2. Le glisser qui fait défiler le rail                              */
/* ------------------------------------------------------------------ */

const premiere = await page.locator('[data-demande]').first().getAttribute('data-demande');
const glissement = await prendreEtPorterAuBord(premiere);
noter(
  'tenir une demande au bord fait défiler le rail',
  glissement.apres > glissement.avant + 20,
  `${Math.round(glissement.avant)} → ${Math.round(glissement.apres)} px`,
);
await page.waitForTimeout(1500);
const restee = await page.evaluate(
  (id) => document.querySelector(`[data-demande="${id}"]`)?.closest('[data-colonne-kanban]')?.dataset.colonneKanban,
  premiere,
);
noter(
  'et la demande se dépose dans la colonne atteinte',
  !!restee && restee !== 'a-faire',
  `colonne d’arrivée : ${restee ?? 'aucune'}`,
);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-espace-client]', { timeout: 30000 });
await page.waitForTimeout(800);
const apresRechargement = await page.evaluate(
  (id) => document.querySelector(`[data-demande="${id}"]`)?.closest('[data-colonne-kanban]')?.dataset.colonneKanban,
  premiere,
);
noter('le déplacement tient après un rechargement', apresRechargement === restee, String(apresRechargement));

/* ------------------------------------------------------------------ */
/* 3. La fiche, en page                                                */
/* ------------------------------------------------------------------ */

await page.locator('[data-ouvrir-demande]').first().click();
await page.waitForSelector('[data-tiroir-demande]', { timeout: 20000 });
// La page s'affiche en fondu : on la mesure une fois posée.
await page.waitForTimeout(800);
/*
 * LA FICHE EST LE « TIROIR » DE L'APPLICATION (`Drawer`), plus un panneau
 * maison : le même composant que le coffre-fort ou le parcours d'une carte.
 * Depuis la refonte du 11/10/2026 (« PLUS AUCUN TIROIR : TOUT S'OUVRE EN PAGE
 * DANS LA ZONE PRINCIPALE »), ce composant rend une PAGE (`data-page-de-zone`)
 * qui couvre l'écran, avec une barre « ← Retour » — plus une feuille qui monte
 * du bas. Trois règles portaient sur la FORME du tiroir et sont parties avec
 * lui : le voile qui le détachait du tableau (une page n'est pas modale, elle
 * n'a pas de voile), l'air autour de sa barre grise (il n'y a plus de poignée à
 * tirer : le repère `data-poignee-tiroir` est désormais porté par la flèche de
 * retour), et la fermeture en tirant cette poignée vers le bas (on sort d'une
 * page par sa flèche, ce qui est vérifié ici à la place).
 */
const posture = await page.evaluate(() => {
  const fiche = document.querySelector('[data-tiroir-demande]');
  const tiroir = fiche?.closest('[data-tiroir]');
  if (!tiroir) return null;
  const boite = tiroir.getBoundingClientRect();
  return {
    genre: tiroir.getAttribute('data-tiroir'),
    page: tiroir.hasAttribute('data-page-de-zone'),
    position: getComputedStyle(tiroir).position,
    haut: Math.round(boite.top),
    colleEnBas: Math.abs(boite.bottom - window.innerHeight) < 2,
    pleineLargeur: Math.abs(boite.width - window.innerWidth) < 2,
    partDeLEcran: boite.height / window.innerHeight,
    retour: tiroir.querySelectorAll('[data-retour-de-page]').length,
  };
});
noter(
  'la fiche est le TIROIR de l’application — devenu une page —, pas un panneau maison',
  posture?.genre === 'plein' && posture.page === true && posture.retour === 1,
  JSON.stringify(posture),
);
noter(
  'elle occupe tout l’écran du téléphone : de haut en bas, sur toute la largeur',
  posture?.position === 'fixed' && posture.haut <= 2 && posture.colleEnBas === true && posture.pleineLargeur === true,
  JSON.stringify(posture),
);

/* ON SORT D'UNE PAGE PAR LA FLÈCHE DE RETOUR DE SA BARRE, et le tableau revient. */
await page.locator('[data-page-de-zone]:has([data-tiroir-demande]) [data-retour-de-page]').last().tap();
await page.waitForTimeout(900);
noter(
  'la flèche de retour de sa barre la referme, et rend le tableau',
  (await page.locator('[data-tiroir-demande]').count()) === 0 &&
    (await page.locator('[data-page-de-zone]').count()) === 0 &&
    (await page.locator('[data-rail-colonnes]').isVisible()),
);

/* LA DISCUSSION EST UN ONGLET EN BAS DU TABLEAU : un clic ouvre sa fenêtre
   flottante juste au-dessus de lui, et sur un téléphone elle prend presque
   toute la largeur, sans jamais sortir de l'écran. */
await page.waitForSelector('[data-onglet-discussion]', { timeout: 10000 });
/* SUR TÉLÉPHONE, L'ONGLET EST UNE ICÔNE SEULE, NOMMÉE, DÉCOLLÉE DES BORDS. */
const ongletTelephone = await page.evaluate(() => {
  const onglet = document.querySelector('[data-onglet-discussion]');
  const bande = document.querySelector('[data-bande-discussion]')?.getBoundingClientRect();
  const r = onglet.getBoundingClientRect();
  return {
    texte: onglet.innerText.replace(/\d+\+?/g, '').trim(),
    nom: onglet.getAttribute('aria-label'),
    largeur: Math.round(r.width),
    droite: bande ? Math.round(bande.right - r.right) : null,
    gauche: bande ? Math.round(r.left - bande.left) : null,
  };
});
noter(
  'sur téléphone, l’onglet Discussion est une icône seule, nommée « Discussion »',
  ongletTelephone.texte === '' && ongletTelephone.nom === 'Discussion' && ongletTelephone.largeur <= 44,
  JSON.stringify(ongletTelephone),
);
noter(
  '…et il garde la marge du menu du bas des deux côtés',
  (ongletTelephone.droite ?? 0) >= 11 && (ongletTelephone.gauche ?? 0) >= 11,
  JSON.stringify(ongletTelephone),
);
await page.click('[data-onglet-discussion]');
await page.waitForSelector('[data-fenetre-discussion] [data-volet-discussion]', { timeout: 20000 });
const fenetre = await page.evaluate(() => {
  const f = document.querySelector('[data-fenetre-discussion]')?.getBoundingClientRect();
  const o = document.querySelector('[data-onglet-discussion]')?.getBoundingClientRect();
  if (!f || !o) return null;
  return {
    part: Math.round((f.width / window.innerWidth) * 100) / 100,
    dedans: f.left >= -1 && f.right <= window.innerWidth + 1,
    auDessus: f.bottom <= o.top + 1,
  };
});
noter(
  'la discussion s’ouvre au-dessus de son onglet, sur presque toute la largeur',
  Boolean(fenetre) && fenetre.part > 0.9 && fenetre.dedans && fenetre.auDessus,
  JSON.stringify(fenetre),
);
await page.click('[data-onglet-discussion]');
await page.waitForTimeout(400);
noter('et se referme d’un second clic sur l’onglet', (await page.locator('[data-fenetre-discussion]').count()) === 0);

/* LA RECHERCHE PAR COLONNE RESTE UTILISABLE SUR UN TÉLÉPHONE : pleine largeur de sa colonne. */
const recherche = await page.evaluate(() => {
  const champ = document.querySelector('[data-rail-colonnes] [data-recherche-colonne]');
  const colonne = champ?.closest('[data-colonne-kanban]');
  if (!champ || !colonne) return null;
  const b = champ.getBoundingClientRect();
  return { largeur: Math.round((b.width / colonne.getBoundingClientRect().width) * 100) / 100, hauteur: Math.round(b.height) };
});
noter(
  'sur téléphone, la recherche d’une colonne tient sa largeur',
  Boolean(recherche) && recherche.largeur > 0.85 && recherche.hauteur >= 28,
  JSON.stringify(recherche),
);

/* ------------------------------------------------------------------ */
/* 4. Rien ne déborde de la largeur                                    */
/* ------------------------------------------------------------------ */

const debordeClient = await cequiDeborde(page);
noter(
  'côté client, aucun élément ne dépasse la largeur de l’écran',
  debordeClient.coupables.length === 0 && debordeClient.pageLarge <= debordeClient.ecran + 1,
  debordeClient.coupables.join(' | ') || `page : ${debordeClient.pageLarge} px`,
);

/* ------------------------------------------------------------------ */
/* 5. Côté Haiko : le sélecteur à tiroir des clients                    */
/* ------------------------------------------------------------------ */

const pageHaiko = await contexte.newPage();
const erreursHaiko = [];
pageHaiko.on('pageerror', (e) => erreursHaiko.push(String(e)));
pageHaiko.on('console', (m) => m.type() === 'error' && erreursHaiko.push(m.text()));

await pageHaiko.goto(RACINE_HAIKO, { waitUntil: 'domcontentloaded', timeout: 60000 });
await pageHaiko.fill('input[name="username"]', HAIKO.identifiant);
await pageHaiko.fill('input[name="password"]', HAIKO.motDePasse);
await Promise.all([
  pageHaiko.waitForNavigation({ waitUntil: 'domcontentloaded' }),
  pageHaiko.click('button[type="submit"]'),
]);
await pageHaiko.waitForTimeout(2000);
await pageHaiko.goto(`${RACINE_HAIKO}/#espace`, { waitUntil: 'domcontentloaded', timeout: 60000 });
const espaceHaiko = await pageHaiko
  .waitForSelector('[data-espace-haiko]', { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
noter('l’espace vu comme Haiko s’ouvre sur un téléphone', espaceHaiko, erreursHaiko.slice(0, 2).join(' | '));

if (espaceHaiko) {
  /*
   * ON ARRIVE SUR LA VUE D'ENSEMBLE, PLUS DANS UNE CONVERSATION. La Messagerie
   * ouvre son accueil : le sélecteur de client et l'entête d'un client ne
   * naissent qu'une fois entré chez quelqu'un. Ce contrôle jugeait l'entête
   * sans y entrer, et refusait donc un écran juste. On entre par la première
   * fiche — c'est le geste réel de l'utilisateur.
   */
  const fiche = pageHaiko.locator('[data-fiche-client]').first();
  if (await fiche.count()) {
    const vise = await fiche.getAttribute('data-fiche-client');
    // La fiche entière ouvre le tableau des demandes du client, discussion
    // fermée : c'est lui que la suite juge.
    await fiche.click();
    await pageHaiko
      .waitForSelector('[data-choix-client]', { timeout: 20000 })
      .catch(() => undefined);
    noter('depuis l’accueil, une fiche entre chez son client', true);
  } else {
    noter('depuis l’accueil, une fiche entre chez son client', false, 'aucune fiche sur la vue d’ensemble');
  }
  noter(
    'la colonne « Clients » a laissé la place à un sélecteur, dans le fil d’Ariane',
    (await pageHaiko.locator('[data-choix-client]').count()) === 1 &&
      (await pageHaiko.getAttribute('[data-espace-haiko]', 'data-vue')) === 'telephone',
  );
  noter(
    'et ce n’est PAS une liste native',
    (await pageHaiko.locator('select').count()) === 0,
  );
  /*
   * L'ENTÊTE VUE COMME HAIKO TIENT SUR UN SEUL RANG. Le sélecteur de client
   * avait sa bande, les projets du client une seconde, l'entête de l'espace une
   * troisième : trois rangs avant la première carte. Depuis la refonte du
   * 11/10/2026, ce rang EST la barre d'en-tête de l'application (« une seule
   * barre d'en-tête par écran ») : le client y est un cran du fil d'Ariane, sa
   * cloche et le menu de l'espace (trois points) montent à sa droite, dans
   * `[data-gestes-de-page="barre"]` — sur téléphone aussi (retouche « Dans
   * l'application, le haut de la messagerie tient sur une rangée »). On mesure
   * donc que le client, sa cloche et le menu partagent la même ligne DANS cette
   * barre, qu'aucune seconde rangée de gestes ne s'ouvre dessous
   * (`[data-gestes-de-page="page"]`), et que le rang des projets a disparu.
   * Le nom du projet (`[data-nom-projet]`) ne se dessine plus sur téléphone
   * (`hidden md:block`, pour laisser sa place au nom du client) : il n'est jugé
   * que s'il est à l'écran.
   */
  const rangsHaiko = await pageHaiko.evaluate(() => {
    const barre = document.querySelector('[data-choix-client]')?.closest('[data-entete-de-zone]');
    const boite = (repere) => {
      const b = barre?.querySelector(repere)?.getBoundingClientRect();
      return b && b.width > 0 && b.height > 0 ? b : null;
    };
    const boites = {
      client: boite('[data-choix-client]'),
      cloche: boite('[data-gestes-de-page="barre"] [data-cloche-espace="client"]'),
      menu: boite('[data-gestes-de-page="barre"] [data-menu-actions="espace-menu"]'),
      projet: boite('[data-nom-projet]'),
    };
    const hauts = Object.values(boites)
      .filter(Boolean)
      .map((b) => b.top);
    return {
      dansLaBarre: !!barre,
      client: !!boites.client,
      cloche: !!boites.cloche,
      menu: !!boites.menu,
      projetAffiche: !!boites.projet,
      ecart: hauts.length ? Math.max(...hauts) - Math.min(...hauts) : -1,
      secondeRangee: document.querySelectorAll('[data-gestes-de-page="page"]').length,
      rangProjets: document.querySelectorAll('[data-projets-client]').length,
    };
  });
  noter(
    'côté Haiko, client et boutons de l’espace tiennent sur une seule ligne',
    rangsHaiko.dansLaBarre &&
      rangsHaiko.client &&
      rangsHaiko.cloche &&
      rangsHaiko.menu &&
      rangsHaiko.ecart >= 0 &&
      rangsHaiko.ecart <= 12 &&
      rangsHaiko.secondeRangee === 0 &&
      rangsHaiko.rangProjets === 0,
    `écart : ${rangsHaiko.ecart} px · seconde rangée : ${rangsHaiko.secondeRangee} · rangs de projets : ${rangsHaiko.rangProjets} · ${JSON.stringify(rangsHaiko)}`,
  );
  const largeurRendue = await pageHaiko.evaluate(() => {
    const espace = document.querySelector('[data-espace-client]');
    return espace ? espace.getBoundingClientRect().width / window.innerWidth : 0;
  });
  noter(
    'l’espace du client récupère toute la largeur',
    largeurRendue > 0.95,
    `part de l’écran : ${largeurRendue.toFixed(2)}`,
  );
  /*
   * LA LISTE DE CHOIX : une entrée par client, cherchable à la frappe. CE N'EST
   * PLUS UN TIROIR (retouche du 11/10/2026 : « une liste de choix n'est jamais
   * une page : sur téléphone elle monte du bas ») : le même panneau que sur
   * ordinateur (`[data-liste-panneau="client"]`), épinglé en bas de l'écran,
   * sans qu'aucune page ne s'ouvre pour elle.
   */
  const pagesAvantLaListe = await pageHaiko.locator('[data-page-de-zone]').count();
  await pageHaiko.click('[data-choix-client]');
  await pageHaiko.waitForSelector('[data-liste-panneau="client"] [data-selecteur-option]', { timeout: 10000 });
  noter(
    'la liste de choix montre les clients, dans un panneau et non dans une page',
    (await pageHaiko.locator('[data-liste-panneau="client"] [data-selecteur-option]').count()) >= 1 &&
      (await pageHaiko.locator('[data-page-de-zone]').count()) === pagesAvantLaListe,
  );
  await pageHaiko.keyboard.press('Escape');
  await pageHaiko.waitForTimeout(450);

  await pageHaiko.waitForSelector('[data-rail-colonnes]', { timeout: 20000 });
  const debordeHaiko = await cequiDeborde(pageHaiko);
  noter(
    'côté Haiko, aucun élément ne dépasse la largeur de l’écran',
    debordeHaiko.coupables.length === 0 && debordeHaiko.pageLarge <= debordeHaiko.ecran + 1,
    debordeHaiko.coupables.join(' | ') || `page : ${debordeHaiko.pageLarge} px`,
  );
}

/* ------------------------------------------------------------------ */
/* 6. Le grand écran n'a pas bougé                                     */
/* ------------------------------------------------------------------ */

await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(800);
const grandEcran = await page.evaluate(() => ({
  rail: document.querySelectorAll('[data-rail-colonnes]').length,
  colonnes: document.querySelectorAll('[data-colonne-kanban]').length,
  points: document.querySelectorAll('[data-point-rail]').length,
}));
noter(
  'sur grand écran, la grille des quatre colonnes revient sans rail ni points',
  grandEcran.rail === 0 && grandEcran.colonnes === 4 && grandEcran.points === 0,
  JSON.stringify(grandEcran),
);

/* ------------------------------------------------------------------ */
/* 7. Aucune erreur dans la console                                    */
/* ------------------------------------------------------------------ */

const graves = [...erreurs, ...erreursHaiko].filter((e) => !/favicon|manifest|service worker/i.test(e));
noter('aucune erreur dans la console du navigateur', graves.length === 0, graves.slice(0, 3).join(' | '));

await navigateur.close();

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
if (echecs.length) {
  console.error(`\n${echecs.length} contrôle(s) en échec :`);
  for (const e of echecs) console.error(`  - ${e.nom}`);
  process.exit(1);
}
process.exit(0);
