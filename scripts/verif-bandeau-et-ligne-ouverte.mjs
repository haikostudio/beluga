#!/usr/bin/env node
/**
 * LE BANDEAU DU FIL D'ARIANE ET L'AGENT OUVERT DANS LA COLONNE (01/11/2026, captures #10c2 et #e118).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-bandeau-et-ligne-ouverte.mjs
 *
 * Démon d'essai sur une base neuve, port à soi, aucun moteur lancé. Sur ordinateur, en sombre puis en clair :
 *   1. la carte ouverte a un fond léger sous son projet ET dans « En cours » ; les autres lignes n'en ont pas ;
 *   2. la barre du fil d'Ariane a son fond, commence au bord de la colonne de gauche et porte une ombre à gauche ;
 *   3. en clair, ce fond est plus foncé que la page ; en sombre, un cran au-dessus ;
 *   4. la barre des étapes de la carte laisse un vrai écart sous le bandeau.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7247);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.BELUGA_VERIF_CAPTURES;
const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-bandeau-', port: PORT });
const jeton = crypto.randomBytes(32).toString('hex');
const T = Date.now();
const run = { engine: 'claude', thinking: 'none', mode: 'direct' };

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai');
  const p = { id: 'p-essai', name: 'Essai', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: T, updatedAt: T };
  db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run('p-essai', 'Essai', DEPOT, JSON.stringify(p), T, T);
  for (const [id, titre] of [['c-ouverte', 'Carte ouverte'], ['c-autre', 'Autre carte']]) {
    const c = { id, projectId: 'p-essai', title: titre, description: '', labels: [], column: 'running', position: T, origin: 'user', attachments: [], run, excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, agentId: `ag-${id}`, parcours: { plans: [] }, createdAt: T, updatedAt: T };
    db.prepare('INSERT OR REPLACE INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)').run(id, 'p-essai', 'running', T, titre, JSON.stringify(c), T, T);
    const a = { id: `ag-${id}`, projectId: 'p-essai', cardId: id, role: 'task', title: 'Agent', run, status: 'running', createdAt: T, updatedAt: T };
    db.prepare('INSERT OR REPLACE INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(a.id, 'p-essai', id, 'task', 'running', JSON.stringify(a), T, T);
  }
  db.close();
}

const fond = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const cs = getComputedStyle(e.matches('[data-agent-en-liste],[data-agent-en-cours]') ? e.querySelector('button') : e);
    return { fond: cs.backgroundColor, ombre: cs.boxShadow, gauche: e.getBoundingClientRect().left };
  }, sel);
const clarte = (rgb) => {
  const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?/.exec(rgb ?? '');
  return m ? { l: (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3, a: m[4] === undefined ? 1 : Number(m[4]) } : null;
};

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const schema of ['dark', 'light']) {
      const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block', colorScheme: schema });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const serveurs = [];
      await page.routeWebSocket(/.*/, (ws) => {
        const serveur = ws.connectToServer();
        ws.onMessage((m) => serveur.send(m));
        serveur.onMessage((m) => ws.send(m));
        serveurs.push(serveur);
      });
      await page.goto(`${BASE}/#projet/p-essai/tache/c-ouverte`);
      await page.locator('[data-page-carte="c-ouverte"]').waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(1500);
      /* Le thème se règle comme depuis le menu : le réglage général, diffusé à l'écran ouvert. */
      for (const sv of serveurs) sv.send(JSON.stringify({ id: `theme-${schema}`, cmd: { type: 'prefs.set', key: 'theme', value: schema === 'dark' ? 'sombre' : 'clair' } }));
      await page.waitForTimeout(1200);
      const sombre = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      const nom = sombre ? 'sombre' : 'clair';
      noter(`${nom} : le thème demandé est appliqué`, sombre === (schema === 'dark'));
      const ouverte = await fond(page, '[data-agent-en-liste="c-ouverte"]');
      const autre = await fond(page, '[data-agent-en-liste="c-autre"]');
      const enCours = await fond(page, '[data-agent-en-cours="c-ouverte"]');
      const visible = (f) => (clarte(f?.fond)?.a ?? 0) > 0;
      noter(`${nom} : la carte ouverte a un fond léger sous son projet`, visible(ouverte) && !visible(autre), `${ouverte?.fond} / autre ${autre?.fond}`);
      noter(`${nom} : et dans « En cours »`, enCours === null || visible(enCours), enCours ? enCours.fond : 'zone absente');
      const entete = await fond(page, '[data-page-carte="c-ouverte"] header[data-entete-de-zone]');
      const colonne = await page.evaluate(() => document.querySelector('aside[data-zone="gauche"]')?.getBoundingClientRect().right ?? null);
      const pageFond = await page.evaluate(() => getComputedStyle(document.querySelector('[data-page-de-zone]') ?? document.body).backgroundColor);
      noter(`${nom} : la barre du fil d'Ariane a son fond`, visible(entete) && entete.fond !== pageFond, `${entete?.fond} sur ${pageFond}`);
      noter(`${nom} : elle commence au bord de la colonne`, colonne !== null && Math.abs(entete.gauche - colonne) <= 1, `${entete?.gauche} / ${colonne}`);
      noter(`${nom} : une ombre à gauche la détache`, /inset/.test(entete?.ombre ?? ''), entete?.ombre);
      const ecart = await page.evaluate(() => {
        const h = document.querySelector('[data-page-carte] header[data-entete-de-zone]')?.getBoundingClientRect();
        const b = document.querySelector('[data-page-carte] [data-barre-du-fil] [data-etape], [data-page-carte] [data-barre-du-fil] > *:not(:empty)')?.getBoundingClientRect();
        return h && b ? Math.round(b.top - h.bottom) : null;
      });
      noter(`${nom} : la barre des étapes respire sous le bandeau`, ecart !== null && ecart >= 14, `${ecart} px`);
      const e = clarte(entete?.fond)?.l ?? 0;
      const p = clarte(pageFond)?.l ?? 0;
      noter(`${nom} : ${sombre ? 'un cran au-dessus' : 'légèrement plus foncé que'} la page`, sombre ? e > p : e < p && p - e < 20, `${e.toFixed(0)} / ${p.toFixed(0)}`);
      if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `bandeau-${nom}.png`) });
      await contexte.close();
    }
  } finally {
    await navigateur.close();
  }
  const reussis = resultats.filter(Boolean).length;
  console.log(`\n${reussis}/${resultats.length} vérifications`);
  process.exit(reussis === resultats.length ? 0 : 1);
}
principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
