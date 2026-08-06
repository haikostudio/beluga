#!/usr/bin/env node
/**
 * Ce qui plante dans la page remonte-t-il vraiment au serveur ?
 *
 * On lève un démon d'essai sur SA propre base (le code qu'on vient de
 * construire, jamais l'application publiée), on ouvre la page dans un vrai
 * navigateur, et on provoque des erreurs VOLONTAIRES :
 *   1. une erreur globale de la fenêtre (`throw` hors de React) ;
 *   2. la MÊME, une seconde fois — elle ne doit pas repartir ;
 *   3. une promesse rejetée sans traitement ;
 *   4. une erreur d'affichage, envoyée comme le fait le filet de sécurité.
 * Puis on vérifie le fichier de journal, le bloc des réglages, et le bouton
 * « Tout effacer ».
 *
 *   node scripts/verif-erreurs-interface.mjs
 *
 * Rien de la machine n'est touché : base neuve, dossier temporaire, aucun
 * projet, aucun compte, aucun quota dépensé.
 *
 * Limite assumée : le chemin 4 passe par le même point d'entrée que le filet de
 * sécurité, mais ne fait pas planter un composant React pour de vrai — la
 * construction publiée n'a pas de point d'essai pour cela.
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-erreurs-'));
const DATA = path.join(TMP, 'data');
const JOURNAL = path.join(DATA, 'logs', 'interface-erreurs.log');
const PORT = Number(process.env.HAIKO_ERREURS_PORT || 7112);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(RACINE, 'data', 'verification');

const MESSAGE_FENETRE = 'panne volontaire de la fenêtre';
const MESSAGE_PROMESSE = 'promesse volontairement rejetée';
const MESSAGE_AFFICHAGE = 'panneau volontairement cassé';

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

/** Les erreurs rangées dans le fichier de journal, telles quelles. */
function lireJournal() {
  if (!fs.existsSync(JOURNAL)) return [];
  return fs
    .readFileSync(JOURNAL, 'utf8')
    .split('\n')
    .filter((ligne) => ligne.trim())
    .map((ligne) => {
      try {
        return JSON.parse(ligne);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
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
      'vérification erreurs',
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
    const inattendues = [];
    page.on('pageerror', (e) => {
      // Nos pannes volontaires ne comptent pas : elles sont le sujet. Le
      // navigateur remonte AUSSI la promesse rejetée par ce guichet.
      const texte = String(e);
      const voulue = [MESSAGE_FENETRE, MESSAGE_PROMESSE, MESSAGE_AFFICHAGE].some((m) => texte.includes(m));
      if (!voulue) inattendues.push(texte);
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    noter('le journal est vide au départ', lireJournal().length === 0);

    /* ---- 1 et 2 : une erreur globale, provoquée deux fois ---- */
    for (let i = 0; i < 2; i += 1) {
      await page.evaluate((message) => {
        setTimeout(() => {
          throw new Error(message);
        }, 0);
      }, MESSAGE_FENETRE);
      await page.waitForTimeout(900);
    }

    /* ---- 3 : une promesse rejetée sans traitement ---- */
    await page.evaluate((message) => {
      void Promise.reject(new Error(message));
    }, MESSAGE_PROMESSE);
    await page.waitForTimeout(900);

    /* ---- 4 : une erreur d'affichage, comme le filet de sécurité l'envoie ---- */
    const posee = await page.evaluate(
      async ([message]) => {
        const res = await fetch('/api/erreur', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            source: 'affichage',
            message,
            zone: 'Tableau',
            pile: 'at CardTile\n  at Board',
            url: location.href,
            appareil: navigator.userAgent,
          }),
        });
        return res.status;
      },
      [MESSAGE_AFFICHAGE],
    );
    noter("une erreur d'affichage est acceptée", posee === 200, `réponse ${posee}`);

    /* ---- Un envoi mal formé est REFUSÉ ---- */
    const refus = await page.evaluate(async () => {
      const res = await fetch('/api/erreur', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'ailleurs', message: '' }),
      });
      return { status: res.status, corps: await res.json().catch(() => ({})) };
    });
    noter('un envoi mal formé est refusé en le disant', refus.status === 400 && !!refus.corps?.error, JSON.stringify(refus));

    /* ---- Le fichier de journal ---- */
    const journal = lireJournal();
    const fenetre = journal.filter((e) => e.message?.includes(MESSAGE_FENETRE));
    noter("l'erreur de la fenêtre est rangée dans le journal", fenetre.length >= 1);
    noter('la même erreur ne part pas deux fois', fenetre.length === 1, `${fenetre.length} lignes`);
    noter(
      'la promesse rejetée est rangée elle aussi',
      journal.some((e) => e.source === 'promesse' && e.message?.includes(MESSAGE_PROMESSE)),
    );
    noter(
      "l'erreur d'affichage garde sa zone",
      journal.some((e) => e.source === 'affichage' && e.zone === 'Tableau'),
    );
    noter('un envoi refusé ne laisse rien dans le journal', journal.length === 3, `${journal.length} lignes`);
    const une = fenetre[0] ?? {};
    noter("la date, l'adresse et l'appareil sont notés", !!une.at && !!une.url && !!une.appareil, JSON.stringify(une).slice(0, 160));

    /* ---- Le bloc des réglages ---- */
    await page.locator('header button').last().click();
    await page.waitForTimeout(700);
    await page.getByText('Réglages', { exact: true }).first().click();
    await page.waitForTimeout(2000);

    const tiroir = page.locator('[role="dialog"]').last();
    noter('le tiroir des réglages est ouvert', await tiroir.isVisible());
    const bloc = tiroir.locator('[data-bloc-erreurs]').last();
    noter("le bloc des erreurs est dans l'onglet Système", (await bloc.count()) > 0);

    await bloc.scrollIntoViewIfNeeded();
    const texte = (await bloc.innerText()).replace(/\s+/g, ' ');
    noter("l'erreur de la fenêtre s'y lit", texte.includes(MESSAGE_FENETRE), texte.slice(0, 220));
    noter("l'erreur d'affichage s'y lit aussi", texte.includes(MESSAGE_AFFICHAGE));
    noter("l'appareil est dit en français", /Linux|Mac|Windows|iPhone|Android/.test(texte) && /Chrome|Safari|Firefox|Edge/.test(texte));
    noter('trois erreurs sont affichées', (await bloc.locator('[data-ligne-erreur]').count()) === 3);

    fs.mkdirSync(SHOTS, { recursive: true });
    await bloc.screenshot({ path: `${SHOTS}/erreurs-01-liste.png` });

    /* ---- Le bouton « Tout effacer » ---- */
    await bloc.locator('[data-effacer-erreurs]').click();
    await page.waitForTimeout(1500);
    noter('le journal est vidé sur le disque', lireJournal().length === 0);
    noter('plus aucune erreur affichée', (await bloc.locator('[data-ligne-erreur]').count()) === 0);
    noter(
      'le bloc dit qu\'il n\'y a plus rien',
      /Aucune erreur remont/i.test((await bloc.innerText()).replace(/\s+/g, ' ')),
    );
    await bloc.screenshot({ path: `${SHOTS}/erreurs-02-vide.png` });

    noter('aucune erreur inattendue dans la console', inattendues.length === 0, inattendues.slice(0, 2).join(' | '));
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
