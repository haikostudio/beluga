#!/usr/bin/env node
/**
 * Le bloc du cerveau est-il clair ET actionnable ?
 *
 * On lève un démon d'essai sur SA propre base (le code qu'on vient de
 * construire, pas l'application publiée), on ouvre les réglages, onglet
 * Système, et on vérifie deux états :
 *   1. sans clé : UNE seule ligne d'état, un champ de saisie avec son bouton,
 *      et pas de liste d'erreurs qui répète le même problème ;
 *   2. après saisie : l'état passe à « posée », le champ disparaît, le bouton
 *      « Envoyer maintenant » revient et répond pour de vrai.
 *
 *   node scripts/verif-cerveau-reglages.mjs
 *
 * Le fichier d'environnement visé est un fichier TEMPORAIRE : la machine n'est
 * pas touchée, et la base neuve ne porte aucun projet — donc rien ne part sur
 * le réseau.
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-cerveau-'));
const DATA = path.join(TMP, 'data');
const ENV_FILE = path.join(TMP, 'haikodev.env');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7108);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(RACINE, 'data', 'verification');
const CLE_ESSAI = 'sk-essai-cerveau-0123456789';

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
      // On juge d'abord l'écran « sans clé », et la clé posée à l'écran ira
      // dans un fichier temporaire : /etc n'est pas touché.
      CERVEAU_API_KEY: '',
      HAIKODEV_ENV_FILE: ENV_FILE,
    },
    stdio: 'ignore',
  });
}

async function main() {
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
    // Une tentative ratée dans le journal : sans clé, elle ne doit PAS être
    // affichée — elle ne ferait que redire la ligne d'état.
    db.prepare('INSERT INTO cerveau_log (at, project, ok, files, error) VALUES (?,?,?,?,?)').run(
      maintenant - 60_000,
      null,
      0,
      0,
      'aucune clé (CERVEAU_API_KEY)',
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

    await page.locator('header button').last().click();
    await page.waitForTimeout(700);
    await page.getByText('Réglages', { exact: true }).first().click();
    await page.waitForTimeout(2000);

    const tiroir = page.locator('[role="dialog"]').last();
    noter('le tiroir des réglages est ouvert', await tiroir.isVisible());

    const bloc = tiroir.locator('section', { hasText: 'Mémoire envoyée au cerveau' }).last();
    noter("le bloc du cerveau est dans l'onglet Système", (await bloc.count()) > 0);
    noter("l'adresse du service est affichée", (await bloc.getByText(/memoire\.haiko-s1\.com/).count()) > 0);

    /* ---- État 1 : la clé manque ---- */
    const texte = (await bloc.innerText()).replace(/\s+/g, ' ');
    noter("l'absence de clé se dit UNE fois", (texte.match(/clé du cerveau n'est pas encore posée/g) ?? []).length === 1);
    noter(
      "le problème n'est pas répété par une liste d'erreurs",
      !/Dernières erreurs/.test(texte) && !/aucune clé \(CERVEAU_API_KEY\)/.test(texte),
      texte.slice(0, 200),
    );
    noter("l'explication tient en une phrase", (texte.match(/\./g) ?? []).length <= 4, texte.slice(0, 200));

    const champ = bloc.locator('input[type="password"]');
    noter('un champ de saisie est proposé dans le bloc', (await champ.count()) === 1);
    const enregistrer = bloc.getByRole('button', { name: /Enregistrer/ });
    noter("le bouton d'enregistrement est là", (await enregistrer.count()) === 1);
    noter(
      "« Envoyer maintenant » ne s'affiche pas tant que rien ne peut partir",
      (await bloc.getByRole('button', { name: /Envoyer maintenant/ }).count()) === 0,
    );

    fs.mkdirSync(SHOTS, { recursive: true });
    await bloc.screenshot({ path: `${SHOTS}/cerveau-01-sans-cle.png` });

    /* ---- Le geste : poser la clé ---- */
    await champ.fill(CLE_ESSAI);
    await enregistrer.click();
    await page.waitForTimeout(2500);

    noter(
      "la clé est rangée là où le serveur la lit",
      fs.existsSync(ENV_FILE) && fs.readFileSync(ENV_FILE, 'utf8').includes(`CERVEAU_API_KEY=${CLE_ESSAI}`),
    );

    /* ---- État 2 : la clé est posée ---- */
    const apres = (await bloc.innerText()).replace(/\s+/g, ' ');
    noter("l'état ne réclame plus la clé", !/n'est pas encore posée/.test(apres), apres.slice(0, 200));
    noter('le champ de saisie a disparu', (await bloc.locator('input[type="password"]').count()) === 0);
    const bouton = bloc.getByRole('button', { name: /Envoyer maintenant/ });
    noter('« Envoyer maintenant » est revenu', (await bouton.count()) === 1);
    await bloc.screenshot({ path: `${SHOTS}/cerveau-02-cle-posee.png` });

    /* ---- Le bouton répond pour de vrai (base neuve : aucun projet, rien ne part) ---- */
    await bouton.click();
    const reponse = await page
      .getByText(/Rien de nouveau à envoyer|fichiers? pour|envoi impossible/i)
      .first()
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    noter("l'envoi répond au lieu de se taire", reponse);
    await tiroir.screenshot({ path: `${SHOTS}/cerveau-03-apres-envoi.png` });

    noter('aucune erreur dans la console', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    if (navigateur) await navigateur.close();
    demon.kill('SIGTERM');
    fs.rmSync(TMP, { recursive: true, force: true });
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
