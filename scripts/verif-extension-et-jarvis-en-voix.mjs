#!/usr/bin/env node
/**
 * L'EXTENSION EN RETARD ET JARVIS TOUT EN VOIX, DANS UN VRAI NAVIGATEUR (carte « Extension à jour et Jarvis tout en
 * voix », 20/11/2026). Ce contrôle juge :
 *
 *   1. deux Chrome en retard (le Mac mini en 1.0.8, le Mac en 1.0.5) font paraître la BANNIÈRE ORANGE, pleine largeur,
 *      tout en haut — au-dessus de la colonne de gauche et de l'entête — avec l'icône, le texte et « Mettre à jour » ;
 *   2. sans programme du Mac, « Mettre à jour » ouvre Réglages › Extension ; rien ne déborde à 390 px ;
 *   3. un Chrome qui passe à la version servie (ici simulé en base, poussé par le canal) fait disparaître la bannière ;
 *   4. la bulle vocale n'a plus de bouton vers le volet ; une CONFIRMATION y paraît en bulle avec ses choix ;
 *   5. Jarvis qui travaille pendant la veille met un rond de chargement sur le bouton du coin.
 *   7. (carte « Bande orange de l'extension, retouches ») la bande reste au-dessus de TOUT sur ordinateur — tableau,
 *      page d'une carte, page de service —, son bouton est noir à texte blanc ; sur téléphone elle tient sur une
 *      ligne et un chevron la déplie ; sur iPhone, 6 px d'air au moins entre elle et les boutons du haut ; le bouton
 *      de l'assistant ne se pose que sur les côtés, entre la barre d'en-tête et le menu du bas.
 *   6. sur iPhone (zone sûre de 59 px), la bannière monte sous l'heure — orange jusqu'au bord, texte sous l'heure et
 *      lisible en entier, barre du haut collée dessous sans trou — et, la bannière partie, la barre reprend l'heure.
 *
 * Démon d'essai (base neuve) + serveur de développement de la copie branché dessus (`belugaEssai`). Jamais BELUGA_URL,
 * jamais BELUGA_TOKEN.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-extension-et-jarvis-en-voix.mjs
 *   VERIF_CAPTURES=/chemin env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-extension-et-jarvis-en-voix.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';
import { poserZonesSures } from './lib/zone-sure.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7291);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7192);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-extension-jarvis-', port: PORT, signaux: true });
const jeton = crypto.randomBytes(32).toString('hex');
const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const couperVite = () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
};
process.on('exit', couperVite);

const base = () => new Database(path.join(DATA, 'beluga.db'));
function poserLeDecor() {
  const db = base();
  const T = Date.now();
  db.prepare("INSERT OR IGNORE INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le) VALUES ('u-essai', 'essai', 'admin', 'Essai', 's', 'h', 1, ?)").run(T);
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai extension', 'u-essai');
  db.prepare("INSERT INTO ordinateurs (id, compte_id, nom, cree_le) VALUES ('o-mini', 'u-essai', 'MacMini', ?), ('o-mac', 'u-essai', 'Mac', ?)").run(T, T);
  db.prepare(
    "INSERT INTO chrome_appareils (id, compte_id, nonce, nom, version, cree_le, vu_le, dernier_ts, ordinateur_id, navigateur) VALUES ('c-mini', 'u-essai', 'n1', 'Chrome · macOS', '1.0.8', ?, ?, 0, 'o-mini', 'chrome'), ('c-mac', 'u-essai', 'n2', 'Chrome · macOS', '1.0.5', ?, ?, 0, 'o-mac', 'chrome')",
  ).run(T, T - 3600_000, T, T - 7200_000);
  /* Un projet et une carte, pour ouvrir la page d'une carte sous la bande. */
  const projet = { id: PROJET, name: 'Essai bande', path: DATA, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: T, updatedAt: T };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, DATA, JSON.stringify(projet), T, T);
  const carte = {
    id: CARTE, projectId: PROJET, title: 'Carte sous la bande', description: 'Essai.', labels: [], column: 'planned', position: 1, origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' }, excludedFromDeploy: false, horsTache: false,
    scheduling: { asap: false, attempts: 0, restarts: 0 }, createdAt: T, updatedAt: T,
  };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(CARTE, PROJET, 'planned', 1, carte.title, JSON.stringify(carte), T, T);
  db.close();
}
const PROJET = 'p-essai-bande';
const CARTE = 'c-essai-bande';

/* La bande reste-t-elle au-dessus de tout ? Pleine largeur en haut, rien ne la recouvre (milieu ET droite, là où la
   page d'une carte passait par-dessus), et toute page fixe ouverte part sous elle. */
async function bandeAuDessus(page, selecteurPage) {
  return page.evaluate((sel) => {
    const el = document.querySelector('[data-banniere-extension]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const libre = [r.width / 2, r.width - 260, 30].every((x) => {
      const c = document.elementFromPoint(x, y);
      return !!c && el.contains(c);
    });
    const pages = sel ? [...document.querySelectorAll(sel)].filter((p) => p.getBoundingClientRect().height > 0 && !p.closest('[inert]')) : [];
    const hauts = pages.map((p) => Math.round(p.getBoundingClientRect().top));
    const bouton = el.querySelector('[data-banniere-extension-bouton]');
    return { haut: r.top, largeur: r.width, bas: r.bottom, libre, pages: pages.length, hauts, couleurBouton: bouton ? getComputedStyle(bouton).color : '' };
  }, selecteurPage);
}

/* Le bouton de l'assistant à l'écran, et les bornes de la zone du contenu (barre d'en-tête, menu du bas). */
async function boutonDeLAssistant(page) {
  return page.evaluate(() => {
    const j = document.querySelector('[data-jarvis-natif]');
    const b = document.querySelector('[data-bouton-du-bord]')?.getBoundingClientRect();
    const barres = [...document.querySelectorAll('[data-entete-de-zone]')]
      .map((x) => x.getBoundingClientRect())
      .filter((x) => x.height > 0 && x.width > 0 && x.top < innerHeight / 3);
    const banniere = document.querySelector('[data-banniere-extension]')?.getBoundingClientRect();
    const menu = document.querySelector('nav[data-menu-bas]')?.getBoundingClientRect();
    return {
      bord: j?.getAttribute('data-bord') ?? null,
      haut: b ? Math.round(b.top) : null,
      bas: b ? Math.round(b.bottom) : null,
      basEntete: Math.round(Math.max(0, banniere?.bottom ?? 0, ...barres.map((x) => x.bottom))),
      hautMenu: menu && menu.height > 0 ? Math.round(menu.top) : innerHeight,
    };
  });
}
async function glisserLeBouton(page, x, y) {
  const d = await page.locator('[data-bouton-du-bord]').boundingBox();
  const cx = d.x + d.width / 2;
  const cy = d.y + d.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(cx + ((x - cx) * i) / 12, cy + ((y - cy) * i) / 12);
  await page.mouse.up();
  await page.waitForTimeout(900);
}
function poserLaPreference(cle, valeur) {
  const db = base();
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(cle, JSON.stringify(valeur), Date.now());
  db.close();
}

/* Le haut de l'écran : la bande orange (bord, début du texte, texte coupé ?), la barre du haut et la bande sous l'heure. */
async function mesurerLeHaut(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-banniere-extension]');
    const p = el?.querySelector('p');
    const r = el?.getBoundingClientRect();
    const rp = p?.getBoundingClientRect();
    const entete = [...document.querySelectorAll('[data-entete-de-zone]')].find((x) => x.getBoundingClientRect().height > 0);
    const re = entete?.getBoundingClientRect();
    const bande = document.querySelector('[data-bande-sous-l-heure]');
    const fondBande = bande ? getComputedStyle(bande).backgroundColor : '';
    const fondBanniere = el ? getComputedStyle(el).backgroundColor : '';
    let texteVisible = false;
    if (rp) {
      const cible = document.elementFromPoint(rp.left + Math.min(40, rp.width / 2), rp.top + Math.min(8, rp.height / 2));
      /* La bande sous l'heure ignore le pointeur : `elementFromPoint` la traverse. On compare donc aussi son bas au haut du texte. */
      const basDeLaBande = bande ? bande.getBoundingClientRect().bottom : 0;
      texteVisible = !!cible && el.contains(cible) && basDeLaBande <= rp.top + 1;
    }
    return {
      banniere: r ? { haut: r.top, bas: r.bottom, texte: rp?.top ?? null, coupe: p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1 } : null,
      barre: re ? { haut: re.top, hauteur: re.height, marge: parseFloat(getComputedStyle(entete).paddingTop) || 0 } : null,
      texteVisible,
      fondBande,
      bandeOrange: !el || !bande || bande.getBoundingClientRect().height === 0 || fondBande === fondBanniere,
      deborde: document.documentElement.scrollWidth - innerWidth,
      debordeHaut: document.documentElement.scrollHeight - innerHeight,
    };
  });
}

async function ouvrirPage(navigateur, telephone, zoneSure = 0) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    permissions: ['microphone'],
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  page.setDefaultTimeout(20_000);
  if (zoneSure) await poserZonesSures(page, { haut: zoneSure, bas: 34 });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bouton-du-bord]', { timeout: 60_000 });
  await page.waitForTimeout(3200);
  /* Le décor de l'iPhone se repose une fois l'application montée : la page réécrit le style de sa racine au démarrage. */
  if (zoneSure) {
    await poserZonesSures(page, { haut: zoneSure, bas: 34 });
    await page.waitForTimeout(300);
  }
  for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"]').count()); essai += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  return { contexte, page, erreurs };
}
async function capturer(page, nom) {
  if (!CAPTURES) return;
  await page.mouse.move(700, 300);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

let navigateur;
try {
  await attendrePort();
  poserLeDecor();
  for (let i = 0; i < 90; i += 1) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {
      /* vite démarre */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  navigateur = await chromium.launch({ channel: 'chrome' });

  for (const clarte of ['clair', 'sombre']) {
    poserLaPreference('theme', clarte);
    /* ---- 1. La bannière, ordinateur ---- */
    console.log(`\n— Bannière, ordinateur, ${clarte}`);
    const o = await ouvrirPage(navigateur, false);
    await o.page.waitForSelector('[data-banniere-extension]', { timeout: 20_000 }).catch(() => null);
    const b = await o.page.evaluate(() => {
      const el = document.querySelector('[data-banniere-extension]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const colonne = document.querySelector('[data-colonne-projets]')?.getBoundingClientRect();
      const fond = getComputedStyle(el).backgroundColor;
      return {
        raison: el.getAttribute('data-banniere-extension'),
        texte: el.textContent ?? '',
        haut: r.top,
        largeur: r.width,
        bas: r.bottom,
        colonneHaut: colonne?.top ?? null,
        fond,
        icone: !!el.querySelector('svg'),
        bouton: el.querySelector('[data-banniere-extension-bouton]')?.textContent ?? '',
        bordureBouton: getComputedStyle(el.querySelector('[data-banniere-extension-bouton]')).borderTopWidth,
      };
    });
    verifier('la bannière paraît pour une extension trop ancienne', b?.raison === 'version', b?.raison ?? 'absente');
    verifier('elle nomme l’ordinateur, la version et celle qu’il faut', !!b && /MacMini|Mac/.test(b.texte) && /1\.0\.(8|5)/.test(b.texte) && /1\.0\.11/.test(b.texte), b?.texte);
    verifier('elle compte l’autre Chrome en retard', !!b && /\(et 1 autre\)/.test(b.texte));
    verifier('pleine largeur, tout en haut', !!b && b.haut === 0 && b.largeur === 1440, b ? `haut ${b.haut}, largeur ${b.largeur}` : '');
    verifier('au-dessus de la colonne de gauche', !!b && b.colonneHaut !== null && b.colonneHaut >= b.bas - 0.5, b ? `colonne à ${b.colonneHaut}, bannière jusqu’à ${b.bas}` : '');
    verifier('orange, avec l’icône d’attention', !!b && /rgb\((2[0-9]{2}), (1[0-9]{2}|[5-9][0-9]), ([0-9]{1,2})\)/.test(b.fond) && b.icone, b?.fond);
    verifier('« Mettre à jour » à droite, sans bordure', !!b && b.bouton.includes('Mettre à jour') && b.bordureBouton === '0px', b?.bouton);
    await capturer(o.page, `banniere-1440-${clarte}`);
    /* ---- 7. Au-dessus de tout : le tableau, la page d'une carte, une page de service ---- */
    const surLeTableau = await bandeAuDessus(o.page, null);
    verifier('bouton noir à texte blanc', surLeTableau?.couleurBouton === 'rgb(255, 255, 255)', surLeTableau?.couleurBouton);
    verifier('tableau : rien ne recouvre la bande', !!surLeTableau && surLeTableau.libre, JSON.stringify(surLeTableau));
    verifier('ordinateur : pas de chevron de dépliage', (await o.page.locator('[data-bande-du-haut-deplier]').count()) === 0);
    await o.page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE}`, { waitUntil: 'domcontentloaded' });
    await o.page.waitForSelector('[data-page-de-zone]', { timeout: 20_000 }).catch(() => null);
    await o.page.waitForTimeout(1500);
    const surLaCarte = await bandeAuDessus(o.page, '[data-page-de-zone]');
    verifier(
      'carte ouverte : la bande reste pleine largeur, au-dessus de la page',
      !!surLaCarte && surLaCarte.haut === 0 && surLaCarte.largeur === 1440 && surLaCarte.libre && surLaCarte.pages > 0 && surLaCarte.hauts.every((h) => h >= surLaCarte.bas - 0.5),
      JSON.stringify(surLaCarte),
    );
    await capturer(o.page, `banniere-carte-ouverte-1440-${clarte}`);
    let service = null;
    for (const vue of ['statistiques', 'communication2', 'surveillance', 'backups', 'messagerie']) {
      await o.page.goto(`${BASE}/#${vue}`, { waitUntil: 'domcontentloaded' });
      if (await o.page.waitForSelector('[data-page-de-service]', { timeout: 6000 }).then(() => true).catch(() => false)) {
        service = vue;
        break;
      }
    }
    await o.page.waitForTimeout(1200);
    const surLeService = await bandeAuDessus(o.page, '[data-page-de-service]');
    verifier(
      `page de service (${service}) : la bande reste pleine largeur, au-dessus de la page`,
      !!service && !!surLeService && surLeService.haut === 0 && surLeService.largeur === 1440 && surLeService.libre && surLeService.pages > 0 && surLeService.hauts.every((h) => h >= surLeService.bas - 0.5),
      JSON.stringify(surLeService),
    );
    await capturer(o.page, `banniere-service-1440-${clarte}`);
    await o.page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await o.page.waitForSelector('[data-banniere-extension]', { timeout: 20_000 }).catch(() => null);
    await o.page.waitForTimeout(1500);
    /* ---- 2. Sans programme du Mac : Réglages › Extension ---- */
    if (clarte === 'clair') {
      await o.page.locator('[data-banniere-extension-bouton]').click();
      const reglages = await o.page.waitForSelector('[role="dialog"]', { timeout: 8000 }).then(() => true).catch(() => false);
      verifier('sans programme du Mac, le bouton ouvre les réglages de l’extension', reglages);
      await o.page.keyboard.press('Escape');
    }
    verifier('aucune erreur de page', o.erreurs.length === 0, o.erreurs.join(' | '));
    await o.contexte.close();

    /* ---- téléphone ---- */
    console.log(`\n— Bannière, téléphone, ${clarte}`);
    const t = await ouvrirPage(navigateur, true);
    await t.page.waitForSelector('[data-banniere-extension]', { timeout: 20_000 }).catch(() => null);
    const bt = await t.page.evaluate(() => {
      const el = document.querySelector('[data-banniere-extension]');
      const r = el?.getBoundingClientRect();
      const p = el?.querySelector('p');
      const bouton = el?.querySelector('[data-banniere-extension-bouton]')?.getBoundingClientRect();
      return {
        existe: !!el,
        haut: r?.top ?? null,
        hauteur: r?.height ?? 0,
        ligne: p ? p.getBoundingClientRect().height : 0,
        coupe: !!p && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1),
        boutonDansLEcran: !!bouton && bouton.right <= innerWidth,
        deborde: document.documentElement.scrollWidth - innerWidth,
      };
    });
    /* Depuis la carte « Bande orange de l'extension, retouches » : repliée sur UNE ligne, un chevron la déplie. */
    verifier('téléphone : la bannière est en haut, repliée sur une ligne', bt.existe && bt.haut === 0 && bt.ligne <= 24 && bt.hauteur <= 50, JSON.stringify(bt));
    verifier('téléphone : le bouton reste dans l’écran, rien ne déborde en largeur', bt.boutonDansLEcran && bt.deborde === 0, JSON.stringify(bt));
    const chevron = t.page.locator('[data-bande-du-haut-deplier]');
    verifier('téléphone : un chevron replié', (await chevron.count()) === 1 && (await chevron.getAttribute('aria-expanded')) === 'false');
    await capturer(t.page, `banniere-390-${clarte}`);
    await chevron.click();
    await t.page.waitForTimeout(300);
    const deplie = await t.page.evaluate(() => {
      const el = document.querySelector('[data-banniere-extension]');
      const p = el?.querySelector('p');
      return { hauteur: el?.getBoundingClientRect().height ?? 0, coupe: !!p && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1), texte: p?.textContent ?? '' };
    });
    verifier('téléphone : déplié, le message se lit en entier', deplie.hauteur > bt.hauteur && !deplie.coupe && /\(et 1 autre\)/.test(deplie.texte), JSON.stringify(deplie));
    await capturer(t.page, `banniere-390-deplie-${clarte}`);
    await chevron.click();
    await t.page.waitForTimeout(300);
    const replie = await t.page.evaluate(() => document.querySelector('[data-banniere-extension]')?.getBoundingClientRect().height ?? 0);
    verifier('téléphone : un second appui la replie', Math.abs(replie - bt.hauteur) <= 1, `${replie} / ${bt.hauteur}`);
    /* iPhone SE : le chevron ne pousse pas le bouton hors de l'écran. */
    await t.page.setViewportSize({ width: 320, height: 640 });
    await t.page.waitForTimeout(400);
    const se = await t.page.evaluate(() => {
      const b = document.querySelector('[data-banniere-extension-bouton]')?.getBoundingClientRect();
      return { droite: b?.right ?? 999, deborde: document.documentElement.scrollWidth - innerWidth };
    });
    verifier('iPhone SE (320 px) : le bouton reste dans l’écran', se.droite <= 320 && se.deborde === 0, JSON.stringify(se));
    await t.contexte.close();

    /* ---- téléphone avec l'heure au-dessus (iPhone, zone sûre de 59 px) — carte « Bande orange cachée sur téléphone » ---- */
    console.log(`\n— Bannière, iPhone (zone sûre 59 px), ${clarte}`);
    const z = await ouvrirPage(navigateur, true, 59);
    await z.page.waitForSelector('[data-banniere-extension]', { timeout: 20_000 }).catch(() => null);
    const bz = await mesurerLeHaut(z.page);
    verifier('iPhone : la bande orange part du bord du haut', bz.banniere?.haut === 0, JSON.stringify(bz));
    verifier('iPhone : son texte commence sous l’heure', bz.banniere && bz.banniere.texte >= 59, `${bz.banniere?.texte} px`);
    verifier('iPhone : la barre du haut suit la bande, avec 8 px d’air et non l’heure', bz.barre && bz.banniere && Math.abs(bz.barre.haut - bz.banniere.bas) <= 1 && Math.abs(bz.barre.marge - 8) <= 1, JSON.stringify({ barre: bz.barre, bas: bz.banniere?.bas }));
    const air = await z.page.evaluate(() => {
      const bas = document.querySelector('[data-banniere-extension]')?.getBoundingClientRect().bottom ?? 0;
      const entete = [...document.querySelectorAll('[data-entete-de-zone]')].find((x) => x.getBoundingClientRect().height > 0);
      const boutons = entete ? [...entete.querySelectorAll('button')].map((b) => b.getBoundingClientRect()).filter((r) => r.height > 0 && r.width > 0) : [];
      return { bas, hautDesBoutons: boutons.length ? Math.min(...boutons.map((r) => r.top)) : null };
    });
    verifier('iPhone : au moins 6 px entre la bande et les boutons du haut', air.hautDesBoutons !== null && air.hautDesBoutons - air.bas >= 6, JSON.stringify(air));
    await z.page.locator('[data-bande-du-haut-deplier]').click();
    await z.page.waitForTimeout(300);
    const bzd = await mesurerLeHaut(z.page);
    verifier('iPhone : déplié, son texte se lit en entier (aucun texte coupé)', bzd.banniere && !bzd.banniere.coupe, JSON.stringify(bzd.banniere));
    await capturer(z.page, `banniere-iphone-390-deplie-${clarte}`);
    await z.page.locator('[data-bande-du-haut-deplier]').click();
    await z.page.waitForTimeout(300);
    verifier('iPhone : rien d’opaque ne recouvre le texte de la bande', bz.texteVisible, '');
    verifier('iPhone : la bande sous l’heure prend l’orange de la bannière', bz.bandeOrange, bz.fondBande);
    verifier('iPhone : rien ne déborde en largeur ni en hauteur', bz.deborde === 0 && bz.debordeHaut <= 0, JSON.stringify({ l: bz.deborde, h: bz.debordeHaut }));
    await capturer(z.page, `banniere-iphone-390-${clarte}`);
    /* Le bouton de l'assistant : côtés seulement, dans la zone du contenu (décision du 20/11/2026). */
    if (clarte === 'clair') {
      for (const [nom, x, y] of [
        ['haut-milieu', 195, 30],
        ['bas-milieu', 195, 830],
        ['centre', 195, 422],
        ['haut à droite', 370, 10],
      ]) {
        await glisserLeBouton(z.page, x, y);
        const a = await boutonDeLAssistant(z.page);
        verifier(
          `iPhone : glissé vers ${nom}, le bouton de l’assistant finit sur un côté, entre l’en-tête et le menu du bas`,
          (a.bord === 'gauche' || a.bord === 'droite') && a.haut >= a.basEntete && a.bas <= a.hautMenu,
          JSON.stringify(a),
        );
      }
      await capturer(z.page, 'assistant-cote-iphone-390-clair');
    }
    /* La bande s'en va en direct : la barre reprend sa place sous l'heure (59 px, 56 px de haut). */
    await z.page.evaluate(() => document.querySelector('[data-banniere-extension]')?.remove());
    await z.page.waitForTimeout(300);
    const sans = await mesurerLeHaut(z.page);
    verifier('iPhone sans bande : la barre recommence sous l’heure, sans marge doublée', sans.barre && Math.abs(sans.barre.haut + sans.barre.marge - 59) <= 1 && sans.barre.haut === 0, JSON.stringify(sans.barre));
    if (clarte === 'clair') {
      await glisserLeBouton(z.page, 195, 20);
      const a = await boutonDeLAssistant(z.page);
      verifier('iPhone sans bande : le bouton de l’assistant reste sous l’en-tête, sur un côté', (a.bord === 'gauche' || a.bord === 'droite') && a.haut >= a.basEntete && a.bas <= a.hautMenu, JSON.stringify(a));
    }
    await z.contexte.close();
  }

  /* ---- 7 bis. Une place retenue EN HAUT sur téléphone revient sur un côté ---- */
  console.log('\n— Bouton de l’assistant, place ancienne en haut (téléphone)');
  {
    poserLaPreference('jarvis-bord-telephone', { bord: 'haut', fraction: 0.8 });
    const o = await ouvrirPage(navigateur, true, 59);
    await o.page.waitForSelector('[data-banniere-extension]', { timeout: 20_000 }).catch(() => null);
    await o.page.waitForTimeout(1500);
    const a = await boutonDeLAssistant(o.page);
    verifier('téléphone : une place ancienne en haut revient sur le côté le plus proche, sous l’en-tête', a.bord === 'droite' && a.haut >= a.basEntete, JSON.stringify(a));
    /* Une carte ouverte sur iPhone : la page part sous la bande, sans recompter l'heure (aucun trou sous la bande). */
    await o.page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE}`, { waitUntil: 'domcontentloaded' });
    await o.page.waitForSelector('[data-page-de-zone]', { timeout: 20_000 }).catch(() => null);
    await o.page.waitForTimeout(2500);
    await poserZonesSures(o.page, { haut: 59, bas: 34 });
    await o.page.waitForTimeout(400);
    const c = await o.page.evaluate(() => {
      const el = document.querySelector('[data-banniere-extension]');
      const r = el?.getBoundingClientRect();
      const pages = [...document.querySelectorAll('[data-page-de-zone]')].filter((p) => p.getBoundingClientRect().height > 0 && !p.closest('[inert]'));
      const hauts = pages.map((p) => Math.round(p.getBoundingClientRect().top));
      /* La barre du haut affichée, la plus haute : celle du projet (la page s'ouvre sous elle) ou celle de la page. */
      const barres = [...document.querySelectorAll('[data-entete-de-zone]')].filter((x) => x.getBoundingClientRect().height > 0 && !x.closest('[inert]'));
      const barre = barres.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      const boutons = barre ? [...barre.querySelectorAll('button')].map((b) => b.getBoundingClientRect()).filter((x) => x.height > 0 && x.width > 0) : [];
      const libre = !!r && !!el.contains(document.elementFromPoint(r.width / 2, r.bottom - 6));
      return {
        bas: r?.bottom ?? null,
        hauts,
        hautDeLaBarre: barre ? Math.round(barre.getBoundingClientRect().top) : null,
        premierBouton: boutons.length ? Math.round(Math.min(...boutons.map((x) => x.top))) : null,
        libre,
      };
    });
    verifier(
      'iPhone, carte ouverte : la page part sous la bande, sans trou de la hauteur de l’heure',
      c.bas !== null && c.libre && c.hauts.length > 0 && c.hauts.every((h) => h >= c.bas - 0.5) && Math.abs(c.hautDeLaBarre - c.bas) <= 1 && c.premierBouton - c.bas >= 6 && c.premierBouton - c.bas <= 20,
      JSON.stringify(c),
    );
    await capturer(o.page, 'banniere-iphone-carte-ouverte-390-sombre');
    await o.contexte.close();
    poserLaPreference('jarvis-bord-telephone', null);
  }

  /* ---- 3. À jour : la bannière s'en va ---- */
  console.log('\n— Extensions à jour');
  {
    const db = base();
    db.prepare("UPDATE chrome_appareils SET version = '1.0.11', incognito = 1").run();
    db.close();
    const o = await ouvrirPage(navigateur, false);
    await o.page.waitForTimeout(2500);
    verifier('plus aucune bannière quand tout est à jour', (await o.page.locator('[data-banniere-extension]').count()) === 0);
    const db2 = base();
    db2.prepare("UPDATE chrome_appareils SET incognito = 0 WHERE id = 'c-mini'").run();
    db2.close();
    await o.page.reload();
    await o.page.waitForSelector('[data-banniere-extension]', { timeout: 20_000 }).catch(() => null);
    const raison = await o.page.locator('[data-banniere-extension]').getAttribute('data-banniere-extension').catch(() => null);
    const bouton = await o.page.locator('[data-banniere-extension-bouton]').textContent().catch(() => '');
    verifier('à jour mais sans navigation privée : la bannière dit « Autoriser »', raison === 'navigation-privee' && /Autoriser/.test(bouton ?? ''), `${raison} / ${bouton}`);
    await capturer(o.page, 'banniere-navigation-privee-1440-sombre');
    const db3 = base();
    db3.prepare('UPDATE chrome_appareils SET incognito = 1').run();
    db3.close();
    await o.contexte.close();
  }

  /* ---- 4 et 5. Jarvis tout en voix ---- */
  for (const [telephone, clarte] of [
    [false, 'clair'],
    [false, 'sombre'],
    [true, 'clair'],
    [true, 'sombre'],
  ]) {
    poserLaPreference('theme', clarte);
    const largeur = telephone ? 390 : 1440;
    console.log(`\n— Jarvis, ${largeur}, ${clarte}`);
    const o = await ouvrirPage(navigateur, telephone);
    /* 5. Le travail pendant la veille : un rond de chargement sur le bouton du coin. */
    await o.page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:voix-directe', { detail: { type: 'voix.direct', etat: 'veille-au-travail', agentId: 'x' } })));
    await o.page.waitForTimeout(300);
    verifier('Jarvis au travail en veille : rond de chargement sur le bouton du coin', (await o.page.locator('[data-bouton-du-bord] [data-jarvis-travaille]').count()) === 1);
    if (!telephone && clarte === 'clair') await capturer(o.page, 'bouton-du-coin-travaille-1440-clair');
    await o.page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:voix-directe', { detail: { type: 'voix.direct', etat: 'arrete' } })));
    await o.page.waitForTimeout(300);
    verifier('travail fini : les trois barres reviennent', (await o.page.locator('[data-bouton-du-bord] [data-jarvis-travaille]').count()) === 0);

    /* 4. La bulle vocale, sa confirmation, et aucun volet. */
    await o.page.locator('[data-bouton-du-bord]').click();
    await o.page.waitForSelector('[data-bulle-vocale]', { timeout: 10_000 }).catch(() => null);
    const tours = [
      { role: 'user', texte: 'Crée une tâche pour la bannière de l’extension.' },
      { role: 'assistant', texte: 'Je crée la tâche « Bannière de l’extension » dans Beluga ?' },
      { role: 'assistant', texte: '', question: { id: 'q-essai', question: 'Je crée la tâche « Bannière de l’extension » dans Beluga ?', choix: ['Oui, vas-y', 'Non'] } },
    ];
    let vue = false;
    for (let i = 0; i < 15 && !vue; i += 1) {
      await o.page.evaluate((b) => window.belugaEssai?.bullesDuDirect?.(null, b), tours);
      await o.page.waitForTimeout(400);
      vue = (await o.page.locator('[data-bulle-vocale] [data-bulle="question"]').count()) > 0;
    }
    verifier('la confirmation paraît en bulle au-dessus du mode vocal', vue);
    verifier('avec ses deux choix à toucher', (await o.page.locator('[data-bulle-vocale] [data-choix-du-direct]').count()) === 2);
    verifier('plus de bouton vers le volet dans la bulle vocale', (await o.page.locator(['jarvis-deplier'].map((n) => `[data-${n}]`).join('')).count()) === 0);
    verifier('aucun volet de l’assistant pendant la voix', (await o.page.locator('[data-volet-de-jarvis]').count()) === 0);
    const deborde = await o.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    verifier('rien ne déborde en largeur', deborde === 0, `${deborde} px`);
    await capturer(o.page, `jarvis-confirmation-${largeur}-${clarte}`);
    verifier('aucune erreur de page', o.erreurs.length === 0, o.erreurs.join(' | '));
    await o.contexte.close();
  }
} catch (err) {
  console.error(err);
  resultats.push(false);
} finally {
  await navigateur?.close().catch(() => {});
  couperVite();
  nettoyer();
}
const ok = resultats.filter(Boolean).length;
console.log(`\n${ok}/${resultats.length} contrôles réussis`);
process.exit(ok === resultats.length && resultats.length > 0 ? 0 : 1);
