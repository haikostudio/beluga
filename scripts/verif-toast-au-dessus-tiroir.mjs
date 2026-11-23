#!/usr/bin/env node
/**
 * UN TOAST RESTE VISIBLE AU-DESSUS D'UN TIROIR OUVERT — pas seulement à
 * z-index égal dans le JSX. Vérifié dans un VRAI navigateur, sur son PROPRE
 * démon (base neuve, dossier de projets vide, port libre : le démon de
 * production n'est pas touché, aucun moteur appelé, aucun quota dépensé).
 *
 * Le défaut corrigé : le tiroir (`Drawer`) est posé par un portail Radix,
 * ajouté en fin de `<body>` à son ouverture — à `z-index` égal (`z-50` des
 * deux côtés), il finissait donc APRÈS les toasts dans le document et les
 * recouvrait, quel que soit l'ordre dans le JSX. Les toasts portent
 * maintenant `z-[100]`, au-dessus de tout le reste de l'application.
 *
 *   node scripts/verif-toast-au-dessus-tiroir.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_TOAST_PORT || 7204);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, PROJETS, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-toast-',
  port: PORT,
  env: {
    BELUGA_WEB: process.env.BELUGA_WEB_ESSAI || path.join(RACINE, 'web', 'dist'),
  },
  signaux: true,
});

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
      db.close();
      if (table) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-toast';
const CARTE_ID = 'c-toast';

function poserLeProjet() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification des toasts au-dessus du tiroir',
  );

  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Projet à tiroir',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, 'planned', 0, ?, ?, '{}', ?, ?)`,
  ).run(CARTE_ID, PROJET_ID, 'Carte à ouvrir', 'Sert à ouvrir son tiroir', maintenant, maintenant);
  db.close();
}

async function main() {
  const pretPort = await attendrePort();
  if (!pretPort) throw new Error(`le démon d'essai n'a jamais ouvert le port ${PORT}`);
  const preteBase = await attendreLaBase();
  if (!preteBase) throw new Error('la base du démon d’essai n’est jamais apparue');
  poserLeProjet();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 860 }, locale: 'fr-CH' });
    await contexte.addCookies([
      { name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="planned"]', { timeout: 30000 });
    await page.waitForTimeout(800);

    // Ouvrir le tiroir de la carte.
    await page.click(`[data-carte="${CARTE_ID}"]`);
    const tiroir = page.locator('[role="dialog"][data-state="open"]');
    await tiroir.waitFor({ state: 'visible', timeout: 10000 });
    noter('Le tiroir de la carte s’ouvre', true);

    // Provoquer un vrai toast via le point d'essai (mode développement).
    await page.evaluate(() => {
      (window).belugaEssai.message('success', 'Ligne ajoutée avec succès');
    });
    const toast = page.locator('[data-toast]', { hasText: 'Ligne ajoutée avec succès' });
    await toast.waitFor({ state: 'visible', timeout: 5000 });
    noter('Le toast apparaît pendant que le tiroir est ouvert', true);

    // Le point central du toast doit appartenir au toast lui-même, pas au voile du tiroir.
    const dessus = await page.evaluate(() => {
      const n = Array.from(document.querySelectorAll('[data-toast]')).find((el) =>
        el.textContent?.includes('Ligne ajoutée avec succès'),
      );
      if (!n) return { present: false };
      const r = n.getBoundingClientRect();
      const point = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        present: true,
        atteint: !!point && (n.contains(point) || point === n),
        dessus: point ? `${point.tagName.toLowerCase()}.${String(point.className).slice(0, 60)}` : 'rien',
      };
    });
    noter(
      'Le toast est réellement au premier plan (pas recouvert par le voile du tiroir)',
      dessus.present && dessus.atteint,
      dessus.present ? `sous le point central : ${dessus.dessus}` : 'toast introuvable',
    );

    // Confirmation visuelle par capture d'écran.
    const SHOTS = path.join(RACINE, 'data', 'verification');
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'toast-au-dessus-du-tiroir.png') });

    noter('Aucune erreur JavaScript de page pendant le scénario', erreurs.length === 0, erreurs.join(' | '));
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  if (echecs.length) {
    console.log('Journal du démon :\n' + journal.join(''));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('ÉCHEC :', error);
  console.log('Journal du démon :\n' + journal.join(''));
  process.exitCode = 1;
});
