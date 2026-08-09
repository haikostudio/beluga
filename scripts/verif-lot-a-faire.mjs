#!/usr/bin/env node
/**
 * Le pied de la colonne « À faire » porte un bouton « Tout valider », qui
 * fonctionne en DEUX TEMPS, exactement comme « Tout archiver » des colonnes de
 * fin de parcours : premier clic, les cases sortent au coin haut-gauche des
 * cartes, toutes cochées ; le pied affiche « Annuler » et « Valider (n) ».
 * Annuler ne touche à rien, valider autorise la dépense des cartes cochées et
 * lance leur chiffrage — la colonne « Validé » n'existe plus, la carte reste
 * dans « À faire » le temps de l'analyse — et laisse les décochées intactes.
 *
 *   node scripts/verif-lot-a-faire.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un dossier de projets vide : le démon de production n'est pas touché. Le
 * plafond d'agents est mis à ZÉRO, donc valider ne déclenche aucun chiffrage
 * réel : aucun quota n'est dépensé.
 */
import { chromium } from 'playwright';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Le dépôt d'où PART ce script, jamais `/root/haikodev` en dur : lancé depuis
 * une copie de travail, il doit juger CETTE copie — sinon il monte son démon
 * d'essai sur la construction du dossier principal et ne voit pas le code qu'on
 * vient d'écrire.
 */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7192);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-lot-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

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

process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

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

/* ------------------------------------------------------------------ */
/* Le décor : un projet, trois cartes « À faire », une session          */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const TITRES = ['Carte d’essai — lot A', 'Carte d’essai — lot B', 'Carte d’essai — lot C'];

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification lot à faire',
  );

  /* Plafond d'agents à ZÉRO : une carte validée n'entraîne aucun chiffrage
     réel, donc aucune dépense. On juge le déplacement, pas l'ordonnanceur. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai lot',
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

  TITRES.forEach((titre, index) => {
    const carte = {
      id: `c-essai-${index}`,
      projectId: PROJET_ID,
      title: titre,
      description: 'Carte fabriquée par le script de vérification.',
      labels: [],
      column: 'todo',
      position: index + 1,
      origin: 'user',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: { asap: false, attempts: 0, restarts: 0, suspendu: false },
      excludedFromDeploy: false,
      horsTache: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(carte.id, PROJET_ID, 'todo', carte.position, titre, JSON.stringify(carte), maintenant, maintenant);
  });
  db.close();
}

/** L'état des trois cartes en BASE : titre → colonne. */
function colonnesEnBase() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const lignes = db.prepare('SELECT title, column_key FROM cards').all();
  db.close();
  return Object.fromEntries(lignes.map((l) => [l.title, l.column_key]));
}

/**
 * La marque de VALIDATION de chaque carte : titre → vrai/faux. Valider ne
 * déplace plus rien — la colonne « Validé » n'existe plus, la carte reste dans
 * « À faire » le temps de son chiffrage. C'est donc ce drapeau qu'on lit pour
 * savoir ce que le lot a vraiment fait.
 */
function validationsEnBase() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const lignes = db.prepare("SELECT title, json_extract(data, '$.analyseDemandee') AS marque FROM cards").all();
  db.close();
  return Object.fromEntries(lignes.map((l) => [l.title, !!l.marque]));
}

/** Où chaque carte se trouve À L'ÉCRAN : titre → colonne affichée. */
async function colonnesAffichees(page) {
  return page.evaluate((titres) => {
    const trouve = {};
    for (const col of document.querySelectorAll('[data-column]')) {
      for (const titre of titres) {
        if (col.textContent?.includes(titre)) trouve[titre] = col.getAttribute('data-column');
      }
    }
    return trouve;
  }, TITRES);
}

/** Les cases à cocher de la colonne « À faire », dans l'ordre des cartes. */
async function casesAFaire(page) {
  return page.evaluate(() => {
    const colonne = document.querySelector('[data-column="todo"]');
    if (!colonne) return [];
    return [...colonne.querySelectorAll('button[aria-pressed]')].map((bouton) => {
      const carte = bouton.parentElement?.querySelector('article');
      const b = bouton.getBoundingClientRect();
      const c = carte?.getBoundingClientRect();
      return {
        titre: carte?.querySelector('h3')?.textContent ?? '',
        cochee: bouton.getAttribute('aria-pressed') === 'true',
        // La case doit déborder du coin HAUT-GAUCHE de la carte.
        enHautAGauche: !!c && b.x < c.x && b.y < c.y,
      };
    });
  });
}

/** Le texte des boutons du pied de la colonne « À faire ». */
async function piedAFaire(page) {
  return page.evaluate(() => {
    const colonne = document.querySelector('[data-column="todo"]');
    const pied = colonne?.lastElementChild;
    if (!pied || !pied.querySelector('button')) return [];
    return [...pied.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
  });
}

const cliquerPied = (page, motif) =>
  page.evaluate((motif) => {
    const colonne = document.querySelector('[data-column="todo"]');
    const bouton = [...(colonne?.lastElementChild?.querySelectorAll('button') ?? [])].find((b) =>
      new RegExp(motif).test(b.textContent ?? ''),
    );
    if (!bouton) throw new Error(`bouton « ${motif} » introuvable au pied de « À faire »`);
    bouton.click();
  }, motif);

/* ------------------------------------------------------------------ */

async function ouvrirLeTableau(navigateur, ecran) {
  const contexte = await navigateur.newContext({
    viewport: ecran === 'téléphone' ? { width: 402, height: 874 } : { width: 1400, height: 900 },
    isMobile: ecran === 'téléphone',
    hasTouch: ecran === 'téléphone',
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const onglet = page.getByRole('button', { name: /^Tableau$/ });
  if (await onglet.count()) {
    await onglet.first().click();
    await page.waitForTimeout(2000);
  }
  const colonne = page.locator('[data-column="todo"]');
  await colonne.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  return { page, erreurs };
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  /* -------- 1. Sur ordinateur : le parcours complet -------- */

  const { page, erreurs } = await ouvrirLeTableau(navigateur, 'ordinateur');

  const depart = await colonnesAffichees(page);
  noter(
    'les trois cartes d’essai sont dans « À faire »',
    TITRES.every((t) => depart[t] === 'todo'),
    JSON.stringify(depart),
  );

  noter('au repos, le pied propose « Tout valider »', (await piedAFaire(page)).join(' | ').includes('Tout valider'));
  noter('au repos, aucune case à cocher n’est affichée', (await casesAFaire(page)).length === 0);

  await cliquerPied(page, 'Tout valider');
  await page.waitForTimeout(800);

  const cases = await casesAFaire(page);
  noter('un premier clic sort une case par carte', cases.length === 3, `${cases.length} case(s)`);
  noter('toutes les cases sortent COCHÉES', cases.every((c) => c.cochee));
  noter('chaque case déborde du coin haut-gauche de sa carte', cases.every((c) => c.enHautAGauche));

  const pied = await piedAFaire(page);
  noter(
    'le pied affiche « Annuler » et « Valider (3) »',
    pied.some((t) => t === 'Annuler') && pied.some((t) => /Valider \(3\)/.test(t)),
    pied.join(' | '),
  );
  await page.screenshot({ path: path.join(TMP, 'lot-ouvert.png') });

  /* -------- Décocher une carte, puis ANNULER : rien ne bouge -------- */

  await page.evaluate(() => {
    const colonne = document.querySelector('[data-column="todo"]');
    colonne?.querySelectorAll('button[aria-pressed]')[0]?.click();
  });
  await page.waitForTimeout(500);
  noter(
    'décocher une carte fait retomber le compteur à 2',
    (await piedAFaire(page)).some((t) => /Valider \(2\)/.test(t)),
    (await piedAFaire(page)).join(' | '),
  );

  await cliquerPied(page, 'Annuler');
  await page.waitForTimeout(1200);
  noter('« Annuler » referme les cases', (await casesAFaire(page)).length === 0);
  noter('« Annuler » ne déplace AUCUNE carte', TITRES.every((t) => colonnesEnBase()[t] === 'todo'), JSON.stringify(colonnesEnBase()));
  noter(
    '« Annuler » ne valide AUCUNE carte',
    TITRES.every((t) => !validationsEnBase()[t]),
    JSON.stringify(validationsEnBase()),
  );

  /* -------- Recommencer, décocher une carte, puis VALIDER -------- */

  await cliquerPied(page, 'Tout valider');
  await page.waitForTimeout(800);
  // La colonne trie du plus récent au plus ancien : la première case est la
  // carte C. C'est elle qu'on décoche, et elle seule doit rester.
  const gardee = (await casesAFaire(page))[0]?.titre ?? '';
  await page.evaluate(() => {
    const colonne = document.querySelector('[data-column="todo"]');
    colonne?.querySelectorAll('button[aria-pressed]')[0]?.click();
  });
  await page.waitForTimeout(400);
  await cliquerPied(page, 'Valider');
  await page.waitForTimeout(4000);

  const apres = colonnesEnBase();
  const validees = validationsEnBase();
  // Valider ne DÉPLACE plus : la carte reste dans « À faire » pendant son
  // chiffrage et ne montera en « Planifié » qu'une fois l'analyse rendue. Les
  // deux états valent donc « validée » — on n'attend pas un vrai tour de moteur.
  noter(
    'les deux cartes cochées sont validées : chiffrage lancé sur place',
    TITRES.filter((t) => t !== gardee).every((t) => validees[t] || apres[t] === 'planned'),
    `${JSON.stringify(apres)} · ${JSON.stringify(validees)}`,
  );
  noter(
    `la carte décochée (« ${gardee} ») est restée intacte dans « À faire »`,
    apres[gardee] === 'todo' && !validees[gardee],
    `${apres[gardee]} · validée : ${validees[gardee]}`,
  );

  const ecran = await colonnesAffichees(page);
  noter(
    'le tableau montre le même partage que la base',
    TITRES.every((t) => ecran[t] === apres[t]),
    JSON.stringify(ecran),
  );
  noter('la sélection est refermée après validation', (await casesAFaire(page)).length === 0);
  await page.screenshot({ path: path.join(TMP, 'lot-valide.png') });

  /* -------- 2. Sur téléphone : le même pied, le même premier temps -------- */

  const { page: mobile, erreurs: erreursMobile } = await ouvrirLeTableau(navigateur, 'téléphone');

  noter(
    'téléphone — le pied de « À faire » propose « Tout valider »',
    (await piedAFaire(mobile)).join(' | ').includes('Tout valider'),
    (await piedAFaire(mobile)).join(' | '),
  );

  await cliquerPied(mobile, 'Tout valider');
  await mobile.waitForTimeout(800);
  // Les trois cartes sont toujours dans « À faire » : valider ne déplace plus
  // rien, il lance le chiffrage sur place. Chacune doit donc sortir sa case.
  const casesMobile = await casesAFaire(mobile);
  noter(
    'téléphone — chaque carte sort sa case cochée, en haut à gauche',
    casesMobile.length === TITRES.length && casesMobile.every((c) => c.cochee && c.enHautAGauche),
    `${casesMobile.length} case(s)`,
  );

  // Rien ne doit dépasser latéralement : la case déborde, la colonne doit
  // lui avoir laissé la place.
  const deborde = await mobile.evaluate(() => {
    const colonne = document.querySelector('[data-column="todo"]');
    const corps = [...(colonne?.querySelectorAll('*') ?? [])].find((n) => getComputedStyle(n).overflowY === 'auto');
    return corps ? corps.scrollWidth - corps.clientWidth : -1;
  });
  noter('téléphone — la case ne fait rien déborder de côté', deborde <= 1, `${deborde} px`);

  await cliquerPied(mobile, 'Annuler');
  await mobile.waitForTimeout(1000);
  noter('téléphone — « Annuler » laisse les cartes dans « À faire »', TITRES.every((t) => colonnesEnBase()[t] === 'todo'));
  await mobile.screenshot({ path: path.join(TMP, 'lot-telephone.png') });

  /* -------- 3. La colonne « Validé » a bel et bien disparu -------- */

  const colonnesDuTableau = await page.evaluate(() =>
    [...document.querySelectorAll('[data-column]')].map((c) => c.getAttribute('data-column')),
  );
  noter(
    'le tableau ne porte plus de colonne « Validé »',
    !colonnesDuTableau.includes('validated'),
    colonnesDuTableau.join(' | '),
  );

  const toutes = [...erreurs, ...erreursMobile];
  noter('aucune erreur de page', toutes.length === 0, toutes.slice(0, 2).join(' | '));

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(`(captures et journal dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
