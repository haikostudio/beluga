#!/usr/bin/env node
/**
 * LE TIROIR D'EXPORT ET D'IMPORT, dans un VRAI navigateur, sur son PROPRE démon
 * (base neuve, port libre, dossier de projets à part : le démon de production
 * n'est pas touché, aucun moteur appelé, aucun quota dépensé).
 *
 * Ce qu'il exige, un contrôle par promesse de la carte :
 *
 *  1. le bouton vit dans l'onglet « Système » des réglages, et il ouvre le tiroir ;
 *  2. les neuf catégories sont là, TOUTES COCHÉES au départ ;
 *  3. décocher marche, et décocher « Projets » DIT ce qui arrivera orphelin ;
 *  4. le bouton d'export est éteint quand plus rien n'est coché ;
 *  5. l'archive se fabrique pour de vrai et se télécharge ;
 *  6. l'onglet « Importer » relit cette archive, montre d'où elle vient, propose
 *     les trois politiques de conflit, et la remonte.
 *
 *   node scripts/verif-tiroir-export-donnees.mjs
 *
 * PIÈGE des scripts à démon d'essai : le démon est un enfant aux tuyaux
 * ouverts, il tient la boucle d'événements éveillée. Sans `process.exit()`
 * explicite, le script reste PENDU après avoir tout vérifié.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_DONNEES_PORT || 7213);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-donnees-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const TELECHARGEMENTS = path.join(TMP, 'telechargements');
const { DATA, PROJETS, DEPOT, demon, attendrePort } = demarrerDemonDEssai({
  tmp: TMP,
  port: PORT,
  dossiers: [TELECHARGEMENTS],
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
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='secrets'").get();
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

function semer() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification de l’export des données',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: 'p-donnees',
    name: 'Boutique en ligne',
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
    'INSERT INTO secrets (id, nom, type, project_id, champs, note, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('s-essai', 'Console OVH', 'mot-de-passe', null, JSON.stringify({ identifiant: 'admin' }), '', maintenant, maintenant);
  db.close();
}

async function main() {
  if (!(await attendrePort())) throw new Error(`le démon d'essai n'a jamais ouvert le port ${PORT}`);
  if (!(await attendreLaBase())) throw new Error('la base d’essai n’est jamais apparue');
  semer();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const contexte = await navigateur.newContext({
      viewport: { width: 1280, height: 900 },
      locale: 'fr-CH',
      acceptDownloads: true,
    });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="planned"]', { timeout: 30000 });
    await page.waitForTimeout(600);

    /* 1. Le bouton vit dans l'onglet « Système » des réglages. */
    await page.click('[aria-label="Menu"]');
    await page.click('[data-reglages-menu]');
    const barre = page.locator('[role="tablist"]').filter({ has: page.locator('[id$="-trigger-systeme"]') });
    await barre.locator('[id$="-trigger-systeme"]').click();
    const ouvrir = page.locator('[data-ouvrir-export-donnees]');
    await ouvrir.waitFor({ state: 'visible', timeout: 15000 });
    noter('Le bouton d’export vit dans l’onglet « Système » des réglages', true);

    await ouvrir.click();
    /* Le tiroir se repère par sa BARRE D'ONGLETS, qui reste montée d'un onglet
       à l'autre — le contenu de l'onglet quitté, lui, est démonté. */
    const tiroir = page.locator('[role="dialog"][data-state="open"]', {
      has: page.locator('[data-bouton-vue="donnees"]'),
    });
    await tiroir.waitFor({ state: 'visible', timeout: 15000 });
    await tiroir.locator('[data-donnees-exporter]').waitFor({ state: 'visible', timeout: 15000 });
    noter('Le tiroir s’ouvre au clic', true);

    /* 2. Les neuf catégories, TOUTES cochées. */
    const cases = tiroir.locator('[data-donnees-categorie]');
    await page.waitForFunction(() => document.querySelectorAll('[data-donnees-categorie]').length >= 9, null, {
      timeout: 15000,
    });
    const nombre = await cases.count();
    const cochees = await cases.evaluateAll((els) => els.filter((e) => e.getAttribute('aria-checked') === 'true').length);
    noter(
      'Les neuf catégories sont là, toutes cochées au départ',
      nombre === 9 && cochees === 9,
      `${cochees}/${nombre} cochée(s)`,
    );

    /* 3. Décocher « Projets » annonce ce qui arrivera orphelin. */
    await tiroir.locator('[data-donnees-categorie="projets"]').uncheck();
    const orphelins = tiroir.locator('[data-donnees-orphelins]');
    await orphelins.waitFor({ state: 'visible', timeout: 5000 });
    noter('Décocher « Projets » annonce ce qui arrivera sans rattachement', true);
    await tiroir.locator('[data-donnees-categorie="projets"]').check();

    /* 4. Plus rien de coché : le bouton s'éteint. */
    await tiroir.locator('[data-donnees-tout-decocher]').click();
    const eteint = await tiroir.locator('[data-donnees-exporter]').isDisabled();
    noter('Sans aucune case cochée, le bouton d’export est éteint', eteint);
    await tiroir.locator('[data-donnees-tout-cocher]').click();
    await page.waitForFunction(
      () => [...document.querySelectorAll('[data-donnees-categorie]')].every((e) => e.getAttribute('aria-checked') === 'true'),
      null,
      { timeout: 5000 },
    );

    /* 5. L'archive se fabrique pour de vrai, et se télécharge. */
    const attente = page.waitForEvent('download', { timeout: 60000 });
    await tiroir.locator('[data-donnees-exporter]').click();
    const telechargement = await attente;
    const archive = path.join(TELECHARGEMENTS, 'archive.zip');
    await telechargement.saveAs(archive);
    const octets = fs.statSync(archive).size;
    noter(
      'L’archive se fabrique et se télécharge',
      octets > 1000 && telechargement.suggestedFilename().endsWith('.zip'),
      `${telechargement.suggestedFilename()}, ${octets} octets`,
    );

    /* 6. L'onglet « Importer » relit cette archive et la remonte. */
    /* Exporter / Importer se choisit par le bouton « Vue » à menu (04/11/2026) : le menu part en portail. */
    await tiroir.locator('[data-bouton-vue="donnees"]').click();
    await page.locator('[data-donnees-onglet="importer"]').click();
    await tiroir.locator('[data-donnees-fichier]').setInputFiles(archive);
    const politiques = tiroir.locator('[data-donnees-politique]');
    await politiques.first().waitFor({ state: 'visible', timeout: 30000 });
    noter('L’archive déposée est relue et acceptée', true);
    noter('Les trois politiques de conflit sont proposées', (await politiques.count()) === 3);
    const defaut = await tiroir.locator('[data-donnees-politique="ignorer"]').isChecked();
    noter('Le choix par défaut est celui qui ne peut rien détruire', defaut);

    await tiroir.locator('[data-donnees-importer]').click();
    const bilan = tiroir.locator('[data-donnees-bilan]');
    await bilan.waitFor({ state: 'visible', timeout: 60000 });
    const texte = (await bilan.innerText()).replace(/\s+/g, ' ').trim();
    noter('L’import rend son compte rendu, table par table', texte.length > 10, texte.slice(0, 90));

    noter('Aucune erreur de page pendant tout le parcours', erreurs.length === 0, erreurs[0] ?? '');
  } finally {
    await navigateur.close();
  }
}

main()
  .then(() => {
    const echecs = resultats.filter((r) => !r.ok);
    console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.\n`);
    process.exit(echecs.length ? 1 : 0);
  })
  .catch((err) => {
    console.error(`\nÉCHEC : ${err?.message ?? err}\n`);
    process.exit(1);
  });
