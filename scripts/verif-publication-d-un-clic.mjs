#!/usr/bin/env node
/**
 * « DÉPLOYER » ET « MISE EN PRODUCTION » D'UN CLIC (22/10/2026), dans un VRAI
 * navigateur — « on clique sur Déployer, on s'attend à ce que ça déploie, pas
 * à ouvrir un volet puis un autre » :
 *
 *  1. sans procédure, le bouton « Déployer » de la barre du haut ouvre la
 *     conversation de l'agent de configuration et lance UN seul tour
 *     (`procedure.tour`, retenu ici avant de partir), sans fenêtre de
 *     réglages ; même chose pour « Mise en production » (allumée) ;
 *  2. éteinte et sans procédure, la mise en production ne lance rien : son
 *     volet s'ouvre sur l'interrupteur ;
 *  3. l'agent attend une réponse : les deux boutons le disent
 *     (`data-etat-bouton-agent="question"`) et rouvrent sa conversation sans
 *     relancer de tour ; au travail (point d'essai du serveur de
 *     développement), la roue tourne et le clic fait de même ;
 *  4. procédure en place : « Mise en production » ouvre DIRECTEMENT la
 *     confirmation (version en ligne, lien vers le détail), sans volet ; rien
 *     ne part avant « Mettre à jour » ; la flèche accolée et « Voir le
 *     détail » ouvrent le volet ;
 *  5. téléphone : les lignes du menu à trois points suivent les mêmes règles ;
 *  6. aucune erreur JavaScript.
 *
 * Démon et base d'ESSAI à soi (`BELUGA_UNCLIC_PORT`), plafond d'agents à zéro.
 * L'écran peut être servi par le serveur de développement (`HAIKO_UNCLIC_URL`,
 * branché sur ce démon par `BELUGA_DEMON_PORT`) : c'est lui seul qui porte le
 * point d'essai pour l'état « au travail ».
 *
 *   node scripts/verif-publication-d-un-clic.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_UNCLIC_PORT || 7231);
const BASE = process.env.HAIKO_UNCLIC_URL || `http://127.0.0.1:${PORT}`;
const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-publication-d-un-clic-',
  port: PORT,
});

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${String(detail).slice(0, 200)}` : ''}`);
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-unclic';
const AGENT_DEV = 'a-config-dev';
const AGENT_PROD = 'a-config-prod';
const PROCESSUS = {
  resume: 'Le site part chez l’hébergeur.',
  etapes: [{ libelle: 'Envoyer', commande: 'true', delaiS: 5 }],
};

function base(fn) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function poserProjet({ deploiement = {}, miseEnProduction = {}, active = true } = {}) {
  base((db) => {
    const t = Date.now();
    const projet = {
      id: PROJET_ID,
      name: 'Essai un clic',
      path: DEPOT,
      defaultEngine: 'claude',
      isSelf: false,
      rank: 1,
      archived: false,
      deploiement,
      miseEnProduction,
      miseEnProductionActive: active,
      createdAt: t,
      updatedAt: t,
    };
    db.prepare('DELETE FROM projects').run();
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);
  });
}

function poserAgent(id, titre, etat) {
  base((db) => {
    const t = Date.now();
    const agent = {
      id, projectId: PROJET_ID, role: 'deploy', title: titre,
      run: { engine: 'claude', thinking: 'none' }, createdAt: t, updatedAt: t, ...etat,
    };
    db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    db.prepare(
      `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
       VALUES (?, ?, NULL, 'deploy', ?, ?, ?, ?)`,
    ).run(id, PROJET_ID, agent.status, JSON.stringify(agent), t, t);
    db.prepare('DELETE FROM messages WHERE agent_id = ?').run(id);
    const message = {
      id: `m-${id}`, agentId: id, role: 'assistant', content: 'Où faut-il mettre le site en ligne ?', steps: [], todos: [],
      proposals: [], questions: [], downloads: [], attachments: [], streaming: false, createdAt: t,
    };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      message.id, id, 'assistant', JSON.stringify(message), t,
    );
  });
}

function poserDecor() {
  base((db) => {
    const t = Date.now();
    db.prepare('DELETE FROM sessions').run();
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
      sha(jeton), t, t + 3_600_000, 'vérification de la publication d’un clic',
    );
    const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  });
}

async function ouvrir(navigateur, { telephone = false } = {}) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.addInitScript(() => {
    /* Les tours d'agent et les mises en ligne sont RETENUS avant de partir, et notés. */
    window.__envoyes = [];
    const envoyer = WebSocket.prototype.send;
    WebSocket.prototype.send = function (donnees) {
      const texte = String(donnees);
      try {
        window.__envoyes.push(JSON.parse(texte));
      } catch {
        /* battement */
      }
      if (texte.includes('"procedure.tour"') || texte.includes('"deploy.start"')) return;
      return envoyer.call(this, donnees);
    };
  });
  await page.goto(`${BASE}/#projet/${PROJET_ID}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4_000);
  const onglet = page.getByRole('button', { name: /^Tableau$/ });
  if (await onglet.count()) {
    await onglet.first().click();
    await page.waitForTimeout(1_500);
  }
  await page.waitForSelector('[data-bandeau-production]', { state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(800);
  return { contexte, page, erreurs };
}

const envoyes = (page, type) =>
  page.evaluate((type) => window.__envoyes.filter((m) => m?.cmd?.type === type || m?.type === type), type);
const cibleDe = (m) => m?.cmd?.cible ?? m?.cible;

async function fermerTiroirs(page) {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('[data-tiroir-agent-configuration], [role="dialog"]').count())) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

async function ouvrirLeMenu(page) {
  await page.locator('[data-entete-de-zone] [data-menu-general]').click();
  await page.waitForSelector('[role="menu"] [data-menu-production]', { timeout: 10_000 });
  await page.waitForTimeout(400);
}

try {
  if (!(await attendrePort())) throw new Error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  poserDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });

  /* ---------- 1. Sans procédure : un clic, l'agent démarre ---------- */
  poserProjet();
  let { contexte, page, erreurs } = await ouvrir(navigateur);
  const deployer = page.locator('[data-bouton-etape-vers-agent="dev"]');
  noter(
    'sans procédure, le bouton garde son nom « Déployer » et dit qu’il configure',
    (await deployer.count()) === 1 &&
      /Déployer/.test((await deployer.textContent()) ?? '') &&
      (await deployer.getAttribute('data-etat-bouton-agent')) === 'initialiser' &&
      /Configurer le déploiement/.test((await deployer.getAttribute('title')) ?? ''),
    await deployer.getAttribute('title').catch(() => 'absent'),
  );
  await deployer.click();
  await page.waitForSelector('[data-tiroir-agent-configuration="dev"]', { timeout: 15_000 });
  await page.waitForTimeout(800);
  let tours = await envoyes(page, 'procedure.tour');
  noter(
    '« Déployer » ouvre la conversation de l’agent et lance UN tour, sans fenêtre de réglages',
    tours.length === 1 && cibleDe(tours[0]) === 'dev' && (await page.locator('[data-config-projet]').count()) === 0,
    JSON.stringify(tours).slice(0, 160),
  );
  await fermerTiroirs(page);
  const production = page.locator('[data-publication-en-tete][data-bandeau-production] [data-ouvrir-tiroir-production]');
  noter(
    'le bouton de mise en production le dit aussi',
    (await production.getAttribute('data-etat-bouton-agent')) === 'initialiser',
    await production.getAttribute('data-etat-bouton-agent').catch(() => 'absent'),
  );
  await production.click();
  await page.waitForSelector('[data-tiroir-agent-configuration="production"]', { timeout: 15_000 });
  await page.waitForTimeout(800);
  tours = await envoyes(page, 'procedure.tour');
  noter(
    '« Mise en production » ouvre l’agent de la production et lance UN tour, sans volet ni réglages',
    tours.length === 2 &&
      cibleDe(tours[1]) === 'production' &&
      (await page.locator('[data-tiroir-procedure-production]').count()) === 0 &&
      (await page.locator('[data-config-projet]').count()) === 0,
    JSON.stringify(tours).slice(0, 200),
  );
  noter('sans procédure — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  /* ---------- 2. Éteinte et sans procédure : rien ne se lance ---------- */
  poserProjet({ active: false });
  ({ contexte, page, erreurs } = await ouvrir(navigateur));
  await page.locator('[data-bandeau-production] [data-ouvrir-tiroir-production]').click();
  await page.waitForSelector('[data-tiroir-procedure-production]', { timeout: 15_000 });
  await page.waitForTimeout(600);
  noter(
    'éteinte, le clic ouvre le volet de l’interrupteur et ne lance aucun tour',
    (await envoyes(page, 'procedure.tour')).length === 0 &&
      (await page.locator('[data-tiroir-agent-configuration]').count()) === 0 &&
      (await page.locator('[data-tiroir-procedure-production] [data-interrupteur-mise-en-production], [data-interrupteur-mise-en-production]').count()) >= 1,
  );
  await contexte.close();

  /* ---------- 3. L'agent attend une réponse, puis travaille ---------- */
  poserProjet({
    deploiement: { agentId: AGENT_DEV },
    miseEnProduction: { agentId: AGENT_PROD, processus: PROCESSUS },
  });
  poserAgent(AGENT_DEV, 'Configuration du déploiement', { status: 'idle', attendReponse: true });
  poserAgent(AGENT_PROD, 'Configuration de la mise en production', { status: 'idle', attendReponse: true });
  ({ contexte, page, erreurs } = await ouvrir(navigateur));
  const deployerQ = page.locator('[data-bouton-etape-vers-agent="dev"]');
  if (process.env.HAIKO_UNCLIC_CAPTURE) {
    await page.locator('[data-entete-de-zone]').first().screenshot({ path: path.join(process.env.HAIKO_UNCLIC_CAPTURE, 'barre-agent-en-attente.png') });
  }
  const productionQ = page.locator('[data-publication-en-tete][data-bandeau-production] [data-ouvrir-tiroir-production]');
  noter(
    'l’agent attend : les deux boutons le disent',
    (await deployerQ.getAttribute('data-etat-bouton-agent')) === 'question' &&
      (await productionQ.getAttribute('data-etat-bouton-agent')) === 'question' &&
      /Répondre à l’agent/.test((await productionQ.getAttribute('title')) ?? ''),
    `${await deployerQ.getAttribute('data-etat-bouton-agent').catch(() => 'absent')} / ${await productionQ.getAttribute('data-etat-bouton-agent').catch(() => 'absent')}`,
  );
  await deployerQ.click();
  await page.waitForSelector(`[data-conversation-procedure="${AGENT_DEV}"]`, { timeout: 15_000 });
  await fermerTiroirs(page);
  await productionQ.click();
  await page.waitForSelector(`[data-conversation-procedure="${AGENT_PROD}"]`, { timeout: 15_000 });
  await page.waitForTimeout(600);
  noter(
    'même procédure en place, le clic rouvre la conversation de l’agent sans relancer de tour, et sans confirmation',
    (await envoyes(page, 'procedure.tour')).length === 0 &&
      (await page.locator('[data-confirmation-production]').count()) === 0,
  );
  await fermerTiroirs(page);
  const pointDEssai = await page.evaluate(
    (id) => !!window.belugaEssai?.agent?.(id, { status: 'running', attendReponse: false, startedAt: Date.now(), tourVivantDepuis: Date.now(), endedAt: undefined }),
    AGENT_PROD,
  );
  if (pointDEssai) {
    await page.waitForTimeout(800);
    noter(
      'au travail, le bouton tourne et rouvre la conversation sans relancer',
      (await productionQ.getAttribute('data-etat-bouton-agent')) === 'travail' &&
        (await productionQ.locator('svg.animate-spin').count()) === 1,
      await productionQ.getAttribute('data-etat-bouton-agent').catch(() => 'absent'),
    );
    await productionQ.click();
    await page.waitForSelector(`[data-conversation-procedure="${AGENT_PROD}"]`, { timeout: 15_000 });
    noter('au travail — aucun tour relancé', (await envoyes(page, 'procedure.tour')).length === 0);
    await fermerTiroirs(page);
  } else {
    console.log('  ---  état « au travail » non joué : point d’essai absent (servir l’écran par HAIKO_UNCLIC_URL)');
  }
  noter('agent en attente — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  /* ---------- 4. Procédure en place : la confirmation directe ---------- */
  poserProjet({ deploiement: { commande: 'true', herite: true }, miseEnProduction: { processus: PROCESSUS } });
  ({ contexte, page, erreurs } = await ouvrir(navigateur));
  const productionP = page.locator('[data-publication-en-tete][data-bandeau-production] [data-ouvrir-tiroir-production]');
  /* Une capture de la barre du haut, pour l'œil (`HAIKO_UNCLIC_CAPTURE=<dossier>`). */
  if (process.env.HAIKO_UNCLIC_CAPTURE) {
    await page.locator('[data-entete-de-zone]').first().screenshot({ path: path.join(process.env.HAIKO_UNCLIC_CAPTURE, 'barre-procedure-en-place.png') });
  }
  noter(
    'procédure en place : le bouton porte sa fusée, pas l’état d’un agent, et une flèche accolée',
    (await productionP.getAttribute('data-etat-bouton-agent')) === null &&
      (await page.locator('[data-bandeau-production] [data-chevron-production]').count()) === 1,
  );
  await productionP.click();
  await page.waitForSelector('[data-confirmation-production]', { timeout: 15_000 });
  await page.waitForTimeout(600);
  noter(
    'un clic ouvre DIRECTEMENT la confirmation, sans volet, avec la version en ligne',
    (await page.locator('[data-tiroir-procedure-production]').count()) === 0 &&
      (await page.locator('[data-version-en-ligne-confirmation]').count()) === 1 &&
      (await page.getByRole('button', { name: 'Mettre à jour' }).count()) === 1,
  );
  noter('rien ne part avant « Mettre à jour »', (await envoyes(page, 'deploy.start')).length === 0);
  await page.locator('[data-voir-detail-production]').click();
  await page.waitForSelector('[data-tiroir-procedure-production]', { timeout: 15_000 });
  await page.waitForTimeout(600);
  noter(
    '« Voir le détail » referme la confirmation et ouvre le volet',
    (await page.locator('[data-confirmation-production]').count()) === 0 &&
      (await page.locator('[data-pied-tiroir-production]').count()) === 1,
  );
  await fermerTiroirs(page);
  await page.locator('[data-bandeau-production] [data-chevron-production]').click();
  await page.waitForSelector('[data-tiroir-procedure-production]', { timeout: 15_000 });
  noter('la flèche accolée ouvre le volet', (await page.locator('[data-confirmation-production]').count()) === 0);
  await fermerTiroirs(page);
  await productionP.click();
  await page.waitForSelector('[data-confirmation-production]', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Mettre à jour' }).click();
  await page.waitForTimeout(800);
  const departs = await envoyes(page, 'deploy.start');
  noter(
    '« Mettre à jour » lance la mise en production, une fois',
    departs.length === 1 && cibleDe(departs[0]) === 'production',
    JSON.stringify(departs).slice(0, 160),
  );
  const deployerP = page.locator('[data-publication-en-tete] [data-bouton-publication]');
  noter(
    'procédure du déploiement en place : « Déployer » reste le bouton de lancement, sans agent',
    (await deployerP.count()) === 1 && (await page.locator('[data-bouton-etape-vers-agent="dev"]').count()) === 0,
  );
  noter('procédure en place — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  /* ---------- 5. Téléphone : les lignes du menu ---------- */
  poserProjet();
  ({ contexte, page, erreurs } = await ouvrir(navigateur, { telephone: true }));
  await ouvrirLeMenu(page);
  await page.locator('[role="menu"] [data-menu-deployer]').click();
  await page.waitForSelector('[data-tiroir-agent-configuration="dev"]', { timeout: 15_000 });
  await page.waitForTimeout(600);
  tours = await envoyes(page, 'procedure.tour');
  noter('téléphone, sans procédure : « Déployer » ouvre l’agent et lance un tour', tours.length === 1 && cibleDe(tours[0]) === 'dev');
  await fermerTiroirs(page);
  await ouvrirLeMenu(page);
  await page.locator('[role="menu"] [data-menu-production]').click();
  await page.waitForSelector('[data-tiroir-agent-configuration="production"]', { timeout: 15_000 });
  tours = await envoyes(page, 'procedure.tour');
  noter('téléphone, sans procédure : « Mise en production » aussi', tours.length === 2 && cibleDe(tours[1]) === 'production');
  await contexte.close();

  poserProjet({ deploiement: { commande: 'true', herite: true }, miseEnProduction: { processus: PROCESSUS } });
  ({ contexte, page, erreurs } = await ouvrir(navigateur, { telephone: true }));
  await ouvrirLeMenu(page);
  await page.locator('[role="menu"] [data-menu-production]').click();
  await page.waitForSelector('[data-confirmation-production]', { timeout: 15_000 });
  await page.waitForTimeout(600);
  noter(
    'téléphone, procédure en place : la ligne ouvre la confirmation, rien ne part',
    (await page.locator('[data-tiroir-procedure-production]').count()) === 0 && (await envoyes(page, 'deploy.start')).length === 0,
  );
  await page.locator('[data-voir-detail-production]').click();
  await page.waitForSelector('[data-tiroir-procedure-production]', { timeout: 15_000 });
  noter('téléphone : « Voir le détail » ouvre le volet', true);
  noter('téléphone — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  await navigateur.close();
} catch (err) {
  noter('le contrôle est allé au bout', false, err?.stack ?? String(err));
} finally {
  nettoyer();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis`);
process.exit(echecs.length ? 1 : 0);
