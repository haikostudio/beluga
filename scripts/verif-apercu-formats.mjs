#!/usr/bin/env node
/**
 * LE VOLET D'APERÇU : DES APPAREILS AUX VRAIS RAPPORTS, ET LE TÉLÉPHONE EN PLEIN
 * ÉCRAN — vérifié dans un VRAI navigateur, sur son PROPRE démon (base neuve,
 * port libre : le démon de production n'est pas touché, aucun quota dépensé).
 *
 * Sur TÉLÉPHONE (390 × 844), sans préférence retenue :
 *   - le bouton « Aperçu » est dans l'en-tête de la carte ;
 *   - l'aperçu prend l'écran entier, la conversation est MASQUÉE (pas démontée) ;
 *   - pas de croix, UN seul bouton de format : il OUVRE un menu (le format, puis
 *     ses modèles groupés par famille, puis Portrait / Paysage), il ne fait plus
 *     défiler les formats ; sans choix, le téléphone s'adapte à sa place ;
 *   - un iPhone 15 s'affiche à 393 × 852, au rapport exact, réduit en entier ;
 *     en paysage, 852 × 393 ; un écran 1920 se réduit sans être coupé ;
 *   - la flèche de retour referme l'aperçu et rend la conversation AVEC son
 *     brouillon ; un second appui quitte la carte.
 * Sur ORDINATEUR (1400 × 900) :
 *   - trois boutons de format tout à droite de la barre, après la croix ;
 *   - l'appareil et l'orientation retenus sur le téléphone (préférences de
 *     compte) sont repris ;
 *   - chaque icône ouvre son menu à deux niveaux (famille, puis modèle), la
 *     rotation y est, et RIEN n'est posé à côté des icônes ;
 *   - chaque appareil garde son rapport, entier dans le volet ; l'ordinateur
 *     « Adapté à la place » garde la largeur nominale et toute la hauteur ;
 *   - le choix survit au rechargement ; un ancien format seul est repris.
 * L'ÉTAT OUVERT / FERMÉ de l'aperçu se retient par projet, téléphone et
 * ordinateur séparés, et un glisser au doigt dans le cadre ne recharge pas la page.
 * À 360 px de large, l'en-tête de la carte ne déborde pas.
 * Sur ORDINATEUR aussi : le site est dans une fenêtre flottante (coins ronds,
 * ombre), la pastille « Développement » précède l'hôte, une poignée règle la
 * largeur de la conversation (400 px au départ, retour au double-clic, valeur
 * mémorisée), et la barre d'étapes ne se chevauche à aucune largeur.
 *
 * On vérifie l'ÉTAT (repères data-*, dimensions du cadre), pas des pixels de fond.
 *
 *   node scripts/verif-apercu-formats.mjs      (port : BELUGA_APERCU_FORMATS_PORT, 7261 par défaut)
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const Database = require_('better-sqlite3');
const ws = require_('ws');
const PORT = Number(process.env.BELUGA_APERCU_FORMATS_PORT || 7261);
const PORT_SITE = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-apercu-formats-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(PROJETS, { recursive: true });
fs.mkdirSync(DEPOT, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

// Le faux site de développement du projet.
const site = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><body style="margin:0;font:16px sans-serif">Site de développement</body></html>');
});

const jeton = crypto.randomBytes(32).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const PROJET = 'p-apercu';

let demon = null;
let garderLesTraces = false;
const journal = [];

function demarrerLeDemon() {
  const enfant = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
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
  enfant.stdout.on('data', (d) => journal.push(String(d)));
  enfant.stderr.on('data', (d) => journal.push(String(d)));
  return enfant;
}

process.on('exit', () => {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  try {
    site.close();
  } catch {
    /* déjà fermé */
  }
  if (!garderLesTraces) fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort(port, limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(port, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function arreterLeDemon() {
  if (!demon) return;
  const parti = new Promise((r) => demon.on('exit', r));
  demon.kill('SIGTERM');
  await Promise.race([parti, new Promise((r) => setTimeout(r, 5000))]);
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  demon = null;
}

/** La session et le projet (avec son adresse de développement), posés en base entre deux démarrages. */
function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification formats d’aperçu',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const projet = {
    id: PROJET,
    name: 'Essai apercu',
    path: DEPOT,
    devUrl: `http://127.0.0.1:${PORT_SITE}`,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(PROJET, projet.name, DEPOT, JSON.stringify(projet), maintenant, maintenant);
  db.close();
}

/**
 * Une carte neuve montre sa CONFIGURATION, pas la barre d'étapes : on lui donne
 * un agent au repos et deux messages, comme une carte déjà commencée.
 */
function poserUneConversation(carteId) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now() - 60_000;
  const agentId = 'a-apercu';
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(carteId);
  db.prepare('UPDATE cards SET data = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(ligne.data), agentId }), carteId);
  const agent = {
    id: agentId,
    projectId: PROJET,
    cardId: carteId,
    role: 'task',
    title: 'Carte de l’aperçu',
    run: { engine: 'claude', thinking: 'low', mode: 'direct' },
    status: 'done',
    startedAt: t,
    endedAt: t + 1000,
    createdAt: t,
    updatedAt: t + 1000,
  };
  db.prepare(
    'INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(agentId, PROJET, carteId, 'task', 'done', JSON.stringify(agent), t, t + 1000);
  [
    { id: 'm-apercu-1', role: 'user', content: 'Bonjour, peux-tu regarder cette page ?', createdAt: t },
    { id: 'm-apercu-2', role: 'assistant', content: 'Oui, voici ce que j’ai vu.', createdAt: t + 1000 },
  ].forEach((m) => {
    const message = { ...m, agentId, steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [] };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      m.id,
      agentId,
      m.role,
      JSON.stringify(message),
      m.createdAt,
    );
  });
  db.close();
}

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 60000);
    prise.on('open', () => prise.send(JSON.stringify({ id, cmd })));
    prise.on('message', (brut) => {
      const evenement = JSON.parse(String(brut));
      if (evenement.type !== 'ack' || evenement.id !== id) return;
      clearTimeout(minuteur);
      prise.close();
      if (evenement.error) reject(new Error(evenement.error));
      else resolve(evenement.data);
    });
    prise.on('error', (e) => (clearTimeout(minuteur), reject(e)));
  });
}

/** L'état du cadre : son appareil, sa réduction, ses dimensions nominales et AFFICHÉES, et la place qu'il a. */
async function etatDuCadre(page) {
  return page.evaluate(() => {
    const cadre = document.querySelector('[data-apercu-cadre]');
    if (!cadre) return null;
    const r = cadre.getBoundingClientRect();
    const zone = cadre.parentElement.getBoundingClientRect();
    return {
      format: cadre.getAttribute('data-apercu-format'),
      modele: cadre.getAttribute('data-apercu-modele'),
      orientation: cadre.getAttribute('data-apercu-orientation'),
      echelle: Number(cadre.getAttribute('data-apercu-echelle')),
      largeurNominale: cadre.offsetWidth,
      hauteurNominale: cadre.offsetHeight,
      largeurAffichee: Math.round(r.width),
      hauteurAffichee: Math.round(r.height),
      tient:
        r.left >= zone.left - 1 && r.right <= zone.right + 1 && r.top >= zone.top - 1 && r.bottom <= zone.bottom + 1,
    };
  });
}

/** Le cadre garde le rapport de son appareil : largeur ÷ hauteur affichées, à 1 % près. */
const garde = (etat, largeur, hauteur) =>
  !!etat && etat.hauteurAffichee > 0 && Math.abs(etat.largeurAffichee / etat.hauteurAffichee / (largeur / hauteur) - 1) < 0.01;

/**
 * LE MENU D'UN FORMAT S'OUVRE AU SECOND CLIC. Une icône qui n'est pas active
 * montre d'abord la version de base de son format (premier clic, aucun menu) ;
 * on la reclique alors pour ouvrir le menu. Le bouton unique du téléphone
 * (`cyclique`, sans rôle « radio ») ouvre son menu dès le premier appui.
 */
async function ouvrirLeMenuDuFormat(page, bouton) {
  const icone = (await bouton.getAttribute('role')) === 'radio';
  if (icone && (await bouton.getAttribute('data-actif')) === null) {
    await bouton.click(); // premier clic : la version de base du format
    await page.waitForTimeout(350);
  }
  await bouton.click();
  const menu = page.locator('[data-apercu-menu]:visible').first();
  await menu.waitFor({ timeout: 5000 });
  return menu;
}

/**
 * Choisit un modèle. Sur le bouton unique du téléphone, le menu donne d'abord
 * les trois formats (un choix = version de base, menu refermé) ; un autre modèle
 * que la version de base se prend dans « Appareil », au menu suivant.
 */
async function choisirUnAppareil(page, bouton, { format, famille, modele }) {
  const cyclique = (await bouton.getAttribute('role')) !== 'radio';
  if (cyclique && format) {
    await bouton.click();
    const m = page.locator('[data-apercu-menu]:visible').first();
    await m.waitFor({ timeout: 5000 });
    await m.locator(`[data-apercu-format-choix="${format}"]`).click();
    await page.waitForTimeout(350);
    if (modele === `${format}-adapte`) return;
  }
  const menu = await ouvrirLeMenuDuFormat(page, bouton);
  if (cyclique) {
    await menu.locator('[data-apercu-appareil-choix]').click();
    await page.waitForTimeout(150);
  } else if (famille) {
    await page.locator(`[data-apercu-famille="${famille}"]:visible`).first().click();
    await page.waitForTimeout(150);
  }
  await page.locator(`[data-apercu-modele-choix="${modele}"]:visible`).first().click();
  await page.waitForTimeout(350);
}

async function choisirUneOrientation(page, bouton, orientation) {
  await ouvrirLeMenuDuFormat(page, bouton);
  await page.locator(`[data-apercu-orientation-choix="${orientation}"]:visible`).first().click();
  await page.waitForTimeout(350);
}

/**
 * L'état ouvert / fermé de l'aperçu SE RETIENT (par projet, téléphone et
 * ordinateur séparés) : après un rechargement, le bouton peut déjà dire
 * « ouvert ». On n'appuie donc que s'il est fermé, et on rend l'état trouvé.
 */
async function ouvrirLApercu(page) {
  const bouton = page.locator('[data-geste-apercu]:visible').first();
  await bouton.waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  const dejaOuvert = (await bouton.getAttribute('data-geste-apercu')) === 'ouvert';
  if (!dejaOuvert) await bouton.click();
  await page.locator('[data-volet-apercu]').waitFor({ timeout: 10000 });
  return dejaOuvert;
}

/** L'état du bouton, sans appui : « ouvert » ou non (la préférence arrive avec l'état de l'application). */
async function ouvrirLApercuSansAppui(page) {
  const bouton = page.locator('[data-geste-apercu]:visible').first();
  await bouton.waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  return (await bouton.getAttribute('data-geste-apercu')) === 'ouvert';
}

const proche = (a, b, marge = 2) => Math.abs(a - b) <= marge;

async function nouveauContexte(navigateur, options) {
  const contexte = await navigateur.newContext({ locale: 'fr-CH', serviceWorkers: 'block', ...options });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  page.erreurs = [];
  page.on('pageerror', (e) => page.erreurs.push(String(e)));
  return { contexte, page };
}

async function main() {
  await new Promise((r) => site.listen(PORT_SITE, '127.0.0.1', r));
  demon = demarrerLeDemon();
  if (!(await attendrePort(PORT))) throw new Error('le démon d’essai n’a pas démarré');
  await arreterLeDemon();
  poserLeDecor();
  demon = demarrerLeDemon();
  if (!(await attendrePort(PORT))) throw new Error('le démon d’essai n’a pas redémarré');

  const { card } = await commande({ type: 'card.create', projectId: PROJET, title: 'Carte de l’aperçu' });
  await arreterLeDemon();
  poserUneConversation(card.id);
  demon = demarrerLeDemon();
  if (!(await attendrePort(PORT))) throw new Error('le démon d’essai n’a pas redémarré');
  const adresseCarte = `${BASE}/#projet/${PROJET}/tache/${card.id}`;
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  /* ─── TÉLÉPHONE ─── */
  const tel = await nouveauContexte(navigateur, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = tel.page;
  await p.goto(adresseCarte, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.locator('[data-page-carte]').first().waitFor({ timeout: 30000 });
  const champ = p.locator('[data-champ-d-ecriture] textarea').first();
  await champ.waitFor({ timeout: 30000 });
  await champ.fill('brouillon à garder');
  /* LA BARRE D'ÉTAPES S'ALIGNE SUR LA LIGNE DU TITRE (25/10/2026, capture du
     téléphone) : son premier rond commence là où commence l'icône du projet,
     son dernier finit à la même distance du bord droit, et rien ne déborde. */
  for (const largeur of [360, 390, 430]) {
    await p.setViewportSize({ width: largeur, height: 844 });
    await p.waitForTimeout(400);
    const alignement = await p.evaluate(() => {
      /* L'ICÔNE DU PROJET A QUITTÉ LE RANG DU TITRE (06/11/2026, elle est dans l'angle du ☰) : la barre garde sa
         marge d'avant, et la même des deux côtés. */
      const icone = document.querySelector('[data-barre-etapes] [data-segment]')?.getBoundingClientRect();
      const barre = document.querySelector('[data-barre-etapes]');
      const ronds = [...(barre?.querySelectorAll('[data-segment]') ?? [])].map((e) => e.getBoundingClientRect());
      return {
        icone: icone ? Math.round(icone.left) : null,
        premier: ronds.length ? Math.round(ronds[0].left) : null,
        dernier: ronds.length ? Math.round(ronds[ronds.length - 1].right) : null,
        ronds: ronds.length,
        page: document.documentElement.clientWidth,
        deborde: barre ? barre.scrollWidth > barre.clientWidth + 1 : true,
      };
    });
    noter(
      `${largeur} px : la barre d'étapes finit à la même distance du bord droit qu'elle commence du gauche, sans déborder`,
      alignement.icone !== null && Math.abs(alignement.premier - alignement.icone) <= 1 &&
        Math.abs(alignement.page - alignement.dernier - alignement.icone) <= 1 && alignement.ronds >= 5 && !alignement.deborde,
      JSON.stringify(alignement),
    );
  }
  await p.setViewportSize({ width: 390, height: 844 });

  const bouton = p.locator('[data-geste-apercu]:visible');
  noter('téléphone : le bouton « Aperçu » est dans l’en-tête de la carte', (await bouton.count()) === 1);
  await bouton.click();
  await p.locator('[data-volet-apercu]').waitFor({ timeout: 10000 });
  noter(
    'téléphone : l’aperçu monte en feuille du bas, la conversation reste montée derrière',
    (await p.locator('[data-feuille-du-volet="apercu"][role="dialog"]').count()) === 1 && (await champ.count()) === 1,
  );
  noter('téléphone : pas de croix dans la barre de l’aperçu', (await p.locator('[data-apercu-fermer]').count()) === 0);
  const formats = p.locator('[data-volet-apercu] [data-apercu-appareil]');
  noter('téléphone : un seul bouton de format', (await formats.count()) === 1);

  let etat = await etatDuCadre(p);
  noter('téléphone : sans préférence, le format de départ est le téléphone', etat?.format === 'telephone', JSON.stringify(etat));
  noter(
    'téléphone : sans choix, le téléphone s’adapte à sa place, bord à bord, sans réduction',
    etat?.modele === 'telephone-adapte' && etat.echelle === 1 && proche(etat.largeurAffichee, 390) && etat.tient,
    JSON.stringify(etat),
  );

  /* UN CLIC OUVRE LE MENU, il ne change plus de format. */
  await formats.first().click();
  await p.locator('[data-apercu-menu="unique"]').waitFor({ timeout: 5000 });
  await p.waitForTimeout(600); // le tiroir finit de monter
  noter(
    'téléphone : le bouton ouvre un menu — les trois formats, puis Portrait / Paysage',
    (await p.locator('[data-apercu-menu="unique"] [data-apercu-format-choix]').count()) === 3 &&
      (await p.locator('[data-apercu-orientation-choix]').count()) === 2,
  );
  noter('téléphone : ouvrir le menu ne change pas le format', (await etatDuCadre(p))?.modele === 'telephone-adapte');
  const dansLEcran = await p.evaluate(() => {
    const m = document.querySelector('[data-apercu-menu="unique"]').getBoundingClientRect();
    return m.left >= -1 && m.right <= window.innerWidth + 1 && m.bottom <= window.innerHeight + 1;
  });
  noter('téléphone : le menu reste dans l’écran', dansLEcran);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);

  await choisirUnAppareil(p, formats.first(), { format: 'ordinateur', modele: 'ecran-1920' });
  etat = await etatDuCadre(p);
  noter(
    'téléphone : un écran 1920 × 1080 garde son rapport, réduit en entier pour tenir',
    etat?.modele === 'ecran-1920' &&
      etat.largeurNominale === 1920 &&
      etat.hauteurNominale === 1080 &&
      etat.echelle < 1 &&
      garde(etat, 1920, 1080) &&
      etat.tient,
    JSON.stringify(etat),
  );
  await p.screenshot({ path: path.join(TMP, 'telephone-ecran-1920.png') });

  await choisirUnAppareil(p, formats.first(), { format: 'telephone', modele: 'iphone-15' });
  etat = await etatDuCadre(p);
  noter(
    'téléphone : un iPhone 15 fait 393 × 852, au rapport de l’écran réel, entier dans la place',
    etat?.modele === 'iphone-15' &&
      etat.largeurNominale === 393 &&
      etat.hauteurNominale === 852 &&
      etat.orientation === 'portrait' &&
      garde(etat, 393, 852) &&
      etat.tient,
    JSON.stringify(etat),
  );
  await p.screenshot({ path: path.join(TMP, 'telephone-iphone-15.png') });

  await choisirUneOrientation(p, formats.first(), 'paysage');
  etat = await etatDuCadre(p);
  noter(
    'téléphone : en paysage, l’iPhone 15 fait 852 × 393',
    etat?.modele === 'iphone-15' &&
      etat.orientation === 'paysage' &&
      etat.largeurNominale === 852 &&
      etat.hauteurNominale === 393 &&
      garde(etat, 852, 393) &&
      etat.tient,
    JSON.stringify(etat),
  );
  await p.screenshot({ path: path.join(TMP, 'telephone-iphone-15-paysage.png') });

  noter(
    'téléphone : le bouton de format est le dernier de la barre',
    await p.evaluate(() => {
      const barre = document.querySelector('[data-apercu-fenetre] > div');
      const boutons = [...barre.querySelectorAll('button, a')];
      return boutons[boutons.length - 1]?.hasAttribute('data-apercu-appareil');
    }),
  );

  /* L'APERÇU EST UNE FEUILLE DU BAS SUR TÉLÉPHONE (25/10/2026, #f41f) : sa croix
     (ou le voile, ou la poignée tirée) le referme ; l'icône du projet, dans le fil,
     quitte la carte. */
  await p.locator('[data-feuille-du-volet="apercu"] [data-poignee-du-volet]').click();
  await p.waitForTimeout(300);
  noter(
    'téléphone : la croix de la feuille referme l’aperçu et rend la conversation avec son brouillon',
    (await p.locator('[data-volet-apercu]').count()) === 0 &&
      (await p.locator('[data-page-carte]').count()) === 1 &&
      (await champ.isVisible()) &&
      (await champ.inputValue()) === 'brouillon à garder',
  );
  /* 06/11/2026 : le titre centré ouvre la grille des services ; on quitte la carte par Échap (ou la colonne). */
  noter(
    'téléphone : plus de flèche de retour, le titre centré ouvre la grille des services',
    (await p.locator('[data-page-carte] [data-retour-carte]:visible').count()) === 0 &&
      (await p.locator('[data-page-carte] [data-rang-du-titre] [data-haut-liste="services"]').count()) === 1,
  );
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  noter('téléphone : Échap quitte la carte', (await p.locator('[data-page-carte]').count()) === 0);

  // À 360 px, l'en-tête de la carte ne déborde pas.
  await p.setViewportSize({ width: 360, height: 760 });
  await p.goto(adresseCarte, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.locator('[data-geste-apercu]:visible').waitFor({ timeout: 30000 });
  const debord = await p.evaluate(() => {
    const b = document.querySelector('[data-geste-apercu]').getBoundingClientRect();
    return { droite: Math.round(b.right), page: document.documentElement.scrollWidth };
  });
  noter('360 px : le bouton « Aperçu » tient dans l’en-tête, rien ne déborde', debord.droite <= 360 && debord.page <= 360, JSON.stringify(debord));
  /* L'ÉTAT OUVERT / FERMÉ SE RETIENT, et un glisser tactile DANS le cadre ne
     recharge pas l'application. Le téléphone reste OUVERT à la fin : le contexte
     ordinateur, qui suit, doit le trouver fermé (clé séparée). */
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(adresseCarte, { waitUntil: 'domcontentloaded', timeout: 60000 });
  noter('téléphone : l’aperçu fermé est retrouvé fermé après rechargement', (await ouvrirLApercuSansAppui(p)) === false);
  await p.locator('[data-geste-apercu]:visible').first().click();
  await p.locator('[data-volet-apercu]').waitFor({ timeout: 10000 });
  await p.waitForTimeout(600);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.locator('[data-geste-apercu]:visible').first().waitFor({ timeout: 30000 });
  await p.locator('[data-volet-apercu]').waitFor({ timeout: 15000 });
  noter(
    'téléphone : l’aperçu ouvert est retrouvé ouvert après rechargement, en feuille du bas',
    (await p.locator('[data-feuille-du-volet="apercu"]').count()) === 1,
  );
  const racines = await p.evaluate(() => ({
    html: getComputedStyle(document.documentElement).overscrollBehaviorY,
    body: getComputedStyle(document.body).overscrollBehaviorY,
    zone: getComputedStyle(document.querySelector('[data-apercu-cadre]').parentElement).overscrollBehaviorY,
  }));
  noter(
    'téléphone : le tirer-pour-recharger est bloqué sur la page, le corps et la zone du cadre',
    racines.html === 'none' && racines.body === 'none' && racines.zone === 'none',
    JSON.stringify(racines),
  );
  await p.evaluate(() => {
    window.__hoteIntact = 'oui';
  });
  const chargements = [];
  const surChargement = () => chargements.push(Date.now());
  p.on('load', surChargement);
  const cdp = await tel.contexte.newCDPSession(p);
  const cadreTactile = await p.locator('[data-apercu-cadre]').boundingBox();
  const xTactile = cadreTactile.x + cadreTactile.width / 2;
  const glisserAuDoigt = async (y0, y1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: xTactile, y: y0 }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: xTactile, y: y0 + ((y1 - y0) * i) / 12 }],
      });
      await p.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(350);
  };
  // Vers le haut (le site défile), puis vers le bas jusqu'au-delà du sommet (le geste « tirer pour recharger »).
  for (let k = 0; k < 3; k++) await glisserAuDoigt(cadreTactile.y + 520, cadreTactile.y + 120);
  for (let k = 0; k < 3; k++) await glisserAuDoigt(cadreTactile.y + 120, cadreTactile.y + 620);
  await p.waitForTimeout(800);
  p.off('load', surChargement);
  noter(
    'téléphone : un glisser au doigt dans le cadre ne recharge pas l’application',
    (await p.evaluate(() => window.__hoteIntact)) === 'oui' && chargements.length === 0,
    `${chargements.length} chargement(s)`,
  );
  noter(
    'téléphone : après le glisser, l’aperçu est toujours là, en feuille du bas',
    (await p.locator('[data-volet-apercu]').count()) === 1 && (await p.locator('[data-feuille-du-volet="apercu"]').count()) === 1,
  );

  noter('téléphone : aucune erreur de page', p.erreurs.length === 0, p.erreurs.slice(0, 2).join(' | '));
  await tel.contexte.close();

  /* ─── ORDINATEUR ─── */
  const ordi = await nouveauContexte(navigateur, { viewport: { width: 1400, height: 900 } });
  const o = ordi.page;
  await o.goto(adresseCarte, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const ouvertDeDepart = await ouvrirLApercu(o);
  noter('ordinateur : l’aperçu ouvert sur le téléphone ne s’ouvre pas ici (mémoire séparée)', ouvertDeDepart === false);
  const trois = o.locator('[data-apercu-formats] [data-apercu-appareil]');
  noter('ordinateur : trois boutons de format côte à côte', (await trois.count()) === 3);
  noter(
    'ordinateur : la bascule est tout à droite, après la croix',
    await o.evaluate(() => {
      const barre = document.querySelector('[data-apercu-fenetre] > div');
      const enfants = [...barre.children];
      const formats = enfants.findIndex((e) => e.hasAttribute('data-apercu-formats'));
      const croix = enfants.findIndex((e) => e.querySelector('[data-apercu-fermer]') || e.hasAttribute('data-apercu-fermer'));
      return formats === enfants.length - 1 && croix >= 0 && croix < formats;
    }),
  );
  etat = await etatDuCadre(o);
  noter(
    'ordinateur : l’appareil retenu sur le téléphone est repris (préférence de compte)',
    etat?.format === 'telephone' && etat.modele === 'iphone-15' && etat.orientation === 'paysage',
    JSON.stringify(etat),
  );
  noter(
    'ordinateur : le format choisi est coché, les autres non',
    (await o.locator('[data-apercu-appareil="telephone"]').getAttribute('aria-checked')) === 'true' &&
      (await o.locator('[data-apercu-appareil="ordinateur"]').getAttribute('aria-checked')) === 'false',
  );
  noter(
    'ordinateur : l’iPhone 15 en paysage fait 852 × 393 et tient entier',
    etat?.largeurNominale === 852 && etat.hauteurNominale === 393 && garde(etat, 852, 393) && etat.tient,
    JSON.stringify(etat),
  );
  noter(
    'ordinateur : rien n’est posé à côté des icônes — le seul contrôle de format est le groupe de trois icônes',
    (await o.locator('[data-apercu-fenetre] [data-apercu-orientation-choix]:visible').count()) === 0 &&
      (await o.locator('[data-apercu-formats]').evaluate((groupe) => groupe.children.length)) === 3,
  );

  /* PREMIER CLIC : la version de base du format, aucun menu. */
  await o.locator('[data-apercu-appareil="tablette"]').click();
  await o.waitForTimeout(400);
  etat = await etatDuCadre(o);
  noter(
    'ordinateur : un clic sur l’icône tablette affiche la version de base, sans ouvrir de menu',
    etat?.format === 'tablette' &&
      etat.modele === 'tablette-adapte' &&
      (await o.locator('[data-apercu-menu]:visible').count()) === 0 &&
      (await o.locator('[data-apercu-appareil="tablette"]').getAttribute('aria-checked')) === 'true',
    JSON.stringify(etat),
  );
  /* SECOND CLIC sur l'icône déjà active : le menu s'ouvre, l'appareil ne change pas. */
  await o.locator('[data-apercu-appareil="tablette"]').click();
  await o.locator('[data-apercu-menu="tablette"]').waitFor({ timeout: 5000 });
  noter(
    'ordinateur : l’icône tablette ouvre ses familles (iPad, Android) avec « Adapté à la place » et la rotation',
    (await o.locator('[data-apercu-menu="tablette"] [data-apercu-famille]').count()) === 2 &&
      (await o.locator('[data-apercu-menu="tablette"] [data-apercu-modele-choix="tablette-adapte"]').count()) === 1 &&
      (await o.locator('[data-apercu-menu="tablette"] [data-apercu-orientation-choix]').count()) === 2,
  );
  noter('ordinateur : ouvrir le menu ne change pas l’appareil', (await etatDuCadre(o))?.modele === 'tablette-adapte');
  await o.keyboard.press('Escape');
  await o.waitForTimeout(250);

  await choisirUnAppareil(o, o.locator('[data-apercu-appareil="tablette"]'), { famille: 'ipad', modele: 'ipad-10' });
  etat = await etatDuCadre(o);
  noter(
    'ordinateur : un iPad 10,9″ en paysage (orientation retenue) fait 1180 × 820, entier dans le volet',
    etat?.format === 'tablette' &&
      etat.modele === 'ipad-10' &&
      etat.largeurNominale === 1180 &&
      etat.hauteurNominale === 820 &&
      garde(etat, 1180, 820) &&
      etat.tient,
    JSON.stringify(etat),
  );
  await choisirUneOrientation(o, o.locator('[data-apercu-appareil="tablette"]'), 'portrait');
  etat = await etatDuCadre(o);
  noter(
    'ordinateur : en portrait, l’iPad fait 820 × 1180 au rapport exact, réduit pour tenir',
    etat?.orientation === 'portrait' &&
      etat.largeurNominale === 820 &&
      etat.hauteurNominale === 1180 &&
      etat.echelle < 1 &&
      garde(etat, 820, 1180) &&
      etat.tient,
    JSON.stringify(etat),
  );

  /* L'ordinateur reste en paysage : aucune rotation dans son menu. Premier clic :
     sa version de base ; second clic : son menu. */
  await o.locator('[data-apercu-appareil="ordinateur"]').click();
  await o.waitForTimeout(400);
  noter(
    'ordinateur : un clic sur l’icône ordinateur affiche sa version de base, sans menu',
    (await etatDuCadre(o))?.modele === 'ordinateur-adapte' && (await o.locator('[data-apercu-menu]:visible').count()) === 0,
  );
  await o.locator('[data-apercu-appareil="ordinateur"]').click();
  await o.locator('[data-apercu-menu="ordinateur"]').waitFor({ timeout: 5000 });
  noter(
    'ordinateur : le menu de l’ordinateur n’a pas de rotation',
    (await o.locator('[data-apercu-menu="ordinateur"] [data-apercu-orientation-choix]').count()) === 0,
  );
  noter(
    'ordinateur : ses familles sont les portables et les écrans',
    (await o.locator('[data-apercu-menu="ordinateur"] [data-apercu-famille]').count()) === 2,
  );
  /* Échap referme le menu sans rien changer, dès le premier appui : aucune
     infobulle ne reste ouverte sous lui pour prendre cet Échap. */
  await o.waitForTimeout(800);
  await o.keyboard.press('Escape');
  const referme = await o
    .locator('[data-apercu-menu="ordinateur"]')
    .waitFor({ state: 'detached', timeout: 3000 })
    .then(() => true, () => false);
  noter('ordinateur : Échap referme le menu', referme);
  await o.waitForTimeout(300);
  await o.locator('[data-apercu-appareil="ordinateur"]').click();
  await o.locator('[data-apercu-menu="ordinateur"]').waitFor({ timeout: 5000 });
  await o.locator('[data-apercu-famille="ecran"]:visible').first().click();
  await o.waitForTimeout(150);
  await o.locator('[data-apercu-modele-choix="ecran-1920"]:visible').first().click();
  await o.waitForTimeout(350);
  etat = await etatDuCadre(o);
  noter(
    'ordinateur : un écran 1920 × 1080 reste en paysage, au rapport exact, entier dans le volet',
    etat?.format === 'ordinateur' &&
      etat.orientation === 'paysage' &&
      etat.largeurNominale === 1920 &&
      etat.hauteurNominale === 1080 &&
      etat.echelle < 1 &&
      garde(etat, 1920, 1080) &&
      etat.tient,
    JSON.stringify(etat),
  );
  await o.screenshot({ path: path.join(TMP, 'ordinateur-ecran-1920.png') });

  await choisirUnAppareil(o, o.locator('[data-apercu-appareil="ordinateur"]'), { modele: 'ordinateur-adapte' });
  etat = await etatDuCadre(o);
  noter(
    'ordinateur : « Adapté à la place » garde la largeur nominale et toute la hauteur',
    etat?.format === 'ordinateur' &&
      etat.modele === 'ordinateur-adapte' &&
      etat.largeurNominale >= 1280 &&
      etat.tient &&
      etat.hauteurAffichee > 500,
    JSON.stringify(etat),
  );

  /* Le choix se retrouve après rechargement. */
  await choisirUnAppareil(o, o.locator('[data-apercu-appareil="telephone"]'), { famille: 'android', modele: 'pixel' });
  await o.waitForTimeout(600);
  await o.reload({ waitUntil: 'domcontentloaded' });
  const survitAuRechargement = await ouvrirLApercu(o);
  noter('ordinateur : l’aperçu reste ouvert après rechargement, sans appui', survitAuRechargement === true);
  await o.locator('[data-apercu-cadre]').waitFor({ timeout: 10000 });
  etat = await etatDuCadre(o);
  noter(
    'ordinateur : le Pixel choisi est retrouvé après rechargement',
    etat?.modele === 'pixel' && etat.largeurNominale === 412 && etat.hauteurNominale === 915 && garde(etat, 412, 915),
    JSON.stringify(etat),
  );

  /* LA DERNIÈRE ADRESSE SAISIE se retrouve après rechargement, par projet. */
  await o.locator('[data-apercu-adresse]').fill('/tarifs');
  await o.locator('[data-apercu-adresse]').press('Enter');
  await o.waitForTimeout(600);
  await o.reload({ waitUntil: 'domcontentloaded' });
  await ouvrirLApercu(o);
  await o.locator('[data-apercu-cadre]').waitFor({ timeout: 10000 });
  noter(
    'ordinateur : la dernière adresse saisie est retrouvée après rechargement',
    (await o.locator('[data-apercu-adresse]').inputValue()) === '/tarifs' &&
      ((await o.locator('[data-apercu-cadre]').getAttribute('src')) ?? '').endsWith('/tarifs'),
  );
  /* Une valeur qui ferait sortir le cadre du site (deux barres, schéma) est ignorée. */
  await commande({ type: 'prefs.set', key: `apercu.chemin.${PROJET}`, value: '//evil.example/x' });
  await o.reload({ waitUntil: 'domcontentloaded' });
  await ouvrirLApercu(o);
  await o.locator('[data-apercu-cadre]').waitFor({ timeout: 10000 });
  noter(
    'ordinateur : une adresse « //hôte » retenue est ignorée, le cadre reste sur le site de développement',
    (await o.locator('[data-apercu-adresse]').inputValue()) === '/' &&
      !((await o.locator('[data-apercu-cadre]').getAttribute('src')) ?? '').includes('evil.example'),
  );
  await commande({ type: 'prefs.set', key: `apercu.chemin.${PROJET}`, value: '/' });

  /* Un ANCIEN choix « téléphone / tablette / ordinateur » seul est repris avec un appareil réaliste. */
  await commande({ type: 'prefs.set', key: `apercu.appareil.${PROJET}`, value: '' });
  await commande({ type: 'prefs.set', key: 'apercu.appareil', value: '' });
  await commande({ type: 'prefs.set', key: 'apercu.format', value: 'tablette' });
  await o.reload({ waitUntil: 'domcontentloaded' });
  await ouvrirLApercu(o);
  await o.locator('[data-apercu-cadre]').waitFor({ timeout: 10000 });
  etat = await etatDuCadre(o);
  noter(
    'ordinateur : un ancien format « tablette » seul est repris avec un iPad 10,9″',
    etat?.format === 'tablette' && etat.modele === 'ipad-10',
    JSON.stringify(etat),
  );

  /* PAR PROJET, AVEC REPLI SUR LE COMPTE : sans choix pour le projet, l'appareil
     retenu par le compte avant cette règle sert ; un choix du projet le
     devance, et le compte n'y change plus rien. */
  await commande({ type: 'prefs.set', key: 'apercu.appareil', value: 'ipad-pro-11' });
  await o.reload({ waitUntil: 'domcontentloaded' });
  await ouvrirLApercu(o);
  await o.locator('[data-apercu-cadre]').waitFor({ timeout: 10000 });
  etat = await etatDuCadre(o);
  noter('ordinateur : sans choix du projet, l’appareil du compte sert', etat?.modele === 'ipad-pro-11', JSON.stringify(etat));
  await choisirUnAppareil(o, o.locator('[data-apercu-appareil="telephone"]'), { famille: 'iphone', modele: 'iphone-mini' });
  await commande({ type: 'prefs.set', key: 'apercu.appareil', value: 'ecran-2560' });
  await o.reload({ waitUntil: 'domcontentloaded' });
  await ouvrirLApercu(o);
  await o.locator('[data-apercu-cadre]').waitFor({ timeout: 10000 });
  etat = await etatDuCadre(o);
  noter(
    'ordinateur : le choix du projet est retenu pour ce projet, le compte ne le change plus',
    etat?.modele === 'iphone-mini',
    JSON.stringify(etat),
  );
  // On rend la main au reste du contrôle : plus de choix, l'ancien format « tablette ».
  await commande({ type: 'prefs.set', key: `apercu.appareil.${PROJET}`, value: '' });
  await commande({ type: 'prefs.set', key: 'apercu.appareil', value: '' });
  await o.reload({ waitUntil: 'domcontentloaded' });
  await ouvrirLApercu(o);
  await o.locator('[data-apercu-cadre]').waitFor({ timeout: 10000 });

  /* ─── FENÊTRE FLOTTANTE, PASTILLE, POIGNÉE, ÉTAPES ─── */
  const fenetre = await o.evaluate(() => {
    const f = document.querySelector('[data-apercu-fenetre]');
    const c = getComputedStyle(f);
    const pad = getComputedStyle(document.querySelector('[data-volet-apercu]')).paddingLeft;
    return { rayon: parseFloat(c.borderTopLeftRadius), ombre: c.boxShadow !== 'none', marge: parseFloat(pad) };
  });
  noter('ordinateur : le site est dans une fenêtre arrondie, ombrée, posée sur le fond', fenetre.rayon >= 8 && fenetre.ombre && fenetre.marge > 0, JSON.stringify(fenetre));
  const pastille = o.locator('[data-apercu-environnement]');
  noter('ordinateur : la pastille « Développement » précède l’hôte', (await pastille.count()) === 1 && (await pastille.innerText()) === 'Développement');

  const poignee = o.locator('[data-conversation-poignee]');
  const largeurDuChat = () => o.evaluate(() => Math.round(document.querySelector('[data-conversation-poignee]').previousElementSibling.getBoundingClientRect().width));
  noter('ordinateur : une poignée entre la conversation et l’aperçu', (await poignee.count()) === 1);
  noter('ordinateur : la conversation fait 400 px au départ', proche(await largeurDuChat(), 400), String(await largeurDuChat()));

  const glisser = async (dx) => {
    const b = await poignee.boundingBox();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await o.mouse.move(x, y);
    await o.mouse.down();
    await o.mouse.move(x + dx / 2, y, { steps: 6 });
    await o.mouse.move(x + dx, y, { steps: 6 });
    await o.mouse.up();
    await o.waitForTimeout(200);
  };
  /** Aucune étape n'en recouvre une autre, et le repère dit si la barre est compacte. */
  const etapes = () =>
    o.evaluate(() => {
      const liste = document.querySelector('[data-barre-etapes]');
      const rects = [...liste.querySelectorAll('[data-segment]')].map((b) => b.getBoundingClientRect());
      const noms = [...liste.querySelectorAll('[data-segment] > span:last-child')].filter((n) => getComputedStyle(n).display !== 'none');
      const sansChevauchement = rects.every((r, i) => i === 0 || r.left >= rects[i - 1].right - 1);
      const nomsLus = noms.every((n) => n.scrollWidth <= n.clientWidth + 1 || getComputedStyle(n).overflow === 'visible');
      return { compacte: liste.hasAttribute('data-barre-compacte'), noms: noms.length, sansChevauchement, nomsLus, largeur: liste.clientWidth, rects: sansChevauchement ? undefined : rects.map((r) => [Math.round(r.left), Math.round(r.right)]) };
    });

  await o.locator('[data-barre-etapes]').waitFor({ timeout: 30000 });
  let e = await etapes();
  noter('ordinateur : à 400 px de conversation, un seul nom, aucun chevauchement', e.compacte && e.noms === 1 && e.sansChevauchement, JSON.stringify(e));
  await o.setViewportSize({ width: 1600, height: 900 });
  await glisser(300);
  noter('ordinateur : la poignée élargit la conversation', (await largeurDuChat()) >= 690 && (await largeurDuChat()) <= 720, String(await largeurDuChat()));
  e = await etapes();
  noter('ordinateur : à 700 px, les cinq noms reviennent sans chevauchement', !e.compacte && e.noms === 5 && e.sansChevauchement && e.nomsLus, JSON.stringify(e));
  await glisser(-100);
  e = await etapes();
  noter('ordinateur : à 600 px, les cinq noms tiennent encore sans chevauchement', !e.compacte && e.noms === 5 && e.sansChevauchement && e.nomsLus, JSON.stringify(e));
  await glisser(-100);
  e = await etapes();
  noter('ordinateur : à 500 px, aucun chevauchement', e.sansChevauchement && e.nomsLus, JSON.stringify(e));
  await glisser(-500);
  noter('ordinateur : la conversation ne descend pas sous 320 px', proche(await largeurDuChat(), 320), String(await largeurDuChat()));
  e = await etapes();
  noter('ordinateur : à 320 px, aucun chevauchement', e.compacte && e.sansChevauchement, JSON.stringify(e));
  await glisser(150);
  const retenue = await largeurDuChat();
  await o.waitForTimeout(800);
  await o.reload({ waitUntil: 'domcontentloaded' });
  await ouvrirLApercu(o);
  await o.locator('[data-conversation-poignee]').waitFor({ timeout: 10000 });
  noter('ordinateur : la largeur choisie survit au rechargement', retenue === 470 && proche(await largeurDuChat(), retenue), `${retenue} → ${await largeurDuChat()}`);
  await poignee.dblclick();
  await o.waitForTimeout(200);
  noter('ordinateur : le double-clic revient à 400 px', proche(await largeurDuChat(), 400), String(await largeurDuChat()));
  await o.setViewportSize({ width: 1400, height: 900 });
  await o.locator('[data-apercu-fermer]').click();
  await o.waitForTimeout(300);
  noter('ordinateur : la croix referme l’aperçu', (await o.locator('[data-volet-apercu]').count()) === 0);
  noter('ordinateur : aucune erreur de page', o.erreurs.length === 0, o.erreurs.slice(0, 2).join(' | '));

  await navigateur.close();
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) {
    garderLesTraces = true;
    console.log(`(captures et dossier d’essai gardés dans ${TMP})`);
  }
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  garderLesTraces = true;
  console.error(e);
  console.error(journal.slice(-20).join(''));
  console.error(`(dossier d’essai gardé dans ${TMP})`);
  process.exit(1);
});
