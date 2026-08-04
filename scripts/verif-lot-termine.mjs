#!/usr/bin/env node
/**
 * Le pied de la colonne « Terminé » porte un bouton « Tout déployer » — et non
 * plus « Tout archiver » : « Terminé » précède « À déployer » dans le parcours
 * d'une carte, on ne saute pas l'étape de publication. Le mécanisme ne change
 * pas : premier clic, les cases sortent au coin haut-gauche des cartes, toutes
 * cochées ; le pied affiche « Annuler » et « Déployer (n) ». Annuler ne touche
 * à rien, confirmer fait passer les cartes cochées en « À déployer » et laisse
 * les décochées où elles sont. RIEN n'est mis en ligne.
 *
 *   node scripts/verif-lot-termine.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un dossier de projets vide : le démon de production n'est pas touché. Le
 * plafond d'agents est mis à ZÉRO : aucun tour n'est lancé, aucun quota dépensé.
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RACINE = '/root/haikodev';
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7193);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-lot-termine-'));

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
/* Le décor : un projet, trois cartes « Terminé », une session          */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const TITRES = ['Carte d’essai — fin A', 'Carte d’essai — fin B', 'Carte d’essai — fin C'];

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification lot terminé',
  );

  /* Plafond d'agents à ZÉRO : rien ne peut se lancer pendant l'essai. */
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
      column: 'done',
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
    ).run(carte.id, PROJET_ID, 'done', carte.position, titre, JSON.stringify(carte), maintenant, maintenant);
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

/** Les cases à cocher d'une colonne, dans l'ordre des cartes. */
async function cases(page, colonne = 'done') {
  return page.evaluate((colonne) => {
    const col = document.querySelector(`[data-column="${colonne}"]`);
    if (!col) return [];
    return [...col.querySelectorAll('button[aria-pressed]')].map((bouton) => {
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
  }, colonne);
}

/** Le texte des boutons du pied d'une colonne. */
async function pied(page, colonne = 'done') {
  return page.evaluate((colonne) => {
    const col = document.querySelector(`[data-column="${colonne}"]`);
    const bas = col?.lastElementChild;
    if (!bas || !bas.querySelector('button')) return [];
    return [...bas.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
  }, colonne);
}

const cliquerPied = (page, motif, colonne = 'done') =>
  page.evaluate(
    ({ motif, colonne }) => {
      const col = document.querySelector(`[data-column="${colonne}"]`);
      const bouton = [...(col?.lastElementChild?.querySelectorAll('button') ?? [])].find((b) =>
        new RegExp(motif).test(b.textContent ?? ''),
      );
      if (!bouton) throw new Error(`bouton « ${motif} » introuvable au pied de « ${colonne} »`);
      bouton.click();
    },
    { motif, colonne },
  );

/* ------------------------------------------------------------------ */

async function ouvrirLeTableau(navigateur) {
  const contexte = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
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
  await page.locator('[data-column="done"]').scrollIntoViewIfNeeded();
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

  const { page, erreurs } = await ouvrirLeTableau(navigateur);

  const depart = await colonnesAffichees(page);
  noter(
    'les trois cartes d’essai sont dans « Terminé »',
    TITRES.every((t) => depart[t] === 'done'),
    JSON.stringify(depart),
  );

  const auRepos = (await pied(page)).join(' | ');
  noter('au repos, le pied propose « Tout déployer »', auRepos.includes('Tout déployer'), auRepos);
  noter('le pied de « Terminé » ne propose PLUS « Tout archiver »', !auRepos.includes('Tout archiver'), auRepos);
  noter('au repos, aucune case à cocher n’est affichée', (await cases(page)).length === 0);

  await cliquerPied(page, 'Tout déployer');
  await page.waitForTimeout(800);

  const sorties = await cases(page);
  noter('un premier clic sort une case par carte', sorties.length === 3, `${sorties.length} case(s)`);
  noter('toutes les cases sortent COCHÉES', sorties.every((c) => c.cochee));
  noter('chaque case déborde du coin haut-gauche de sa carte', sorties.every((c) => c.enHautAGauche));

  const ouvert = await pied(page);
  noter(
    'le pied affiche « Annuler » et « Déployer (3) »',
    ouvert.some((t) => t === 'Annuler') && ouvert.some((t) => /Déployer \(3\)/.test(t)),
    ouvert.join(' | '),
  );
  await page.screenshot({ path: path.join(TMP, 'lot-ouvert.png') });

  /* -------- Décocher une carte, puis ANNULER : rien ne bouge -------- */

  await page.evaluate(() => {
    document.querySelector('[data-column="done"]')?.querySelectorAll('button[aria-pressed]')[0]?.click();
  });
  await page.waitForTimeout(500);
  noter(
    'décocher une carte fait retomber le compteur à 2',
    (await pied(page)).some((t) => /Déployer \(2\)/.test(t)),
    (await pied(page)).join(' | '),
  );

  await cliquerPied(page, 'Annuler');
  await page.waitForTimeout(1200);
  noter('« Annuler » referme les cases', (await cases(page)).length === 0);
  noter(
    '« Annuler » ne déplace AUCUNE carte',
    TITRES.every((t) => colonnesEnBase()[t] === 'done'),
    JSON.stringify(colonnesEnBase()),
  );

  /* -------- Recommencer, décocher une carte, puis DÉPLOYER -------- */

  await cliquerPied(page, 'Tout déployer');
  await page.waitForTimeout(800);
  // La colonne trie du plus récent au plus ancien : la première case est la
  // carte C. C'est elle qu'on décoche, et elle seule doit rester.
  const gardee = (await cases(page))[0]?.titre ?? '';
  await page.evaluate(() => {
    document.querySelector('[data-column="done"]')?.querySelectorAll('button[aria-pressed]')[0]?.click();
  });
  await page.waitForTimeout(400);
  await cliquerPied(page, 'Déployer');
  await page.waitForTimeout(4000);

  const apres = colonnesEnBase();
  noter(
    'les deux cartes cochées sont passées en « À déployer »',
    TITRES.filter((t) => t !== gardee).every((t) => apres[t] === 'to_deploy'),
    JSON.stringify(apres),
  );
  noter(`la carte décochée (« ${gardee} ») est restée dans « Terminé »`, apres[gardee] === 'done', apres[gardee]);
  noter('AUCUNE carte n’est partie à l’archive', !Object.values(apres).includes('archived'), JSON.stringify(apres));

  const ecran = await colonnesAffichees(page);
  noter(
    'le tableau montre le même partage que la base',
    TITRES.every((t) => ecran[t] === apres[t]),
    JSON.stringify(ecran),
  );
  noter('la sélection est refermée après confirmation', (await cases(page)).length === 0);
  await page.screenshot({ path: path.join(TMP, 'lot-deploye.png') });

  /* -------- « À déployer » garde son « Tout archiver » -------- */

  const piedADeployer = (await pied(page, 'to_deploy')).join(' | ');
  noter(
    'la colonne « À déployer » propose toujours « Tout archiver »',
    piedADeployer.includes('Tout archiver'),
    piedADeployer,
  );

  const toutes = erreurs;
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
