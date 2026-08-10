#!/usr/bin/env node
/**
 * Le pied de la colonne « À faire » porte un bouton « Tout lancer », à côté de
 * « Tout valider » : depuis le retrait de « À faire », les deux étapes de
 * l'avant-travail se jouent dans la même colonne. Le
 * mécanisme est celui des autres pieds, sans exception : premier clic, une case
 * sort au coin haut-gauche de chaque carte, TOUTES cochées, et le pied devient
 * « Annuler » / « Lancer (n) ». Annuler ne touche à rien ; confirmer déplace les
 * cartes cochées vers « En cours » une par une, par le MÊME appel que le bouton
 * du tiroir — donc par `startCard`, portes dures comprises.
 *
 *   node scripts/verif-lot-lancer.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et un
 * dossier de projets vide : le démon de production n'est pas touché.
 *
 * Le plafond d'agents est mis à ZÉRO : aucun quota n'est dépensé, et c'est
 * justement le REFUS qu'on veut voir — chaque carte revient à « À faire » avec
 * sa raison, le lot continue avec les suivantes JUSQU'À LA DERNIÈRE, et un
 * compte rendu dit combien sont parties, combien attendent et pourquoi. Le
 * lancement RÉUSSI n'est
 * pas rejoué ici (il dépenserait un vrai quota) : il est verrouillé autrement,
 * le lot n'ayant aucun chemin à lui — il rejoue `client.moveCard`, déjà couvert
 * par `scripts/verif-glissement-lancement.mjs` et par les règles pures de
 * `server/src/test/suivi-colonne.test.ts`.
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

/* La racine se déduit du script LUI-MÊME : lancé depuis une copie de travail
   (`.worktrees/…`), il doit juger le code de CETTE copie, jamais celui du
   dossier principal — sinon il déclare bon un changement jamais exécuté. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* La résolution ordinaire de Node remonte les dossiers parents : elle trouve le
   `node_modules` de la copie de travail, et à défaut celui du dépôt principal. */
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7194);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-lot-lancer-'));

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
/* Le décor : un projet, trois cartes « À faire », une session         */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const TITRES = ['Carte d’essai — plan A', 'Carte d’essai — plan B', 'Carte d’essai — plan C'];

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification lot planifié',
  );

  /* Plafond d'agents à ZÉRO : aucun tour réel, et le refus attendu au lancement. */
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
 * La raison d'attente écrite par le serveur sur chaque carte : titre → raison.
 * C'est la PREUVE qu'une carte a été tentée — une carte que la boucle n'aurait
 * pas atteinte n'en porterait aucune.
 */
function raisonsEnBase() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const lignes = db.prepare('SELECT title, data FROM cards').all();
  db.close();
  return Object.fromEntries(
    lignes.map((l) => {
      let raison = '';
      try {
        raison = JSON.parse(l.data)?.scheduling?.waitingReason ?? '';
      } catch {
        /* carte illisible : pas de raison */
      }
      return [l.title, raison];
    }),
  );
}

/** Efface les raisons d'attente : on veut voir celles du lot suivant, pas les vieilles. */
function effacerLesRaisons() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  for (const ligne of db.prepare('SELECT id, data FROM cards').all()) {
    const carte = JSON.parse(ligne.data);
    carte.scheduling = { ...(carte.scheduling ?? {}), waitingReason: undefined };
    db.prepare('UPDATE cards SET data = ? WHERE id = ?').run(JSON.stringify(carte), ligne.id);
  }
  db.close();
}

/*
 * Combien d'agents de TRAVAIL ont été créés ? Doit rester à zéro. On ne compte
 * que ceux rattachés à une carte : le chef d'orchestre du projet, lui, existe
 * dès l'ouverture de la conversation et n'a rien à voir avec le lot.
 */
function agentsDeCarte() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const n = db.prepare('SELECT COUNT(*) AS n FROM agents WHERE card_id IS NOT NULL').get()?.n ?? 0;
  db.close();
  return n;
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
async function cases(page, colonne = 'todo') {
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
async function pied(page, colonne = 'todo') {
  return page.evaluate((colonne) => {
    const col = document.querySelector(`[data-column="${colonne}"]`);
    const bas = col?.lastElementChild;
    if (!bas || !bas.querySelector('button')) return [];
    return [...bas.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
  }, colonne);
}

const cliquerPied = (page, motif, colonne = 'todo') =>
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
  await page.locator('[data-column="todo"]').scrollIntoViewIfNeeded();
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
    'les trois cartes d’essai sont dans « À faire »',
    TITRES.every((t) => depart[t] === 'todo'),
    JSON.stringify(depart),
  );

  const auRepos = (await pied(page)).join(' | ');
  noter('au repos, le pied propose « Tout lancer »', auRepos.includes('Tout lancer'), auRepos);
  // La même colonne porte les DEUX gestes de l'avant-travail depuis la fusion.
  noter('au repos, le pied propose aussi « Tout valider »', auRepos.includes('Tout valider'), auRepos);
  noter('au repos, aucune case à cocher n’est affichée', (await cases(page)).length === 0);

  await cliquerPied(page, 'Tout lancer');
  await page.waitForTimeout(800);

  const sorties = await cases(page);
  noter('un premier clic sort une case par carte', sorties.length === 3, `${sorties.length} case(s)`);
  noter('toutes les cases sortent COCHÉES', sorties.every((c) => c.cochee));
  noter('chaque case déborde du coin haut-gauche de sa carte', sorties.every((c) => c.enHautAGauche));

  const ouvert = await pied(page);
  noter(
    'le pied affiche « Annuler » et « Lancer (3) »',
    ouvert.some((t) => t === 'Annuler') && ouvert.some((t) => /Lancer \(3\)/.test(t)),
    ouvert.join(' | '),
  );
  await page.screenshot({ path: path.join(TMP, 'lot-ouvert.png') });

  /* -------- Décocher une carte, puis ANNULER : rien ne bouge -------- */

  await page.evaluate(() => {
    document.querySelector('[data-column="todo"]')?.querySelectorAll('button[aria-pressed]')[0]?.click();
  });
  await page.waitForTimeout(500);
  noter(
    'décocher une carte fait retomber le compteur à 2',
    (await pied(page)).some((t) => /Lancer \(2\)/.test(t)),
    (await pied(page)).join(' | '),
  );

  await cliquerPied(page, 'Annuler');
  await page.waitForTimeout(1200);
  noter('« Annuler » referme les cases', (await cases(page)).length === 0);
  noter(
    '« Annuler » ne déplace AUCUNE carte',
    TITRES.every((t) => colonnesEnBase()[t] === 'todo'),
    JSON.stringify(colonnesEnBase()),
  );
  noter('« Annuler » n’a lancé aucun agent', agentsDeCarte() === 0, `${agentsDeCarte()} agent(s) de carte`);

  /* -------- Recommencer, décocher une carte, puis LANCER -------- */

  await cliquerPied(page, 'Tout lancer');
  await page.waitForTimeout(800);
  // La colonne trie du plus récent au plus ancien : la première case est la
  // carte C. C'est elle qu'on décoche — elle ne doit même pas être tentée.
  const gardee = (await cases(page))[0]?.titre ?? '';
  await page.evaluate(() => {
    document.querySelector('[data-column="todo"]')?.querySelectorAll('button[aria-pressed]')[0]?.click();
  });
  await page.waitForTimeout(400);
  await cliquerPied(page, 'Lancer');
  await page.waitForTimeout(6000);

  /*
   * Le plafond est à zéro : les deux cartes cochées sont REFUSÉES au démarrage.
   * C'est le contrôle qui compte — le lot est passé par `startCard`, il n'a pas
   * poussé les cartes en « En cours » de son côté.
   */
  const apres = colonnesEnBase();
  noter(
    'un lancement refusé laisse chaque carte dans « À faire »',
    TITRES.every((t) => apres[t] === 'todo'),
    JSON.stringify(apres),
  );
  noter('aucun agent n’a été créé malgré le lot', agentsDeCarte() === 0, `${agentsDeCarte()} agent(s) de carte`);

  const ecran = await colonnesAffichees(page);
  noter(
    'le tableau montre le même partage que la base',
    TITRES.every((t) => ecran[t] === apres[t]),
    JSON.stringify(ecran),
  );
  noter(`la carte décochée (« ${gardee} ») n’a pas bougé non plus`, ecran[gardee] === 'todo', ecran[gardee]);

  const texte = await page.locator('body').innerText();
  noter(
    'le refus se dit en toutes lettres',
    /Plafond atteint|Quota épuisé|suspendus|impossible/i.test(texte),
    (texte.match(/(Plafond atteint[^\n]*|Quota épuisé[^\n]*|[^\n]*impossible[^\n]*)/) ?? [''])[0].slice(0, 90),
  );
  await page.screenshot({ path: path.join(TMP, 'lot-refuse.png') });

  /* -------- Le lot va jusqu'à la DERNIÈRE carte, et fait son compte -------- */

  /*
   * Le vrai piège du départ : la première carte refusée arrêtait la boucle, la
   * sélection restait ouverte et AUCUN mot n'apparaissait. On recommence donc
   * avec les TROIS cartes cochées, sur un tableau dont les raisons d'attente ont
   * été effacées : chaque carte doit en récupérer une — c'est la preuve qu'elle
   * a été tentée —, et le compte rendu doit annoncer 0 lancée / 3 en attente.
   *
   * Le refus est ici celui du plafond d'agents ; celui du dossier déjà occupé
   * (`porteDuDossier`) emprunte le MÊME chemin (`refus`, `startCard`) mais
   * demanderait un agent réellement vivant, donc un vrai quota : sa formulation
   * est verrouillée par `server/src/test/branche-de-carte.test.ts`.
   */
  effacerLesRaisons();
  await cliquerPied(page, 'Tout lancer');
  await page.waitForTimeout(800);
  const toutes = await pied(page);
  noter(
    'le lot se rouvre avec les trois cartes cochées',
    toutes.some((t) => /Lancer \(3\)/.test(t)),
    toutes.join(' | '),
  );

  await cliquerPied(page, 'Lancer');
  await page.waitForTimeout(8000);

  const raisons = raisonsEnBase();
  noter(
    'la boucle est allée jusqu’à la dernière : les trois cartes portent leur raison',
    TITRES.every((t) => (raisons[t] ?? '').length > 10),
    JSON.stringify(Object.fromEntries(TITRES.map((t) => [t, (raisons[t] ?? '').slice(0, 40)]))),
  );

  const finales = colonnesEnBase();
  noter(
    'les trois cartes sont restées dans « À faire »',
    TITRES.every((t) => finales[t] === 'todo'),
    JSON.stringify(finales),
  );
  noter('toujours aucun agent créé', agentsDeCarte() === 0, `${agentsDeCarte()} agent(s) de carte`);

  const bilan = await page.locator('body').innerText();
  noter(
    'le compte rendu annonce 0 lancée et 3 en attente',
    /Aucune carte lancée\s*—\s*3 en attente/.test(bilan),
    (bilan.match(/Aucune carte lancée[^\n]*/) ?? [''])[0],
  );
  noter(
    'le compte rendu NOMME chaque carte refusée',
    TITRES.every((t) => bilan.includes(`« ${t} »`)),
    TITRES.filter((t) => !bilan.includes(`« ${t} »`)).join(' | ') || 'les trois sont nommées',
  );
  noter('la sélection s’est refermée après le lot', (await cases(page)).length === 0);
  await page.screenshot({ path: path.join(TMP, 'lot-compte-rendu.png') });

  /* -------- Les pieds déjà en place n'ont pas bougé -------- */

  const piedADeployer = (await pied(page, 'to_deploy')).join(' | ');
  noter(
    // Colonne vide ici : elle n'a pas de pied de LOT (c'est la règle), seul son
    // bloc de publication s'affiche. Ce qu'on contrôle, c'est qu'elle n'archive
    // plus en lot — le pied « Tout mettre en production » est joué sur une
    // colonne PLEINE par `verif-lot-production.mjs` et `verif-lot-termine.mjs`.
    'la colonne « À déployer » n’archive plus en lot',
    !piedADeployer.includes('Tout archiver'),
    piedADeployer || 'colonne vide : pas de pied de lot, c’est la règle',
  );

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

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
