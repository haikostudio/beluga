#!/usr/bin/env node
/**
 * LA COLONNE DE GAUCHE MONTRE LA VRAIE ICÔNE DU PROJET — vérifié dans un VRAI
 * navigateur, sur son PROPRE démon (base neuve, dossier de projets vide, port
 * libre : le démon de production n'est pas touché, aucun quota dépensé).
 *
 * Trois projets, trois situations réelles, une par ligne de la colonne :
 *
 *   1. une ADRESSE qui répond, dont la page déclare son icône → l'icône du site ;
 *   2. AUCUNE adresse, mais un dépôt qui porte `public/favicon.svg` → l'icône du dépôt ;
 *   3. aucune adresse et un dépôt sans la moindre icône → le rond aux initiales.
 *
 * On ne se contente pas de voir une balise `<img>` : on lit `naturalWidth`, le
 * seul témoin qu'une image a RÉELLEMENT été chargée par le navigateur — un
 * carré vide passerait sinon pour un succès.
 *
 *   node scripts/verif-favicon-projets.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7196);
const PORT_SITE = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-favicon-projets-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(PROJETS, { recursive: true });

// Un PNG rouge de 1×1 : assez pour que le navigateur le décode vraiment.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#4f7"/></svg>';

/** Un dépôt git d'essai, avec les fichiers demandés. */
function depot(nom, fichiers) {
  const racine = path.join(TMP, nom);
  fs.mkdirSync(racine, { recursive: true });
  for (const [relatif, contenu] of Object.entries(fichiers)) {
    const cible = path.join(racine, relatif);
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.writeFileSync(cible, contenu);
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: racine });
  execFileSync('git', ['add', '-A'], { cwd: racine });
  execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
    cwd: racine,
  });
  return racine;
}

const DEPOT_SITE = depot('depot-site', { 'README.md': '# site\n' });
const DEPOT_AVEC_ICONE = depot('depot-avec-icone', {
  'README.md': '# avec icône\n',
  'public/favicon.svg': SVG,
  'src/components/icon-phone.png': PNG, // un piège : image d'interface, pas l'icône du site
});
const DEPOT_SANS_ICONE = depot('depot-sans-icone', { 'README.md': '# sans icône\n', 'src/index.ts': 'export {};\n' });

// Le faux site du projet 1 : une page qui DÉCLARE son icône, comme un vrai.
const site = http.createServer((req, res) => {
  if (req.url?.startsWith('/media/logo-du-site.png')) {
    res.writeHead(200, { 'content-type': 'image/png' });
    return res.end(PNG);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><link rel="icon" href="/media/logo-du-site.png"></head><body>ok</body></html>');
});

const jeton = crypto.randomBytes(32).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

const PROJETS_D_ESSAI = [
  { id: 'p-site', name: 'Site avec adresse', path: DEPOT_SITE, devUrl: `http://127.0.0.1:${PORT_SITE}` },
  { id: 'p-depot', name: 'Depot avec icone', path: DEPOT_AVEC_ICONE },
  { id: 'p-rien', name: 'Rien du tout', path: DEPOT_SANS_ICONE },
];

let demon = null;
const journal = [];

function demarrerLeDemon() {
  const enfant = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
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
  enfant.stdout.on('data', (d) => journal.push(String(d)));
  enfant.stderr.on('data', (d) => journal.push(String(d)));
  return enfant;
}

process.on('exit', () => {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  try {
    site.close();
  } catch {
    /* déjà fermé */
  }
  // Un échec laisse ses traces : la capture d'écran est la seule chose qui
  // dise POURQUOI, une fois le démon d'essai éteint.
  if (!garderLesTraces) fs.rmSync(TMP, { recursive: true, force: true });
});
let garderLesTraces = false;

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

async function arreterLeDemon() {
  if (!demon) return;
  const parti = new Promise((r) => demon.on('exit', r));
  demon.kill('SIGTERM');
  await Promise.race([parti, new Promise((r) => setTimeout(r, 5000))]);
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  demon = null;
}

/**
 * Les projets sont posés EN BASE avant un démarrage : c'est au lancement que le
 * démon va chercher les icônes manquantes (`server/src/main.ts`), et c'est
 * précisément ce chemin-là qu'on veut vérifier.
 */
function poserLesProjets() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification icônes de projet',
  );

  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  PROJETS_D_ESSAI.forEach((p, i) => {
    const projet = {
      ...p,
      defaultEngine: 'claude',
      isSelf: false,
      rank: i + 1,
      archived: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(p.id, p.name, p.path, JSON.stringify(projet), maintenant, maintenant);
  });

  db.close();
}

/** Ce que la ligne d'un projet montre RÉELLEMENT : une image chargée, ou des initiales. */
async function pastilleDuProjet(page, id) {
  return page.evaluate((projectId) => {
    const ligne = document.querySelector(`[data-drag-id="${projectId}"]`);
    if (!ligne) return { trouve: false };
    const img = ligne.querySelector('[data-favicon-projet]');
    const initiales = ligne.querySelector('[data-initiales-projet]');
    return {
      trouve: true,
      image: !!img,
      chargee: !!img && img.naturalWidth > 0,
      src: img?.getAttribute('src') ?? null,
      initiales: initiales ? initiales.textContent : null,
    };
  }, id);
}

async function main() {
  await new Promise((r) => site.listen(PORT_SITE, '127.0.0.1', r));

  // Premier démarrage : il crée la base et joue les migrations.
  demon = demarrerLeDemon();
  if (!(await attendrePort(PORT))) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  await arreterLeDemon();

  poserLesProjets();

  // Second démarrage : c'est lui qui va chercher les icônes manquantes.
  demon = demarrerLeDemon();
  if (!(await attendrePort(PORT))) {
    console.error('Le démon d’essai n’a pas redémarré :\n' + journal.join(''));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 4000)); // le temps des téléchargements

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const site1 = await pastilleDuProjet(page, 'p-site');
  noter('un projet dont l’adresse répond montre l’icône de son site', site1.chargee, JSON.stringify(site1));

  const depot1 = await pastilleDuProjet(page, 'p-depot');
  noter('un projet SANS adresse montre l’icône trouvée dans son dépôt', depot1.chargee, JSON.stringify(depot1));

  const rien = await pastilleDuProjet(page, 'p-rien');
  noter(
    'un projet sans icône nulle part garde son rond aux initiales',
    rien.trouve && !rien.image && !!rien.initiales,
    JSON.stringify(rien),
  );

  await page.screenshot({ path: path.join(TMP, 'icones-colonne-gauche.png') });

  // L'icône disparue du disque ne doit pas laisser un carré vide à l'écran.
  const fichiers = fs.existsSync(path.join(DATA, 'favicons')) ? fs.readdirSync(path.join(DATA, 'favicons')) : [];
  noter(
    'chaque icône est rangée sur le disque du démon, avec sa vraie extension',
    fichiers.includes('p-site.png') && fichiers.includes('p-depot.svg') && !fichiers.some((n) => n.startsWith('p-rien.')),
    fichiers.join(', '),
  );

  const reponse = await page.evaluate(async () => {
    const r = await fetch('/api/favicon?project=p-depot');
    return { statut: r.status, type: r.headers.get('content-type') };
  });
  noter(
    'l’icône du dépôt est servie avec son vrai type',
    reponse.statut === 200 && reponse.type === 'image/svg+xml',
    JSON.stringify(reponse),
  );

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) {
    garderLesTraces = true;
    console.log(`(capture et dossier d’essai gardés dans ${TMP})`);
  }
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
