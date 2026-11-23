#!/usr/bin/env node
/**
 * CLAVIER OUVERT, LA BARRE D'ÉCRITURE D'UNE CARTE SE POSE SUR LE CLAVIER.
 *
 * Décision du 30/10/2026 (capture #8dff, remplace le recouvrement « sticky »
 * du 27/10/2026) : l'application prend la hauteur visible au-dessus du
 * clavier, les blocs du pied, la rangée d'action et la barre des messages en
 * attente s'effacent pendant la frappe, et la barre d'écriture — dernier bloc
 * de la colonne — se pose sur le clavier, comme dans une messagerie.
 *
 * Sur un téléphone (390 × 844) avec un FAUX clavier (`visualViewport`
 * remplacé, Chromium sans tête n'en fait pas monter) de 336 px puis de 600 px,
 * une carte dont la question attend une réponse (panneau de décision) :
 *
 *  1. le champ touché, un long texte écrit, le champ est ENTIER dans la zone
 *     que le clavier laisse visible, et c'est lui qu'on touche en son milieu ;
 *  2. le bas de la barre d'écriture touche le haut du clavier (± 1 px), la page
 *     n'a pas glissé, et les blocs du pied sont effacés ;
 *  3. le champ quitté, la marque tombe et les blocs du pied retrouvent
 *     exactement leur place d'avant ;
 *  4. AVEC UNE BARRE DE GESTES DE 34 PX (`scripts/lib/zone-sure.mjs` : l'encart
 *     vaut 0 dans Chromium, ce qui cachait l'espace de la capture #80d52), la
 *     barre touche toujours le clavier, et la marge réapparaît si on la remet :
 *     le contrôle sait donc voir ce défaut ;
 *  5. LE CLAVIER QUI BOUGE SANS PRÉVENIR (captures #93638, #e155) : refermé puis
 *     remonté sans aucun `resize`, il est retrouvé par la surveillance ; revenu
 *     pendant que la page était cachée, il est retrouvé au retour, par
 *     `visibilitychange` comme par `pageshow`. Le cas réel du sélecteur de photos
 *     ne se rejoue pas ici : on en simule l'effet ;
 *  6. LA ZONE VISIBLE BLOQUÉE (iOS 26, application installée, captures #2da6 /
 *     #866f) : un clavier a déjà été mesuré dans cette orientation (hauteur
 *     retenue), puis le clavier monte SANS que `visualViewport` bouge. La
 *     hauteur retenue prend le relais (source « secours ») et la barre se pose
 *     sur le clavier réel ; le champ quitté, tout retombe à 0.
 *
 * Démon d'essai à base neuve : aucun quota, la production n'est pas touchée.
 * Usage : npm run build && node scripts/verif-champ-au-dessus-du-clavier.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { poserZonesSures } from './lib/zone-sure.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7194);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = `${RACINE}/data/verification`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-ecriture-clavier-'));
const DOSSIER = path.join(TMP, 'projet');
const { DATA, journal, attendrePort } = demarrerDemonDEssai({ tmp: TMP, port: PORT, depot: false, dossiers: [DOSSIER] });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const AGENT_ID = 'a-essai';
const CARTE_ID = 'c-essai-ecriture-clavier';
const QUESTION = `Vérification ${Date.now()} — barre d'écriture au-dessus du clavier`;
const TEXTE_LONG = Array.from({ length: 12 }, (_, i) => `Ligne ${i + 1} d'un long message écrit au clavier.`).join('\n');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification barre d’écriture au-dessus du clavier',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  const projet = { id: PROJET_ID, name: 'Essai clavier', path: DOSSIER, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
    projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant,
  );
  /* Une carte d'essai, en « Planifié » : rien ne la balaie, rien ne la lance. */
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, agent_id)
     VALUES (?, ?, 'planned', 1, ?, '{}', ?, ?, ?, ?)`,
  ).run(CARTE_ID, PROJET_ID, 'Carte d’essai — barre au-dessus du clavier', maintenant, maintenant, 'Carte posée par un contrôle automatique.', AGENT_ID);
  const agent = { id: AGENT_ID, projectId: PROJET_ID, cardId: CARTE_ID, role: 'task', title: 'Carte d’essai', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'done', createdAt: maintenant, updatedAt: maintenant };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, CARTE_ID, 'task', 'done', JSON.stringify(agent), maintenant, maintenant);
  /* Sans une demande partie, l'écran resterait sur la configuration de l'agent. */
  const demande = { id: crypto.randomUUID(), agentId: AGENT_ID, role: 'user', content: 'Carte d’essai : ne rien exécuter.', steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [], streaming: false, createdAt: maintenant - 1000 };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    demande.id, AGENT_ID, 'user', JSON.stringify(demande), demande.createdAt,
  );
  const id = crypto.randomUUID();
  const message = {
    id, agentId: AGENT_ID, role: 'assistant', content: 'Question posée par le script de vérification.',
    steps: [], todos: [], proposals: [], downloads: [], attachments: [], streaming: false, createdAt: maintenant,
    questions: [{
      id: crypto.randomUUID(),
      question: QUESTION,
      kind: 'single',
      options: Array.from({ length: 6 }, (_, i) => ({ id: `option-${i + 1}`, label: `Option ${i + 1}`, description: 'Un choix proposé.' })),
      allowFreeText: true,
      answerAttachments: [],
    }],
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id, AGENT_ID, 'assistant', JSON.stringify(message), maintenant,
  );
  db.close();
}

/** La place de chaque bloc du pied, pour comparer avant et après. */
const lireLePied = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-ecran-de-carte] [data-bloc-du-pied]')).map((n) => {
      const r = n.getBoundingClientRect();
      return `${n.getAttribute('data-bloc-du-pied')}:${Math.round(r.top)}:${Math.round(r.height)}`;
    }).join('|'),
  );

async function essai(navigateur, clavier, theme) {
  const context = await navigateur.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'fr-CH', serviceWorkers: 'block', colorScheme: theme,
  });
  await context.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  /* LE FAUX CLAVIER : `visualViewport` rétrécit quand un champ a le curseur. */
  await context.addInitScript((hauteur) => {
    const cible = new EventTarget();
    let ouvert = false;
    const vue = {
      get width() { return window.innerWidth; },
      get height() { return window.innerHeight - (ouvert ? hauteur : 0); },
      offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
      addEventListener: (...a) => cible.addEventListener(...a),
      removeEventListener: (...a) => cible.removeEventListener(...a),
      dispatchEvent: (e) => cible.dispatchEvent(e),
    };
    Object.defineProperty(window, 'visualViewport', { get: () => vue, configurable: true });
    const basculer = (etat) => {
      if (ouvert === etat) return;
      ouvert = etat;
      setTimeout(() => cible.dispatchEvent(new Event('resize')), 200);
    };
    document.addEventListener('focusin', (e) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) basculer(true);
    });
    document.addEventListener('focusout', () => basculer(false));
  }, clavier);
  const page = await context.newPage();
  const nom = `clavier ${clavier} px (${theme})`;
  try {
    await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const champ = page.locator('[data-ecran-de-carte] [data-champ-d-ecriture] textarea').first();
    await champ.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    if (!(await champ.count())) {
      noter(`${nom} : le champ d'écriture de la carte est affiché`, false);
      await page.screenshot({ path: `${SHOTS}/ecriture-clavier-${clavier}-${theme}-introuvable.png` });
      return;
    }
    await page.waitForTimeout(800);
    const avant = await lireLePied(page);
    noter(`${nom} : la décision en attente est dans le pied`, avant.includes('decision:') && !/decision:\d+:0\b/.test(avant), avant);

    await champ.tap();
    await champ.fill(TEXTE_LONG);
    await page.waitForTimeout(1400);
    const lu = await champ.evaluate((el) => {
      const c = el.getBoundingClientRect();
      const vv = window.visualViewport;
      const dessus = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
      const ecran = el.closest('[data-ecran-de-carte]');
      const barre = el.closest('[data-composer]')?.getBoundingClientRect();
      return {
        focus: document.activeElement === el,
        marque: ecran?.hasAttribute('data-ecriture-au-clavier') ?? false,
        auDessus: !!dessus && (dessus === el || el.contains(dessus) || !!dessus.closest?.('[data-champ-d-ecriture]')),
        champHaut: Math.round(c.top), champBas: Math.round(c.bottom),
        barreBas: barre ? Math.round(barre.bottom) : null,
        hautVisible: Math.round(vv.offsetTop), basVisible: Math.round(vv.offsetTop + vv.height),
        fond: barre ? getComputedStyle(el.closest('[data-composer]')).backgroundColor : '',
        defilement: Math.round(window.scrollY),
        blocsVisibles: Array.from(ecran?.querySelectorAll('[data-bloc-du-pied], [data-rangee-principale], [data-file-attente-barre]') ?? [])
          .filter((n) => n.getClientRects().length > 0)
          .map((n) => n.getAttribute('data-bloc-du-pied') ?? (n.hasAttribute('data-rangee-principale') ? 'rangee' : 'attente')),
      };
    });
    noter(`${nom} : le champ a le curseur`, lu.focus);
    noter(`${nom} : l'écran porte la marque du clavier`, lu.marque);
    noter(`${nom} : le champ est entier au-dessus du clavier`, lu.champHaut >= lu.hautVisible && lu.champBas <= lu.basVisible + 1, JSON.stringify(lu));
    noter(`${nom} : rien ne recouvre le champ`, lu.auDessus, JSON.stringify(lu));
    noter(`${nom} : la barre d'écriture est posée sur le clavier`, lu.barreBas !== null && Math.abs(lu.barreBas - lu.basVisible) <= 1, `${lu.barreBas} / ${lu.basVisible}`);
    noter(`${nom} : la page n'a pas glissé`, lu.defilement === 0, String(lu.defilement));
    noter(`${nom} : les blocs du pied sont effacés pendant la frappe`, lu.blocsVisibles.length === 0, lu.blocsVisibles.join(', '));
    noter(`${nom} : le fond de la barre est opaque`, /^rgb\(/.test(lu.fond) || /, 1\)$/.test(lu.fond), lu.fond);
    await page.screenshot({ path: `${SHOTS}/ecriture-clavier-${clavier}-${theme}.png` });
    if (process.env.SONDE) console.log(await page.evaluate(() => {
      const out = [];
      let n = document.querySelector('[data-ecran-de-carte]');
      while (n && n !== document.documentElement) { const r = n.getBoundingClientRect(); out.push(`${n.tagName}.${(n.className||'').toString().slice(0,60)} ${Math.round(r.top)}-${Math.round(r.bottom)} minH=${getComputedStyle(n).minHeight}`); n = n.parentElement; }
      const c = document.querySelector('[data-ecran-de-carte] [data-composer]');
      out.push('composer kids: ' + Array.from(c.children).map((k) => `${k.tagName}${k.hasAttribute('data-rangee-principale')?'[rangee]':''}:${Math.round(k.getBoundingClientRect().height)}`).join(' '));
      out.push('visible=' + document.documentElement.style.getPropertyValue('--hauteur-visible') + ' clavier=' + document.documentElement.style.getPropertyValue('--clavier') + ' happ=' + document.documentElement.style.getPropertyValue('--hauteur-app'));
      return out.join('\n');
    }));

    /* Le champ quitté (texte retiré pour comparer à l'identique), tout revient. */
    await champ.fill('');
    await champ.evaluate((el) => el.blur());
    await page.waitForTimeout(900);
    const apres = await lireLePied(page);
    const marqueApres = await page.evaluate(() => !!document.querySelector('[data-ecriture-au-clavier]'));
    noter(`${nom} : champ quitté, la marque est retirée`, !marqueApres);
    noter(`${nom} : champ quitté, le pied reprend sa place exacte`, apres === avant, `${avant} → ${apres}`);
  } finally {
    await context.close();
  }
}

/** La barre de gestes de 34 px, et le clavier qui bouge sans aucun événement. */
async function essaiBarreDeGestesEtRetour(navigateur) {
  const context = await navigateur.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'fr-CH', serviceWorkers: 'block',
  });
  await context.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript(() => {
    const cible = new EventTarget();
    const etat = { hauteur: 0, cachee: false };
    window.__essaiClavier = etat;
    Object.defineProperty(document, 'hidden', { get: () => etat.cachee, configurable: true });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      get: () => ({
        get width() { return window.innerWidth; },
        get height() { return window.innerHeight - etat.hauteur; },
        offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
        addEventListener: (...a) => cible.addEventListener(...a),
        removeEventListener: (...a) => cible.removeEventListener(...a),
        dispatchEvent: (e) => cible.dispatchEvent(e),
      }),
    });
  });
  const page = await context.newPage();
  await poserZonesSures(page, { haut: 0, bas: 34 });
  const CLAVIER = 336;
  const poser = (hauteur) => page.evaluate((h) => { window.__essaiClavier.hauteur = h; }, hauteur);
  const lire = () => page.evaluate(() => {
    const champ = document.querySelector('[data-ecran-de-carte] [data-champ-d-ecriture] textarea');
    const vv = window.visualViewport;
    return {
      focus: document.activeElement === champ,
      marque: !!document.querySelector('[data-ecran-de-carte][data-ecriture-au-clavier]'),
      clavier: document.documentElement.style.getPropertyValue('--clavier'),
      barreBas: Math.round(champ?.closest('[data-composer]')?.getBoundingClientRect().bottom ?? -1),
      basVisible: Math.round(vv.offsetTop + vv.height),
    };
  });
  const enPlace = (l) => l.marque && l.clavier === `${CLAVIER}px` && Math.abs(l.barreBas - l.basVisible) <= 1;
  try {
    await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const champ = page.locator('[data-ecran-de-carte] [data-champ-d-ecriture] textarea').first();
    await champ.waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(800);
    await poserZonesSures(page, { haut: 0, bas: 34 });
    await champ.tap();
    await page.waitForTimeout(200);

    /* Clavier monté SANS AUCUN `resize`, champ déjà au curseur. */
    await poser(CLAVIER);
    await page.waitForTimeout(700);
    let lu = await lire();
    noter('surveillance : clavier monté sans événement, la barre se pose dessus', lu.focus && enPlace(lu), JSON.stringify(lu));
    noter('barre de gestes de 34 px : aucun espace sous la barre, clavier ouvert', Math.abs(lu.barreBas - lu.basVisible) <= 1, `${lu.barreBas} / ${lu.basVisible}`);

    /* CONTRE-ÉPREUVE : la marge remise, le contrôle voit l'écart. */
    const barreSansMarge = lu.barreBas;
    await page.evaluate(() => document.documentElement.style.setProperty('--marge-bas-hors-clavier', '34px'));
    await page.waitForTimeout(200);
    lu = await lire();
    noter('contre-épreuve : la marge remise écarte bien la barre du clavier', barreSansMarge - lu.barreBas === 34, `${barreSansMarge} → ${lu.barreBas}`);
    await page.evaluate(() => document.documentElement.style.removeProperty('--marge-bas-hors-clavier'));

    /* Clavier refermé sans événement, le champ garde le curseur : plus de marque. */
    await poser(0);
    await page.waitForTimeout(700);
    lu = await lire();
    noter('surveillance : clavier parti, champ au curseur, aucune marque', lu.focus && !lu.marque && lu.clavier === '0px', JSON.stringify(lu));
    const margeHorsClavier = await page.evaluate(() => {
      const barre = document.querySelector('[data-ecran-de-carte] [data-composer]');
      return Math.round(window.innerHeight - barre.getBoundingClientRect().bottom);
    });
    noter('clavier fermé : la barre de gestes reste réservée', margeHorsClavier >= 34, `${margeHorsClavier} px sous la barre`);

    /* Page cachée : la surveillance s'arrête ; le retour remesure. */
    for (const retour of ['visibilitychange', 'pageshow']) {
      await page.evaluate(() => {
        window.__essaiClavier.cachee = true;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await poser(CLAVIER);
      await page.waitForTimeout(600);
      lu = await lire();
      noter(`page cachée : la surveillance est à l'arrêt (${retour})`, lu.clavier === '0px', lu.clavier);
      await page.evaluate((nom) => {
        window.__essaiClavier.cachee = false;
        (nom === 'pageshow' ? window : document).dispatchEvent(new Event(nom));
      }, retour);
      await page.waitForTimeout(500);
      lu = await lire();
      noter(`retour par ${retour} : la barre se pose sur le clavier`, lu.focus && enPlace(lu), JSON.stringify(lu));
      await poser(0);
      await page.waitForTimeout(600);
    }

    /* Champ quitté : la surveillance s'arrête, plus aucune mesure ne suit. */
    await champ.evaluate((el) => el.blur());
    await page.waitForTimeout(600);
    await poser(CLAVIER);
    await page.waitForTimeout(600);
    lu = await lire();
    noter('champ quitté : la surveillance est arrêtée, aucune marque', !lu.marque && lu.clavier === '0px', JSON.stringify(lu));
  } finally {
    await context.close();
  }
}

/** La zone visible bloquée à pleine hauteur, clavier ouvert : la hauteur retenue prend le relais. */
async function essaiZoneBloquee(navigateur) {
  const CLAVIER = 336;
  const context = await navigateur.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'fr-CH', serviceWorkers: 'block',
  });
  await context.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript((hauteur) => {
    localStorage.setItem('beluga:clavier-retenu:portrait', String(hauteur));
    const cible = new EventTarget();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      get: () => ({
        get width() { return window.innerWidth; },
        get height() { return window.innerHeight; },
        offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
        addEventListener: (...a) => cible.addEventListener(...a),
        removeEventListener: (...a) => cible.removeEventListener(...a),
        dispatchEvent: (e) => cible.dispatchEvent(e),
      }),
    });
  }, CLAVIER);
  const page = await context.newPage();
  const lire = () => page.evaluate((hauteur) => {
    const champ = document.querySelector('[data-ecran-de-carte] [data-champ-d-ecriture] textarea');
    return {
      focus: document.activeElement === champ,
      source: document.documentElement.getAttribute('data-clavier-source'),
      clavier: document.documentElement.style.getPropertyValue('--clavier'),
      barreBas: Math.round(champ?.closest('[data-composer]')?.getBoundingClientRect().bottom ?? -1),
      basReel: Math.round(window.innerHeight - hauteur),
      defilement: Math.round(window.scrollY),
    };
  }, CLAVIER);
  try {
    await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const champ = page.locator('[data-ecran-de-carte] [data-champ-d-ecriture] textarea').first();
    await champ.waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(800);
    await champ.tap();
    await page.waitForTimeout(1200);
    let lu = await lire();
    noter('zone visible bloquée : la hauteur retenue prend le relais', lu.focus && lu.source === 'secours' && lu.clavier === `${CLAVIER}px`, JSON.stringify(lu));
    noter('zone visible bloquée : la barre se pose sur le clavier réel', Math.abs(lu.barreBas - lu.basReel) <= 1 && lu.defilement === 0, JSON.stringify(lu));
    await champ.evaluate((el) => el.blur());
    await page.waitForTimeout(600);
    lu = await lire();
    noter('zone visible bloquée : champ quitté, tout retombe', lu.clavier === '0px' && lu.source === 'aucune', JSON.stringify(lu));
  } finally {
    await context.close();
  }
}

/** Sur ordinateur, rien ne change : jamais de marque. */
async function essaiOrdinateur(navigateur) {
  const context = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await context.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const champ = page.locator('[data-ecran-de-carte] [data-champ-d-ecriture] textarea').first();
    await champ.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    if (!(await champ.count())) return noter('ordinateur : le champ est affiché', false);
    await champ.click();
    await champ.fill(TEXTE_LONG);
    await page.waitForTimeout(800);
    noter('ordinateur : aucune marque du clavier', !(await page.evaluate(() => !!document.querySelector('[data-ecriture-au-clavier]'))));
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  if (!(await attendrePort())) {
    console.error(`Le démon d'essai n'a pas démarré :\n${journal.join('')}`);
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const clavier of [336, 600]) await essai(navigateur, clavier, 'light');
    await essai(navigateur, 336, 'dark');
    await essaiBarreDeGestesEtRetour(navigateur);
    await essaiZoneBloquee(navigateur);
    await essaiOrdinateur(navigateur);
  } finally {
    await navigateur.close().catch(() => {});
  }
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
