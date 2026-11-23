#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur de téléphone (390×844, tactile), de la NAVIGATION DU TÉLÉPHONE, écran par
 * écran (décision de l'utilisateur du 03/11/2026, carte « Refonte de la navigation mobile », `shared/src/menu-du-bas.ts`) :
 *
 *  - LE HAUT : un seul rang ; le nom (service, projet, marque, création) est CENTRÉ sur l'axe de l'écran, quel que
 *    soit le nombre de boutons de chaque côté, porte un chevron, et ouvre LE MENU PRINCIPAL (13/11/2026 : plus de ☰
 *    ni de grille des services) ; la flèche retour tient le coin gauche dès qu'on est descendu d'un niveau — sauf dans
 *    un projet, où « Tâches » la remplace sur tous ses écrans (13/11/2026) ;
 *  - LE BAS : aucun (un projet, Backup, Surveillance, Coffre-fort, Messagerie, Marketing), un bouton pleine largeur (Mémoire,
 *    Communication, Studio) ou des boutons répartis (projet, marque, création, Marketing dans un projet) ;
 *  - LES SOUS-PAGES S'OUVRENT EN FEUILLE DU BAS (`[data-feuille-du-bas]`) : le directeur, le chevron d'une
 *    marque, les médias d'une création, la vue d'ensemble de la Mémoire ;
 *  - SUR ORDINATEUR, aucun bas, et le haut garde son fil d'Ariane.
 *
 * Vise le serveur de développement (`HAIKO_MENU_URL`, défaut http://localhost:7099), jamais `BELUGA_URL`. Le contrôle
 * ne déplace pas l'écran de l'utilisateur : les écritures de préférences et de lecture sont retenues.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const BASE = process.env.HAIKO_MENU_URL || 'http://localhost:7099';

function ouvrirBase() {
  return new Database(cheminDeLaBaseServie());
}

function poserSession() {
  const db = ouvrirBase();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification de la navigation du téléphone',
  );
  const lire = (sql) => {
    try {
      return db.prepare(sql).get() ?? null;
    } catch {
      return null;
    }
  };
  const ids = {
    projet: lire('SELECT id FROM projects WHERE archived = 0 ORDER BY rowid LIMIT 1')?.id ?? lire('SELECT id FROM projects ORDER BY rowid LIMIT 1')?.id,
    marque: lire('SELECT id FROM communication_marques ORDER BY rowid LIMIT 1')?.id,
    creation: lire('SELECT id FROM studio_creations ORDER BY rowid DESC LIMIT 1')?.id,
    /* Une tâche AVEC un plan (le volet passe dans les trois points), et sa voisine sans. */
    /* Dans un projet OUVERT (un projet archivé n'a pas de rangée d'onglets). */
    carteAvecPlan: lire(`SELECT c.id, c.project_id AS projet FROM cards c JOIN projects p ON p.id = c.project_id WHERE p.archived = 0 AND c.archived_at IS NULL AND c.data LIKE '%"plans":[{%' ORDER BY c.updated_at DESC LIMIT 1`),
    carte: lire(`SELECT c.id, c.project_id AS projet FROM cards c JOIN projects p ON p.id = c.project_id WHERE p.archived = 0 AND c.archived_at IS NULL AND c.data NOT LIKE '%"plans":[{%' ORDER BY c.updated_at DESC LIMIT 1`),
  };
  db.close();
  return { cookie, ids };
}

function retirerSession(cookie) {
  const db = ouvrirBase();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(crypto.createHash('sha256').update(cookie).digest('hex'));
  db.close();
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

async function contexte(browser, cookie, telephone) {
  const ctx = await browser.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: telephone,
    isMobile: telephone,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await ctx.addCookies([{ name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const serveur = ws.connectToServer();
    ws.onMessage((message) => {
      try {
        const lu = JSON.parse(String(message));
        if (['prefs.set', 'card.read', 'project.read'].includes(lu?.cmd?.type ?? lu?.type)) return;
      } catch {
        /* un message qui n'est pas du JSON passe tel quel */
      }
      serveur.send(message);
    });
  });
  page.setDefaultTimeout(8000);
  return { ctx, page };
}

const etat = (page) =>
  page.evaluate(() => {
    const titre = document.querySelector('[data-haut-titre]');
    const r = titre?.getBoundingClientRect();
    const nav = document.querySelector('nav[data-menu-bas]');
    /* Le nom ne passe sous aucun bouton : son centre est bien le bouton du nom. */
    const dessus = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return {
      titre: titre?.textContent?.trim() ?? null,
      centre: r ? r.left + r.width / 2 : null,
      liste: titre?.getAttribute('data-haut-liste') ?? null,
      chevron: !!titre?.querySelector('[data-chevron-du-haut]'),
      libre: !!(titre && dessus && titre.contains(dessus)),
      forme: nav ? nav.getAttribute('data-menu-bas') : 'aucun',
      ecran: nav?.getAttribute('data-ecran-du-bas') ?? null,
      boutons: nav ? [...nav.querySelectorAll('[data-bouton-du-bas]')].map((b) => b.getAttribute('data-bouton-du-bas')) : [],
      retour: !!document.querySelector('[data-entete-de-zone] [data-retour-du-fil]'),
      /* DANS UN PROJET (13/11/2026) : « Tâches » tient le coin gauche à la place de la flèche, sur tous ses écrans. */
      taches: !!document.querySelector('[data-entete-de-zone] [data-taches-du-haut]'),
      dansUnProjet: !!document.querySelector('[data-haut-du-telephone]'),
      feuilles: document.querySelectorAll('[data-feuille-du-bas]').length,
      bordure: nav ? parseFloat(getComputedStyle(nav).borderTopWidth) || 0 : 0,
      /* AU PLUS UN BOUTON À GAUCHE, DEUX À DROITE (03/11/2026) : les boutons VISIBLES de chaque côté du haut. */
      gauche: [...document.querySelectorAll('[data-entete-de-zone] [data-cote-du-haut="gauche"] button')].filter((b) => b.getBoundingClientRect().width > 0).length,
      droite: [...document.querySelectorAll('[data-entete-de-zone] [data-cote-du-haut="droite"] button')].filter((b) => b.getBoundingClientRect().width > 0).length,
      troisPoints: !!document.querySelector('[data-entete-de-zone] [data-trois-points-du-haut]'),
      hamburger: [...document.querySelectorAll('button[aria-label="Projets"]')].some((b) => b.getBoundingClientRect().width > 0),
    };
  });

async function aller(page, fragment) {
  await page.goto(`${BASE}/#${fragment}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2600);
}

function verifierLeHaut(nom, e, { liste, retour = false }) {
  record(`${nom} : nom centré sur l'écran`, e.centre !== null && Math.abs(e.centre - 195) <= 2, `centre ${e.centre?.toFixed(1)}`);
  record(`${nom} : chevron visible, nom libre de tout bouton`, e.chevron && e.libre);
  record(`${nom} : le nom ouvre « ${liste} »`, e.liste === liste, String(e.liste));
  if (e.dansUnProjet)
    record(`${nom} : dans un projet, « Tâches » à gauche (jamais de flèche), et plus aucun ☰`, e.taches && !e.retour && !e.hamburger);
  else record(`${nom} : ${retour ? 'flèche retour à gauche' : 'aucune flèche de retour'}, et plus aucun ☰`, e.retour === retour && !e.hamburger);
  record(`${nom} : un bouton à gauche, deux au plus à droite, les trois points en bout`, e.gauche <= 1 && e.droite <= 2 && e.troisPoints, `${e.gauche} | ${e.droite}`);
}

async function main() {
  const { cookie, ids } = poserSession();
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
  try {
    const { ctx, page } = await contexte(browser, cookie, true);

    /* 1. Les écrans de chaque service : haut, et forme du bas. */
    const SERVICES = [
      /* UN PROJET : plus rien en bas, « Publier » est un petit bouton du haut (13/11/2026). */
      { f: `projet/${ids.projet}`, liste: 'menu', forme: 'aucun' },
      { f: 'backups', liste: 'menu', forme: 'aucun' },
      { f: 'surveillance', liste: 'menu', forme: 'aucun' },
      { f: 'coffre', liste: 'menu', forme: 'aucun' },
      { f: 'espace', liste: 'menu', forme: 'aucun' },
      { f: 'strategie', liste: 'menu', forme: 'aucun' },
    ];
    for (const s of SERVICES) {
      await aller(page, s.f);
      const e = await etat(page);
      verifierLeHaut(s.f.split('/')[0], e, { liste: s.liste });
      record(`${s.f.split('/')[0]} : bas « ${s.forme} »`, e.forme === s.forme, `${e.forme}${e.boutons.length ? ' · ' + e.boutons.join(',') : ''}`);
      if (s.boutons) record(`${s.f.split('/')[0]} : boutons du bas`, JSON.stringify(e.boutons) === JSON.stringify(s.boutons), e.boutons.join(','));
      if (e.forme !== 'aucun') record(`${s.f.split('/')[0]} : aucun trait au-dessus du bas`, e.bordure === 0);
    }

    /* 2. La Mémoire : la recherche à la place du nom, « Vue d'ensemble » en bas, qui ouvre une feuille. */
    await aller(page, 'memoire');
    const memoire = await page.evaluate(() => !!document.querySelector('[data-entete-de-zone] [data-haut-contenu] [data-graphe-recherche]'));
    record('memoire : la recherche est dans le haut', memoire);
    record('memoire : plus de bouton « Liste » au téléphone', (await page.locator('[data-memoire-vers-liste]').count()) === 0);
    await page.locator('[data-bouton-pleine-largeur="vue-d-ensemble"]').tap();
    await page.waitForTimeout(800);
    record('memoire : « Vue d’ensemble » ouvre les projets en feuille', (await etat(page)).feuilles >= 1 && (await page.locator('[data-memoire-feuille-des-projets]').count()) === 1);

    /* 3. LE NOM CENTRÉ OUVRE LE MENU PRINCIPAL (13/11/2026) : la colonne des projets, en feuille ; plus de grille. */
    await aller(page, 'backups');
    await page.locator('[data-haut-titre]').tap();
    await page.waitForTimeout(700);
    record('le nom du haut ouvre le menu principal', (await page.locator('[data-menu-du-telephone]').count()) >= 1);
    record('…et plus jamais la grille des services', (await page.locator('[data-feuille-des-services]').count()) === 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    /* 3 bis. L'ÉCRAN D'UNE TÂCHE (13/11/2026, carte « Haut d'un projet fixe sur téléphone ») : le HAUT COMMUN du
       projet — « Tâches » à gauche, le NOM DU PROJET centré qui ouvre le menu principal, les trois points de la tâche
       (la branche est leur première ligne) puis « Publier » à droite, la rangée d'onglets dessous (celui de la tâche
       actif) — et rien en bas ; le volet (plan, suivi) est une entrée des trois points. */
    for (const [nom, carte] of [['une tâche avec plan', ids.carteAvecPlan], ['une tâche sans plan', ids.carte]]) {
      if (!carte) {
        record(`${nom} : sautée`, true, 'aucune carte');
        continue;
      }
      await aller(page, `projet/${carte.projet}/tache/${carte.id}`);
      const barreSel = '[data-haut-du-telephone]';
      await page.locator(`[data-page-de-zone]:not([data-page-cachee]) [data-page-carte="${carte.id}"]`).first().waitFor({ timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      const t = await page.evaluate(({ sel }) => {
        const barre = document.querySelector(sel);
        const titre = barre?.querySelector('[data-haut-titre]');
        const r = titre?.getBoundingClientRect();
        const dessus = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
        const visibles = (cote) =>
          [...(barre?.querySelectorAll(`[data-cote-du-haut="${cote}"] button`) ?? [])].filter((b) => b.getBoundingClientRect().width > 0);
        const droite = visibles('droite');
        return {
          centre: r ? r.left + r.width / 2 : null,
          libre: !!(titre && dessus && titre.contains(dessus)),
          liste: titre?.getAttribute('data-haut-liste') ?? null,
          menu: titre?.hasAttribute('data-menu-principal') ?? false,
          retour: !!barre?.querySelector('[data-cote-du-haut="gauche"] [data-retour-carte], [data-cote-du-haut="gauche"] [data-retour-du-fil]'),
          taches: !!barre?.querySelector('[data-cote-du-haut="gauche"] [data-taches-du-haut]'),
          bas: [...document.querySelectorAll('nav[data-menu-bas]')].some((n) => n.getBoundingClientRect().height > 0),
          gauche: visibles('gauche').length,
          ordre: droite.map((b) => (b.hasAttribute('data-bouton-de-branche') ? 'branche' : b.hasAttribute('data-menu-de-carte') ? 'menu' : b.hasAttribute('data-publier-du-haut') ? 'publier' : '?')).join(','),
          /* PLUS DE RANGÉE D'ONGLETS SOUS LE HAUT (14/11/2026) : aucune ligne d'onglets ne doit reparaître. */
          sansOnglets: !barre?.querySelector('[role="tablist"][aria-label="Onglets du projet"]'),
          voletDansLaBarre: !!barre?.querySelector('button[data-ouvrir-le-volet]'),
          iconeDuCran: [...(barre?.querySelectorAll('[data-icone-du-cran]') ?? [])].some((e) => e.getBoundingClientRect().width > 0),
          deborde: document.documentElement.scrollWidth > window.innerWidth,
        };
      }, { sel: barreSel });
      record(`${nom} : nom centré, libre de tout bouton`, t.centre !== null && Math.abs(t.centre - 195) <= 2 && t.libre, `centre ${t.centre?.toFixed(1)}`);
      record(`${nom} : le nom ouvre le menu principal`, t.liste === 'menu' && t.menu);
      record(`${nom} : « Tâches » à gauche (pas de flèche), les trois points puis « Publier » à droite`, t.taches && !t.retour && t.gauche === 1 && t.ordre === 'menu,publier', `${t.gauche} | ${t.ordre}`);
      record(`${nom} : plus rien en bas`, !t.bas);
      record(`${nom} : plus de rangée d'onglets sous le haut`, t.sansOnglets);
      record(`${nom} : ni icône de projet dans le rang, ni bouton du volet`, !t.iconeDuCran && !t.voletDansLaBarre);
      record(`${nom} : rien ne déborde`, !t.deborde);
      await page.locator('[data-menu-de-tache-ici] [data-menu-de-carte]').tap();
      await page.waitForTimeout(600);
      const premiere = await page.evaluate(() => {
        const menu = [...document.querySelectorAll('[role="menu"]')].find((m) => m.getBoundingClientRect().height > 0);
        return menu?.querySelector('[role="menuitem"]')?.hasAttribute('data-voir-la-branche') ?? false;
      });
      record(`${nom} : la branche en première ligne des trois points`, premiere);
      const entree = await page.locator('[role="menuitem"][data-ouvrir-le-volet]').count();
      if (carte === ids.carteAvecPlan) {
        record(`${nom} : le plan s'ouvre depuis les trois points`, entree === 1);
        if (entree) {
          await page.locator('[role="menuitem"][data-ouvrir-le-volet]').tap();
          await page.waitForTimeout(1000);
          record(`${nom} : …en feuille du bas`, (await page.locator('[data-feuille-du-volet]').count()) >= 1);
        }
      } else record(`${nom} : aucune entrée de volet sans plan`, entree === 0);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }

    /* 5. Communication : une marque, son retour et son chevron. */
    if (ids.marque) {
      await aller(page, `communication/${ids.marque}`);
      const e = await etat(page);
      /* LE HAUT GARDE « COMMUNICATION » DANS UNE MARQUE (03/11/2026) : la marque se choisit dans le menu en tête de page. */
      verifierLeHaut('une marque', e, { liste: 'menu', retour: true });
      /* UNE MARQUE DE COMMUNICATION 2 (12/11/2026, `menuDuBas('communication2-marque')`) : ses quatre pages, sans rond au centre. */
      record('une marque : Campagnes, Connexion | Calendrier, Réponses', JSON.stringify(e.boutons) === JSON.stringify(['v2-campagnes', 'v2-connexion', 'v2-calendrier', 'v2-reponses']) && (await page.locator('[data-centre-du-bas]').count()) === 0, e.boutons.join(','));
    }

    /* 6. Une création du Studio : retour, nom à liste, quatre tiroirs en bas. */
    if (ids.creation) {
      await aller(page, `studio/${ids.creation}`);
      await page.waitForTimeout(1200);
      const e = await etat(page);
      verifierLeHaut('une création', e, { liste: 'menu', retour: true });
      /* Le rond violet du centre : la mise en production de la création (12/11/2026, `menuDuBas('studio-creation')`). */
      record('une création : Médias, Téléchargements | mise en production | Style, Archives', JSON.stringify(e.boutons) === JSON.stringify(['medias-studio', 'telechargements', 'mise-en-production', 'style', 'archives']), e.boutons.join(','));
      await page.locator('[data-bouton-du-bas="medias-studio"]').tap();
      await page.waitForTimeout(1000);
      record('les médias s’ouvrent en feuille', (await etat(page)).feuilles >= 1);
    }

    await ctx.close();

    /* 8. Sur ordinateur, rien ne change : aucun bas, le fil d'Ariane. */
    const ordinateur = await contexte(browser, cookie, false);
    await aller(ordinateur.page, `projet/${ids.projet}`);
    const surOrdinateur = await ordinateur.page.evaluate(() => ({
      bas: [...document.querySelectorAll('nav[data-menu-bas]')].some((n) => n.getBoundingClientRect().height > 0),
      fil: !!document.querySelector('[data-fil-d-ariane]'),
      nom: !!document.querySelector('[data-haut-titre]'),
    }));
    record('ordinateur : aucun bas, le fil d’Ariane, pas de nom centré', !surOrdinateur.bas && surOrdinateur.fil && !surOrdinateur.nom, JSON.stringify(surOrdinateur));
    await ordinateur.ctx.close();
  } finally {
    await browser.close();
    retirerSession(cookie);
  }
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
