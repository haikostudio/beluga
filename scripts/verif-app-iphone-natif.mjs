#!/usr/bin/env node
/**
 * L'APPLICATION IPHONE REJOUÉE DANS UN VRAI NAVIGATEUR (carte « Marge du pied, onglets et volet tâches », 16/11/2026).
 *
 * La page se sait dans l'application quand le pont natif a posé `window.__belugaNatif` (plateforme « ios ») avant
 * tout script. Ce contrôle pose ce pont (faux, il note ce que la page lui dit) et juge, à 390 px :
 *
 *   1. le marqueur `html[data-natif=ios]` est posé dès le premier affichage ; sans pont, jamais ;
 *   2. le bas : le menu du bas a 16 px de marge basse dans l'application ; sans pont, la marge d'avant (inchangée) ;
 *      les côtés : 12 px dans l'application, 16 px sans ;
 *   3. Tableaux de bord : trois onglets « Tâches », « À déployer », « Production » avec leur nombre ;
 *   4. Jarvis : un PETIT rond au bord (≤ 30 px de haut), l'attente du mot démarre SANS geste ; page cachée hors
 *      conversation → AUCUN micro ouvert ; retour à l'écran → l'attente reprend ; « Dis Jarvis » (point d'essai) ou
 *      le double toucher au dos (événement du pont) → la barre d'appel au-dessus du menu, sans voile ; raccrocher →
 *      le rond ; interrupteur du double toucher coupé → rien ;
 *   5. sans pont (application installée depuis Safari, navigateur) : LE MÊME Jarvis au bord (décision du 16/11/2026,
 *      plus de module d'avant), micro coupé jusqu'au premier geste ; un toucher sort la barre d'appel ;
 *   6. ordinateur (1440 px) : le même rond fondu dans le bord (congés rentrants), la barre d'appel en bas à gauche à
 *      largeur bornée (≤ 420 px), la conversation empilée au-dessus et jointe à elle ; aucun point devant la ligne
 *      ouverte de la colonne (capture #b166).
 *
 * Démon d'essai (base neuve, aucun compte moteur) + serveur de développement de la copie branché sur lui : le point
 * d'essai `belugaEssai` n'existe qu'hors production. Jamais BELUGA_URL, jamais BELUGA_TOKEN.
 *
 *   env -u BELUGA_TOKEN node scripts/verif-app-iphone-natif.mjs
 *   VERIF_CAPTURES=/chemin env -u BELUGA_TOKEN node scripts/verif-app-iphone-natif.mjs   # + captures clair/sombre
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7213);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7114);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ---------------- Le décor, écrit par le magasin du démon AVANT son lancement ---------------- */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-app-iphone-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(PROJETS, { recursive: true });
process.env.BELUGA_DATA = DATA;
process.env.BELUGA_PROJECTS_ROOT = PROJETS;
const shared = await import(path.join(RACINE, 'shared/dist/index.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));
const maintenant = Date.now();
const PROJET = 'p-app-iphone';
store.saveProject(shared.Project.parse({ id: PROJET, name: 'Application iPhone', path: PROJETS, createdAt: maintenant, updatedAt: maintenant }));
for (const [id, titre, colonne] of [
  ['c-a-deployer', 'Marge du pied', 'to_deploy'],
  ['c-planifiee', 'Volet des tâches', 'planned'],
]) {
  store.saveCard(shared.Card.parse({ id, projectId: PROJET, title: titre, column: colonne, position: 0, run: { engine: 'claude' }, createdAt: maintenant, updatedAt: maintenant }));
}
const jeton = crypto.randomBytes(32).toString('hex');
const db = getDb();
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), maintenant, maintenant + 3600_000, 'essai app iphone');
const pref = db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)');
pref.run('voix.visible', 'true', maintenant);
const poserPref = (cle, valeur) => getDb().prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(cle, JSON.stringify(valeur), Date.now());

/* ---------------- Le démon d'essai et le serveur de développement branché sur lui ---------------- */

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: { ...process.env, BELUGA_PORT: String(PORT), BELUGA_HOST: '127.0.0.1', BELUGA_DATA: DATA, BELUGA_PROJECTS_ROOT: PROJETS, BELUGA_WEB: path.join(RACINE, 'web', 'dist'), BELUGA_SANS_AMORCE: '1', BELUGA_URL: '', BELUGA_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));
const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'ignore', 'ignore'],
});
const nettoyer = () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
};
process.on('exit', nettoyer);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(1));

async function attendre(url, essais = 90) {
  for (let i = 0; i < essais; i += 1) {
    if (await fetch(url).then(() => true).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function ouvrir(navigateur, { natif, largeur = 390, hauteur = 844 }) {
  const contexte = await navigateur.newContext({
    viewport: { width: largeur, height: hauteur },
    isMobile: largeur < 640,
    hasTouch: largeur < 640,
    permissions: ['microphone'],
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  await contexte.addInitScript((avecPont) => {
    window.__natifRecus = [];
    if (avecPont) {
      window.__belugaNatif = { plateforme: 'ios', version: '8', envoyer: (m) => window.__natifRecus.push(m) };
    }
    // La visibilité de la page, pilotable : le contrôle rejoue « application quittée ».
    window.__cachee = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__cachee ? 'hidden' : 'visible') });
  }, natif);
  const page = await contexte.newPage();
  page.setDefaultTimeout(20_000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav[data-menu-bas], [data-page-en-route]', { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"]').count()); essai += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  return { contexte, page, erreurs };
}

const cacher = (page, cachee) =>
  page.evaluate((c) => {
    window.__cachee = c;
    document.dispatchEvent(new Event('visibilitychange'));
  }, cachee);

const mesures = (page) =>
  page.evaluate(() => {
    const nav = document.querySelector('nav[data-menu-bas]');
    /* LE BOUTON DU BORD ET LE VOLET DE L'ASSISTANT (carte « Jarvis : volet, voix et rapidité », 16/11/2026) : la barre
       d'appel et la conversation empilée ont disparu ; en mode voix, les ondes (`data-pied-vocal`) remplacent la zone
       d'écriture du volet, et le fil du direct s'y lit parmi les messages. */
    const rond = document.querySelector('[data-bouton-du-bord]')?.getBoundingClientRect();
    const barre = document.querySelector('[data-pied-vocal]')?.getBoundingClientRect();
    const menu = nav?.getBoundingClientRect();
    const conges = document.querySelector('[data-conges-jarvis]');
    const fil = document.querySelector('[data-assistant-chat]')?.getBoundingClientRect();
    const module = document.querySelector('[data-module-voix][data-etat-reveil]');
    return {
      marqueur: document.documentElement.getAttribute('data-natif'),
      piedMenu: nav ? getComputedStyle(nav).paddingBottom : null,
      coteMenu: nav ? getComputedStyle(nav).paddingLeft : null,
      rond: rond ? { h: Math.round(rond.height), l: Math.round(rond.left), w: Math.round(rond.width), presqueRond: Math.abs(rond.height - rond.width) <= 2 && rond.width >= 28 && rond.width <= 32 } : null,
      barre: barre ? { bas: Math.round(barre.bottom), gauche: Math.round(barre.left), h: Math.round(barre.height) } : null,
      hautMenu: menu ? Math.round(menu.top) : null,
      // Depuis le 17/11/2026, l'assistant s'ouvre au téléphone en FEUILLE DU BAS, par-dessus le menu (MEM-7624).
      // Le bouton du bord (et son repère `data-conversation`) s'efface sous la feuille : les ondes en feuille prouvent la conversation.
      enFeuille: !!document.querySelector('[data-feuille-du-bas] [data-pied-vocal]'),
      hauteurEcran: window.innerHeight,
      // Aucun voile : rien de plein écran ne se pose derrière le volet.
      voileVisible: [...document.querySelectorAll('[data-module-voix] *')].some((e) => { const r = e.getBoundingClientRect(); return r.width >= window.innerWidth && r.height >= window.innerHeight * 0.95; }),
      etat: module?.getAttribute('data-etat-reveil') ?? null,
      conversation: module?.hasAttribute('data-conversation') ?? false,
      // Le module de voix ne pose que le bouton du bord : ni barre d'appel, ni conversation empilée, ni rond d'avant.
      moduleDAvant: !module || [...module.children].filter((e) => getComputedStyle(e).position === 'fixed').length !== 1 || !module.querySelector('[data-languette-jarvis]'),
      conges: conges ? { visible: getComputedStyle(conges).opacity === '1', gauche: Math.round(conges.getBoundingClientRect().left), h: Math.round(conges.getBoundingClientRect().height) } : null,
      fil: fil ? { bas: Math.round(fil.bottom), gauche: Math.round(fil.left), largeur: Math.round(fil.width), tours: document.querySelectorAll('[data-assistant-chat] [data-tour-fil]').length } : null,
      barreLarge: barre ? Math.round(barre.width) : null,
      points: document.querySelectorAll('[data-repere-demi-rond]').length,
      micros: window.belugaEssai?.micros?.() ?? null,
      recus: [...(window.__natifRecus ?? [])],
      onglets: [...document.querySelectorAll('[data-onglets-tableaux-de-bord] [data-onglet]')].map((o) => `${o.getAttribute('data-onglet')}:${o.querySelector('[data-compteur-onglet]')?.getAttribute('data-compteur-onglet') ?? '-'}`),
      deborde: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

async function capturer(page, nom) {
  if (!CAPTURES) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

/* Une conversation fabriquée, au format du démon : deux phrases de chaque côté. */
const deuxTours = (page) =>
  page.evaluate(() => {
    const envoyer = (detail) => window.dispatchEvent(new CustomEvent('beluga:voix-directe', { detail }));
    envoyer({ type: 'voix.direct.tour', role: 'user', texte: 'Quelles cartes sont en cours ?', final: true, projets: [] });
    envoyer({ type: 'voix.direct.tour', role: 'assistant', texte: 'Deux cartes tournent : la marge du pied et le volet des tâches.', final: true, projets: [] });
    envoyer({ type: 'voix.direct.tour', role: 'user', texte: 'Lance la suivante.', final: true, projets: [] });
  });

let navigateur;
try {
  if (!(await attendre(`http://127.0.0.1:${PORT}/`))) throw new Error('le démon d’essai n’a pas démarré :\n' + journal.join('').slice(-2000));
  if (!(await attendre(BASE))) throw new Error('le serveur de développement n’a pas démarré');
  navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });

  for (const clarte of ['sombre', 'clair']) {
    poserPref('theme', clarte);
    console.log(`— Application iPhone, ${clarte}`);
    const { contexte, page, erreurs } = await ouvrir(navigateur, { natif: true });
    let m = await mesures(page);
    verifier('le marqueur de l’application est posé', m.marqueur === 'ios', String(m.marqueur));
    verifier('le menu du bas s’arrête à 16 px du bord', m.piedMenu === '16px', String(m.piedMenu));
    verifier('Tableaux de bord : trois onglets avec leur nombre', m.onglets.length === 3 && m.onglets.every((o) => !o.endsWith(':-')), m.onglets.join(' '));
    verifier('rien ne déborde en largeur', m.deborde <= 0, String(m.deborde));
    await capturer(page, `iphone-tableaux-de-bord-${clarte}`);
    // Jarvis : le petit rond, l'attente sans geste.
    await page.waitForSelector('[data-bouton-du-bord]', { timeout: 20_000 }).catch(() => undefined);
    m = await mesures(page);
    verifier('Jarvis : le bouton du bord, presque rond, collé au bord gauche', !!m.rond && m.rond.presqueRond && m.rond.l === 0, JSON.stringify(m.rond));
    verifier('Jarvis : ni barre d’appel ni module d’avant', !m.moduleDAvant);
    verifier('Jarvis : les angles creusés fondent le bouton dans le bord', !!m.conges && m.conges.visible && m.conges.gauche === 0, JSON.stringify(m.conges));
    const attente = await page
      .waitForFunction(() => ['chargement', 'attente', 'erreur'].includes(document.querySelector('[data-module-voix][data-etat-reveil]')?.getAttribute('data-etat-reveil') ?? ''), null, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    m = await mesures(page);
    verifier('l’attente du mot démarre sans geste, application à l’écran', attente && (m.micros ?? 0) > 0, `${m.etat}, micros=${m.micros}`);
    if (clarte === 'sombre') {
      await cacher(page, true);
      await page.waitForTimeout(1200);
      m = await mesures(page);
      verifier('application quittée hors conversation : AUCUN micro ouvert (plus de point orange)', m.micros === 0, `micros=${m.micros}, état=${m.etat}`);
      await cacher(page, false);
      const reprise = await page
        .waitForFunction(() => (window.belugaEssai?.micros?.() ?? 0) > 0, null, { timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      verifier('retour à l’écran : l’attente du mot reprend seule', reprise);
      await page.waitForTimeout(1500);
    }
    // « Dis Jarvis » : le volet de l'assistant s'ouvre, les ondes à la place de la zone d'écriture.
    const reveil = await page.evaluate(() => window.belugaEssai?.reveil?.() ?? false);
    await page.waitForSelector('[data-pied-vocal]', { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    m = await mesures(page);
    verifier('« Dis Jarvis » : l’assistant s’ouvre en feuille du bas, les ondes dans l’écran, sans voile', reveil && !!m.barre && !m.voileVisible && m.enFeuille && m.barre.bas <= m.hauteurEcran, JSON.stringify({ reveil, barre: m.barre, enFeuille: m.enFeuille, voile: m.voileVisible }));
    verifier('sous les ondes, Muet et Arrêter', (await page.locator('[data-jarvis-micro]').count()) === 1 && (await page.locator('[data-jarvis-raccrocher]').count()) === 1);
    verifier('la conversation dit au natif de passer en mode appel', m.recus.some((r) => r.type === 'audio' && r.actif === true));
    await capturer(page, `iphone-barre-jarvis-${clarte}`);
    await deuxTours(page);
    await page.waitForTimeout(900);
    m = await mesures(page);
    verifier('la conversation se lit dans le volet, au-dessus des ondes', !!m.fil && m.fil.tours >= 2 && !!m.barre && m.barre.bas <= m.fil.bas + 1, JSON.stringify({ fil: m.fil, barre: m.barre }));
    await capturer(page, `iphone-conversation-jarvis-${clarte}`);
    await page.locator('[data-jarvis-raccrocher]').dispatchEvent('click');
    await page.waitForTimeout(800);
    m = await mesures(page);
    verifier('Arrêter : la zone d’écriture revient, le mode appel est rendu', !m.barre && !m.conversation && m.recus.some((r) => r.type === 'audio' && r.actif === false));
    if (clarte === 'sombre') {
      // Le double toucher au dos.
      verifier('l’interrupteur du double toucher est redit au natif', m.recus.some((r) => r.type === 'jarvis-dos'));
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:natif', { detail: { type: 'jarvis-conversation' } })));
      const parDos = await page.waitForSelector('[data-pied-vocal]', { timeout: 8000 }).then(() => true).catch(() => false);
      verifier('double toucher au dos : le volet et la conversation', parDos);
      await page.locator('[data-jarvis-raccrocher]').dispatchEvent('click');
      await page.waitForTimeout(800);
    }
    // Le volet des tâches du projet : les lignes de la colonne, le bouton du pied à 16 px du bord.
    await page.evaluate((id) => (window.location.hash = `#projet/${id}`), PROJET);
    await page.waitForTimeout(2000);
    const boutonTaches = page.locator('[data-taches-du-haut]').first();
    if (await boutonTaches.count()) {
      await boutonTaches.dispatchEvent('click');
      await page.waitForSelector('[data-feuille-des-taches] [data-agent-en-liste]', { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(800);
      const v = await page.evaluate(() => {
        const feuille = document.querySelector('[data-feuille-des-taches]');
        const pied = document.querySelector('[data-nouvel-artefact-feuille-taches]')?.getBoundingClientRect();
        return {
          lignes: feuille?.querySelectorAll('[data-agent-en-liste]').length ?? 0,
          branches: feuille?.querySelectorAll('[data-branche-agent]').length ?? 0,
          recherche: !!feuille?.querySelector('input'),
          basDuPied: pied ? Math.round(window.innerHeight - pied.bottom) : null,
          cote: pied ? Math.round(pied.left) : null,
        };
      });
      verifier('volet des tâches : les lignes de la colonne, sans nom de branche, recherche gardée', v.lignes > 0 && v.branches === 0 && v.recherche, JSON.stringify(v));
      verifier('volet des tâches : « Nouvel artefact » à 16 px du bord, 12 px sur les côtés', v.basDuPied !== null && Math.abs(v.basDuPied - 16) <= 1 && v.cote === 12, JSON.stringify(v));
      await capturer(page, `iphone-volet-des-taches-${clarte}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      verifier('volet des tâches : le bouton du haut est là', false);
    }
    if (erreurs.length) console.log('    erreurs de page :', erreurs.slice(0, 3).join(' | '));
    verifier('aucune erreur de page', erreurs.length === 0, erreurs[0] ?? '');
    await contexte.close();
  }

  // L'interrupteur coupé : le double toucher ne fait rien.
  poserPref('theme', 'sombre');
  poserPref('voix.jarvis-dos', false);
  {
    const { contexte, page } = await ouvrir(navigateur, { natif: true });
    await page.waitForSelector('[data-bouton-du-bord]', { timeout: 20_000 }).catch(() => undefined);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:natif', { detail: { type: 'jarvis-conversation' } })));
    await page.waitForTimeout(1500);
    verifier('interrupteur coupé : le double toucher ne lance rien', (await page.locator('[data-pied-vocal]').count()) === 0);
    await contexte.close();
  }
  poserPref('voix.jarvis-dos', true);

  // Sans pont : le MÊME Jarvis au bord, micro coupé jusqu'au premier geste.
  console.log('— Navigateur / application installée depuis Safari');
  for (const clarte of ['sombre', 'clair']) {
    poserPref('theme', clarte);
    const { contexte, page, erreurs } = await ouvrir(navigateur, { natif: false });
    await page.waitForSelector('[data-bouton-du-bord]', { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    let m = await mesures(page);
    verifier(`Safari (${clarte}) : aucun marqueur d’application`, m.marqueur === null);
    verifier(`Safari (${clarte}) : la marge du menu du bas est celle d’avant`, m.piedMenu === '18px', String(m.piedMenu));
    verifier(`Safari (${clarte}) : le bouton du bord, ni barre d’appel ni module d’avant`, !!m.rond && m.rond.l === 0 && m.rond.presqueRond && !m.moduleDAvant, JSON.stringify({ rond: m.rond, avant: m.moduleDAvant }));
    verifier(`Safari (${clarte}) : les angles creusés fondent le bouton dans le bord`, !!m.conges && m.conges.visible && m.conges.gauche === 0 && m.conges.h === m.rond.h + 16, JSON.stringify(m.conges));
    verifier(`Safari (${clarte}) : micro coupé tant qu’aucun geste`, m.micros === 0, `micros=${m.micros}`);
    await capturer(page, `safari-rond-${clarte}`);
    // Le volet a pu rester ouvert (préférence du compte) : le bouton du bord le REFERMERAIT.
    if (!(await page.locator('[data-assistant-chat]').count())) await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
        /* La voix ne s'ouvre plus d'un bouton du champ (18/11/2026) : l'événement du raccourci. */ await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:parler-a-jarvis', { detail: { agentId: null } })));
    await page.waitForSelector('[data-pied-vocal]', { timeout: 8000 }).catch(() => undefined);
    await deuxTours(page);
    await page.waitForTimeout(900);
    m = await mesures(page);
    verifier(`Safari (${clarte}) : le bouton ouvre l’assistant en feuille du bas, le micro lance Jarvis`, !!m.barre && m.enFeuille && m.barre.bas <= m.hauteurEcran, JSON.stringify({ barre: m.barre, enFeuille: m.enFeuille }));
    verifier(`Safari (${clarte}) : la conversation se lit dans le volet`, !!m.fil && m.fil.tours >= 2, JSON.stringify({ fil: m.fil }));
    verifier(`Safari (${clarte}) : rien ne déborde en largeur`, m.deborde <= 0, String(m.deborde));
    await capturer(page, `safari-conversation-${clarte}`);
    await page.locator('[data-jarvis-raccrocher]').dispatchEvent('click');
    await page.waitForTimeout(800);
    verifier(`Safari (${clarte}) : Arrêter, la zone d’écriture revient`, (await page.locator('[data-pied-vocal]').count()) === 0);
    verifier(`Safari (${clarte}) : aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
    await contexte.close();
  }
  // L'ordinateur : Tableaux de bord inchangés, Jarvis au bord, barre en bas à gauche, aucun point dans la colonne.
  console.log('— Ordinateur');
  for (const clarte of ['sombre', 'clair']) {
    poserPref('theme', clarte);
    const { contexte, page, erreurs } = await ouvrir(navigateur, { natif: false, largeur: 1440, hauteur: 900 });
    await page.waitForTimeout(1500);
    const o = await page.evaluate(() => ({
      empiles: !!document.querySelector('[data-publications-en-attente] [data-projets-a-deployer]'),
      onglets: !!document.querySelector('[data-onglets-tableaux-de-bord]'),
    }));
    verifier(`ordinateur (${clarte}) : « À déployer » empilé comme avant, aucune barre d’onglets`, o.empiles && !o.onglets, JSON.stringify(o));
    await page.evaluate((id) => (window.location.hash = `#projet/${id}`), PROJET);
    await page.waitForTimeout(2000);
    const ronds = await page.evaluate(() => [...document.querySelectorAll('[data-rond-d-etat]')].map((r) => Math.round(r.getBoundingClientRect().height)));
    verifier(`ordinateur (${clarte}) : les ronds d’état sont petits (13 ou 15 px)`, ronds.length > 0 && ronds.every((h) => h === 13 || h === 15), ronds.join(','));
    let m = await mesures(page);
    verifier(`ordinateur (${clarte}) : aucun point devant la ligne ouverte de la colonne`, m.points === 0, String(m.points));
    verifier(`ordinateur (${clarte}) : le bouton du bord, aux angles creusés`, !!m.rond && m.rond.l === 0 && m.rond.presqueRond && !!m.conges && m.conges.visible && !m.moduleDAvant, JSON.stringify({ rond: m.rond, conges: m.conges }));
    await capturer(page, `ordinateur-projet-${clarte}`);
    // Le volet a pu rester ouvert (préférence du compte) : le bouton du bord le REFERMERAIT.
    if (!(await page.locator('[data-assistant-chat]').count())) await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
        /* La voix ne s'ouvre plus d'un bouton du champ (18/11/2026) : l'événement du raccourci. */ await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:parler-a-jarvis', { detail: { agentId: null } })));
    await page.waitForSelector('[data-pied-vocal]', { timeout: 8000 }).catch(() => undefined);
    await deuxTours(page);
    await page.waitForTimeout(900);
    m = await mesures(page);
    verifier(`ordinateur (${clarte}) : le volet s’ouvre à droite du bouton, les ondes en bas`, !!m.fil && !!m.rond && m.fil.gauche >= m.rond.l + m.rond.w && !!m.barre && m.barre.bas <= 900 - 16, JSON.stringify({ fil: m.fil, barre: m.barre }));
    verifier(`ordinateur (${clarte}) : la conversation se lit dans le volet`, !!m.fil && m.fil.tours >= 2, JSON.stringify(m.fil));
    await capturer(page, `ordinateur-conversation-${clarte}`);
    await page.locator('[data-jarvis-raccrocher]').dispatchEvent('click');
    await page.waitForTimeout(600);
    verifier(`ordinateur (${clarte}) : aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
    await contexte.close();
  }
} catch (err) {
  console.error(err);
  resultats.push(false);
} finally {
  await navigateur?.close().catch(() => undefined);
  const ok = resultats.filter(Boolean).length;
  console.log(`\n${ok}/${resultats.length} contrôles réussis`);
  nettoyer();
  process.exit(ok === resultats.length && resultats.length > 0 ? 0 : 1);
}
