#!/usr/bin/env node
/**
 * LE COFFRE-FORT DES IDENTIFIANTS, dans un VRAI navigateur, sur son PROPRE
 * démon (base neuve, port libre, dossier de projets à part : le démon de
 * production n'est pas touché, aucun moteur appelé, aucun quota dépensé).
 *
 * Ce qu'il exige, un contrôle par promesse de la carte :
 *
 *  1. le bouton « Coffre-fort » est DANS la colonne de gauche, sous le tableau de bord, et il ouvre le tiroir ;
 *  2. un accès de CHAQUE type proposé se crée et se retrouve dans la liste ;
 *  3. la recherche trouve un accès par son NOM, par son PROJET et par son TYPE ;
 *  4. ouvrir un accès pose un SECOND tiroir PAR-DESSUS le premier, qui reste ouvert ;
 *  5. les accès SSH centraux d'HaikoDev ont leur fiche, et l'écrire depuis le
 *     coffre écrit VRAIMENT dans les réglages ;
 *  6. un champ secret est masqué tant qu'on ne demande pas à le voir.
 *
 *   node scripts/verif-coffre-fort.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKODEV_COFFRE_PORT || 7209);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-coffre-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
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
  fs.rmSync(TMP, { recursive: true, force: true });
};
process.on('exit', ranger);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    ranger();
    process.exit(130);
  });
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
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
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
const PROJET_ID = 'p-coffre';
const PROJET_NOM = 'Boutique en ligne';

function poserLeProjet() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification du coffre-fort',
  );

  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: PROJET_NOM,
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
  db.close();
}

/** Les réglages tels que la base les porte à cet instant. */
function reglagesActuels() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const brut = db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}';
  db.close();
  return JSON.parse(brut);
}

/* Un accès par type, avec le champ qu'on remplira et ce qu'on y écrit. */
const A_CREER = [
  { type: 'cle-api', nom: 'Clé Stripe', champ: 'service', valeur: 'Stripe' },
  { type: 'mot-de-passe', nom: 'Console OVH', champ: 'identifiant', valeur: 'admin-ovh' },
  { type: 'ssh', nom: 'Serveur de secours', champ: 'hote', valeur: '203.0.113.10' },
  { type: 'jeton', nom: 'Jeton Vercel', champ: 'service', valeur: 'Vercel' },
  { type: 'base-de-donnees', nom: 'Base des commandes', champ: 'base', valeur: 'commandes' },
  { type: 'autre', nom: 'Code du coffre physique', champ: 'valeur', valeur: '4821' },
];

async function main() {
  const pretPort = await attendrePort();
  if (!pretPort) throw new Error(`le démon d'essai n'a jamais ouvert le port ${PORT}`);
  const preteBase = await attendreLaBase();
  if (!preteBase) throw new Error('la table du coffre n’est jamais apparue : la migration n’a pas tourné');
  noter('La table du coffre est créée par la migration', true);
  poserLeProjet();

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

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-column="notes"]', { timeout: 30000 });
    await page.waitForTimeout(600);

    /* 1. Le bouton vit dans la COLONNE DE GAUCHE, sous le tableau de bord, et il ouvre le tiroir. */
    const bouton = page.locator('aside[data-zone="gauche"] [data-ouvrir-coffre]');
    const dansLaColonne = (await bouton.count()) === 1;
    noter('Le bouton « Coffre-fort » est dans la colonne de gauche', dansLaColonne);
    await bouton.click();
    const tiroirListe = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-recherche]') });
    await tiroirListe.waitFor({ state: 'visible', timeout: 15000 });
    noter('Le tiroir du coffre s’ouvre au clic', true);

    /* 2. Un accès de CHAQUE type. */
    for (const item of A_CREER) {
      await page.click('[data-coffre-creer]');
      await page.click(`[data-coffre-type="${item.type}"]`);
      const fiche = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-enregistrer]') });
      await fiche.waitFor({ state: 'visible', timeout: 10000 });
      await fiche.locator('[data-coffre-nom]').fill(item.nom);
      await fiche.locator(`[data-coffre-champ="${item.champ}"]`).fill(item.valeur);
      await fiche.locator('[data-coffre-projet]').selectOption(PROJET_ID);
      await fiche.locator('[data-coffre-enregistrer]').click();
      await fiche.waitFor({ state: 'hidden', timeout: 10000 });
    }
    const lignes = await page.locator('[data-coffre-acces]').count();
    noter(
      `Les ${A_CREER.length} types d’accès se créent et paraissent dans la liste`,
      lignes === A_CREER.length + 1,
      `${lignes} ligne(s) affichée(s), ${A_CREER.length + 1} attendues (les accès créés + la machine)`,
    );

    /* 3. La recherche : par NOM, par PROJET, par TYPE. */
    const chercher = async (texte) => {
      await page.fill('[data-coffre-recherche]', texte);
      await page.waitForTimeout(200);
      return page.locator('[data-coffre-acces]').allTextContents();
    };

    const parNom = await chercher('stripe');
    noter(
      'La recherche trouve un accès par son NOM',
      parNom.length === 1 && parNom[0].includes('Clé Stripe'),
      `${parNom.length} résultat(s)`,
    );

    const parProjet = await chercher('boutique');
    noter(
      'La recherche trouve les accès par leur PROJET',
      parProjet.length === A_CREER.length,
      `${parProjet.length} résultat(s) pour « ${PROJET_NOM} »`,
    );

    const parType = await chercher('base de données');
    noter(
      'La recherche trouve un accès par son TYPE',
      parType.length === 1 && parType[0].includes('Base des commandes'),
      `${parType.length} résultat(s)`,
    );

    const parSecret = await chercher('4821');
    noter(
      'La recherche ne mord PAS sur une valeur secrète',
      parSecret.length === 0,
      `${parSecret.length} résultat(s) pour un contenu secret`,
    );

    /* 4. Le tiroir EMPILÉ : le premier reste ouvert derrière. */
    await chercher('');
    await page.click('[data-coffre-acces]:not([data-coffre-acces="reglages:vps"])');
    const fiche = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-enregistrer]') });
    await fiche.waitFor({ state: 'visible', timeout: 10000 });
    const ouverts = await page.locator('[role="dialog"][data-state="open"]').count();
    const listeEncoreLa = await tiroirListe.isVisible();
    noter(
      'Un accès s’ouvre dans un tiroir EMPILÉ, la liste restant ouverte dessous',
      ouverts === 2 && listeEncoreLa,
      `${ouverts} tiroir(s) ouvert(s), liste ${listeEncoreLa ? 'visible' : 'refermée'}`,
    );

    /* 6. Un champ secret est masqué tant qu'on ne demande pas à le voir. */
    const typeAvant = await fiche.locator('input[data-coffre-champ][type="password"]').count();
    noter('Un champ secret est masqué par défaut', typeAvant >= 1, `${typeAvant} champ(s) masqué(s)`);
    const oeil = fiche.locator('[data-coffre-oeil]').first();
    if (await oeil.count()) {
      await oeil.click();
      await page.waitForTimeout(150);
      const typeApres = await fiche.locator('input[data-coffre-champ][type="password"]').count();
      noter('L’œil dévoile le champ secret', typeApres < typeAvant, `${typeApres} champ(s) encore masqué(s)`);
    }
    await page.keyboard.press('Escape');
    await fiche.waitFor({ state: 'hidden', timeout: 10000 });

    /* 5. Les accès SSH centraux d'HaikoDev : leur fiche est là, et elle ÉCRIT
       dans les réglages. */
    const ficheMachine = page.locator('[data-coffre-acces="reglages:vps"]');
    const machinePresente = (await ficheMachine.count()) === 1;
    noter('Les accès SSH centraux d’HaikoDev ont leur fiche dans le coffre', machinePresente);
    if (machinePresente) {
      await ficheMachine.click();
      const detail = page.locator('[role="dialog"][data-state="open"]', { has: page.locator('[data-coffre-enregistrer]') });
      await detail.waitFor({ state: 'visible', timeout: 10000 });
      await detail.locator('[data-coffre-champ="hote"]').fill('198.51.100.7');
      await detail.locator('[data-coffre-champ="utilisateur"]').fill('root');
      await detail.locator('[data-coffre-champ="port"]').fill('2202');
      await detail.locator('[data-coffre-enregistrer]').click();
      await detail.waitFor({ state: 'hidden', timeout: 10000 });
      await page.waitForTimeout(400);

      const r = reglagesActuels();
      noter(
        'Écrire cette fiche depuis le coffre écrit VRAIMENT dans les réglages « Système »',
        r.vpsHote === '198.51.100.7' && r.vpsUtilisateur === 'root' && r.vpsPort === 2202,
        `hôte=${r.vpsHote} utilisateur=${r.vpsUtilisateur} port=${r.vpsPort} moyen=${r.vpsMoyen}`,
      );
      noter(
        'Sans clé ni mot de passe, le moyen de connexion retombe sur les clés déjà en place',
        r.vpsMoyen === 'agent',
        `moyen=${r.vpsMoyen}`,
      );
    }

    const SHOTS = path.join(RACINE, 'data', 'verification');
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'coffre-fort.png') });

    noter('Aucune erreur JavaScript de page pendant le scénario', erreurs.length === 0, erreurs.join(' | '));
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  if (echecs.length) console.log('Journal du démon :\n' + journal.join(''));
  /*
   * On SORT explicitement : le démon d'essai est un enfant aux tuyaux ouverts,
   * il tient la boucle d'événements éveillée tant qu'il vit. Sans ce départ
   * franc, le script reste pendu APRÈS avoir tout vérifié — et un contrôle qui
   * ne rend pas la main passe pour un contrôle qui n'a pas fini.
   */
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ÉCHEC :', error);
  console.log('Journal du démon :\n' + journal.join(''));
  process.exit(1);
});
