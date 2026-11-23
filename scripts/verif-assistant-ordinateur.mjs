#!/usr/bin/env node
/**
 * « AJOUTER CET ORDINATEUR » ET LA BANDE DE L'EXTENSION, DANS UN VRAI NAVIGATEUR (carte « Beluga Connect :
 * installation simplifiée », 21/11/2026 ; refait par la carte « Liaison d'ordinateur simplifiée », 22/11/2026 : ligne
 * « Ajouter cet ordinateur » + « Lier », étapes empilées dans le même onglet, page d'un ordinateur avec sommaire).
 *
 * L'interface de la copie (serveur de développement) parle au démon, mais les lectures de l'extension sont
 * INTERCEPTÉES sur le canal : chaque écran reçoit un état fabriqué. Rien ne part en base : les gestes qui écriraient
 * (code, renommage, préférences, lectures de cartes) sont retenus et reçoivent une réponse d'essai.
 *
 * Il parcourt, à 1440 et 390 px, en clair et en sombre : la page unique (anciennes adresses comprises), le parcours
 * en étapes empilées sur un Mac (image disque → Beluga Connect relié → autorisations → Chrome prêt → prêt), sur
 * Windows (fichier personnalisé, ligne SmartScreen, secours au bon chemin), sur Linux (commande à coller), un
 * ordinateur DÉJÀ relié reconnu par l'extension (tout coché sans rien télécharger), la page d'un ordinateur, et les
 * deux bandes (#d1aa : information, orange).
 *
 *   VERIF_URL=http://localhost:7311 VERIF_CAPTURES=<dossier> node scripts/verif-assistant-ordinateur.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const URL_ESSAI = process.env.VERIF_URL || 'http://localhost:7311';
const VERSION_ATTENDUE = JSON.parse(fs.readFileSync(new URL('../extension-chrome/manifest.json', import.meta.url), 'utf8')).version;
const CAPTURES = process.env.VERIF_CAPTURES || '/tmp/captures-assistant-ordinateur';
const BASE = process.env.VERIF_BASE || '/root/beluga/data/beluga.db';
fs.mkdirSync(CAPTURES, { recursive: true });

let echecs = 0;
let total = 0;
function noter(nom, ok, detail = '') {
  total += 1;
  if (!ok) echecs += 1;
  console.log(`${ok ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const MAINTENANT = Date.now();
const MAC = 'oEssaiMac';
const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
};

/** Les états fabriqués : un ordinateur ancien (« Bureau »), puis celui qui se relie pendant le parcours. */
const ancien = { id: 'oBureau', nom: 'PC Bureau', repere: 'pc-bureau', creeLe: MAINTENANT - 86400_000, navigateurs: [], programme: null };
const programme = (autre) => ({ id: 'rEssai', etat: 'pret', vuLe: Date.now(), autorisations: { accessibilite: false, ecran: false }, connect: '1.0.1', preparation: null, systeme: 'mac', relieLe: Date.now(), ...autre });
const chrome = (autre) => ({ id: 'cEssai', genre: 'chrome', enLigne: true, version: VERSION_ATTENDUE, incognito: false, vuLe: Date.now(), agentsAuTravail: 0, creeLe: Date.now(), ...autre });
const prep = (autre) => ({ etat: 'en-cours', ajoutee: true, message: null, depuis: Date.now() - 60_000, majLe: Date.now(), travail: 'installation', ...autre });
/* LES NAVIGATEURS CHOISIS (carte « Navigateurs facultatifs à la liaison ») : Chrome et Safari sur un Mac, Chrome
   ailleurs, sauf scène qui dit autre chose (`null` : pas encore choisi, l'étape « Navigateurs » attend). */
const relie = (nom, p, navigateurs = [], choisis) => ({
  id: MAC,
  nom,
  repere: 'essai',
  creeLe: MAINTENANT,
  navigateurs,
  programme: p,
  navigateursChoisis: choisis !== undefined ? choisis : p?.systeme === 'windows' || p?.systeme === 'linux' ? ['chrome'] : ['chrome', 'safari'],
});
const DETECTES = [
  { marque: 'chrome', version: '152.0.1', parDefaut: true },
  { marque: 'safari', version: '19.1', parDefaut: false },
  { marque: 'firefox', version: '133.0', parDefaut: false },
  { marque: 'arc', version: '1.80', parDefaut: false },
  { marque: 'orion', version: '0.99', parDefaut: false },
];
const etatAvec = (ordinateurs) => ({ version: VERSION_ATTENDUE, chromes: [], ordinateurs, safari: { disponible: true, version: '1.0.8' }, sites: [], routines: [] });

const SCENARIOS = {
  vide: () => etatAvec([ancien]),
  macRelie: () => etatAvec([ancien, relie('Chris - MacBook Pro', programme({ autorisations: { accessibilite: true, ecran: false } }), [], null)]),
  /* L'ÉTAPE « NAVIGATEURS » : autorisations données, cinq navigateurs trouvés, rien encore choisi. */
  macChoix: () => etatAvec([ancien, relie('Chris - MacBook Pro', programme({ autorisations: { accessibilite: true, ecran: true }, installes: DETECTES }), [], null)]),
  /* « Continuer sans navigateur » : prêt sans aucun navigateur. */
  macSansNavigateur: () => etatAvec([ancien, relie('Chris - MacBook Pro', programme({ autorisations: { accessibilite: true, ecran: true }, installes: DETECTES }), [], [])]),
  /* Chrome seul retenu : prêt sans jamais toucher à Safari. */
  macChromeSeul: () =>
    etatAvec([
      ancien,
      relie('Chris - MacBook Pro', programme({ autorisations: { accessibilite: true, ecran: true }, installes: DETECTES, preparation: { etat: 'fait', ajoutee: true, message: null, depuis: Date.now() } }), [chrome({ incognito: true })], ['chrome']),
    ]),
  macChrome: () =>
    etatAvec([ancien, relie('Chris - MacBook Pro', programme({ autorisations: { accessibilite: true, ecran: true }, preparation: { etat: 'en-cours', ajoutee: true, message: null, depuis: Date.now() } }), [chrome()])]),
  /* Carte « Beluga Connect : liaison sans fenêtre » : Safari s'installe tout seul APRÈS Chrome. */
  macSafari: () =>
    etatAvec([
      ancien,
      relie(
        'Chris - MacBook Pro',
        programme({ autorisations: { accessibilite: true, ecran: true }, preparation: { etat: 'fait', ajoutee: true, message: null, depuis: Date.now() }, safari: { etat: 'en-cours', installee: true, activee: false, message: null, depuis: Date.now() } }),
        [chrome({ incognito: true })],
      ),
    ]),
  /* Carte « Ordinateurs : pannes et volets alignés » : Safari tombé (onglet « Extensions » introuvable). */
  macSafariEchec: () =>
    etatAvec([
      ancien,
      relie(
        'Mac mini de Chris',
        programme({
          autorisations: { accessibilite: true, ecran: true },
          preparation: { etat: 'fait', ajoutee: true, message: null, depuis: Date.now() },
          safari: { etat: 'echec', installee: true, activee: false, message: 'onglet « Extensions » des réglages de Safari introuvable (3 essais, Safari relancé entre deux)', depuis: Date.now() },
        }),
        [chrome({ incognito: true })],
      ),
    ]),
  macSansSafari: () =>
    etatAvec([
      ancien,
      relie('Chris - MacBook Pro', programme({ autorisations: { accessibilite: true, ecran: true }, preparation: { etat: 'fait', ajoutee: true, message: null, depuis: Date.now() } }), [chrome({ incognito: true })]),
    ]),
  macPret: () =>
    etatAvec([
      ancien,
      relie(
        'Chris - MacBook Pro',
        programme({ autorisations: { accessibilite: true, ecran: true }, preparation: { etat: 'fait', ajoutee: true, message: null, depuis: Date.now() }, safari: { etat: 'fait', installee: true, activee: true, message: null, depuis: Date.now() } }),
        [chrome({ incognito: true }), chrome({ id: 'sEssai', genre: 'safari', incognito: null })],
      ),
    ]),
  winRelie: () =>
    etatAvec([
      ancien,
      relie('DESKTOP-ESSAI', programme({ systeme: 'windows', autorisations: null, preparation: { etat: 'echec', ajoutee: false, message: 'Le bouton « Mode développeur » est introuvable', depuis: Date.now(), dossier: 'C:\\Users\\Chris\\AppData\\Local\\Beluga\\extension-chrome' } })),
    ]),
  /* Carte « Liaison Chrome automatique et suivie » : code posé depuis 5 s (pas encore de secours), depuis 40 s (secours),
     échec dit avec sa raison, réparation en cours (message d'information). */
  macAttente: () => etatAvec([ancien, relie('Mac mini de Chris', programme({ autorisations: { accessibilite: true, ecran: true }, preparation: prep({ debutLiaison: Date.now() - 5_000 }) }))]),
  macSecours: () => etatAvec([ancien, relie('Mac mini de Chris', programme({ autorisations: { accessibilite: true, ecran: true }, preparation: prep({ debutLiaison: Date.now() - 40_000 }) }))]),
  macEchec: () =>
    etatAvec([
      ancien,
      relie('Mac mini de Chris', programme({ autorisations: { accessibilite: true, ecran: true }, preparation: prep({ etat: 'echec', debutLiaison: Date.now() - 95_000, message: 'Chrome n’a pas pu se relier seul : Code inconnu ou expiré' }) })),
    ]),
  macReparation: () =>
    etatAvec([ancien, relie('Mac mini de Chris', programme({ autorisations: { accessibilite: true, ecran: true }, preparation: prep({ travail: 'reparation', debutLiaison: null, ajoutee: null }) }))]),
  macRepare: () =>
    etatAvec([
      ancien,
      relie('Mac mini de Chris', programme({ autorisations: { accessibilite: true, ecran: true }, preparation: prep({ travail: 'reparation', etat: 'fait' }) }), [
        chrome({ incognito: true }),
        chrome({ id: 'sEssai', genre: 'safari', incognito: null }),
      ]),
    ]),
  winPret: () => etatAvec([ancien, relie('DESKTOP-ESSAI', programme({ systeme: 'windows', autorisations: null }), [chrome({ incognito: null })])]),
};
const BANDES = {
  aucune: { retards: [], avis: [] },
  information: { retards: [], avis: [{ chromeId: 'cMini', nom: 'MacMini', version: '1.0.12', faiteLe: MAINTENANT - 60_000 }] },
  orange: {
    retards: [
      {
        chromeId: 'cMac',
        nom: 'Chris - MacBook Pro',
        ordinateurId: MAC,
        version: '1.0.5',
        versionAttendue: '1.0.12',
        raison: 'version',
        programmeEnLigne: true,
        enLigne: true,
        agentsAuTravail: 0,
        geste: 'relancer-chrome',
        enCours: false,
      },
    ],
    avis: [],
  },
  silencieuse: {
    retards: [
      {
        chromeId: 'cMac',
        nom: 'Chris - MacBook Pro',
        ordinateurId: MAC,
        version: '1.0.11',
        versionAttendue: '1.0.12',
        raison: 'version',
        programmeEnLigne: true,
        enLigne: true,
        agentsAuTravail: 1,
        geste: 'aucun',
        enCours: false,
      },
    ],
    avis: [],
  },
};

/** Les commandes retenues (elles écriraient) : la réponse d'essai donnée à la page. */
function reponseDEssai(cmd, scene) {
  switch (cmd.type) {
    case 'extension.etat':
      return SCENARIOS[scene.etat]();
    case 'extension.retards':
      return BANDES[scene.bande];
    case 'extension.code':
      return { code: '482913', expireLe: Date.now() + 10 * 60_000 };
    case 'relaisMac.codeDeSecours':
      scene.secours += 1;
      return { code: '482915', expireLe: Date.now() + 10 * 60_000 };
    case 'relaisMac.code':
      scene.codes += 1;
      return { code: '731205', expireLe: Date.now() + 10 * 60_000 };
    /* Le code de secours attendu (Beluga Connect non reconnu à coup sûr), et sa saisie dans l'onglet. */
    case 'relaisMac.liaison.enAttente':
      return { demandes: [], codeAttendu: scene.codeAttendu ? { nom: 'Mac', systeme: 'mac', expireLe: Date.now() + 10 * 60_000 } : null };
    case 'relaisMac.liaison.parCode':
      scene.parCode = cmd.code;
      return { ok: true, nom: 'Chris - MacBook Pro' };
    case 'relaisMac.preparerSafari':
      scene.safari += 1;
      return { ok: true };
    case 'ordinateur.navigateurs':
      scene.navigateurs = cmd.choisis;
      return { ok: true, choisis: cmd.choisis };
    case 'ordinateur.renommer':
    case 'relaisMac.reglage':
    case 'relaisMac.preparer':
    case 'prefs.set':
    case 'card.read':
    case 'project.read':
      return { ok: true };
    default:
      return undefined;
  }
}

const cookie = crypto.randomBytes(24).toString('base64url');
const db = new Database(BASE);
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(
  crypto.createHash('sha256').update(cookie).digest('hex'),
  Date.now(),
  Date.now() + 3600_000,
  'essai assistant ordinateur',
  'admin-premier',
);

const navigateur = await chromium.launch({ channel: 'chrome' });

/** Un onglet d'essai : le canal intercepté, la scène qu'on change, et les téléchargements notés. */
async function ouvrir(largeur, theme, systeme) {
  const telephone = largeur === 390;
  const ctx = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    serviceWorkers: 'block',
    locale: 'fr-FR',
    acceptDownloads: true,
    ...(systeme ? { userAgent: UA[systeme] } : {}),
  });
  await ctx.addCookies([{ name: 'beluga_session', value: cookie, url: URL_ESSAI }]);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e?.message ?? e)));
  const telechargements = [];
  page.on('download', (d) => telechargements.push(d.url()));
  const scene = { etat: 'vide', bande: 'aucune', codes: 0, secours: 0, codeAttendu: false, parCode: null, safari: 0, navigateurs: null };
  let pousser = null;
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const serveur = ws.connectToServer();
    pousser = (obj) => ws.send(JSON.stringify(obj));
    ws.onMessage((message) => {
      let lu = null;
      try {
        lu = JSON.parse(String(message));
      } catch {
        /* tel quel */
      }
      const cmd = lu?.cmd;
      const reponse = cmd ? reponseDEssai(cmd, scene) : undefined;
      if (cmd && reponse !== undefined) {
        ws.send(JSON.stringify({ type: 'ack', id: lu.id, ok: true, data: reponse }));
        return;
      }
      serveur.send(message);
    });
  });
  const changer = async (etat, bande) => {
    if (etat) scene.etat = etat;
    if (bande) scene.bande = bande;
    pousser?.({ type: 'extension.change' });
    await page.waitForTimeout(900);
  };
  const aller = async (adresse) => {
    await page.goto(`${URL_ESSAI}/${adresse}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => !!window.belugaEssai, null, { timeout: 60_000 }).catch(() => undefined);
    await page.evaluate((t) => window.belugaEssai?.reglages?.({ theme: t }), theme);
    await page.waitForTimeout(1500);
    /* Les préférences du compte arrivent du serveur après la première pose : le thème d'essai est reposé par-dessus,
       sans quoi les captures « sombre » sortaient claires. */
    await page.evaluate((t) => window.belugaEssai?.reglages?.({ ...window.belugaEssai.reglagesActuels(), theme: t }), theme);
    await page.waitForTimeout(300);
  };
  const pousserEvenement = (obj) => pousser?.(obj);
  return { ctx, page, erreurs, telechargements, scene, changer, aller, pousserEvenement, nom: (n) => path.join(CAPTURES, `${n}-${largeur}-${theme}.png`) };
}

const etape = (page, cle) => page.locator(`[data-etape-connexion="${cle}"]`).getAttribute('data-etat').catch(() => null);

/**
 * L'UN SOUS L'AUTRE, JAMAIS EN COLONNES (carte « Beluga Connect : liaison sans fenêtre », décision répétée de
 * l'utilisateur) : les blocs ont le même bord gauche et la même largeur, chacun SOUS le précédent ; dans chaque bloc,
 * les points ont le même bord gauche, chacun sous le précédent.
 */
async function empilesLUnSousLAutre(page) {
  return page.evaluate(() => {
    const blocs = [...document.querySelectorAll('[data-etape-connexion]')].map((b) => b.getBoundingClientRect());
    if (blocs.length < 2) return 'moins de deux blocs';
    for (let i = 1; i < blocs.length; i++) {
      if (Math.abs(blocs[i].left - blocs[0].left) > 1 || Math.abs(blocs[i].width - blocs[0].width) > 1) return `bloc ${i} décalé`;
      if (blocs[i].top < blocs[i - 1].bottom - 1) return `bloc ${i} pas sous le précédent`;
    }
    for (const b of document.querySelectorAll('[data-etape-connexion]')) {
      const points = [...b.querySelectorAll('[data-points-etape] > [data-ligne-etat]')].map((p) => p.getBoundingClientRect());
      for (let i = 1; i < points.length; i++) {
        if (Math.abs(points[i].left - points[0].left) > 1) return `point ${i} de ${b.getAttribute('data-etape-connexion')} décalé`;
        if (points[i].top < points[i - 1].bottom - 1) return `point ${i} de ${b.getAttribute('data-etape-connexion')} sur la même ligne`;
      }
    }
    return 'ok';
  });
}

/**
 * LES LIGNES SUR LA GRILLE DU VOLET (carte « Ordinateurs : pannes et volets alignés ») : dans le volet ouvert, le rond
 * de chaque ligne est centré sous le rond du volet, son libellé commence sous le titre, son état finit sous le résumé.
 */
async function alignesSurLeVolet(page) {
  return page.evaluate(() => {
    const volet = document.querySelector('[data-etape-connexion][data-ouverte]');
    if (!volet) return 'aucun volet ouvert';
    const entete = volet.querySelector('[data-entete-etape]');
    const [rond, titre, resume] = [...entete.children].map((e) => e.getBoundingClientRect());
    const centre = (r) => r.left + r.width / 2;
    for (const ligne of volet.querySelectorAll('[data-points-etape] > [data-ligne-etat]')) {
      const [r, l, v] = [...ligne.children].map((e) => e.getBoundingClientRect());
      const rondLigne = ligne.children[0].firstElementChild?.getBoundingClientRect() ?? r;
      if (Math.abs(centre(rondLigne) - centre(rond)) > 1) return `rond de ${ligne.getAttribute('data-ligne-etat')} décalé`;
      if (Math.abs(l.left - titre.left) > 1) return `libellé de ${ligne.getAttribute('data-ligne-etat')} décalé`;
      if (Math.abs(v.right - resume.right) > 1) return `état de ${ligne.getAttribute('data-ligne-etat')} décalé`;
    }
    return 'ok';
  });
}

try {
  /* VERIF_LARGEURS=1440 VERIF_THEMES=clair : un passage seul, pour mettre au point. */
  const largeurs = (process.env.VERIF_LARGEURS || '1440,390').split(',').map(Number);
  const themes = (process.env.VERIF_THEMES || 'sombre,clair').split(',');
  for (const largeur of largeurs) {
    for (const theme of themes) {
      const T = `[${largeur} ${theme}]`;
      // --- LA BANDE : information, puis orange, puis rien pendant qu'un agent travaille ---------------------
      {
        const { ctx, page, changer, aller, nom } = await ouvrir(largeur, theme, null);
        await aller('');
        await changer(null, 'information');
        const info = page.locator('[data-banniere-extension="information"]');
        await info.waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(`${T} bande d'information après une mise à jour faite seule`, (await info.count()) === 1 && /MacMini/.test((await info.textContent()) ?? ''));
        await page.screenshot({ path: nom('bande-information'), clip: { x: 0, y: 0, width: largeur, height: 140 } });
        await page.locator('[data-banniere-extension-ok]').click();
        await page.waitForTimeout(400);
        noter(`${T} « OK » la retire, et elle ne revient pas`, (await info.count()) === 0);
        await changer(null, 'silencieuse');
        noter(`${T} aucun orange quand Beluga s'en charge (agent au travail)`, (await page.locator('[data-banniere-extension]').count()) === 0);
        await changer(null, 'orange');
        const orange = page.locator('[data-banniere-geste="relancer-chrome"]');
        await orange.waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(`${T} orange seulement quand Chrome doit redémarrer`, (await orange.count()) === 1 && /Chris - MacBook Pro/.test((await orange.textContent()) ?? ''));
        await page.screenshot({ path: nom('bande-orange'), clip: { x: 0, y: 0, width: largeur, height: 140 } });
        await ctx.close();
      }

      // --- UN MAC : la page unique, un bouton, puis tout se coche en direct ----------------------------------
      {
        const { ctx, page, erreurs, telechargements, scene, changer, aller, pousserEvenement, nom } = await ouvrir(largeur, theme, 'mac');
        await aller('#reglages/beluga-connect');
        const bouton = page.locator('[data-lier-cet-ordinateur]');
        await bouton.waitFor({ timeout: 60_000 }).catch(() => undefined);
        noter(
          `${T} l'ancienne adresse « Beluga Connect » mène à la page unique : « Ajouter cet ordinateur » et « Lier » en tête`,
          (await page.locator('[data-page-ordinateurs]').count()) === 1 &&
            (await bouton.count()) === 1 &&
            (await page.locator('[data-ajouter-cet-ordinateur="mac"]').count()) === 1 &&
            /Celui où vous êtes/.test((await page.locator('[data-ajouter-cet-ordinateur]').textContent().catch(() => '')) ?? '') &&
            (await page.locator('[data-page-ordinateurs] button', { hasText: 'Connecter cet ordinateur' }).count()) === 0,
        );
        noter(`${T} plus d'entrée « Beluga Connect » ni « Extension du navigateur » au menu`, (await page.locator('[data-page-menu="beluga-connect"], [data-page-menu="navigateur"]').count()) === 0);
        await page.screenshot({ path: nom('page-ordinateurs') });
        await bouton.click();
        await page.locator('[data-parcours-connexion="installation"]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(600);
        /* Le téléchargement part après la réponse du code : on lui laisse jusqu'à cinq secondes pour se montrer. */
        for (let i = 0; i < 25 && !telechargements.length; i++) await page.waitForTimeout(200);
        noter(
          `${T} Mac : « Lier » remplace la liste par « Ajouter ce Mac », télécharge l'image disque avec le code, le bloc 1 en cours`,
          telechargements.some((u) => u.endsWith('/api/connect/Beluga-Connect.dmg?code=731205')) &&
            scene.codes === 1 &&
            (await page.locator('[data-page-parcours]').count()) === 1 &&
            (await page.locator('[data-ouvrir-ordinateur]').count()) === 0 &&
            /Ajouter ce Mac/.test((await page.locator('[data-titre-parcours]').textContent().catch(() => '')) ?? '') &&
            (await etape(page, 'installation')) === 'en-cours' &&
            (await page.locator('[data-etape-connexion="installation"][data-ouverte]').count()) === 1 &&
            (await etape(page, 'mac')) === 'a-venir' &&
            (await page.locator('[data-etape-connexion]').count()) === 3 &&
            /Installation · étape 1 sur 3/.test((await page.locator('[data-entete-ordinateur]').textContent().catch(() => '')) ?? '') &&
            (await page.locator('[data-etape-connexion][data-ouverte]').count()) === 1 &&
            (await page.locator('[data-etape-connexion="installation"] [data-ligne-etat="telecharge"][data-etat="fait"]').count()) === 1 &&
            (await page.locator('[data-aide-liaison]').count()) === 0,
          telechargements.join(' '),
        );
        noter(`${T} Mac : trois volets (Installation, Ce Mac, Navigateurs) pleine largeur l'un sous l'autre, chaque ligne sur la grille du volet`, (await empilesLUnSousLAutre(page)) === 'ok', await empilesLUnSousLAutre(page));
        noter(`${T} Mac : les lignes alignées sous le rond, le titre et le résumé du volet`, (await alignesSurLeVolet(page)) === 'ok', await alignesSurLeVolet(page));
        noter(
          `${T} Mac : aucun navigateur imposé avant le choix (ni Chrome ni Safari), aucun bouton « Relier »`,
          (await page.locator('[data-etape-connexion="chrome"], [data-etape-connexion="safari"]').count()) === 0 &&
            /À venir/.test((await page.locator('[data-etape-connexion="navigateurs"] [data-statut-etape]').textContent().catch(() => '')) ?? '') &&
            (await page.getByRole('button', { name: /^Relier$/ }).count()) === 0,
        );
        /* Contenu EMPILÉ : la consigne, PUIS l'image dessous. */
        const yConsignes = (await page.locator('[data-etapes-installation="mac"]').boundingBox().catch(() => null))?.y ?? -1;
        const yImage = (await page.locator('[data-image-installation]').boundingBox().catch(() => null))?.y ?? -1;
        noter(`${T} Mac : la consigne, puis l'image dessous`, yConsignes > 0 && yImage > yConsignes, `${yConsignes} ${yImage}`);
        noter(`${T} Mac : aucun nouvel onglet ouvert`, ctx.pages().length === 1);
        await page.screenshot({ path: nom('mac-installer'), fullPage: true });
        /* LE CODE DE SECOURS : Beluga Connect non reconnu à coup sûr — l'onglet ouvre six cases, la liaison part au sixième chiffre. */
        scene.codeAttendu = true;
        pousserEvenement({ type: 'relaisMac.codeAttendu', pour: 'admin-premier', nom: 'Mac', systeme: 'mac', expireLe: Date.now() + 10 * 60_000 });
        await page.locator('[data-champ-code-de-secours]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} Mac : code de secours attendu — volet « Installation » ouvert, « À vous », six cases`,
          (await etape(page, 'installation')) === 'en-cours' &&
            (await page.locator('[data-etape-connexion="installation"][data-ouverte]').count()) === 1 &&
            (await page.locator('[data-etape-connexion="installation"] [data-ligne-etat="code"][data-etat="en-cours"]').count()) === 1 &&
            /À vous/.test((await page.locator('[data-etape-connexion="installation"] [data-statut-etape]').textContent().catch(() => '')) ?? '') &&
            (await page.locator('[data-cases-du-code] > span').count()) === 6,
        );
        await page.locator('[data-champ-code-de-secours]').fill('481').catch(() => undefined);
        await page.waitForTimeout(400);
        await page.locator('[data-etape-connexion="installation"]').scrollIntoViewIfNeeded().catch(() => undefined);
        await page.screenshot({ path: nom('mac-code-de-secours-a-taper'), fullPage: true });
        noter(`${T} Mac : trois chiffres tapés, rien n'est encore envoyé`, scene.parCode === null);
        await page.locator('[data-champ-code-de-secours]').fill('481207').catch(() => undefined);
        await page.waitForTimeout(800);
        noter(`${T} Mac : le sixième chiffre envoie le code à Beluga`, scene.parCode === '481207', String(scene.parCode));
        scene.codeAttendu = false;
        await changer('macRelie');
        await page.locator('[data-parcours-connexion="mac"]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} Mac : relié tout seul, « Installation » terminée et repliée, « Ce Mac » ouvert, une autorisation sur deux`,
          (await etape(page, 'installation')) === 'faite' &&
            /Terminée/.test((await page.locator('[data-etape-connexion="installation"] [data-statut-etape]').textContent().catch(() => '')) ?? '') &&
            (await page.locator('[data-etape-connexion][data-ouverte]').count()) === 1 &&
            (await page.locator('[data-etape-connexion="mac"][data-ouverte]').count()) === 1 &&
            (await page.locator('[data-ligne-etat="accessibilite"][data-etat="fait"]').count()) === 1 &&
            (await page.locator('[data-ligne-etat="ecran"][data-etat="en-cours"]').count()) === 1 &&
            (await page.locator('[data-rouvrir-aide]').count()) === 1,
        );
        const vert = await page.locator('[data-etape-connexion="installation"] [data-rond="fait"]').evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => '');
        noter(`${T} la coche est verte`, vert === 'rgb(34, 197, 94)', vert);
        await page.screenshot({ path: nom('mac-autorisations'), fullPage: true });
        // --- L'étape « Navigateurs » (maquette #c3802) ---------------------------------------------------------
        await changer('macChoix');
        await page.locator('[data-etape-navigateurs]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        const etatsProposes = await page.locator('[data-navigateur-propose]').evaluateAll((l) => l.map((e) => `${e.getAttribute('data-navigateur-propose')}:${e.getAttribute('data-etat')}`));
        noter(
          `${T} Navigateurs : volet ouvert « À vous », confirmation de Beluga Connect, cinq navigateurs trouvés — Chrome et Safari cochés d'office, les autres « Bientôt »`,
          (await page.locator('[data-etape-connexion="navigateurs"][data-ouverte]').count()) === 1 &&
            /À vous/.test((await page.locator('[data-etape-connexion="navigateurs"] [data-statut-etape]').textContent().catch(() => '')) ?? '') &&
            (await page.locator('[data-etape-connexion="navigateurs"] [data-ligne-etat="connect"][data-etat="fait"]').count()) === 1 &&
            /trouvé 5 navigateurs/.test((await page.locator('[data-etape-navigateurs]').textContent().catch(() => '')) ?? '') &&
            etatsProposes.join(' ') === 'chrome:coche safari:coche firefox:bientot arc:bientot orion:bientot' &&
            (await page.locator('[data-bientot]').count()) === 3 &&
            /Équiper 2 navigateurs/.test((await page.locator('[data-equiper-navigateurs]').textContent().catch(() => '')) ?? '') &&
            (await page.locator('[data-sans-navigateur]').count()) === 1 &&
            (await page.locator('[data-celui-ou-vous-etes]').count()) === 1,
          etatsProposes.join(' '),
        );
        await page.screenshot({ path: nom('mac-navigateurs'), fullPage: true });
        await page.locator('[data-cocher-navigateur="safari"]').click().catch(() => undefined);
        await page.waitForTimeout(300);
        noter(
          `${T} Navigateurs : décocher Safari le passe en « Pas pour moi », le bouton dit « Équiper 1 navigateur »`,
          (await page.locator('[data-navigateur-propose="safari"][data-etat="decoche"]').count()) === 1 &&
            /Pas pour moi/.test((await page.locator('[data-navigateur-propose="safari"]').textContent().catch(() => '')) ?? '') &&
            /Équiper 1 navigateur/.test((await page.locator('[data-equiper-navigateurs]').textContent().catch(() => '')) ?? ''),
        );
        await page.screenshot({ path: nom('mac-navigateurs-safari-decoche'), fullPage: true });
        await page.locator('[data-equiper-navigateurs]').click().catch(() => undefined);
        await page.waitForTimeout(500);
        noter(`${T} Navigateurs : « Équiper 1 navigateur » envoie le choix (Chrome seul)`, JSON.stringify(scene.navigateurs) === '["chrome"]', JSON.stringify(scene.navigateurs));
        await changer('macChromeSeul');
        await page.locator('[data-assistant-tout-pret]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} Chrome seul : le Mac est prêt sans jamais toucher à Safari — quatre volets verts, aucun volet Safari`,
          (await page.locator('[data-assistant-tout-pret]').count()) === 1 &&
            (await page.locator('[data-etape-connexion="safari"]').count()) === 0 &&
            (await page.locator('[data-etape-connexion][data-etat="faite"]').count()) === 4 &&
            /dans Chrome sur ce Mac/.test((await page.locator('[data-assistant-tout-pret]').textContent().catch(() => '')) ?? ''),
        );
        await page.screenshot({ path: nom('mac-chrome-seul-pret'), fullPage: true });
        await changer('macSansNavigateur');
        await page.waitForTimeout(300);
        noter(
          `${T} « Continuer sans navigateur » : prêt, trois volets verts, le texte le dit`,
          (await page.locator('[data-assistant-tout-pret]').count()) === 1 &&
            (await page.locator('[data-etape-connexion]').count()) === 3 &&
            /Relié sans navigateur/.test((await page.locator('[data-assistant-tout-pret]').textContent().catch(() => '')) ?? ''),
        );
        await changer('macChoix');
        await page.locator('[data-sans-navigateur]').click().catch(() => undefined);
        await page.waitForTimeout(500);
        noter(`${T} « Continuer sans navigateur » envoie un choix vide`, JSON.stringify(scene.navigateurs) === '[]', JSON.stringify(scene.navigateurs));
        await changer('macChrome');
        await page.locator('[data-parcours-connexion="chrome"]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} Mac : Chrome préparé seul — ajoutée, reliée, navigation privée en vérification ; Safari attend`,
          (await page.locator('[data-etape-connexion="chrome"][data-ouverte]').count()) === 1 &&
            (await page.locator('[data-etape-connexion][data-ouverte]').count()) === 1 &&
            (await page.locator('[data-etape-connexion="chrome"] [data-ligne-etat="ajoutee"][data-etat="fait"]').count()) === 1 &&
            (await page.locator('[data-etape-connexion="chrome"] [data-ligne-etat="reliee"][data-etat="fait"]').count()) === 1 &&
            (await page.locator('[data-etape-connexion="chrome"] [data-ligne-etat="prive"][data-etat="en-cours"]').count()) === 1 &&
            /Après Chrome/.test((await page.locator('[data-etape-connexion="safari"] [data-statut-etape]').textContent().catch(() => '')) ?? ''),
        );
        noter(`${T} Mac (Chrome) : toujours l'un sous l'autre`, (await empilesLUnSousLAutre(page)) === 'ok', await empilesLUnSousLAutre(page));
        await page.screenshot({ path: nom('mac-chrome'), fullPage: true });
        await changer('macSafari');
        await page.locator('[data-parcours-connexion="safari"]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} Mac : Safari s'installe tout seul après Chrome — installée, activation en cours, reliée à venir`,
          (await etape(page, 'chrome')) === 'faite' &&
            (await page.locator('[data-etape-connexion="safari"][data-ouverte]').count()) === 1 &&
            (await page.locator('[data-etape-connexion="safari"] [data-ligne-etat="installee"][data-etat="fait"]').count()) === 1 &&
            (await page.locator('[data-etape-connexion="safari"] [data-ligne-etat="activee"][data-etat="en-cours"]').count()) === 1 &&
            (await page.locator('[data-etape-connexion="safari"] [data-ligne-etat="reliee"][data-etat="a-venir"]').count()) === 1,
        );
        await page.screenshot({ path: nom('mac-safari'), fullPage: true });
        await changer('macSafariEchec');
        await page.locator('[data-etape-connexion="safari"] [data-raison-echec]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} Mac : Safari en panne — seul son volet ouvert, « À réparer », la raison et « Réessayer », bandeau « 1 élément à réparer »`,
          (await page.locator('[data-etape-connexion][data-ouverte]').count()) === 1 &&
            (await page.locator('[data-etape-connexion="safari"][data-ouverte]').count()) === 1 &&
            /À réparer/.test((await page.locator('[data-etape-connexion="safari"] [data-statut-etape]').textContent().catch(() => '')) ?? '') &&
            /introuvable/.test((await page.locator('[data-etape-connexion="safari"] [data-raison-echec]').textContent().catch(() => '')) ?? '') &&
            (await page.locator('[data-safari-reessayer]').count()) === 1 &&
            /1 élément à réparer/.test((await page.locator('[data-entete-ordinateur]').textContent().catch(() => '')) ?? ''),
        );
        noter(`${T} Mac (Safari en panne) : lignes alignées sur le volet`, (await alignesSurLeVolet(page)) === 'ok', await alignesSurLeVolet(page));
        await page.locator('[data-etape-connexion="chrome"] [data-entete-etape]').click().catch(() => undefined);
        await page.waitForTimeout(300);
        noter(
          `${T} Mac : un clic sur un autre volet l'ouvre et referme le précédent`,
          (await page.locator('[data-etape-connexion][data-ouverte]').count()) === 1 && (await page.locator('[data-etape-connexion="chrome"][data-ouverte]').count()) === 1,
        );
        await page.locator('[data-etape-connexion="safari"] [data-entete-etape]').click().catch(() => undefined);
        await page.waitForTimeout(300);
        const barreAGauche = await page.evaluate(() =>
          [...document.querySelectorAll('[data-parcours-installation] *')].filter((e) => {
            const r = e.getBoundingClientRect();
            const st = getComputedStyle(e);
            return (parseFloat(st.borderLeftWidth) >= 2 && st.borderLeftStyle !== 'none') || (r.width > 0 && r.width <= 4 && r.height > 20 && st.backgroundColor !== 'rgba(0, 0, 0, 0)');
          }).length,
        );
        noter(`${T} Mac : aucune barre sur le bord gauche`, barreAGauche === 0, String(barreAGauche));
        await page.screenshot({ path: nom('mac-safari-en-panne'), fullPage: true });
        await changer('macPret');
        await page.locator('[data-assistant-tout-pret]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} Mac : « Chris - MacBook Pro est prêt », cinq volets verts, tous repliés, « Tout va bien », « Fermer » et « Voir l’ordinateur »`,
          /Chris - MacBook Pro est prêt/.test((await page.locator('[data-assistant-tout-pret]').textContent().catch(() => '')) ?? '') &&
            /Chrome et Safari/.test((await page.locator('[data-assistant-tout-pret]').textContent().catch(() => '')) ?? '') &&
            (await page.locator('[data-etape-connexion][data-etat="faite"]').count()) === 5 &&
            (await page.locator('[data-etape-connexion][data-ouverte]').count()) === 0 &&
            /Tout va bien/.test((await page.locator('[data-entete-ordinateur]').textContent().catch(() => '')) ?? '') &&
            (await page.locator('[data-parcours-fermer]').count()) === 1 &&
            (await page.locator('[data-parcours-voir]').count()) === 1,
        );
        await page.screenshot({ path: nom('mac-tout-pret'), fullPage: true });
        const deborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        noter(`${T} rien ne déborde en largeur`, deborde <= 0, String(deborde));
        // --- La page d'un ordinateur : sommaire à gauche, titres simples, plus la rangée des autres ---------------
        await page.locator('[data-parcours-voir]').click();
        await page.locator(`[data-page-ordinateur="${MAC}"]`).waitFor({ timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(300);
        const titres = await page.locator(`[data-page-ordinateur="${MAC}"] [data-partie-ordinateur] h3`).allTextContents();
        noter(
          `${T} « Voir l’ordinateur » ouvre la page du Mac : titres simples, droits, navigateurs, Safari`,
          titres.join('|') === 'Autorisations|Confirmations|Beluga Connect|Navigateurs|Accès du Mac' &&
            (await page.locator('[data-droit]').count()) === 5 &&
            (await page.locator('[data-delier-navigateur="cEssai"]').count()) === 1 &&
            /* Safari posé d'office par Beluga Connect : il est relié, plus rien à « ajouter ». */
            (await page.locator('[data-delier-navigateur="sEssai"]').count()) === 1 &&
            (await page.locator('[data-choix-des-navigateurs] [data-navigateur-propose="safari"][data-etat="coche"]').count()) === 1,
          titres.join('|'),
        );
        noter(`${T} plus aucune rangée des autres ordinateurs`, (await page.locator('[data-page-ordinateur] [data-choix-ordinateur], [data-page-ordinateur] [data-ordinateur]').count()) === 0);
        /* LA MÊME LISTE SUR LA PAGE (carte « Navigateurs facultatifs ») : décocher Safari part aussitôt au démon. */
        await page.locator('[data-suivi-de-connect]').waitFor({ timeout: 2_000 }).catch(() => undefined);
        if (await page.locator('[data-suivi-de-connect]').count()) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(400);
        }
        await page.locator('[data-choix-des-navigateurs]').scrollIntoViewIfNeeded().catch(() => undefined);
        await page.screenshot({ path: nom('page-navigateurs') });
        await page.locator('[data-choix-des-navigateurs] [data-cocher-navigateur="safari"]').click({ timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(700);
        noter(`${T} page : décocher Safari envoie aussitôt le choix (Chrome seul)`, JSON.stringify(scene.navigateurs) === '["chrome"]', JSON.stringify(scene.navigateurs));
        await changer('macPret');
        /* Le bouton Safari est plus bas dans la page : on remonte en tête pour la suite (partie lue = Autorisations). */
        await page.locator(`[data-page-ordinateur="${MAC}"]`).evaluate((el) => {
          let n = el.parentElement;
          while (n && !['auto', 'scroll'].includes(getComputedStyle(n).overflowY)) n = n.parentElement;
          if (n) n.scrollTop = 0;
        }).catch(() => undefined);
        await page.waitForTimeout(600);
        if (largeur === 1440) {
          const sommaire = page.locator('[data-sommaire-sous-page]');
          noter(
            `${T} la colonne de gauche devient le sommaire : retour, nom, cinq parties, « Autorisations » surlignée`,
            (await sommaire.isVisible().catch(() => false)) &&
              (await page.locator('[data-page-menu]:visible').count()) === 0 &&
              (await page.locator('[data-retour-ordinateurs="colonne"]').isVisible().catch(() => false)) &&
              /Chris - MacBook Pro/.test((await page.locator('[data-titre-sous-page]').textContent().catch(() => '')) ?? '') &&
              (await page.locator('[data-aller-partie]').count()) === 5 &&
              (await page.locator('[data-aller-partie="autorisations"][data-actif="oui"]').count()) === 1,
          );
          await page.screenshot({ path: nom('page-d-un-mac') });
          await page.locator('[data-aller-partie="navigateurs"]').click();
          await page.waitForTimeout(1_000);
          /* La partie arrive en haut de la zone, ou aussi haut que le bas de la page le permet. */
          const position = await page.locator('[data-partie-ordinateur="navigateurs"]').evaluate((el) => {
            let n = el.parentElement;
            while (n && !['auto', 'scroll'].includes(getComputedStyle(n).overflowY)) n = n.parentElement;
            const haut = el.getBoundingClientRect().top - (n?.getBoundingClientRect().top ?? 0);
            const enBas = !!n && n.scrollTop + n.clientHeight >= n.scrollHeight - 4;
            return { haut, enBas };
          }).catch(() => ({ haut: 999, enBas: false }));
          noter(
            `${T} un clic du sommaire mène à sa partie et la surligne, seule`,
            (position.haut < 60 || (position.enBas && position.haut < 400)) &&
              (await page.locator('[data-aller-partie="navigateurs"][data-actif="oui"]').count()) === 1 &&
              (await page.locator('[data-aller-partie][data-actif="oui"]').count()) === 1,
            JSON.stringify(position),
          );
          await page.screenshot({ path: nom('page-d-un-mac-navigateurs') });
          await page.locator('[data-retour-ordinateurs="colonne"]').click({ timeout: 10_000 }).catch((e) => console.log('retour :', String(e?.message ?? e).split('\n')[0]));
        } else {
          noter(
            `${T} téléphone : pas de sommaire, la flèche de l'en-tête dit « Vos ordinateurs », aucun retour dans la page`,
            (await page.locator('[data-sommaire-sous-page]:visible').count()) === 0 &&
              (await page.locator('[data-retour-ordinateurs="entete"]').isVisible().catch(() => false)) &&
              (await page.locator('[data-retour-ordinateurs="page"]').count()) === 0,
          );
          await page.screenshot({ path: nom('page-d-un-mac') });
          await page.locator('[data-retour-ordinateurs="entete"]').click();
        }
        await page.locator('[data-ouvrir-ordinateur]').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(300);
        noter(
          `${T} le retour ramène à la liste, et la colonne reprend ses pages`,
          (await page.locator(`[data-ouvrir-ordinateur="${MAC}"]`).count()) === 1 && (await page.locator('[data-sommaire-sous-page]').count()) === 0,
          `ligne ${await page.locator(`[data-ouvrir-ordinateur="${MAC}"]`).count()} · sommaire ${await page.locator('[data-sommaire-sous-page]').count()}`,
        );
        await page.screenshot({ path: nom('retour-a-la-liste') });
        noter(`${T} Mac : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
        await ctx.close();
      }

      // --- LIAISON SUIVIE : code de secours à 30 s, échec dit, page de l'ordinateur, fenêtre seule, message ------
      {
        const { ctx, page, erreurs, scene, changer, aller, nom } = await ouvrir(largeur, theme, 'mac');
        await aller('#reglages/ordinateurs');
        await page.locator('[data-lier-cet-ordinateur]').click();
        await page.locator('[data-parcours-connexion="installation"]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        await changer('macAttente');
        await page.locator('[data-parcours-connexion="chrome"]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        /* Au tout premier passage, le serveur de dev compile encore l'étape : on attend sa ligne avant de juger. */
        await page.locator('[data-ligne-etat="reliee"][data-etat="en-cours"]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} code posé depuis 5 s : « Liaison de l’extension… » en cours, pas encore de code`,
          (await page.locator('[data-ligne-etat="reliee"][data-etat="en-cours"]').count()) === 1 && (await page.locator('[data-code-de-secours]').count()) === 0,
        );
        await changer('macSecours');
        const code = page.locator('[data-code-de-secours]');
        await code.waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} 30 s sans liaison : le code de secours en grand, groupé 3 + 3, avec « Copier »`,
          (await code.getAttribute('data-code-de-secours').catch(() => null)) === '482915' &&
            (await code.textContent().catch(() => '')) === '482 915' &&
            (await page.locator('[data-copier-code-de-secours]').count()) === 1 &&
            scene.secours === 1,
        );
        await page.locator('[data-encadre="code-de-secours"]').scrollIntoViewIfNeeded().catch(() => undefined);
        await page.screenshot({ path: nom('mac-code-de-secours') });
        await changer('macEchec');
        await page.locator('[data-raison-echec]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} échec : la raison dite, la ligne en croix, le code de secours et « Réessayer »`,
          /Code inconnu ou expiré/.test((await page.locator('[data-raison-echec]').textContent().catch(() => '')) ?? '') &&
            (await page.locator('[data-ligne-etat="reliee"][data-etat="echec"]').count()) === 1 &&
            (await page.locator('[data-code-de-secours]').count()) === 1 &&
            (await page.locator('[data-assistant-reessayer]').count()) === 1,
        );
        await page.locator('[data-assistant-reessayer]').scrollIntoViewIfNeeded().catch(() => undefined);
        await page.screenshot({ path: nom('mac-echec-dit') });

        /* La page de l'ordinateur : les étapes en direct à la place de « Aucun navigateur relié ». */
        await changer('macSecours');
        await page.locator('[data-retour-ordinateurs]:visible').first().click().catch(() => undefined);
        await page.locator(`[data-ouvrir-ordinateur="${MAC}"]`).click().catch(() => undefined);
        await page.locator('[data-etapes-de-l-ordinateur] [data-code-de-secours]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} page de l’ordinateur : les étapes en direct et le même code, plus « Aucun navigateur relié »`,
          (await page.locator('[data-etapes-de-l-ordinateur] [data-code-de-secours="482915"]').count()) === 1 && (await page.getByText('Aucun navigateur relié').count()) === 0,
        );
        await page.locator('[data-etapes-de-l-ordinateur]').scrollIntoViewIfNeeded().catch(() => undefined);
        await page.screenshot({ path: nom('page-d-un-mac-etapes') });

        /* L'ÉTAT PAR SERVICE EN ACCORDÉON (carte « Beluga Connect : liaison et suivi ») : en échec, l'en-tête dit le pire
           état, « Extension Chrome » s'ouvre en rouge avec SON « Réparer » ; les sections qui vont bien restent repliées. */
        await changer('macEchec');
        const services = page.locator('[data-etat-des-services]');
        await page.locator('[data-section-de-service="chrome"][data-etat="echec"]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} page de l’ordinateur : accordéon d’état, « Extension Chrome » ouverte en rouge avec « Réparer », le reste replié`,
          (await services.getAttribute('data-etat-des-services').catch(() => null)) === 'echec' &&
            (await page.locator('[data-section-de-service="chrome"][data-ouverte]').count()) === 1 &&
            (await page.locator('[data-reparer-service="chrome"]').count()) === 1 &&
            (await page.locator('[data-section-de-service="connect"][data-ouverte]').count()) === 0 &&
            (await page.locator('[data-reparer-service]').count()) === 1,
        );
        /* La fenêtre de connexion de CET appareil s'ouvre par-dessus en échec : masquée le temps de la photo seulement
           (la refermer la dirait « fermée par la personne » et fausserait le contrôle suivant). */
        const masque = await page.addStyleTag({ content: '[data-suivi-de-connect], [data-voile-de-fenetre]:has(~ * [data-suivi-de-connect]) { visibility: hidden !important; }' }).catch(() => null);
        await page.evaluate(() => {
          const f = document.querySelector('[data-suivi-de-connect]');
          for (const v of document.querySelectorAll('[data-voile-de-fenetre]')) if (f) v.style.visibility = 'hidden';
        }).catch(() => undefined);
        await services.scrollIntoViewIfNeeded().catch(() => undefined);
        await page.screenshot({ path: nom('page-d-un-mac-services') });
        await page.evaluate(() => {
          for (const v of document.querySelectorAll('[data-voile-de-fenetre]')) v.style.visibility = '';
        }).catch(() => undefined);
        await masque?.evaluate((n) => n.remove()).catch(() => undefined);

        /* Ailleurs dans Beluga, sur CET appareil (marque posée au clic) : la fenêtre de connexion s'ouvre seule. */
        await aller('');
        await changer('macSecours');
        const fenetre = page.locator(`[data-suivi-de-connect="${MAC}"]`);
        await fenetre.waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} sur l’ordinateur qu’on installe, la fenêtre de connexion s’ouvre seule, étapes et code compris`,
          (await fenetre.count()) === 1 && (await fenetre.locator('[data-code-de-secours]').count()) === 1 && /Mac mini de Chris/.test((await fenetre.textContent()) ?? ''),
        );
        await page.screenshot({ path: nom('fenetre-de-connexion-seule') });
        await changer('macPret');
        await fenetre.waitFor({ state: 'detached', timeout: 9_000 }).catch(() => undefined);
        noter(`${T} tout est prêt : la fenêtre se referme seule`, (await fenetre.count()) === 0);
        noter(`${T} liaison suivie : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
        await ctx.close();
      }
      {
        /* Un AUTRE appareil (aucune marque) : jamais de fenêtre ; une réparation s'annonce par un message d'information. */
        const { ctx, page, erreurs, changer, aller, nom } = await ouvrir(largeur, theme, 'mac');
        await aller('');
        await changer('macSecours');
        await page.waitForTimeout(1_500);
        noter(`${T} un autre appareil : aucune fenêtre ne s’ouvre`, (await page.locator('[data-suivi-de-connect]').count()) === 0);
        await changer('macReparation');
        const message = page.getByText('Beluga Connect répare Chrome sur « Mac mini de Chris »…');
        await message.first().waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(`${T} réparation : un message d’information dit ce qui se fait et où`, (await message.count()) >= 1);
        await page.screenshot({ path: nom('message-reparation') });
        await changer('macRepare');
        const fin = page.getByText('Beluga Connect a terminé sur « Mac mini de Chris » : Chrome est prêt.');
        await fin.first().waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(`${T} réparation finie : un message le dit`, (await fin.count()) >= 1);
        noter(`${T} messages : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
        await ctx.close();
      }

      // --- WINDOWS : fichier personnalisé, ligne SmartScreen, secours au bon chemin ---------------------------
      {
        const { ctx, page, erreurs, telechargements, changer, aller, nom } = await ouvrir(largeur, theme, 'windows');
        await aller('#reglages/ordinateurs');
        await page.locator('[data-lier-cet-ordinateur]').click();
        await page.locator('[data-parcours-connexion="installation"]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(600);
        /* Le téléchargement part après la réponse du code : on lui laisse jusqu'à cinq secondes pour se montrer. */
        for (let i = 0; i < 25 && !telechargements.length; i++) await page.waitForTimeout(200);
        noter(
          `${T} Windows : le fichier porte le code, la marche à suivre dit SmartScreen, deux volets`,
          telechargements.some((u) => /\/api\/connect\/Beluga-Connect-Windows\.exe\?code=731205&base=/.test(u)) &&
            /Exécuter quand même/.test((await page.locator('[data-etapes-installation="windows"]').textContent().catch(() => '')) ?? '') &&
            /Ajouter ce PC/.test((await page.locator('[data-titre-parcours]').textContent().catch(() => '')) ?? '') &&
            (await page.locator('[data-etape-connexion]').count()) === 2,
          telechargements.join(' '),
        );
        await page.screenshot({ path: nom('windows-ouvrir') });
        await changer('winRelie');
        await page.locator('[data-assistant-secours]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(
          `${T} Windows : relié, aucune autorisation, le secours montre le dossier Windows`,
          (await etape(page, 'installation')) === 'faite' &&
            (await page.locator('[data-etape-connexion="mac"]').count()) === 0 &&
            /AppData\\Local\\Beluga\\extension-chrome/.test((await page.locator('[data-assistant-secours]').textContent().catch(() => '')) ?? ''),
        );
        await page.screenshot({ path: nom('windows-secours') });
        await changer('winPret');
        await page.locator('[data-assistant-tout-pret]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(`${T} Windows : Chrome prêt sans navigation privée exigée, tout est prêt`, (await page.locator('[data-etape-connexion][data-etat="faite"]').count()) === 3, 'Installation, Navigateurs, Chrome');
        noter(`${T} Windows : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
        await ctx.close();
      }

      // --- LINUX : la commande à coller ------------------------------------------------------------------------
      {
        const { ctx, page, erreurs, telechargements, aller, nom } = await ouvrir(largeur, theme, 'linux');
        await aller('#reglages/navigateur');
        await page.locator('[data-lier-cet-ordinateur]').click();
        await page.locator('[data-commande-linux]').waitFor({ timeout: 10_000 }).catch(() => undefined);
        const commande = (await page.locator('[data-commande-linux]').textContent().catch(() => '')) ?? '';
        noter(
          `${T} Linux : aucune archive, une commande « curl … | sh » qui porte le code`,
          telechargements.length === 0 && /^curl -fsSL '.*\/api\/connect\/installer-linux\.sh\?code=731205&base=.*' \| sh$/.test(commande),
          commande,
        );
        const deborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        noter(`${T} Linux : la commande ne déborde pas`, deborde <= 0, String(deborde));
        await page.screenshot({ path: nom('linux-commande') });
        noter(`${T} Linux : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
        await ctx.close();
      }

      // --- DÉJÀ RELIÉ : l'extension annonce ce navigateur, rien ne se retélécharge -----------------------------
      {
        const { ctx, page, erreurs, telechargements, scene, aller, nom } = await ouvrir(largeur, theme, 'mac');
        scene.etat = 'macPret';
        await page.addInitScript(() => {
          document.addEventListener('DOMContentLoaded', () => {
            document.documentElement.dataset.belugaNavigateur = 'cEssai';
            document.documentElement.dataset.belugaExtension = '1.0.15';
          });
        });
        await aller('#reglages/ordinateurs');
        await page.locator('[data-cet-ordinateur]').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
        noter(`${T} déjà relié : la ligne porte « Cet ordinateur »`, (await page.locator(`[data-ordinateur="${MAC}"] [data-cet-ordinateur]`).count()) === 1);
        await page.waitForTimeout(600);
        noter(
          `${T} déjà relié : aucune ligne « Ajouter cet ordinateur », rien téléchargé, aucun code`,
          (await page.locator('[data-ajouter-cet-ordinateur]').count()) === 0 && (await page.locator('[data-lier-cet-ordinateur]').count()) === 0 && telechargements.length === 0 && scene.codes === 0,
        );
        await page.screenshot({ path: nom('deja-relie') });
        noter(`${T} déjà relié : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
        await ctx.close();
      }
    }
  }
} finally {
  db.prepare('DELETE FROM sessions WHERE label = ?').run('essai assistant ordinateur');
  db.close();
  await navigateur.close();
}
console.log(`\n${total - echecs}/${total} contrôles verts — captures dans ${CAPTURES}`);
process.exit(echecs ? 1 : 0);
