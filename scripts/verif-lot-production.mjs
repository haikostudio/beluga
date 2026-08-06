#!/usr/bin/env node
/**
 * La mise en ligne compte DEUX étapes sur le tableau. Entre « À déployer » et
 * « Archivé » s'intercale « En production » :
 *
 *   - le pied de « À déployer » propose « Tout mettre en production » et non
 *     plus « Tout archiver » — on n'archive jamais par-dessus une étape ;
 *   - la colonne « En production » existe, porte son titre, se défile, et son
 *     pied propose « Tout archiver » ;
 *   - sur écran de téléphone, elle a son onglet, avec son compte de cartes ;
 *   - une carte posée là ne se reprend qu'à la main, et retombe alors dans
 *     « À déployer » — l'étape juste avant, jamais deux d'un coup.
 *
 *   node scripts/verif-lot-production.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un dossier de projets vide : le démon de production n'est pas touché. Le
 * plafond d'agents est mis à ZÉRO : aucun tour n'est lancé, aucun quota dépensé.
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

/* La racine se déduit du script LUI-MÊME : lancé depuis une copie de travail,
   il doit juger le code de cette copie, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* La résolution ordinaire de Node remonte les dossiers parents : elle trouve le
   `node_modules` de la copie de travail, et à défaut celui du dépôt principal. */
const Database = createRequire(import.meta.url)('better-sqlite3');

const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7197);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-lot-production-'));

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
/* Le décor : un projet, trois cartes « À déployer », une session       */
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
    'vérification colonne en production',
  );

  /* Plafond d'agents à ZÉRO : rien ne peut se lancer pendant l'essai. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai production',
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
      column: 'to_deploy',
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
    ).run(carte.id, PROJET_ID, 'to_deploy', carte.position, titre, JSON.stringify(carte), maintenant, maintenant);
  });
  db.close();
}

/**
 * Le projet déclare un environnement « dev chez le client » — la seule chose
 * qui ouvre la seconde étape de mise en ligne — et une carte revient dans « En
 * production » pour que le lot ne soit pas vide. Rien n'est publié : on ne fait
 * qu'écrire des réglages dans la base d'essai.
 */
function declarerUnEnvironnementDeDev() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const ligne = db.prepare('SELECT data FROM projects WHERE id = ?').get(PROJET_ID);
  const projet = JSON.parse(ligne.data);
  projet.environments = [
    { id: 'dev', nom: 'Dev client', role: 'dev-client' },
    { id: 'prod', nom: 'Production', role: 'production' },
  ];
  db.prepare('UPDATE projects SET data = ? WHERE id = ?').run(JSON.stringify(projet), PROJET_ID);

  const carte = JSON.parse(db.prepare('SELECT data FROM cards WHERE id = ?').get('c-essai-0').data);
  carte.column = 'in_production';
  db.prepare('UPDATE cards SET column_key = ?, data = ? WHERE id = ?').run(
    'in_production',
    JSON.stringify(carte),
    'c-essai-0',
  );
  db.close();
}

/** L'état des cartes en BASE : titre → colonne. */
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
async function cases(page, colonne) {
  return page.evaluate((colonne) => {
    const col = document.querySelector(`[data-column="${colonne}"]`);
    if (!col) return [];
    return [...col.querySelectorAll('button[aria-pressed]')].map((bouton) => {
      const carte = bouton.parentElement?.querySelector('article');
      return { titre: carte?.querySelector('h3')?.textContent ?? '', cochee: bouton.getAttribute('aria-pressed') === 'true' };
    });
  }, colonne);
}

/** Le texte des boutons du pied d'une colonne. */
async function pied(page, colonne) {
  return page.evaluate((colonne) => {
    const col = document.querySelector(`[data-column="${colonne}"]`);
    const bas = col?.lastElementChild;
    if (!bas || !bas.querySelector('button')) return [];
    return [...bas.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
  }, colonne);
}

/**
 * Le bloc de publication posé EN TÊTE d'une colonne : son bouton, ce qu'il dit,
 * et s'il est éteint. `null` quand la colonne n'en porte aucun — c'est le cas
 * d'« En production » tant que le projet n'a qu'une seule mise en ligne.
 */
async function blocPublication(page, colonne) {
  return page.evaluate((colonne) => {
    const col = document.querySelector(`[data-column="${colonne}"]`);
    const bloc = col?.querySelector('[data-bloc-publication]');
    if (!bloc) return null;
    const bouton = bloc.querySelector('[data-bouton-publication]');
    return {
      colonne: bloc.getAttribute('data-bloc-publication'),
      bouton: bouton?.textContent?.trim() ?? null,
      eteint: bouton?.disabled === true,
      texte: bloc.textContent?.trim() ?? '',
    };
  }, colonne);
}

const cliquerPied = (page, motif, colonne) =>
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

async function ouvrirLeTableau(navigateur, viewport = { width: 1400, height: 900 }) {
  const contexte = await navigateur.newContext({ viewport, locale: 'fr-CH', serviceWorkers: 'block' });
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
  return { page, contexte, erreurs };
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

  const { page, contexte, erreurs } = await ouvrirLeTableau(navigateur);

  /* -------- La colonne existe et se défile -------- */

  const colonne = page.locator('[data-column="in_production"]');
  noter('la colonne « En production » existe sur le tableau', (await colonne.count()) === 1);
  await colonne.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const vue = await page.evaluate(() => {
    const col = document.querySelector('[data-column="in_production"]');
    if (!col) return null;
    const b = col.getBoundingClientRect();
    return { titre: col.querySelector('h2')?.textContent ?? '', visible: b.left >= -1 && b.right <= window.innerWidth + 1 };
  });
  noter('elle porte le titre « En production »', vue?.titre === 'En production', vue?.titre ?? '—');
  noter('le rail l’amène entièrement à l’écran', !!vue?.visible, JSON.stringify(vue));

  const ordre = await page.evaluate(() =>
    [...document.querySelectorAll('[data-column]')].map((c) => c.getAttribute('data-column')),
  );
  noter(
    'elle s’intercale entre « À déployer » et « Archivé »',
    ordre.indexOf('to_deploy') + 1 === ordre.indexOf('in_production') &&
      ordre.indexOf('in_production') + 1 === ordre.indexOf('archived'),
    ordre.join(' → '),
  );

  /* -------- Le pied de « À déployer » pousse en production -------- */

  await page.locator('[data-column="to_deploy"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const depart = await colonnesAffichees(page);
  noter(
    'les trois cartes d’essai sont dans « À déployer »',
    TITRES.every((t) => depart[t] === 'to_deploy'),
    JSON.stringify(depart),
  );

  /* -------- Le bloc de publication, colonne par colonne -------- */

  const blocDeploy = await blocPublication(page, 'to_deploy');
  noter(
    '« À déployer » garde son bloc et son bouton « Tout déployer »',
    !!blocDeploy && /Tout déployer/.test(blocDeploy.bouton ?? ''),
    JSON.stringify(blocDeploy),
  );
  noter(
    'le bouton compte exactement les trois cartes du lot',
    /\(3\)/.test(blocDeploy?.bouton ?? ''),
    blocDeploy?.bouton ?? '—',
  );

  await page.locator('[data-column="in_production"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const blocProduction = await blocPublication(page, 'in_production');
  noter(
    'sans environnement de dev déclaré, « En production » ne porte AUCUN bloc de publication',
    blocProduction === null,
    JSON.stringify(blocProduction),
  );

  await page.locator('[data-column="to_deploy"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const auRepos = (await pied(page, 'to_deploy')).join(' | ');
  noter('le pied de « À déployer » propose « Tout mettre en production »', auRepos.includes('Tout mettre en production'), auRepos);
  noter('il ne propose PLUS « Tout archiver »', !auRepos.includes('Tout archiver'), auRepos);

  await cliquerPied(page, 'Tout mettre en production', 'to_deploy');
  await page.waitForTimeout(800);
  const sorties = await cases(page, 'to_deploy');
  noter('un premier clic sort une case par carte, toutes cochées', sorties.length === 3 && sorties.every((c) => c.cochee), `${sorties.length} case(s)`);

  // La colonne trie du plus récent au plus ancien : la première case est la
  // carte C. On la décoche — elle seule doit rester dans « À déployer ».
  const gardee = sorties[0]?.titre ?? '';
  await page.evaluate(() => {
    document.querySelector('[data-column="to_deploy"]')?.querySelectorAll('button[aria-pressed]')[0]?.click();
  });
  await page.waitForTimeout(500);
  noter(
    'le compteur du pied suit la sélection',
    (await pied(page, 'to_deploy')).some((t) => /Mettre en production \(2\)/.test(t)),
    (await pied(page, 'to_deploy')).join(' | '),
  );

  await cliquerPied(page, 'Mettre en production', 'to_deploy');
  await page.waitForTimeout(4000);

  const apres = colonnesEnBase();
  noter(
    'les cartes cochées sont passées en « En production »',
    TITRES.filter((t) => t !== gardee).every((t) => apres[t] === 'in_production'),
    JSON.stringify(apres),
  );
  noter(`la carte décochée (« ${gardee} ») est restée dans « À déployer »`, apres[gardee] === 'to_deploy', apres[gardee]);
  noter('AUCUNE carte n’a sauté à l’archive', !Object.values(apres).includes('archived'), JSON.stringify(apres));

  /* -------- Le pied d’« En production » archive -------- */

  await page.locator('[data-column="in_production"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const piedProduction = (await pied(page, 'in_production')).join(' | ');
  noter('le pied d’« En production » propose « Tout archiver »', piedProduction.includes('Tout archiver'), piedProduction);
  // Deux cartes viennent d'arriver dans la colonne : le bloc reste absent tant
  // que la seconde étape n'existe pas, sinon on proposerait une mise en ligne
  // que le serveur refuserait au clic.
  const blocRempli = await blocPublication(page, 'in_production');
  noter(
    'la colonne remplie n’a toujours pas de bloc de publication',
    blocRempli === null,
    JSON.stringify(blocRempli),
  );
  await page.screenshot({ path: path.join(TMP, 'colonne-production.png') });

  await cliquerPied(page, 'Tout archiver', 'in_production');
  await page.waitForTimeout(800);
  await cliquerPied(page, 'Archiver', 'in_production');
  await page.waitForTimeout(5000);

  const archivees = colonnesEnBase();
  noter(
    'les deux cartes partent à l’archive depuis « En production »',
    TITRES.filter((t) => t !== gardee).every((t) => archivees[t] === 'archived'),
    JSON.stringify(archivees),
  );

  /* -------- Une carte reprise retombe à l’étape juste avant -------- */

  await page.locator('[data-column="to_deploy"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  // On remet une carte « En production » à la main, puis on la reprend.
  await page.evaluate(() => {
    const col = document.querySelector('[data-column="to_deploy"]');
    col?.querySelector('article h3')?.closest('article')?.click();
  });
  await page.waitForTimeout(1500);
  const reprise = await page.evaluate(() => {
    const bouton = document.querySelector('[data-geste="reprendre"]');
    return bouton ? (bouton.textContent ?? '') : null;
  });
  // La carte ouverte est encore dans « À déployer » : son bouton de reprise dit
  // le geste de CETTE colonne-là.
  noter(
    'une carte « À déployer » propose de retomber en « Terminé »',
    !!reprise && reprise.includes('Retirer du lot à publier') && reprise.includes('Terminé'),
    reprise ?? '—',
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  /* -------- Avec un environnement de dev, le bouton « Tout publier » -------- */

  // Le rôle « dev chez le client » EST la déclaration de la seconde étape. On
  // l'écrit en base, on remet une carte dans la colonne, et l'on recharge : le
  // bloc de publication doit apparaître, avec le bon verbe et le bon compte.
  declarerUnEnvironnementDeDev();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.locator('[data-column="in_production"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);

  const blocDev = await blocPublication(page, 'in_production');
  noter(
    'avec un environnement de dev déclaré, « En production » porte son bloc de publication',
    !!blocDev,
    JSON.stringify(blocDev),
  );
  noter(
    'son bouton dit « Tout publier », jamais « Tout déployer »',
    /Tout publier/.test(blocDev?.bouton ?? '') && !/Tout déployer/.test(blocDev?.bouton ?? ''),
    blocDev?.bouton ?? '—',
  );
  noter(
    'il compte la seule carte de la colonne',
    /Tout publier \(1\)/.test(blocDev?.bouton ?? ''),
    blocDev?.bouton ?? '—',
  );
  noter(
    'il vise la production, pas l’environnement de dev d’où la carte sort',
    /Production/.test(blocDev?.bouton ?? '') && !/Dev client/.test(blocDev?.bouton ?? ''),
    blocDev?.bouton ?? '—',
  );
  noter(
    'le bloc de « À déployer » garde son propre verbe',
    /Tout déployer/.test((await blocPublication(page, 'to_deploy'))?.bouton ?? ''),
    (await blocPublication(page, 'to_deploy'))?.bouton ?? '—',
  );
  const piedEncore = (await pied(page, 'in_production')).join(' | ');
  noter('le pied « Tout archiver » reste disponible', piedEncore.includes('Tout archiver'), piedEncore);
  await page.screenshot({ path: path.join(TMP, 'bouton-tout-publier.png') });

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();

  /* -------- Sur téléphone, l’onglet et son compte -------- */

  const { page: tel, contexte: ctxTel } = await ouvrirLeTableau(navigateur, { width: 390, height: 844 });
  const onglet = await tel.evaluate(() => {
    const el = document.querySelector('[data-onglet-colonne="in_production"]');
    if (!el) return null;
    return {
      texte: el.textContent ?? '',
      compte: el.querySelector('[data-onglet-compte]')?.textContent ?? null,
    };
  });
  noter('l’onglet « En production » existe sur téléphone', !!onglet && onglet.texte.includes('En production'), JSON.stringify(onglet));
  noter('il porte son compte de cartes, zéro compris', onglet?.compte !== null && onglet?.compte !== undefined, String(onglet?.compte));
  await tel.screenshot({ path: path.join(TMP, 'onglet-telephone.png') });
  await ctxTel.close();

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
