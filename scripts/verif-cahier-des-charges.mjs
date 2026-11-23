#!/usr/bin/env node
/**
 * LE CAHIER DES CHARGES D'UN NOUVEAU PROJET, DANS UN VRAI NAVIGATEUR.
 *
 *  - la fenêtre « Nouveau projet » porte la case « Démarrer par un cahier des
 *    charges », cochée d'office ; l'onglet GitHub porte la sienne, décochée ;
 *  - la carte « Cahier des charges » montre son avancement sur le tableau ;
 *  - ouverte, elle n'a plus de bandeau (ni compteur, ni jauge, ni pause) ;
 *  - « Lire », dernière ligne du fil, ouvre le document, découpé en parties ;
 *  - une pause posée par le démon rend la barre d'écriture, la reprise la lève.
 *
 *   node scripts/verif-cahier-des-charges.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * aucun agent autorisé à démarrer (`maxAgents: 0`) : la reprise met sa demande
 * en file, aucun moteur n'est appelé.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { ouvrirLesTableauxDeBord } from './lib/navigation.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7197);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'verification');
const PROJET_ID = 'p-cahier';
const CARTE_ID = 'c-cahier';
const AGENT_ID = 'a-cahier';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-cahier-', port: PORT });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now() - 60_000;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3600_000,
    'vérification cahier des charges',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  for (const table of ['proposals', 'messages', 'agents', 'cards', 'projects']) db.prepare(`DELETE FROM ${table}`).run();

  const projet = {
    id: PROJET_ID,
    name: 'Essai cahier',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);

  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    title: 'Cahier des charges',
    description: 'Établir le cahier des charges du projet « Essai cahier ».',
    briefing: 'Démarrer le projet « Essai cahier » par un cahier des charges.',
    labels: [],
    column: 'planned',
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    scheduling: { asap: false, attempts: 0, restarts: 0, suspendu: false },
    excludedFromDeploy: false,
    horsTache: false,
    cahierDesCharges: { faites: 3, total: 12, phase: 'interfaces', restants: ['Interfaces', 'Paiement'], majA: t },
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, 'planned', 1, ?, ?, ?, ?)`,
  ).run(CARTE_ID, PROJET_ID, carte.title, JSON.stringify(carte), t, t);

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    cardId: CARTE_ID,
    role: 'cadrage',
    title: 'Cahier des charges',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'done',
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, 'cadrage', 'done', ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, CARTE_ID, JSON.stringify(agent), t, t);
  db.close();

  fs.mkdirSync(path.join(DEPOT, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(DEPOT, 'docs', 'cahier-des-charges.md'),
    '# Cahier des charges — Essai cahier\n\n## Vision\nRéserver des courts de tennis.\n\n## Interfaces\nà voir\n\n## Fonctionnalités\nà voir\n',
  );
}

const cahierEnBase = () => {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(CARTE_ID);
  db.close();
  return ligne ? JSON.parse(ligne.data).cahierDesCharges : null;
};

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomUUID();
    w.on('open', () => w.send(JSON.stringify({ id, cmd })));
    w.on('message', (brut) => {
      const ev = JSON.parse(String(brut));
      if (ev.type === 'ack' && ev.id === id) {
        w.close();
        ev.ok === false ? reject(new Error(ev.error)) : resolve(ev.data);
      }
    });
    w.on('error', reject);
  });
}

async function attendreQue(condition, delai = 10000) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  page.setDefaultTimeout(10000);

  /* ---------- 1. Le tableau ---------- */
  await page.goto(`${BASE}/#projet/${PROJET_ID}`, { waitUntil: 'domcontentloaded' });
  const carte = page.locator(`article[data-carte="${CARTE_ID}"]`);
  await carte.waitFor({ timeout: 20000 });
  const repere = carte.locator('[data-repere-cahier]');
  noter('la carte du tableau montre l’avancement', (await repere.getAttribute('data-repere-cahier')) === 'en-cours', await repere.innerText());

  /* ---------- 2. Plus de bandeau (21/10/2026) ---------- */
  await carte.click();
  const lecture = page.locator(`[data-volet-cahier] [data-barre-cahier] [data-lecture-du-cahier="cahier"]`).first();
  await lecture.waitFor({ timeout: 15000 });
  noter(
    'plus de bandeau : ni compteur, ni jauge, ni pause',
    (await page.locator('[data-cahier-des-charges], [data-cahier-avancement], [data-cahier-jauge], [data-cahier-pause]').count()) === 0,
  );
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, 'cahier-volet.png') });

  /* ---------- 3. Le document, lu depuis la rangée d'action ---------- */
  await lecture.locator('[data-cahier-lire]').click();
  const tiroir = page.locator(`[data-tiroir-cahier="${PROJET_ID}"]`);
  await tiroir.locator('[data-cahier-partie]').first().waitFor({ timeout: 10000 });
  const tranchees = await tiroir.locator('[data-cahier-partie="tranchee"]').count();
  const aVoir = await tiroir.locator('[data-cahier-partie="a-voir"]').count();
  noter('le document s’ouvre, découpé en parties', tranchees >= 1 && aVoir === 2, `${tranchees} tranchée(s), ${aVoir} à voir`);
  await page.screenshot({ path: path.join(SHOTS, 'cahier-document.png') });
  noter('le texte du document est lu sur le disque', /Réserver des courts/.test(await tiroir.innerText()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  /* ---------- 4. Une pause posée par le démon : on reprend en écrivant ---------- */
  await commande({ type: 'card.cahierPause', id: CARTE_ID });
  noter('la pause se pose en base', await attendreQue(() => !!cahierEnBase()?.enPauseA));
  noter('le tableau dit « En pause »', await attendreQue(async () => (await repere.getAttribute('data-repere-cahier')) === 'en-pause'));
  noter(
    'en pause : la barre d’écriture paraît pour reprendre en écrivant',
    await attendreQue(async () => (await page.locator('[data-composer] textarea:visible').count()) >= 1),
  );
  await commande({ type: 'card.cahierReprendre', id: CARTE_ID });
  noter('la reprise lève la pause en base', await attendreQue(() => !cahierEnBase()?.enPauseA));

  /* ---------- 5. La case de la fenêtre « Nouveau projet » ---------- */
  /* Le « + » de la liste des projets n'est à l'écran que sur les tableaux de
     bord (refonte du 11/10/2026) : on y remonte d'abord. */
  await page.goto(`${BASE}/#projet/${PROJET_ID}`, { waitUntil: 'domcontentloaded' });
  await carte.waitFor({ timeout: 20000 });
  await ouvrirLesTableauxDeBord(page);
  await page.waitForTimeout(500);
  await page.locator('[data-menu-dossier]:visible').first().click();
  await page.locator('[data-ouvrir-projets]:visible').first().click();
  await page.waitForTimeout(700);
  await page.getByRole('tab', { name: 'Nouveau projet' }).click();
  // 18/11/2026 : le cahier d'un projet vide est OBLIGATOIRE — une phrase le dit, plus d'interrupteur.
  noter('le cahier est obligatoire pour un projet vide, sans interrupteur', (await page.locator('[data-cahier-obligatoire]').count()) === 1 && (await page.locator('[data-case-cahier="vide"]').count()) === 0);
  await page.getByRole('tab', { name: /GitHub/ }).click();
  const caseGithub = page.locator('[data-case-cahier="github"] [role="switch"]');
  noter('la case est décochée pour un dépôt importé', (await caseGithub.getAttribute('aria-checked')) === 'false');

  noter('aucune erreur dans la page', erreurs.length === 0, erreurs.join(' | '));
  await navigateur.close();
}

try {
  await main();
} catch (err) {
  noter('le parcours s’est déroulé jusqu’au bout', false, String(err?.message ?? err));
} finally {
  demon.kill('SIGTERM');
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(echecs ? `\n${echecs} échec(s).` : '\nTout est vert.');
process.exit(echecs ? 1 : 0);
