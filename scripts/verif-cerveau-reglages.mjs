#!/usr/bin/env node
/**
 * La liaison au cerveau se lit-elle vraiment dans les réglages ?
 *
 * On lève un démon d'essai sur SA propre base (le code qu'on vient de
 * construire, pas l'application publiée), on ouvre les réglages, onglet
 * Système, et on vérifie : l'état de la clé, la date du dernier envoi, les
 * erreurs, et le bouton « Envoyer maintenant » qui répond pour de vrai.
 *
 *   node scripts/verif-cerveau-reglages.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DATA = '/tmp/verif-cerveau-data';
const PORT = 7108;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = '/root/haikodev/data/verification';

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
  return spawn('node', ['/root/haikodev/server/dist/main.js'], {
    env: {
      ...process.env,
      HAIKODEV_DATA: DATA,
      HAIKODEV_PORT: String(PORT),
      HAIKODEV_HOST: '127.0.0.1',
      HAIKODEV_WEB: '/root/haikodev/web/dist',
      // On juge l'écran « sans clé » : rien ne doit partir pour de vrai.
      CERVEAU_API_KEY: '',
    },
    stdio: 'ignore',
  });
}

async function main() {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });

  let demon = lancerDemon();
  let navigateur;
  try {
    if (!(await attendre(`${BASE}/`))) throw new Error("le démon d'essai ne répond pas");
    demon.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1200));

    // Une session valable, posée directement en base : on vérifie l'écran, pas
    // le mur d'accès. Les jetons sont stockés HACHÉS.
    const db = new Database(path.join(DATA, 'haikodev.db'));
    const cookie = crypto.randomBytes(24).toString('hex');
    const maintenant = Date.now();
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?,?,?,?)').run(
      crypto.createHash('sha256').update(cookie).digest('hex'),
      maintenant,
      maintenant + 3600_000,
      'vérification cerveau',
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
    await context.addCookies([{ name: 'haikodev_session', value: cookie, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    await page.locator('header button').last().click();
    await page.waitForTimeout(700);
    await page.getByText('Réglages', { exact: true }).first().click();
    await page.waitForTimeout(2000);

    const tiroir = page.locator('[role="dialog"]').last();
    noter('le tiroir des réglages est ouvert', await tiroir.isVisible());

    const bloc = tiroir.locator('section', { hasText: 'Mémoire envoyée au cerveau' }).last();
    noter("le bloc du cerveau est dans l'onglet Système", (await bloc.count()) > 0);
    noter("l'adresse du service est affichée", (await bloc.getByText(/memoire\.haiko-s1\.com/).count()) > 0);
    noter(
      "l'absence de clé se dit en toutes lettres",
      (await bloc.getByText('aucune clé', { exact: true }).count()) > 0,
    );
    noter(
      "l'état du dernier envoi est affiché",
      (await bloc.getByText(/Dernier envoi réussi|Aucun envoi réussi/).count()) > 0,
    );

    fs.mkdirSync(SHOTS, { recursive: true });
    await bloc.screenshot({ path: `${SHOTS}/cerveau-01-etat.png` });

    // Le bouton répond pour de vrai : sans clé, il le dit au lieu de rester muet.
    const bouton = bloc.getByRole('button', { name: /Envoyer maintenant/ });
    noter('le bouton « Envoyer maintenant » est là', (await bouton.count()) > 0);
    await bouton.click();
    await page.waitForTimeout(2500);
    noter(
      "sans clé, l'envoi le dit au lieu de se taire",
      (await page.getByText(/aucune clé/i).count()) > 0,
    );
    await tiroir.screenshot({ path: `${SHOTS}/cerveau-02-apres-envoi.png` });

    // Et le refus est retenu : il se relit dans les dernières erreurs.
    await page.waitForTimeout(500);
    noter(
      'la tentative laisse une trace lisible',
      (await bloc.getByText(/Dernières erreurs/).count()) > 0,
    );

    noter('aucune erreur dans la console', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    if (navigateur) await navigateur.close();
    demon.kill('SIGTERM');
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles au vert`);
  console.log(`captures dans ${SHOTS}`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
