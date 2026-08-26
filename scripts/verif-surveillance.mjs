#!/usr/bin/env node
/**
 * LA SURVEILLANCE DES SITES, dans un VRAI navigateur, sur son PROPRE démon
 * (base neuve, port libre, dossier de projets à part : le démon de production
 * n'est pas touché, aucun moteur appelé, aucun quota dépensé).
 *
 * Deux sites d'essai sont montés ici même : l'un répond, l'autre casse — et il
 * se répare à la demande. Aucun appel ne sort de la machine.
 *
 * Ce qu'il exige, un contrôle par promesse de la carte :
 *
 *  1. le bouton « Surveillance » est DANS la colonne de gauche, SOUS le coffre-fort, et il ouvre sa fenêtre ;
 *  2. une adresse s'ajoute, et elle est appelée TOUT DE SUITE ;
 *  3. le site cassé est vu « en panne » avec sa raison, le site valide « en ligne » ;
 *  4. la PASTILLE du menu compte les sites tombés ;
 *  5. l'ALERTE part vraiment vers l'application, avec le motif « site-indisponible » ;
 *  6. une seule alerte par chute : une seconde tournée sur un site toujours à terre n'en pousse pas d'autre ;
 *  7. le site réparé éteint la pastille, et le BANDEAU d'apaisement le dit ;
 *  8. une adresse illisible est refusée en toutes lettres, et une adresse retirée disparaît.
 *
 *   node scripts/verif-surveillance.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKODEV_SURVEILLANCE_PORT || 7213);
const PORT_SITES = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-surveillance-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
for (const dossier of [DATA, PROJETS]) fs.mkdirSync(dossier, { recursive: true });

/*
 * LES DEUX SITES D'ESSAI, servis ici même. « /casse » rend 500 tant qu'on ne
 * l'a pas réparé : c'est ce qui permet de rejouer une CHUTE puis un RETOUR sans
 * jamais dépendre d'internet.
 */
let casseRepare = false;
const sites = http.createServer((req, res) => {
  if (req.url.startsWith('/ok')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<html><body>Tout va bien</body></html>');
  }
  if (req.url.startsWith('/casse')) {
    if (casseRepare) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html><body>Réparé</body></html>');
    }
    res.writeHead(500, { 'content-type': 'text/html' });
    return res.end('<html><body>Panne interne</body></html>');
  }
  res.writeHead(404);
  res.end('rien ici');
});

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HAIKODEV_PORT: String(PORT),
    HAIKODEV_HOST: '127.0.0.1',
    HAIKODEV_DATA: DATA,
    HAIKODEV_PROJECTS_ROOT: PROJETS,
    HAIKODEV_WEB: process.env.HAIKODEV_WEB_ESSAI || path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

const ranger = () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  try {
    sites.close();
  } catch {
    /* déjà fermé */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
};
process.on('exit', ranger);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    ranger();
    process.exit(130);
  });
}

async function attendrePort(port, limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(port, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sites_surveilles'")
        .get();
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

/** Une session d'une heure, fabriquée à la main : aucun mot de passe en jeu. */
function poserLaSession() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification de la surveillance',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.close();
}

/** L'état d'un site, lu dans la base : la vérité du serveur, pas celle de l'écran. */
function etatsEnBase() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const lignes = db.prepare('SELECT nom, url, etat, raison, code FROM sites_surveilles').all();
  db.close();
  return lignes;
}

async function main() {
  sites.listen(PORT_SITES, '127.0.0.1');
  if (!(await attendrePort(PORT_SITES, 10000))) throw new Error("les sites d'essai n'ont pas démarré");

  if (!(await attendrePort(PORT))) throw new Error(`le démon d'essai n'a jamais ouvert le port ${PORT}`);
  if (!(await attendreLaBase()))
    throw new Error('la table des sites surveillés n’est jamais apparue : la migration n’a pas tourné');
  noter('La table des sites surveillés est créée par la migration', true);
  poserLaSession();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-CH' });
    await contexte.addCookies([
      { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));

    /*
     * L'ALERTE se lit là où elle passe VRAIMENT : dans le canal ouvert entre le
     * démon et l'application. On ne se fie donc ni au journal ni à l'écran pour
     * dire qu'une notification est partie.
     */
    const alertes = [];
    page.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => {
        try {
          const event = JSON.parse(String(payload));
          if (event?.type === 'notify') alertes.push(event);
        } catch {
          /* trame binaire ou illisible : rien à en tirer */
        }
      });
    });

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="notes"]', { timeout: 30000 });
    await page.waitForTimeout(600);

    /* 1. Le bouton vit dans la COLONNE DE GAUCHE, sous le coffre-fort. */
    const bouton = page.locator('aside[data-zone="gauche"] [data-ouvrir-surveillance]');
    noter('Le bouton « Surveillance » est dans la colonne de gauche', (await bouton.count()) === 1);

    const ordre = await page.evaluate(() => {
      const coffre = document.querySelector('aside[data-zone="gauche"] [data-ouvrir-coffre]');
      const veille = document.querySelector('aside[data-zone="gauche"] [data-ouvrir-surveillance]');
      if (!coffre || !veille) return 'absent';
      // Le bouton du dessous suit celui du dessus dans l'ordre du document.
      return coffre.compareDocumentPosition(veille) & Node.DOCUMENT_POSITION_FOLLOWING ? 'dessous' : 'dessus';
    });
    noter('Il est posé JUSTE SOUS le coffre-fort', ordre === 'dessous', ordre);

    await bouton.click();
    const fenetre = page.locator('[role="dialog"][data-state="open"]', {
      has: page.locator('[data-surveillance-url]'),
    });
    await fenetre.waitFor({ state: 'visible', timeout: 15000 });
    noter('La fenêtre de surveillance s’ouvre au clic', true);

    /* 2. Deux adresses : une valide, une cassée. */
    const ajouter = async (adresse, nom) => {
      await fenetre.locator('[data-surveillance-url]').fill(adresse);
      await fenetre.locator('[data-surveillance-nom]').fill(nom);
      await fenetre.locator('[data-surveillance-ajouter]').click();
      await page.waitForTimeout(1200);
    };
    await ajouter(`http://127.0.0.1:${PORT_SITES}/ok`, 'Site debout');
    await ajouter(`http://127.0.0.1:${PORT_SITES}/casse`, 'Site cassé');

    const lignes = await page.locator('[data-surveillance-site]').count();
    noter('Les deux adresses sont ajoutées et listées', lignes === 2, `${lignes} ligne(s)`);

    // 3. L'ajout appelle TOUT DE SUITE : l'état ne doit pas rester « inconnu ».
    await page.waitForTimeout(1500);
    const enBase = etatsEnBase();
    const casse = enBase.find((l) => l.url.includes('/casse'));
    const debout = enBase.find((l) => l.url.includes('/ok'));
    noter(
      'Une adresse ajoutée est appelée tout de suite, sans attendre l’heure suivante',
      casse?.etat !== 'inconnu' && debout?.etat !== 'inconnu',
      `ok=${debout?.etat} cassé=${casse?.etat}`,
    );
    noter(
      'Le site en erreur 500 est vu « en panne », avec sa raison',
      casse?.etat === 'panne' && casse?.raison === 'serveur' && casse?.code === 500,
      `état=${casse?.etat} raison=${casse?.raison} code=${casse?.code}`,
    );
    noter('Le site valide est vu « en ligne »', debout?.etat === 'ok', `état=${debout?.etat}`);

    const etiquette = await fenetre.locator('[data-surveillance-etat="panne"]').first().textContent();
    noter(
      'La fenêtre affiche l’état de chaque site',
      (await fenetre.locator('[data-surveillance-etat="ok"]').count()) === 1 &&
        (await fenetre.locator('[data-surveillance-etat="panne"]').count()) === 1,
      `étiquette de panne : ${etiquette?.trim()}`,
    );

    /* 4. La pastille du menu. */
    const pastille = page.locator('aside[data-zone="gauche"] [data-surveillance-pastille]');
    const texte = (await pastille.count()) ? (await pastille.first().textContent())?.trim() : '';
    noter('La pastille du menu compte les sites tombés', texte === '1', `pastille = « ${texte} »`);

    /*
     * 5. L'alerte est vraiment partie vers l'application. On lui laisse passer
     * la FENÊTRE DE GROUPEMENT du guichet des notifications (quatre secondes,
     * `server/src/notify.ts`) : plus tôt, on constaterait une absence qui n'en
     * est pas une.
     */
    await page.waitForTimeout(5500);
    const alerte = alertes.find((a) => a.motif === 'site-indisponible');
    noter(
      'Une alerte « site indisponible » part vers l’application',
      Boolean(alerte),
      alerte ? `${alerte.title} — ${alerte.body}` : `aucune alerte reçue (${alertes.length} au total)`,
    );
    noter(
      'Elle NOMME le site et ce qui cloche',
      Boolean(alerte && /cassé/i.test(alerte.title) && /500/.test(alerte.body)),
      alerte ? alerte.title : '',
    );

    /* 6. Une seule alerte par chute. */
    const avant = alertes.filter((a) => a.motif === 'site-indisponible').length;
    await fenetre.locator('[data-surveillance-verifier]').click();
    // Même attente : si une seconde alerte devait partir, elle aurait eu tout
    // le temps d'arriver.
    await page.waitForTimeout(6000);
    const apres = alertes.filter((a) => a.motif === 'site-indisponible').length;
    noter(
      'Un site toujours à terre ne réveille personne une seconde fois',
      apres === avant,
      `${avant} alerte(s) avant, ${apres} après une nouvelle tournée`,
    );

    /* 7. Le site réparé : pastille éteinte, bandeau d'apaisement. */
    noter(
      'Tant qu’un site est tombé, le bandeau rouge le nomme',
      (await fenetre.locator('[data-surveillance-bandeau="panne"]').count()) === 1,
    );
    casseRepare = true;
    await fenetre.locator('[data-surveillance-verifier]').click();
    await page.waitForTimeout(3000);

    const restant = await page.locator('aside[data-zone="gauche"] [data-surveillance-pastille]').count();
    noter('Le site réparé éteint la pastille', restant === 0, `${restant} pastille(s) restante(s)`);
    noter(
      'Le bandeau d’apaisement annonce le retour à la normale',
      (await fenetre.locator('[data-surveillance-bandeau="apaise"]').count()) === 1,
    );

    /* 8. Une adresse illisible est refusée, une adresse retirée disparaît. */
    await fenetre.locator('[data-surveillance-url]').fill('machin');
    await fenetre.locator('[data-surveillance-ajouter]').click();
    await page.waitForTimeout(800);
    const refus = await page.locator('[data-toast], [role="status"]').allTextContents();
    noter(
      'Une adresse sans nom de domaine est refusée, en toutes lettres',
      (await page.locator('[data-surveillance-site]').count()) === 2,
      refus.join(' | ').slice(0, 120),
    );

    const premier = await page.locator('[data-surveillance-supprimer]').first().getAttribute('data-surveillance-supprimer');
    await page.locator(`[data-surveillance-supprimer="${premier}"]`).click();
    await page.locator('button:has-text("Retirer")').last().click();
    await page.waitForTimeout(1000);
    noter(
      'Une adresse retirée disparaît de la liste',
      (await page.locator('[data-surveillance-site]').count()) === 1 && etatsEnBase().length === 1,
    );

    const SHOTS = path.join(RACINE, 'data', 'verification');
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'surveillance.png') });

    noter('Aucune erreur JavaScript de page pendant le scénario', erreurs.length === 0, erreurs.join(' | '));
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  if (echecs.length) console.log('Journal du démon :\n' + journal.join(''));
  /*
   * On SORT explicitement : le démon d'essai et les sites d'essai tiennent la
   * boucle d'événements éveillée. Un contrôle qui ne rend pas la main passe
   * pour un contrôle qui n'a pas fini.
   */
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ÉCHEC :', error);
  console.log('Journal du démon :\n' + journal.join(''));
  process.exit(1);
});
