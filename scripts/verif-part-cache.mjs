#!/usr/bin/env node
/**
 * La part de l'entrée RELUE AU CACHE est-elle visible dans les réglages ?
 *
 * On lève un démon d'essai sur SA propre base (le code qu'on vient de
 * construire, jamais l'application publiée), on y écrit des tours de
 * consommation dont on connaît la réponse d'avance, on ouvre les réglages,
 * onglet « Consommation », et on lit ce qui s'affiche :
 *
 *   - trois quarts relus sur sept jours → « 75 % » ;
 *   - un tour vieux de trente jours ne compte pas dans la fenêtre ;
 *   - une base sans le moindre tour ne montre pas « 0 % » mais le dit.
 *
 *   node scripts/verif-part-cache.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* La racine du dépôt d'où part CE script : depuis une copie de travail, on juge
   le code de la copie, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Le module natif n'est installé qu'à la racine du projet principal. */
const { default: Database } = await import(
  fs.existsSync(path.join(RACINE, 'node_modules', 'better-sqlite3'))
    ? path.join(RACINE, 'node_modules', 'better-sqlite3', 'lib', 'index.js')
    : '/root/haikodev/node_modules/better-sqlite3/lib/index.js'
);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-cache-'));
const DATA = path.join(TMP, 'data');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7112);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(RACINE, 'data', 'verification');

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

async function attendre(url, essais = 80) {
  for (let i = 0; i < essais; i += 1) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      /* pas encore levé */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function lancerDemon() {
  return spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
    env: {
      ...process.env,
      HAIKODEV_DATA: DATA,
      HAIKODEV_PORT: String(PORT),
      HAIKODEV_HOST: '127.0.0.1',
      HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
      CERVEAU_API_KEY: '',
    },
    stdio: 'ignore',
  });
}

/** Ouvre les réglages sur l'onglet « Consommation » et rend le texte du bloc. */
async function lireLeBloc(page) {
  await page.locator('header button').last().click();
  await page.waitForTimeout(700);
  await page.getByText('Réglages', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const tiroir = page.locator('[role="dialog"]').last();
  await tiroir.getByRole('tab', { name: 'Consommation' }).click();
  await page.waitForTimeout(2000);
  const bloc = tiroir.locator('[data-bloc="part-cache"]').first();
  try {
    await bloc.waitFor({ state: 'visible', timeout: 20000 });
  } catch (err) {
    // Un écran introuvable se regarde : la photo dit tout de suite si le tiroir
    // ne s'est pas ouvert ou si c'est le bloc qui manque.
    await page.screenshot({ path: path.join(SHOTS, 'part-cache-introuvable.png'), fullPage: true }).catch(() => {});
    await page.getByText('Détail technique').first().click().catch(() => {});
    console.log((await page.locator('body').innerText().catch(() => '')).slice(-1500));
    throw err;
  }
  return { tiroir, texte: (await bloc.innerText()).replace(/\s+/g, ' ') };
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  let demon = lancerDemon();
  let navigateur;
  try {
    if (!(await attendre(`${BASE}/`))) throw new Error("le démon d'essai ne répond pas");
    demon.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1200));

    const db = new Database(path.join(DATA, 'haikodev.db'));
    const cookie = crypto.randomBytes(24).toString('hex');
    const maintenant = Date.now();
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?,?,?,?)').run(
      crypto.createHash('sha256').update(cookie).digest('hex'),
      maintenant,
      maintenant + 3600_000,
      'vérification part de cache',
    );
    db.close();

    demon = lancerDemon();
    if (!(await attendre(`${BASE}/`))) throw new Error("le démon d'essai n'est pas reparti");

    navigateur = await chromium.launch({
      channel: 'chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await navigateur.newContext({
      viewport: { width: 1400, height: 900 },
      locale: 'fr-CH',
      serviceWorkers: 'block',
    });
    await context.addCookies([
      { name: 'haikodev_session', value: cookie, url: BASE, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    /* ---- État 1 : aucune consommation relevée ---- */
    const vide = await lireLeBloc(page);
    noter('sans le moindre tour, la part n’est pas inventée', /Aucun tour mesuré/.test(vide.texte), vide.texte.slice(0, 120));
    noter('aucun « 0 % » trompeur sur une fenêtre vide', !/\b0 %/.test(vide.texte));
    await vide.tiroir.screenshot({ path: path.join(SHOTS, 'part-cache-vide.png') }).catch(() => {});
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    /* ---- État 2 : trois quarts relus sur la fenêtre ---- */
    demon.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1200));
    const base2 = new Database(path.join(DATA, 'haikodev.db'));
    const ecrire = base2.prepare(
      `INSERT INTO usage (engine, tokens, input_tokens, cached_tokens, output_tokens, quota_share, quota_5h, quota_semaine, seconds, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`,
    );
    // Dans la fenêtre : 250 000 frais + 750 000 relus = 75 % relus.
    ecrire.run('claude', 1_000_000, 200_000, 600_000, 0, maintenant - 2 * 86_400_000);
    ecrire.run('codex', 200_000, 50_000, 150_000, 0, maintenant - 5 * 86_400_000);
    // Hors fenêtre : ne doit RIEN changer au chiffre affiché.
    ecrire.run('claude', 9_000_000, 9_000_000, 0, 0, maintenant - 30 * 86_400_000);
    base2.close();

    demon = lancerDemon();
    if (!(await attendre(`${BASE}/`))) throw new Error("le démon d'essai n'est pas reparti (2)");
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    const plein = await lireLeBloc(page);
    noter('la part relue est affichée en clair', /75 %/.test(plein.texte), plein.texte.slice(0, 160));
    // Le titre est mis en majuscules par la feuille de style : on lit sans y voir malice.
    noter('la fenêtre annoncée est de 7 jours', /7 derniers jours/i.test(plein.texte));
    noter('les tours hors fenêtre ne sont pas comptés', !/10 %|2 %/.test(plein.texte));
    noter('le détail par moteur est donné', /claude/.test(plein.texte) && /codex/.test(plein.texte));
    await plein.tiroir.screenshot({ path: path.join(SHOTS, 'part-cache.png') }).catch(() => {});

    noter("aucune erreur JavaScript dans la page", erreurs.length === 0, erreurs[0] ?? '');
  } finally {
    if (navigateur) await navigateur.close().catch(() => {});
    demon.kill('SIGTERM');
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés`);
  if (echecs.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
