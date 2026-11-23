#!/usr/bin/env node
/**
 * LE PANNEAU DES QUOTAS, RANGÉ PAR MOTEUR, DANS UN VRAI NAVIGATEUR (carte « Médias : aperçu en modale, fiche en
 * tiroir », 05/11/2026, capture #8527).
 *
 * Quatre promesses :
 *   1. les comptes sont rangés sous un titre par moteur, dans l'ordre de « Comptes et quotas » ;
 *   2. un moteur dont aucun compte ne sert (tous coupés) est replié d'office, sur sa seule ligne de titre ;
 *   3. un clic sur un titre replie ou déplie le groupe, sans refermer le panneau ;
 *   4. ce choix est RETENU dans les réglages — donc sur tous les appareils : il tient après un rechargement.
 *
 *   node scripts/verif-groupes-quotas.mjs
 *
 * Démon à soi, base neuve, HOME à soi : les comptes réels de la machine ne sont ni lus ni touchés. Les comptes posés
 * sont FICTIFS (coffres d'essai) ; aucun relevé réel n'aboutit.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-groupes-quotas-'));
const CAPTURES = process.env.HAIKO_GROUPES_QUOTAS_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const HOME = path.join(TMP, 'home');
const coffre = (nom) => path.join(TMP, 'coffres', nom);
const COMPTES = [
  { id: 'claude-a', engine: 'claude', label: 'Claude Perso', priority: 10, configDir: coffre('claude-a') },
  { id: 'codex-a', engine: 'codex', label: 'Codex - Pro', priority: 10, configDir: coffre('codex-a') },
  { id: 'codex-b', engine: 'codex', label: 'Codex - Privé', priority: 20, configDir: coffre('codex-b') },
  { id: 'mimo-a', engine: 'mimo', label: 'MiMo — compte principal', priority: 10, configDir: coffre('mimo-a'), disabled: true },
];
const { DATA, journal, attendrePort } = demarrerDemonDEssai({
  tmp: TMP,
  port: PORT,
  dossiers: [HOME, ...COMPTES.map((c) => c.configDir)],
  env: { HOME, BELUGA_CODEX_COFFRES_A_REPRENDRE: '', CURSOR_API_KEY: '' },
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

function poserLeDecor() {
  for (const c of COMPTES) {
    fs.mkdirSync(c.configDir, { recursive: true });
    /* Un coffre Codex « connecté » aux yeux du démon (clé posée), sans rien de réel derrière. */
    if (c.engine === 'codex') fs.writeFileSync(path.join(c.configDir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-essai' }));
  }
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now() - 60_000;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t, t + 3600_000, 'vérification des groupes du panneau des quotas');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM accounts').run();
  for (const c of COMPTES) db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(c.id, c.engine, JSON.stringify(c), t);
  db.close();
}

const reglagesEnBase = () => {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  try {
    return JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  } finally {
    db.close();
  }
};

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}
poserLeDecor();

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let sortie = 1;
try {
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-essai="badge-quota"]', { timeout: 60000 });

  /* L'assistant de démarrage peut barrer l'écran (aucun moteur réellement joignable) : on ouvre le panneau par son
     déclencheur lui-même, sans passer par le point de l'écran. */
  const ouvrirLePanneau = async () => {
    const declencheur = page.locator('[data-essai="badge-quota"]').first();
    for (let i = 0; i < 3 && !(await page.locator('[data-groupes-quota]').count()); i++) {
      await declencheur.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse', isPrimary: true });
      await page.waitForTimeout(400);
      if (!(await page.locator('[data-groupes-quota]').count())) await declencheur.press('Enter').catch(() => undefined);
      await page.waitForTimeout(400);
    }
    await page.waitForSelector('[data-groupes-quota]', { timeout: 15000 });
  };
  await ouvrirLePanneau();
  /* Les comptes ont été posés après le démarrage : « Actualiser » fait relire les quotas. */
  await page.locator('[data-groupes-quota]').locator('xpath=ancestor::*[@role="menu"][1]').getByTitle('Actualiser').click().catch(() => undefined);
  await page.waitForFunction(() => document.querySelectorAll('[data-groupe-quota]').length >= 3, null, { timeout: 30000 }).catch(() => undefined);
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'panneau-groupes.png') });

  const groupes = await page.evaluate(() => [...document.querySelectorAll('[data-groupe-quota]')].map((g) => ({ moteur: g.getAttribute('data-groupe-quota'), replie: g.hasAttribute('data-replie'), cartes: g.querySelectorAll('[data-carte-quota]').length })));
  const ordre = groupes.map((g) => g.moteur).join(' ');
  noter('les comptes sont rangés sous un titre par moteur, dans l’ordre des réglages', ordre.startsWith('claude codex') && ordre.includes('mimo'), ordre);
  const codex = groupes.find((g) => g.moteur === 'codex');
  noter('un moteur en service est ouvert, avec ses comptes', !!codex && !codex.replie && codex.cartes === 2, JSON.stringify(codex));
  const mimo = groupes.find((g) => g.moteur === 'mimo');
  noter('un moteur dont tous les comptes sont coupés est replié d’office, sur sa seule ligne de titre', !!mimo && mimo.replie && mimo.cartes === 0, JSON.stringify(mimo));

  await page.locator('[data-titre-groupe-quota="codex"]').click();
  await page.waitForTimeout(400);
  noter('un clic sur le titre replie le groupe, sans refermer le panneau', (await page.locator('[data-groupe-quota="codex"][data-replie]').count()) === 1 && (await page.locator('[data-groupes-quota]').count()) === 1);
  await page.locator('[data-titre-groupe-quota="mimo"]').click();
  await page.waitForTimeout(400);
  noter('un clic sur un groupe replié d’office le déplie', (await page.locator('[data-groupe-quota="mimo"]:not([data-replie]) [data-carte-quota="mimo-a"]').count()) === 1);
  await page.waitForFunction(() => true);
  const enBase = await (async () => {
    for (let i = 0; i < 20; i++) {
      const r = reglagesEnBase().groupesQuotaReplies;
      if (r && r.codex === true && r.mimo === false) return r;
      await page.waitForTimeout(250);
    }
    return reglagesEnBase().groupesQuotaReplies;
  })();
  noter('le choix est retenu dans les réglages (partagés entre appareils)', enBase?.codex === true && enBase?.mimo === false, JSON.stringify(enBase));

  /* UN AUTRE APPAREIL : un second navigateur, neuf, qui ne partage rien que le démon. */
  /* Un écran d'ordinateur portable : le panneau des quotas y est au pied de la colonne, comme sur le premier. */
  const autre = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await autre.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const tel = await autre.newPage();
  await tel.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.close();
  const pageTel = tel;
  await pageTel.waitForSelector('[data-essai="badge-quota"]', { timeout: 60000 });
  const declencheur = pageTel.locator('[data-essai="badge-quota"]').first();
  for (let i = 0; i < 3 && !(await pageTel.locator('[data-groupes-quota]').count()); i++) {
    await declencheur.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse', isPrimary: true });
    await pageTel.waitForTimeout(400);
    if (!(await pageTel.locator('[data-groupes-quota]').count())) await declencheur.press('Enter').catch(() => undefined);
    await pageTel.waitForTimeout(400);
  }
  await pageTel.waitForSelector('[data-groupe-quota="codex"]', { timeout: 20000 }).catch(() => undefined);
  if (CAPTURES) await pageTel.screenshot({ path: path.join(CAPTURES, 'panneau-groupes-autre-appareil.png') });
  noter(
    'sur un autre appareil, les groupes gardent le choix fait ailleurs',
    (await pageTel.locator('[data-groupe-quota="codex"][data-replie]').count()) === 1 && (await pageTel.locator('[data-groupe-quota="mimo"]:not([data-replie])').count()) === 1,
  );
  sortie = resultats.every((r) => r.ok) ? 0 : 1;
} catch (err) {
  noter('le contrôle est allé au bout', false, String(err?.message ?? err).split('\n')[0]);
} finally {
  await navigateur.close().catch(() => undefined);
  console.log(`\n${resultats.filter((r) => r.ok).length}/${resultats.length} contrôles passés.`);
  process.exit(sortie);
}
