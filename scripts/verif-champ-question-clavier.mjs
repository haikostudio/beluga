#!/usr/bin/env node
/**
 * LE CHAMP « OU VOTRE PROPRE RÉPONSE » RESTE VISIBLE, CLAVIER OUVERT.
 *
 * Sur iPhone, iOS ramène le champ touché juste au-dessus du clavier sans
 * compter la barre « Répondre / Joindre / Annuler » collée au bas de la zone
 * qui défile : le champ finissait dessous. Ce contrôle, sur un téléphone
 * (390 × 844), avec un FAUX clavier (`visualViewport` remplacé, Chromium sans
 * tête n'en fait pas monter) de 336 px puis de 600 px :
 *
 *  1. une longue question (douze choix + réponse libre) est affichée, et
 *     « Répondre » l'ouvre dans sa feuille du bas ;
 *  2. le champ touché, le clavier monté, son bas est AU-DESSUS du haut de la
 *     barre d'actions ET de la zone que le clavier laisse visible ;
 *  3. la barre d'actions reste elle aussi au-dessus du clavier ;
 *  4. ZONE VISIBLE BLOQUÉE (iOS 26, application installée, captures #2da6 /
 *     #866f) : le faux clavier monte SANS que `visualViewport` bouge, après un
 *     premier clavier mesuré (hauteur retenue posée d'avance). L'application
 *     reprend la hauteur retenue (source « secours ») et le champ comme la
 *     barre restent au-dessus de la zone que le clavier couvre vraiment.
 *
 * Démon d'essai à base neuve : aucun quota, la production n'est pas touchée.
 * Usage : npm run build && node scripts/verif-champ-question-clavier.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7193);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = `${RACINE}/data/verification`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-champ-clavier-'));
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
const CARTE_ID = 'c-essai-clavier';
const QUESTION = `Vérification ${Date.now()} — champ libre au-dessus du clavier`;

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification champ au-dessus du clavier',
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
  ).run(CARTE_ID, PROJET_ID, 'Carte d’essai — champ au-dessus du clavier', maintenant, maintenant, 'Carte posée par un contrôle automatique.', AGENT_ID);
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
      options: Array.from({ length: 12 }, (_, i) => ({
        id: `option-${i + 1}`,
        label: `Option ${i + 1} — choix proposé`,
        description: 'Une explication assez longue pour donner à la question la hauteur d’un écran.',
      })),
      allowFreeText: true,
      answerAttachments: [],
    }],
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id, AGENT_ID, 'assistant', JSON.stringify(message), maintenant,
  );
  db.close();
}

async function essai(navigateur, clavier, { bloque = false } = {}) {
  const nom = bloque ? `clavier ${clavier} px, zone visible bloquée` : `clavier ${clavier} px`;
  const context = await navigateur.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'fr-CH', serviceWorkers: 'block',
  });
  await context.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  /* LE FAUX CLAVIER : `visualViewport` rétrécit quand un champ a le curseur. */
  await context.addInitScript(({ hauteur, bloque }) => {
    /* Bloquée : la zone visible ne bouge jamais, mais un clavier a déjà été mesuré dans cette orientation. */
    if (bloque) localStorage.setItem('beluga:clavier-retenu:portrait', String(hauteur));
    const cible = new EventTarget();
    let ouvert = false;
    const vue = {
      get width() { return window.innerWidth; },
      get height() { return window.innerHeight - (ouvert && !bloque ? hauteur : 0); },
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
  }, { hauteur: clavier, bloque });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${CARTE_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const bloc = page.locator('[data-question-agent]').filter({ hasText: QUESTION }).first();
    await bloc.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    if (!(await bloc.count())) {
      noter(`${nom} : la question est affichée`, false);
      await page.screenshot({ path: `${SHOTS}/champ-clavier-${clavier}-introuvable.png` });
      return;
    }
    /* Sur téléphone, la question se réduit à « Répondre », qui ouvre la feuille du bas. */
    await bloc.locator('[data-repondre-question]').first().tap();
    const feuille = page.locator('[data-feuille-question]').first();
    await feuille.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(600);
    /* AUCUN ESPACE SOUS LA BARRE (capture #c913, 28/10/2026) : défilée à mi-course, la
       barre colle au BORD de la zone qui défile — pas une bande où le texte passe dessous. */
    const bas = await page.evaluate(() => {
      const barre = document.querySelector('[data-feuille-question] [data-actions-question]');
      let zone = barre?.parentElement ?? null;
      while (zone && !['auto', 'scroll'].includes(getComputedStyle(zone).overflowY)) zone = zone.parentElement;
      if (!barre || !zone) return null;
      zone.scrollTop = Math.max(0, (zone.scrollHeight - zone.clientHeight) / 2);
      const b = barre.getBoundingClientRect();
      const z = zone.getBoundingClientRect();
      return { ecart: Math.round(z.bottom - b.bottom), defile: zone.scrollHeight > zone.clientHeight };
    });
    if (clavier === 336 && !bloque) noter('la barre « Répondre / Joindre / Annuler » colle au bas de la feuille, sans espace dessous', !!bas && Math.abs(bas.ecart) <= 1, JSON.stringify(bas));
    const champ = feuille.locator('[data-champ-reponse-question]');
    /* Le champ est amené juste SOUS la barre collée, comme iOS le laisse. */
    await champ.evaluate((el) => {
      const barre = el.closest('[data-feuille-question]')?.querySelector('[data-actions-question]');
      let zone = el.parentElement;
      while (zone && !/(auto|scroll)/.test(getComputedStyle(zone).overflowY)) zone = zone.parentElement;
      if (zone && barre) zone.scrollTop += el.getBoundingClientRect().top - barre.getBoundingClientRect().top + 10;
    });
    await champ.tap();
    await page.waitForTimeout(1400);
    const lu = await champ.evaluate((el, { hauteur, bloque }) => {
      const barre = el.closest('[data-feuille-question]')?.querySelector('[data-actions-question]');
      const c = el.getBoundingClientRect();
      const b = barre?.getBoundingClientRect();
      const vv = window.visualViewport;
      return {
        focus: document.activeElement === el,
        champHaut: Math.round(c.top), champBas: Math.round(c.bottom),
        barreHaut: b ? Math.round(b.top) : null, barreBas: b ? Math.round(b.bottom) : null,
        // Bloquée, la zone visible ment : le bas réellement visible est au-dessus du clavier simulé.
        basVisible: Math.round(bloque ? window.innerHeight - hauteur : vv.offsetTop + vv.height),
        source: document.documentElement.getAttribute('data-clavier-source'),
      };
    }, { hauteur: clavier, bloque });
    if (bloque) noter(`${nom} : la hauteur retenue prend le relais`, lu.source === 'secours', JSON.stringify(lu));
    noter(`${nom} : le champ a le curseur`, lu.focus);
    noter(`${nom} : le champ est au-dessus de la barre d'actions`, lu.barreHaut !== null && lu.champBas <= lu.barreHaut, JSON.stringify(lu));
    noter(`${nom} : le champ est au-dessus du clavier`, lu.champBas <= lu.basVisible && lu.champHaut >= 0, JSON.stringify(lu));
    noter(`${nom} : la barre d'actions est au-dessus du clavier`, lu.barreBas !== null && lu.barreBas <= lu.basVisible + 1, JSON.stringify(lu));
    await page.screenshot({ path: `${SHOTS}/champ-clavier-${clavier}${bloque ? '-bloque' : ''}.png` });
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
    for (const clavier of [336, 600]) await essai(navigateur, clavier);
    await essai(navigateur, 336, { bloque: true });
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
