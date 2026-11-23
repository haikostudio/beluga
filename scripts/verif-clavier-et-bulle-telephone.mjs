#!/usr/bin/env node
/**
 * LE CLAVIER RESTE OUVERT, ET LA BULLE DE JARVIS PREND LA PLACE DU CHAMP — TÉLÉPHONE 390 PX, CLAIR ET SOMBRE.
 *
 * Carte « Clavier qui se referme sur mobile » (18/11/2026, captures #e1c70 et #37ce). Ce contrôle juge :
 *
 *   1. LE CLAVIER NE SE REFERME PLUS : sur la page d'une carte, le champ touché (faux clavier de 336 px, la seule
 *      façon d'en faire monter un dans Chromium) garde le curseur DIX SECONDES, reste affiché, porte la marque
 *      « écriture au clavier », et aucun `focusout` ne part. Avant la correction, la règle « tout le pied sauf le
 *      champ » masquait l'enveloppe du champ (`[data-enveloppe-du-champ]`) : le champ disparaissait sous le doigt.
 *   2. LA BULLE À LA PLACE EXACTE DU CHAMP : le bouton du bord touché, la bulle vocale se cale sur le bas qu'avait le
 *      champ (son retrait du bas compris) — aucune bande vide dessous ; le fil s'arrête au-dessus d'elle.
 *   3. LE BOUTON PHOTO AU-DESSUS, À DROITE : « Ce que l'agent a vu » se pose juste au-dessus de la bulle, aligné sur
 *      son bord droit, comme sur le champ.
 *   4. LA BULLE FERMÉE, LE CHAMP REVIENT : la réserve tombe, le champ est de nouveau là.
 *
 * Un DÉMON D'ESSAI (base neuve, aucun compte Codex, aucun quota) et le serveur de développement de la copie, branché
 * sur lui. Jamais BELUGA_URL, jamais BELUGA_TOKEN.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-clavier-et-bulle-telephone.mjs
 *   VERIF_CAPTURES=/chemin env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-clavier-et-bulle-telephone.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7233);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7134);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });
const CLAVIER = 336;

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, TMP, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-clavier-bulle-', port: PORT, signaux: true, dossiers: [] });
const DOSSIER = path.join(TMP, 'projet');
fs.mkdirSync(DOSSIER, { recursive: true });
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-clavier-bulle';
const AGENT_ID = 'a-clavier-bulle';
const CARTE_ID = 'c-clavier-bulle';

const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
vite.stdout.on('data', () => undefined);
vite.stderr.on('data', () => undefined);
const couperVite = () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
};
process.on('exit', couperVite);

const base = () => new Database(path.join(DATA, 'beluga.db'));
function poserLaPreference(cle, valeur) {
  const db = base();
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(cle, JSON.stringify(valeur), Date.now());
  db.close();
}

function poserLeDecor() {
  const db = base();
  const T = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai clavier et bulle');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  const projet = { id: PROJET_ID, name: 'Essai clavier et bulle', path: DOSSIER, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: T, updatedAt: T };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(projet.id, projet.name, projet.path, JSON.stringify(projet), T, T);
  db.close();
}

async function envoyerUneImage() {
  const reponse = await fetch(`${BASE}/api/upload?project=${PROJET_ID}`, {
    method: 'POST',
    headers: { cookie: `beluga_session=${jeton}`, 'content-type': 'image/png', 'x-file-name': encodeURIComponent('vue.png') },
    body: fs.readFileSync(path.join(RACINE, 'web/public/icon-192.png')),
  });
  return reponse.ok ? (await reponse.json()).attachment : null;
}

/** Une carte terminée, dont l'agent a vu une image (bouton photo du pied), et un fil assez long pour défiler. */
function poserLaCarte(idImage) {
  const db = base();
  const T = Date.now();
  const run = { engine: 'claude', thinking: 'none', mode: 'direct' };
  const agent = { id: AGENT_ID, projectId: PROJET_ID, cardId: CARTE_ID, role: 'task', title: 'Carte d’essai', run, status: 'done', createdAt: T, updatedAt: T };
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(AGENT_ID, PROJET_ID, CARTE_ID, 'task', 'done', JSON.stringify(agent), T, T);
  const carte = {
    id: CARTE_ID, projectId: PROJET_ID, title: 'Carte d’essai — clavier et bulle', description: 'Carte posée par un contrôle automatique.', labels: [],
    column: 'planned', position: 1, origin: 'agent', agentId: AGENT_ID, run, excludedFromDeploy: false, horsTache: false,
    scheduling: { asap: false, attempts: 0, restarts: 0 }, createdAt: T, updatedAt: T,
  };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(CARTE_ID, PROJET_ID, 'planned', 1, carte.title, JSON.stringify(carte), T, T);
  const vide = { steps: [], todos: [], proposals: [], questions: [], downloads: [], streaming: false };
  const demande = { ...vide, id: 'm-demande', agentId: AGENT_ID, role: 'user', content: 'Carte d’essai : ne rien exécuter.', attachments: [], createdAt: T - 5000 };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(demande.id, AGENT_ID, 'user', JSON.stringify(demande), demande.createdAt);
  const long = Array.from({ length: 14 }, (_, i) => `Paragraphe ${i + 1} : ce que l’agent a relevé dans le projet, assez long pour remplir l’écran du téléphone.`).join('\n\n');
  const reponse = { ...vide, id: 'm-reponse', agentId: AGENT_ID, role: 'assistant', content: long, attachments: idImage ? [idImage] : [], createdAt: T };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(reponse.id, AGENT_ID, 'assistant', JSON.stringify(reponse), T);
  if (idImage) db.prepare("UPDATE attachments SET data = json_set(data, '$.deLAgent', json('true')) WHERE id = ?").run(idImage);
  db.close();
}

async function ouvrirLaCarte(navigateur, clarte) {
  const contexte = await navigateur.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    permissions: ['microphone'], serviceWorkers: 'block', colorScheme: clarte === 'sombre' ? 'dark' : 'light',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  /* LE FAUX CLAVIER (compétence « champ-visible-au-dessus-du-clavier-mobile ») : `visualViewport` rétrécit tant qu'un
     champ a le curseur ; chaque `focusout` est noté, avec ce qui a pris la main. */
  await contexte.addInitScript((hauteur) => {
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
    window.__sorties = [];
    document.addEventListener('focusin', (e) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) basculer(true);
    });
    document.addEventListener('focusout', (e) => {
      window.__sorties.push({ de: e.target?.tagName ?? '?', vers: e.relatedTarget?.tagName ?? null, t: Math.round(performance.now()) });
      basculer(false);
    });
  }, CLAVIER);
  const page = await contexte.newPage();
  page.setDefaultTimeout(20_000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE_ID}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-ecran-de-carte] [data-champ-d-ecriture] textarea').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForSelector('[data-bouton-du-bord]', { timeout: 60_000 });
  await page.waitForTimeout(3200);
  return { contexte, page, erreurs };
}


let navigateur = null;
try {
  if (!(await attendrePort())) throw new Error('le démon d’essai ne répond pas');
  poserLeDecor();
  for (let i = 0; i < 90; i += 1) {
    if (await fetch(BASE).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const piece = await envoyerUneImage();
  verifier('une image de l’agent est posée sur la carte', !!piece?.id);
  poserLaCarte(piece?.id ?? null);
  navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });

  for (const clarte of ['sombre', 'clair']) {
    poserLaPreference('theme', clarte);
    const { contexte, page, erreurs } = await ouvrirLaCarte(navigateur, clarte);
    const champ = page.locator('[data-ecran-de-carte] [data-champ-d-ecriture] textarea').first();

    /* ===== 1. Le clavier reste ouvert ===== */
    await champ.tap();
    // Seuls comptent les départs du CHAMP : le focus qui QUITTE l'élément d'avant pour lui n'est pas une fermeture.
    await page.evaluate(() => (window.__sorties = []));
    await champ.type('Bonjour, je tape au clavier du téléphone.', { delay: 15 });
    await page.waitForTimeout(1400);
    if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `telephone-${clarte}-clavier-ouvert.png`) });
    await page.waitForTimeout(8600);
    const tenu = await champ.evaluate((el) => ({
      focus: document.activeElement === el,
      affiche: el.offsetParent !== null && el.getBoundingClientRect().height > 0,
      marque: !!el.closest('[data-ecran-de-carte]')?.hasAttribute('data-ecriture-au-clavier'),
      enveloppe: el.closest('[data-enveloppe-du-champ]') ? getComputedStyle(el.closest('[data-enveloppe-du-champ]')).display : 'absente',
      sorties: window.__sorties.filter((s) => s.de === 'TEXTAREA'),
      texte: el.value,
    }));
    verifier(`${clarte} : clavier ouvert, le champ garde le curseur dix secondes`, tenu.focus && tenu.sorties.length === 0, JSON.stringify(tenu.sorties));
    verifier(`${clarte} : clavier ouvert, le champ reste affiché (son enveloppe n'est jamais masquée)`, tenu.affiche && tenu.enveloppe === 'contents', tenu.enveloppe);
    verifier(`${clarte} : l'écran porte la marque « écriture au clavier »`, tenu.marque);
    verifier(`${clarte} : le texte tapé est entier`, tenu.texte === 'Bonjour, je tape au clavier du téléphone.', tenu.texte);
    await champ.fill('');
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    await page.waitForTimeout(800);

    /* ===== 2 et 3. La bulle à la place du champ, le bouton photo au-dessus ===== */
    const avant = await page.evaluate(() => {
      const c = document.querySelector('[data-ecran-de-carte] [data-composer]');
      return { bas: c ? Math.round(c.getBoundingClientRect().bottom) : null, retrait: c ? parseFloat(getComputedStyle(c).paddingBottom) : null };
    });
    await page.locator('[data-bouton-du-bord]').tap();
    await page.locator('[data-bulle-vocale]').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(1500);
    if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `telephone-${clarte}-bulle-en-bas.png`) });
    const lu = await page.evaluate(() => {
      const b = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
      const r = (x) => (x ? { haut: Math.round(x.top), bas: Math.round(x.bottom), gauche: Math.round(x.left), droite: Math.round(x.right) } : null);
      const champ = document.querySelector('[data-ecran-de-carte] [data-champ-d-ecriture] textarea');
      return {
        hauteur: window.innerHeight,
        bulle: r(b('[data-bulle-vocale]')),
        reserve: r(b('[data-ecran-de-carte] [data-place-de-la-bulle]')),
        camera: r(b('[data-ecran-de-carte] [data-captures-bouton]')),
        fil: r(b('[data-ecran-de-carte] [data-fil]')),
        champVisible: !!champ && champ.offsetParent !== null,
      };
    });
    verifier(`${clarte} : en mode Jarvis, le champ se retire`, !lu.champVisible);
    verifier(`${clarte} : une réserve tient la place du champ`, !!lu.reserve && lu.reserve.bas > lu.reserve.haut, JSON.stringify(lu.reserve));
    verifier(
      `${clarte} : la bulle se pose sur le bas qu'avait le champ, sans bande vide dessous`,
      !!lu.bulle && avant.bas !== null && Math.abs(lu.bulle.bas - (avant.bas - avant.retrait)) <= 2 && lu.hauteur - lu.bulle.bas <= 48,
      JSON.stringify({ bulle: lu.bulle, champAvant: avant, ecran: lu.hauteur }),
    );
    verifier(`${clarte} : le fil s'arrête au-dessus de la bulle`, !!lu.fil && !!lu.bulle && lu.fil.bas <= lu.bulle.haut + 1, JSON.stringify({ fil: lu.fil, bulle: lu.bulle }));
    verifier(
      `${clarte} : le bouton photo est juste au-dessus de la bulle, à droite`,
      !!lu.camera && !!lu.bulle && lu.camera.bas <= lu.bulle.haut && lu.bulle.haut - lu.camera.bas <= 24 && Math.abs(lu.camera.droite - lu.bulle.droite) <= 4,
      JSON.stringify({ camera: lu.camera, bulle: lu.bulle }),
    );
    const auDessus = await page.evaluate(() => {
      const c = document.querySelector('[data-ecran-de-carte] [data-captures-bouton]')?.getBoundingClientRect();
      if (!c) return false;
      const el = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
      return !!el?.closest('[data-captures-bouton]');
    });
    verifier(`${clarte} : rien ne recouvre le bouton photo`, auDessus);

    /* ===== 4. La bulle fermée, le champ revient ===== */
    await page.locator('[data-bulle-vocale] [data-jarvis-raccrocher]').tap();
    await page.waitForTimeout(2000);
    const apres = await page.evaluate(() => ({
      reserve: !!document.querySelector('[data-place-de-la-bulle]'),
      champ: !!document.querySelector('[data-ecran-de-carte] [data-champ-d-ecriture] textarea')?.offsetParent,
      variable: document.documentElement.style.getPropertyValue('--hauteur-de-la-bulle-vocale'),
    }));
    verifier(`${clarte} : la bulle fermée, le champ revient et la réserve tombe`, apres.champ && !apres.reserve && !apres.variable, JSON.stringify(apres));
    if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `telephone-${clarte}-apres.png`) });
    verifier(`${clarte} : aucune erreur ne sort de la page`, erreurs.length === 0, erreurs[0] ?? '');
    await contexte.close();
  }
} catch (e) {
  verifier('le contrôle est allé au bout', false, String(e).slice(0, 400));
} finally {
  if (navigateur) await navigateur.close().catch(() => undefined);
  couperVite();
  nettoyer();
}

const rates = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - rates}/${resultats.length} contrôles passés`);
process.exit(rates ? 1 : 0);
