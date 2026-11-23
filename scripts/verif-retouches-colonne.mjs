#!/usr/bin/env node
/**
 * LES RETOUCHES DE LA COLONNE DE GAUCHE, DANS UN VRAI NAVIGATEUR.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-retouches-colonne.mjs
 *
 * Démon jetable, base neuve, aucun quota dépensé. On juge : l'indicateur de chargement
 * sans silhouette, le repère de l'élément ouvert, le menu dossier, la recherche sur
 * place (qui n'écrit rien), le flux des tâches, les outils de ligne animés, le panneau
 * des LLM (quotas injectés dans le canal), l'interrupteur, le menu replié, le point
 * entier et le fil d'Ariane, sur ordinateur puis sur téléphone.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7233);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = path.join(RACINE, 'data/verification');
fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-retouches-colonne-', port: PORT });
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const H = 3600_000;

function projet(db, id, name, rank, extra = {}) {
  const p = { id, name, path: `${DEPOT}-${id}`, defaultEngine: 'claude', isSelf: false, rank, archived: false, createdAt: MAINTENANT, updatedAt: MAINTENANT, ...extra };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, name, p.path, JSON.stringify(p), MAINTENANT, MAINTENANT);
}
function carte(db, id, projectId, column, title, date, extra = {}) {
  const c = { id, projectId, title, description: '', labels: [], column, position: date, origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' }, excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt: date - H, updatedAt: date, ...extra };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, projectId, column, date, title, JSON.stringify(c), null, c.createdAt, date);
}
function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + H, 'vérification colonne');
  db.prepare('DELETE FROM projects').run();
  const groupes = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_groups'").get();
  void groupes;
  projet(db, 'p-alpha', 'Alpha', 1);
  projet(db, 'p-beta', 'Beta', 2);
  projet(db, 'p-long', 'Long', 3);
  carte(db, 'c-beta', 'p-beta', 'planned', 'Demande du projet Beta', MAINTENANT - H);
  carte(db, 'c-alpha', 'p-alpha', 'planned', 'Une tâche d’Alpha', MAINTENANT - 2 * H);
  for (let i = 0; i < 12; i += 1) {
    carte(db, `c-long-${String(i).padStart(2, '0')}`, 'p-long', i % 2 ? 'archived' : 'planned', `Ancienne ${i}`, MAINTENANT - (10 + i) * H, i % 2 ? { archivedAt: MAINTENANT - (10 + i) * H } : {});
  }
  carte(db, 'c-archive-perdue', 'p-beta', 'archived', 'Facture retrouvable', MAINTENANT - 500 * H, { archivedAt: MAINTENANT - 500 * H });
  /* Une question très ancienne : hors des cinq, elle doit rester visible. */
  carte(db, 'c-question', 'p-long', 'running', 'Question très ancienne', MAINTENANT - 900 * H);
  const a = { id: 'ag-q', projectId: 'p-long', cardId: 'c-question', role: 'task', title: 'Agent', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'running', attendReponse: true, tourVivantDepuis: MAINTENANT - 60_000, startedAt: MAINTENANT, createdAt: MAINTENANT, updatedAt: MAINTENANT };
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(a.id, a.projectId, a.cardId, a.role, a.status, JSON.stringify(a), a.createdAt, a.updatedAt);
  db.close();
}
const prefs = () => {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const lignes = db.prepare('SELECT * FROM preferences').all();
  db.close();
  return JSON.stringify(lignes.filter((l) => /sidebar|collapsed|Deplies/.test(JSON.stringify(l))));
};

const QUOTAS = [
  { id: 'q1', engine: 'claude', label: 'Compte Claude', priority: 1, active: true, available: true, session: { usedPct: 30 }, weekly: { usedPct: 40 } },
  { id: 'q2', engine: 'claude', label: 'Compte Coupé', priority: 2, active: false, available: true, disabled: true, session: { usedPct: 10 }, weekly: { usedPct: 15 } },
];
const HISTOIRE = {
  q1: [0, 1, 2, 3].map((i) => ({ at: MAINTENANT - (3 - i) * 24 * H, weekly: 10 + i * 10, session: 5 + i * 8 })),
  q2: [0, 1, 2, 3].map((i) => ({ at: MAINTENANT - (3 - i) * 24 * H, weekly: 5 + i * 3, session: 2 + i * 2 })),
};
/** Le canal, tel quel, plus des quotas et un message en attente injectés côté écran. */
async function canalAvecQuotas(page) {
  await page.routeWebSocket(/\/ws/, (ws) => {
    const serveur = ws.connectToServer();
    ws.onMessage((brut) => {
      const envelope = JSON.parse(String(brut));
      if (envelope.cmd?.type === 'quota.history') {
        ws.send(JSON.stringify({ type: 'ack', id: envelope.id, ok: true, data: { history: HISTOIRE, resume: {} } }));
        return;
      }
      serveur.send(brut);
    });
    serveur.onMessage((brut) => {
      ws.send(brut);
      if (String(brut).includes('"type":"hello"') || String(brut).includes('"type":"init"')) injecter(ws);
    });
    const injecter = (cible) => {
      cible.send(JSON.stringify({ type: 'quotas', quotas: QUOTAS }));
      cible.send(JSON.stringify({ type: 'espace.compteurs', nonLu: 2, aTraiter: 0 }));
    };
    setTimeout(() => injecter(ws), 3000);
    setTimeout(() => injecter(ws), 6000);
  });
}

const aside = 'aside[data-zone="gauche"] ';
const lignesVisibles = (page) =>
  page.locator(`${aside}[data-projet-cible]:visible, ${aside}[data-agent-en-liste]:visible, ${aside}[data-groupe-projets]:visible`).evaluateAll((els) => els.map((el) => el.getAttribute('data-projet-cible') ?? el.getAttribute('data-agent-en-liste') ?? el.getAttribute('data-groupe-projets')));
const rvb = (couleur) => (couleur.match(/[\d.]+/g) ?? []).map(Number);
const lum = ([r, g, b]) => { const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    await canalAvecQuotas(page);
    /* Tout ce qui passe par la colonne pendant le chargement est noté. */
    await page.addInitScript(() => {
      window.__vus = { silhouette: 0, indicateur: 0 };
      new MutationObserver(() => {
        const zone = document.querySelector('aside[data-zone="gauche"]');
        if (!zone) return;
        if (zone.querySelector('.animate-silhouette, [data-silhouette], [data-silhouette-taches]')) window.__vus.silhouette += 1;
        if (zone.querySelector('[data-chargement-projets], [data-chargement-taches]')) window.__vus.indicateur += 1;
      }).observe(document, { subtree: true, childList: true });
    });
    await page.goto(`${BASE}/#en-route`);
    await page.locator(`${aside}[data-drag-id="p-long"]`).waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1000);

    /* --- 1. Haut de colonne --- */
    noter('1. plus de libellé « Projets » ni de rangée d’ajout', (await page.locator(`${aside}.group\\/section`).count()) === 0 && !(await page.locator(`${aside}[data-drop-root]`).innerText()).split('\n').includes('Projets'));
    const tete = await page.evaluate(() => {
      const b = (s) => document.querySelector(`aside[data-zone="gauche"] ${s}`).getBoundingClientRect();
      return { fichiers: b('[data-rangee-de-boutons] [data-ligne-fichiers]').right, dossier: b('[data-menu-dossier]').left, repli: b('[data-replier-colonne="depliee"]').left, nouvelAgent: b('[data-ligne-nouvel-agent]').bottom, enCours: document.querySelector('aside[data-zone="gauche"] [data-taches-en-cours-colonne]')?.getBoundingClientRect().bottom ?? null, liste: Math.min(...[...document.querySelectorAll('aside[data-zone="gauche"] [data-drop-root] [data-projet-cible], aside[data-zone="gauche"] [data-drop-root] [data-groupe-projets]')].map((el) => el.getBoundingClientRect().top)) };
    });
    /* Depuis le 06/11/2026 : la loupe a disparu (recherche centrale, ⌘F), « Fichiers » est une icône de la tête. */
    noter('1. dans l’ordre : fichiers, dossier, repli ; plus de loupe', tete.fichiers <= tete.dossier && tete.dossier < tete.repli && (await page.locator(`${aside}[data-chercher-projet]`).count()) === 0, JSON.stringify(tete));
    /* Depuis le 01/11/2026, la zone « En cours » s'intercale : la liste remonte sous elle, sinon sous « Nouvel agent ». */
    const dessus = tete.enCours ?? tete.nouvelAgent;
    noter('1. la zone « En cours » suit « Nouvel agent », puis la liste', (tete.enCours === null || tete.enCours > tete.nouvelAgent) && tete.liste - dessus <= 12, `${tete.liste - dessus} px`);
    await page.locator(`${aside}[data-menu-dossier]`).click();
    const menuDossier = page.locator('[data-menu-dossier-panneau]');
    await menuDossier.waitFor({ state: 'visible', timeout: 5000 });
    noter('1. le menu dossier propose « Nouveau projet » et « Nouveau dossier »', (await menuDossier.locator('[data-ouvrir-projets]').innerText()).includes('Nouveau projet') && (await menuDossier.locator('[data-nouveau-groupe]').innerText()).includes('Nouveau dossier'));
    await page.screenshot({ path: path.join(CAPTURES, 'colonne-menu-dossier.png') });
    await menuDossier.locator('[data-nouveau-groupe]').click();
    const nomDossier = page.getByPlaceholder('Nom du dossier');
    await nomDossier.waitFor({ state: 'visible', timeout: 5000 });
    await nomDossier.fill('Clients essai');
    await nomDossier.press('Enter');
    const dossierCree = await page.locator(`${aside}[data-groupe-projets]`, { hasText: 'Clients essai' }).waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    noter('1. « Nouveau dossier » crée le dossier dans la liste', dossierCree);

    /* --- 2. La recherche : plus dans la colonne, au CENTRE de l'écran (⌘F / Ctrl+F, 06/11/2026) --- */
    const avant = await lignesVisibles(page);
    const prefsAvant = prefs();
    await page.keyboard.press('Control+f');
    const champ = page.locator('[data-champ-recherche-centrale]');
    noter('2. Ctrl+F ouvre la recherche au centre, prête à écrire', await champ.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false));
    await champ.fill('beta');
    await page.waitForTimeout(500);
    noter('2. un nom de projet se retrouve', (await page.locator('[data-resultat-recherche="projet"]', { hasText: 'beta' }).count()) >= 1);
    await champ.fill('facture retrouvable');
    noter('2. une tâche archivée se retrouve', await page.locator('[data-resultat-recherche="tache"]').first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false));
    await page.screenshot({ path: path.join(CAPTURES, 'colonne-recherche.png') });
    await champ.fill('zzzz introuvable');
    noter('2. rien de trouvé : un message court', await page.locator('[data-recherche-centrale-vide]').waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false));
    await champ.press('Escape');
    await page.waitForTimeout(400);
    noter('2. Échap ferme la fenêtre', (await champ.count()) === 0);
    const apres = await lignesVisibles(page);
    noter('2. la colonne reste à l’identique', JSON.stringify(apres) === JSON.stringify(avant), `${apres.length} lignes`);
    noter('2. la recherche n’a rien écrit dans les préférences', prefs() === prefsAvant);

    /* --- 3. Le flux --- */
    const blocLong = `${aside}[data-taches-du-projet="p-long"] `;
    await page.locator(`${aside}[data-deplier-taches="p-long"]`).click();
    await page.locator(`${blocLong}[data-agent-en-liste]`).nth(5).waitFor({ state: 'visible', timeout: 8000 });
    const flux = await page.locator(`${blocLong}[data-agent-en-liste]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-agent-en-liste')));
    /* DEPUIS LE 01/11/2026 (capture #ca0c), les ACTIVES montent au-dessus du trait, toutes gardées, à leur rang de
       date ; sous le trait, les rangées des cinq premières par date. Les paires sont actives, les impaires rangées. */
    noter(
      '3. les actives d’abord (celle qui attend comprise), puis les rangées des cinq premières',
      flux.join(',') === 'c-long-00,c-long-02,c-long-04,c-long-06,c-long-08,c-long-10,c-question,c-long-01,c-long-03',
      flux.join(','),
    );
    noter('3. aucun « Voir les archives »', (await page.locator(`${aside}[data-voir-archives], ${aside}[data-archives-de-plus]`).count()) === 0);
    await page.locator(`${blocLong}[data-voir-plus]`).click();
    await page.locator(`${blocLong}[data-agent-en-liste]`).nth(10).waitFor({ state: 'visible', timeout: 8000 });
    /* Dix par date : les rangées 01 à 09 sous le trait, avec les sept actives au-dessus. */
    noter('3. « Voir plus » en ajoute cinq', (await page.locator(`${blocLong}[data-agent-en-liste]`).count()) === 12, String(await page.locator(`${blocLong}[data-agent-en-liste]`).count()));
    await page.locator(`${blocLong}[data-voir-plus]`).click();
    await page.waitForTimeout(800);
    noter('3. tout est lu : plus de « Voir plus »', (await page.locator(`${blocLong}[data-voir-plus]`).count()) === 0 && (await page.locator(`${blocLong}[data-agent-en-liste]`).count()) === 13, String(await page.locator(`${blocLong}[data-agent-en-liste]`).count()));
    const vus = await page.evaluate(() => window.__vus);
    noter('3. aucune silhouette dans la colonne, à aucun moment', vus.silhouette === 0, JSON.stringify(vus));
    noter('3. un indicateur a dit le chargement', vus.indicateur > 0, JSON.stringify(vus));

    /* --- 4. Le repère et les outils --- */
    await page.locator(`${aside}[data-drag-id="p-alpha"] :is(a, button)`).first().click();
    await page.waitForTimeout(800);
    const ligneAlpha = page.locator(`${aside}[data-drag-id="p-alpha"]`);
    await page.mouse.move(800, 500);
    await page.waitForTimeout(250);
    /* Depuis le 31/10/2026, le nom du projet ouvre son dernier agent : le repère
       passe alors sur la ligne de cet agent, visible dessous. */
    /* Depuis le 16/11/2026 (capture #b166), la ligne ouverte ne porte PLUS AUCUN POINT devant elle. */
    const etatAlpha = await ligneAlpha.evaluate((el) => {
      const points = [...document.querySelectorAll('aside[data-zone="gauche"] span')].filter((s) => {
        const r = s.getBoundingClientRect();
        const c = getComputedStyle(s);
        return r.width > 0 && r.width <= 8 && Math.abs(r.width - r.height) < 1 && c.borderRadius !== '0px' && c.position === 'absolute' && !/rgba\(0, 0, 0, 0\)/.test(c.backgroundColor) && !s.closest('[data-repere-robot], [data-repere-publication], [data-repere-rendus]');
      });
      return { fond: getComputedStyle(el).backgroundColor, couleur: getComputedStyle(el).color, ancienRepere: document.querySelectorAll('[data-repere-demi-rond]').length, pointsSuspects: points.length };
    });
    noter('4. la ligne ouverte n’a aucun fond', /rgba\(0, 0, 0, 0\)|transparent/.test(etatAlpha.fond), etatAlpha.fond);
    noter('4. aucun point devant la ligne ouverte', etatAlpha.ancienRepere === 0, JSON.stringify(etatAlpha));
    const ligneBeta = page.locator(`${aside}[data-drag-id="p-beta"]`);
    const outils = ligneBeta.locator('[data-outils-de-ligne]');
    const mesureOutils = () => outils.evaluate((el) => {
      const chevron = el.parentElement.querySelector('[data-deplier-taches]').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { largeur: Math.round(r.width), ecart: Math.round(chevron.left - r.right) };
    });
    const repos = await mesureOutils();
    noter('4. au repos, les outils ne prennent aucune place', repos.largeur === 0 && repos.ecart === 0, JSON.stringify(repos));
    await ligneBeta.hover();
    await page.waitForTimeout(50);
    const enRoute = await mesureOutils();
    await page.waitForTimeout(250);
    const ouverts = await mesureOutils();
    noter('4. au survol, ils s’ouvrent en glissant', enRoute.largeur >= 0 && enRoute.largeur < ouverts.largeur && ouverts.largeur >= 50, JSON.stringify({ enRoute, ouverts }));
    const survol = await ligneBeta.evaluate((el) => getComputedStyle(el).backgroundColor);
    noter('4. le fond gris de survol reste', !/rgba\(0, 0, 0, 0\)/.test(survol), survol);
    await page.screenshot({ path: path.join(CAPTURES, 'colonne-survol.png'), clip: { x: 0, y: 0, width: 340, height: 900 } });
    /* Le glisser part de la poignée et survit à la sortie de la ligne. */
    const poignee = await ligneBeta.locator('[data-poignee-projet]').boundingBox();
    const cible = await page.locator(`${aside}[data-drag-id="p-alpha"]`).boundingBox();
    await page.mouse.move(poignee.x + 8, poignee.y + 8);
    await page.mouse.down();
    await page.mouse.move(poignee.x + 8, cible.y + 4, { steps: 8 });
    await page.waitForTimeout(250);
    await page.mouse.up();
    await page.waitForTimeout(600);
    const ordre = (await lignesVisibles(page)).filter((id) => id === 'p-alpha' || id === 'p-beta');
    noter('4. la poignée range toujours un projet', ordre.join(',') === 'p-beta,p-alpha', ordre.join(','));
    /* Au clavier, l'outil se révèle quand le focus l'atteint. */
    await ligneBeta.locator('[data-reglages-projet]').focus();
    await page.mouse.move(800, 500);
    await page.waitForTimeout(250);
    noter('4. au clavier, le focus ouvre les outils', (await mesureOutils()).largeur > 0);
    await page.evaluate(() => document.activeElement?.blur());

    /* --- 5. Le fil d'Ariane --- */
    /* Depuis le 06/11/2026, le fil s'ouvre sur la GRILLE DES SERVICES (le mot « Tableaux de bord » l'a quitté). */
    const fil = await page.locator('[data-entete-de-zone]').first().innerText();
    const grilleEnTete = await page.evaluate(() => {
      const f = document.querySelector('[data-entete-de-zone] [data-fil-d-ariane]');
      return [...(f?.children ?? [])].find((n) => n.getClientRects().length > 0)?.matches('[data-cran-grille]') ?? false;
    });
    noter('5. le fil d’Ariane d’un projet s’ouvre sur la grille des services', grilleEnTete && !fil.startsWith('Tableaux de bord'), fil.replace(/\n/g, ' / '));
    await page.locator(`${aside}[data-agent-en-liste="c-alpha"] :is(a, button)`).first().click();
    await page.locator('[data-page-carte="c-alpha"]').waitFor({ state: 'visible', timeout: 15000 });
    const filCarte = await page.locator('[data-page-carte="c-alpha"] [data-fil-d-ariane]').first().innerText();
    const grilleCarte = await page.locator('[data-page-carte="c-alpha"] [data-fil-d-ariane] [data-cran-grille]').count();
    noter('5. et celui d’une tâche aussi, avant son projet', grilleCarte === 1 && filCarte.includes('Alpha'), filCarte.replace(/\n/g, ' / '));
    await page.mouse.move(800, 500);
    await page.waitForTimeout(250);
    const ouverte = await page.locator(`${aside}[data-agent-en-liste="c-alpha"]`).evaluate((el) => {
      const b = el.querySelector('button');
      return { fond: getComputedStyle(b).backgroundColor, point: !!el.querySelector('[data-repere-demi-rond]') };
    });
    noter('5. aucun point dans toute la colonne', (await page.locator('[data-repere-demi-rond]').count()) === 0);
    noter('5. la tâche ouverte : sans point', !ouverte.point, JSON.stringify(ouverte));

    /* --- 6. Le panneau des LLM --- */
    await page.locator('[data-essai="badge-quota"]').first().click();
    const carte1 = page.locator('[data-carte-quota="q1"]');
    await carte1.waitFor({ state: 'visible', timeout: 8000 });
    await page.mouse.move(800, 100);
    await page.waitForTimeout(400);
    const hauteurDetail = (id) => page.locator(`[data-detail-du-compte="${id}"]`).evaluate((el) => Math.round(el.getBoundingClientRect().height));
    noter('6. graphiques cachés au repos', (await hauteurDetail('q1')) === 0 && (await hauteurDetail('q2')) === 0);
    await page.screenshot({ path: path.join(CAPTURES, 'colonne-llm-repos.png') });
    await carte1.hover();
    await page.waitForTimeout(400);
    const h1 = await hauteurDetail('q1');
    noter('6. le survol d’un compte montre son graphique, et lui seul', h1 >= 30 && (await hauteurDetail('q2')) === 0, `${h1} px`);
    noter('6. le menu reste ouvert et la carte survolée', (await carte1.isVisible()) && (await carte1.evaluate((el) => el.matches(':hover'))));
    const trait = await page.locator('[data-detail-du-compte="q1"] svg path').last().evaluate((el) => getComputedStyle(el).stroke);
    const [tr, tg, tb] = rvb(trait);
    noter('6. la courbe est violette', tb > tg && tr > tg, trait);
    await page.screenshot({ path: path.join(CAPTURES, 'colonne-llm-survol.png') });
    const interrupteurs = await page.evaluate(() => {
      const mesurer = (id) => {
        const el = document.querySelector(`[data-interrupteur-compte="${id}"]`);
        const carte = el.closest('[data-carte-quota]');
        return { fond: getComputedStyle(el).backgroundColor, rond: getComputedStyle(el.firstElementChild).backgroundColor, carte: getComputedStyle(carte).backgroundColor, etat: el.getAttribute('data-state') };
      };
      return { allume: mesurer('q1'), eteint: mesurer('q2') };
    });
    const pleine = (s) => rvb(s).slice(0, 3);
    noter('6. l’interrupteur allumé a un fond franc', contraste(pleine(interrupteurs.allume.fond), pleine(interrupteurs.allume.carte)) > 3, JSON.stringify(interrupteurs.allume));
    noter('6. l’interrupteur éteint se voit', !/rgba\(0, 0, 0, 0\)/.test(interrupteurs.eteint.fond), JSON.stringify(interrupteurs.eteint));
    await page.keyboard.press('Escape');

    /* --- 7. Le menu replié --- */
    await page.locator(`${aside}[data-replier-colonne="depliee"]`).click();
    await page.mouse.move(900, 500);
    await page.waitForTimeout(700);
    /* « Tableaux de bord » a quitté la colonne (carte « Lecteur de charte : commentaires et barre ») : restent
       « Nouvel agent » (violet) et l'icône des fichiers. */
    const boutons = await page.evaluate(() => ['[data-ligne-nouvel-agent]', '[data-ligne-fichiers]'].map((s) => {
      const r = document.querySelector(`aside[data-zone="gauche"] ${s}`).getBoundingClientRect();
      return { l: Math.round(r.width), h: Math.round(r.height), centre: Math.round(r.left + r.width / 2), rayon: getComputedStyle(document.querySelector(`aside[data-zone="gauche"] ${s}`)).borderTopLeftRadius };
    }));
    const pareils = boutons.every((b) => b.l === boutons[0].l && b.h === boutons[0].h && b.centre === boutons[0].centre && b.rayon === boutons[0].rayon);
    noter('7. replié : les boutons de la tête ont la même taille, sur le même axe', pareils && boutons[0].h >= 36, JSON.stringify(boutons));
    const point = await page.evaluate(() => {
      const el = document.querySelector('aside[data-zone="gauche"] [data-alerte-navigation]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const zone = el.closest('[data-drop-root]').getBoundingClientRect();
      const bouton = el.closest('button').getBoundingClientRect();
      return { dansLaZone: r.top >= zone.top && r.right <= zone.right, dansLeBouton: r.top >= bouton.top && r.right <= bouton.right };
    });
    noter('7. le point est entier, dans son bouton', !!point && point.dansLaZone && point.dansLeBouton, JSON.stringify(point));
    noter('7. « Tableaux de bord » n’est plus dans la colonne', (await page.locator(`${aside}[data-ligne-tableau-de-bord]`).count()) === 0);
    noter('7. « Nouvel agent » est violet', (await page.locator(`${aside}[data-ligne-nouvel-agent][data-bouton-violet]`).count()) === 1);
    await page.screenshot({ path: path.join(CAPTURES, 'colonne-repliee.png'), clip: { x: 0, y: 0, width: 200, height: 500 } });
    await contexte.close();

    /* --- 8. Le téléphone --- */
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-CH', serviceWorkers: 'block' });
    await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const mobile = await tel.newPage();
    await canalAvecQuotas(mobile);
    await mobile.goto(`${BASE}/#projet/p-alpha`);
    const boutonMenu = mobile.locator('[data-ouvrir-colonne], [data-ouvrir-menu-principal], [data-menu-principal]').first();
    await boutonMenu.waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
    await mobile.waitForTimeout(1500);
    const filTel = await mobile.locator('[data-entete-de-zone]:visible').first().innerText().catch(() => '');
    noter('8. téléphone : pas de « Tableaux de bord » dans la barre', !filTel.includes('Tableaux de bord'), filTel.replace(/\n/g, ' / '));
    await mobile.locator('[data-agent-en-liste="c-alpha"] :is(a, button):visible').first().tap().catch(() => undefined);
    const carteOuverte = await mobile.locator('[data-page-carte="c-alpha"]').waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    if (carteOuverte) {
      /* 06/11/2026 : l'icône du projet est dans l'angle du ☰ ; Échap remonte d'une tâche à son projet. */
      await mobile.keyboard.press('Escape');
      noter('8. téléphone : refermer une tâche remonte à son projet', await mobile.locator('[data-page-carte="c-alpha"]').waitFor({ state: 'detached', timeout: 8000 }).then(() => true, () => false));
    } else {
      noter('8. téléphone : la tâche s’ouvre depuis la page du projet', false);
    }
    await tel.close();

    /* --- 9. Les silhouettes des autres écrans : les réponses du démon sont retenues,
       chaque écran montre donc son attente. Aucune ne doit déborder de la page. --- */
    for (const [nom, viewport, options] of [
      ['ordinateur', { width: 1440, height: 900 }, {}],
      ['telephone', { width: 390, height: 844 }, { deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
    ]) {
      const ctx = await navigateur.newContext({ viewport, locale: 'fr-CH', serviceWorkers: 'block', ...options });
      await ctx.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const p = await ctx.newPage();
      let retenir = false;
      const retenus = [];
      await p.routeWebSocket(/\/ws/, (ws) => {
        const serveur = ws.connectToServer();
        ws.onMessage((brut) => serveur.send(brut));
        serveur.onMessage((brut) => {
          if (retenir && String(brut).includes('"type":"ack"')) retenus.push(() => ws.send(brut));
          else ws.send(brut);
        });
      });
      for (const [ecran, zone] of [
        ['en-route', 'agents'],
        ['coffre', 'coffre'],
        ['surveillance', 'surveillance'],
        ['statistiques', 'statistiques'],
        ['marketing', 'marketing'],
        ['notes', 'notes'],
        ['taches-recurrentes', 'taches-recurrentes'],
      ]) {
        retenir = true;
        await p.goto(`${BASE}/#${ecran}`).catch(() => undefined);
        await p.reload();
        const vue = await p.locator(`[data-silhouette="${zone}"]`).first().waitFor({ state: 'visible', timeout: 12000 }).then(() => true, () => false);
        const deborde = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        noter(`9. ${nom} : ${ecran} montre sa silhouette, sans déborder`, vue && !deborde, vue ? '' : 'non vue');
        await p.screenshot({ path: path.join(CAPTURES, `silhouette-${nom}-${ecran}.png`) });
        retenir = false;
        retenus.splice(0).forEach((envoyer) => envoyer());
        await p.waitForTimeout(600);
      }
      await ctx.close();
    }
  } finally {
    await navigateur.close();
  }
  const passes = resultats.filter((r) => r.ok).length;
  console.log(`\n${passes}/${resultats.length} vérifications passent.`);
  process.exitCode = passes === resultats.length ? 0 : 1;
}

principal()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
