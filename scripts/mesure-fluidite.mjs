#!/usr/bin/env node
/**
 * MESURE DE FLUIDITÉ — combien coûte UNE FRAPPE au clavier, et combien de
 * cartes le tableau pose réellement dans la page.
 *
 * Mesuré dans un VRAI navigateur, sur son PROPRE démon (base neuve, dossier de
 * projets vide, port libre : le démon de production n'est pas touché, aucun
 * quota dépensé). Un projet d'essai est rempli de CARTES_D_ESSAI cartes
 * réparties sur les sept colonnes, le tableau est ouvert avec la conversation
 * du chef à côté — exactement l'écran où la lenteur se voit — puis on frappe
 * dans le champ d'écriture en chronométrant chaque touche.
 *
 * La frappe est jouée depuis la page elle-même (événement `input` natif),
 * parce que l'interface rend de façon SYNCHRONE sur une frappe : le temps
 * mesuré autour de l'événement contient donc tout le travail d'affichage
 * qu'elle déclenche.
 *
 *   node scripts/mesure-fluidite.mjs
 *   node scripts/mesure-fluidite.mjs --cartes 400 --touches 40
 *
 * Le script AFFICHE des chiffres, il ne juge pas : il sert à comparer un avant
 * et un après. Il rend 0 tant que la page se comporte normalement.
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
const PORT = Number(process.env.HAIKODEV_MESURE_PORT || 7196);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mesure-fluidite-'));

const lire = (nom, defaut) => {
  const i = process.argv.indexOf(nom);
  return i === -1 ? defaut : Number(process.argv[i + 1]);
};
const CARTES_D_ESSAI = lire('--cartes', 400);
const TOUCHES = lire('--touches', 40);

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
    HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
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
// Un arrêt à la main doit emporter le démon d'essai AVEC lui : sans cela il
// garde son port, et la mesure suivante s'ouvre sur une base vide.
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

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-mesure';
const COLONNES = ['notes', 'planned', 'running', 'done', 'to_deploy', 'in_production', 'archived'];

/**
 * Le port peut s'ouvrir avant que la base ait fini ses migrations : on attend
 * la table, pas l'écoute. Un port pris par un démon d'essai OUBLIÉ se dirait ici,
 * au lieu de faire mesurer une base vide.
 */
async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
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

function poserLeProjetEtSesCartes() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'mesure de fluidité',
  );

  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Projet de mesure',
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

  const poser = db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const lot = db.transaction(() => {
    for (let i = 0; i < CARTES_D_ESSAI; i += 1) {
      const colonne = COLONNES[i % COLONNES.length];
      const id = `c-mesure-${i}`;
      poser.run(
        id,
        PROJET_ID,
        colonne,
        i,
        `Carte de mesure ${i}`,
        'Carte posée pour mesurer le coût d’affichage du tableau.',
        JSON.stringify({}),
        maintenant,
        maintenant,
      );
    }
  });
  lot();
  db.close();
}

async function ouvrirLeTableau(navigateur) {
  const contexte = await navigateur.newContext({
    // Assez large pour que la conversation du chef soit affichée À CÔTÉ du
    // tableau : c'est cet écran-là qui rame, pas le tableau seul.
    viewport: { width: 1600, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  const debut = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-column="planned"]', { timeout: 30000 });
  const ouverture = Date.now() - debut;
  await page.waitForTimeout(3000);
  return { page, erreurs, ouverture };
}

/** Combien de cartes le tableau a réellement posées dans la page. */
const cartesDansLaPage = (page) =>
  page.evaluate(() => document.querySelectorAll('[data-carte^="c-mesure-"]').length);

/**
 * Le coût d'UNE frappe. On pose la nouvelle valeur par le mutateur natif du
 * champ (sinon l'interface ne voit pas le changement), puis on chronomètre
 * l'événement `input` : l'affichage se refait dedans, de façon synchrone.
 */
async function coutDUneFrappe(page, touches) {
  return page.evaluate((n) => {
    const zone = document.querySelector('textarea');
    if (!zone) return { trouve: false };
    const poser = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    const mesures = [];
    for (let i = 0; i < n; i += 1) {
      poser.call(zone, `${zone.value}a`);
      const t0 = performance.now();
      zone.dispatchEvent(new Event('input', { bubbles: true }));
      mesures.push(performance.now() - t0);
    }
    const triees = [...mesures].sort((a, b) => a - b);
    return {
      trouve: true,
      touches: n,
      median: triees[Math.floor(triees.length / 2)],
      pire: triees[triees.length - 1],
      total: mesures.reduce((s, v) => s + v, 0),
      texteFinal: zone.value.length,
    };
  }, touches);
}

const ms = (v) => `${v.toFixed(1)} ms`;

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  if (!(await attendreLaBase())) {
    console.error(
      `La base d’essai est restée vide : le port ${PORT} est peut-être tenu par un démon d’essai oublié.\n` +
        journal.join(''),
    );
    process.exit(1);
  }
  poserLeProjetEtSesCartes();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  try {
    const { page, erreurs, ouverture } = await ouvrirLeTableau(navigateur);
    const posees = await cartesDansLaPage(page);
    const frappe = await coutDUneFrappe(page, TOUCHES);

    console.log('');
    console.log(`  Cartes en base .................. ${CARTES_D_ESSAI}`);
    console.log(`  Cartes posées dans la page ...... ${posees}`);
    console.log(`  Ouverture du tableau ............ ${ouverture} ms`);
    if (frappe.trouve) {
      console.log(`  Coût d’une frappe (médiane) ..... ${ms(frappe.median)}`);
      console.log(`  Coût d’une frappe (pire) ........ ${ms(frappe.pire)}`);
      console.log(`  ${frappe.touches} frappes, en tout ............ ${ms(frappe.total)}`);
    } else {
      console.log('  Champ d’écriture introuvable : rien de mesuré.');
    }
    if (erreurs.length) console.log(`  Erreurs de page ................. ${erreurs.length} (${erreurs[0]})`);
    console.log('');
    await page.context().close();
  } finally {
    await navigateur.close();
  }
}

main()
  // Le démon d'essai tourne encore : sans sortie explicite, le script ne rendrait
  // jamais la main (ses tuyaux gardent la boucle d'événements ouverte).
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
