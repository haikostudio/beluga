#!/usr/bin/env node
/**
 * Créer une note avec une pièce jointe, dans un vrai navigateur :
 *  1. le formulaire montre la vignette avant la création ;
 *  2. la carte naît dans « Notes » avec l'identifiant du fichier ;
 *  3. le fichier reste visible dans l'onglet « Pièces jointes » du projet.
 *
 * Le script monte son propre démon, sa base et son projet dans un dossier
 * jetable. Il vérifie donc le code construit sans toucher à l'instance servie.
 *
 *   npm run build && node scripts/verif-pieces-jointes-note.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lireCarteOu } from './carte-en-base.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-pieces-note-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DOSSIER = path.join(TMP, 'projet');
const PORT = Number(process.env.HAIKODEV_NOTE_VERIF_PORT || 7194);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJET_ID = 'projet-note-jointe';
const JETON = crypto.randomBytes(32).toString('hex');
const TITRE = `Note avec pièce jointe ${Date.now()}`;

for (const dossier of [DATA, PROJETS, DOSSIER]) fs.mkdirSync(dossier, { recursive: true });

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HAIKODEV_PORT: String(PORT),
    HAIKODEV_HOST: '127.0.0.1',
    HAIKODEV_DATA: DATA,
    HAIKODEV_PROJECTS_ROOT: PROJETS,
    HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const journal = [];
demon.stdout.on('data', (donnee) => journal.push(String(donnee)));
demon.stderr.on('data', (donnee) => journal.push(String(donnee)));

let navigateur;
process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà arrêté */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function poserDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();
  const empreinte = crypto.createHash('sha256').update(JETON).digest('hex');
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification note avec pièce jointe',
  );
  const projet = {
    id: PROJET_ID,
    name: 'Essai note avec pièce jointe',
    path: DOSSIER,
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
  db.close();
}

function fabriqueImage() {
  const contenu = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAP0lEQVR42u3OMQEAAAgDoC252H0M' +
      'Ywm4mUryJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgWQ0YMAAB8W8LqQAAAABJRU5ErkJggg==',
    'base64',
  );
  const fichier = path.join(TMP, 'preuve-note.png');
  fs.writeFileSync(fichier, contenu);
  return fichier;
}

function lireCarte() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const carte = lireCarteOu(db, 'project_id = ? AND title = ?', PROJET_ID, TITRE);
  db.close();
  return carte;
}

async function attendreCarteDansNotes(limiteMs = 20000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const carte = lireCarte();
    if (carte?.column === 'notes') return carte;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return lireCarte();
}

async function main() {
  if (!(await attendrePort())) throw new Error(`Le démon d'essai n'a pas démarré :\n${journal.join('')}`);
  poserDecor();

  navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const contexte = await navigateur.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (erreur) => erreurs.push(String(erreur)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: 'Notes', exact: true }).waitFor({ timeout: 30000 });

  const teteNotes = page.getByRole('heading', { name: 'Notes', exact: true }).locator('..');
  await teteNotes.getByRole('button', { name: 'Nouvelle note' }).click();
  await page.locator('input[placeholder="Titre de la note…"]').fill(TITRE);
  await page.locator('textarea[placeholder="Description (facultative)…"]').fill('Une note créée avec son image.');
  await page.locator('input[data-note-file-input]').setInputFiles(fabriqueImage());

  const vignette = page.locator('[data-note-attachments] img[alt="preuve-note.png"]');
  await vignette.waitFor({ timeout: 20000 });
  noter('Le fichier joint apparaît avant la création', await vignette.isVisible());

  await page.getByRole('button', { name: 'Ajouter la note' }).click();
  await page.getByText(TITRE, { exact: true }).waitFor({ timeout: 20000 });

  const carte = await attendreCarteDansNotes();
  noter('La note est créée dans « Notes »', carte?.column === 'notes', carte?.column ?? 'carte absente');
  noter('La carte conserve la pièce jointe', carte?.attachments?.length === 1, `${carte?.attachments?.length ?? 0} fichier(s)`);

  await page.getByRole('tab', { name: 'Pièces jointes', exact: true }).click();
  await page.locator('img[alt="preuve-note.png"]').waitFor({ timeout: 20000 });
  noter(
    'Le fichier reste visible dans les pièces jointes du projet',
    await page.locator('img[alt="preuve-note.png"]').isVisible(),
  );
  noter('Aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await contexte.close();
  const echecs = resultats.filter((resultat) => !resultat.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exitCode = echecs.length ? 1 : 0;
}

main()
  .catch((erreur) => {
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(async () => {
    await navigateur?.close().catch(() => {});
    demon.kill('SIGTERM');
  });
