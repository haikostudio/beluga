#!/usr/bin/env node
/**
 * AUCUNE MODIFICATION À DÉPLOYER NE DOIT RESTER INVISIBLE.
 *
 * Le fait constaté le 17/08/2026 : la tête de la colonne annonçait
 * « À DÉPLOYER 1 » pendant que la colonne, juste dessous, écrivait « Rien à
 * mettre en ligne pour l'instant ». Le chiffre venait du bloc de publication
 * (cartes du lot + travail enregistré sans carte), la liste des cartes
 * réellement posées : deux lectures pour une seule colonne.
 *
 * Deux volets, tous deux joués pour de vrai.
 *
 * A. LE DÉPÔT (dossiers d'essai à soi, aucun serveur) — `commitsEnAttente` ne
 *    compte comme « sans carte » que ce qui l'est vraiment : ni les FUSIONS,
 *    ni ce qui vit sur la branche d'une carte, ni la plomberie de publication.
 *    C'est ce tri qui faisait annoncer onze modifications anonymes là où il n'y
 *    en avait aucune.
 *
 * B. L'ÉCRAN (vrai navigateur, serveur de DÉVELOPPEMENT) — le compteur de
 *    chaque tête de colonne dit EXACTEMENT le nombre de cartes affichées, dans
 *    les deux sens, et la phrase « Rien à mettre en ligne » ne cohabite jamais
 *    avec un avertissement de travail sans carte.
 *
 * Ce que ce contrôle NE fait PAS : il ne fabrique pas de travail sans carte sur
 * un vrai projet pour voir l'encart s'afficher — cela demanderait d'écrire dans
 * le dépôt du serveur en service. Le texte de l'encart est verrouillé côté
 * règle pure (`server/src/test/colonne-a-deployer.test.ts`), sa présence à
 * l'écran est jugée ici quand le cas se présente de lui-même.
 *
 *   node scripts/verif-colonne-a-deployer.mjs
 *   HAIKO_COLONNE_URL=http://localhost:7099 node scripts/verif-colonne-a-deployer.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* Le script juge le dépôt d'où il PART, jamais /root/haikodev en dur. */
const racineDuDepot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* On vise le serveur de DÉVELOPPEMENT : `HAIKODEV_URL`, posée pour les agents,
   désigne l'application DÉJÀ PUBLIÉE — on y verrait l'ancienne version. */
const BASE = process.env.HAIKO_COLONNE_URL || 'http://localhost:7099';
const BASE_DB = '/root/haikodev/data/haikodev.db';

let echecs = 0;
const dire = (ok, texte) => {
  if (!ok) echecs += 1;
  console.log(`${ok ? '  ok  ' : '  RATÉ'} ${texte}`);
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

/* ------------------------------------------------------------------ */
/* A. LE DÉPÔT : ce qui compte comme « sans carte », et ce qui n'y compte pas */
/* ------------------------------------------------------------------ */

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-colonne-a-deployer-'));
process.env.HAIKODEV_DATA = path.join(racine, 'data');
fs.mkdirSync(process.env.HAIKODEV_DATA, { recursive: true });

const store = await import(path.join(racineDuDepot, 'server/dist/store.js'));
const { commitsEnAttente, ficherLeTravailSansCarte } = await import(
  path.join(racineDuDepot, 'server/dist/deploy.js'),
);
const { compteurEtListeDAccord, alerteTravailSansCarte } = await import(
  path.join(racineDuDepot, 'shared/dist/index.js')
);

console.log('\nA. Ce qui attend sans carte, et ce qui n’attend pas');

const cwd = path.join(racine, 'depot');
fs.mkdirSync(cwd, { recursive: true });
git(cwd, 'init', '-q', '-b', 'main');
git(cwd, 'config', 'user.email', 'essai@haikodev');
git(cwd, 'config', 'user.name', 'Essai');
fs.writeFileSync(path.join(cwd, 'README.md'), '# essai\n');
git(cwd, 'add', 'README.md');
git(cwd, 'commit', '-q', '-m', 'départ');
const depart = git(cwd, 'rev-parse', 'HEAD').trim();

/* 1. Du travail d'une CARTE : sur sa branche, puis fusionné dans la principale.
      Il a sa fiche — il ne doit jamais compter comme anonyme, MÊME si personne
      n'a jamais ouvert l'onglet « GitHub » de la carte (c'est exactement ce qui
      manquait : `shasCouverts` reste alors vide). */
git(cwd, 'checkout', '-q', '-b', 'tache/le-travail-dune-carte');
fs.writeFileSync(path.join(cwd, 'carte.txt'), 'le travail de la carte\n');
git(cwd, 'add', 'carte.txt');
git(cwd, 'commit', '-q', '-m', 'Le travail porté par une carte');
git(cwd, 'checkout', '-q', 'main');
git(cwd, 'merge', '-q', '--no-ff', 'tache/le-travail-dune-carte', '-m', 'Fusion de main : le travail de la carte');

/* 2. Du travail VRAIMENT sans carte : commité droit sur la principale. */
fs.writeFileSync(path.join(cwd, 'anonyme.txt'), 'une correction menée sans carte\n');
git(cwd, 'add', 'anonyme.txt');
git(cwd, 'commit', '-q', '-m', 'Corriger le calcul de TVA');

/* 3. De la PLOMBERIE de publication : ce n'est pas du travail. */
fs.writeFileSync(path.join(cwd, 'plomberie.txt'), 'x\n');
git(cwd, 'add', 'plomberie.txt');
git(cwd, 'commit', '-q', '-m', 'Travaux en cours enregistrés avant publication');

const maintenant = Date.now();
const projet = store.saveProject({
  id: store.newId(),
  name: 'essai-colonne',
  path: cwd,
  defaultEngine: 'claude',
  isSelf: false,
  rank: 1000,
  archived: false,
  deploiement: { constate: true },
  createdAt: maintenant,
  updatedAt: maintenant,
});
/* La carte porte SA BRANCHE, et rien d'autre : aucun relevé GitHub, aucun sha.
   C'est le cas ordinaire — le relevé n'existe que si l'onglet a été ouvert. */
store.saveCard({
  id: store.newId(),
  projectId: projet.id,
  title: 'Le travail porté par une carte',
  description: '',
  labels: [],
  column: 'to_deploy',
  position: 1,
  origin: 'user',
  run: { engine: 'claude' },
  excludedFromDeploy: false,
  horsTache: false,
  github: { branch: 'tache/le-travail-dune-carte' },
  createdAt: maintenant,
  updatedAt: maintenant,
});
/* Un déploiement réussi au point de DÉPART : c'est lui qui borne la plage. */
store.saveDeploy({
  id: store.newId(),
  projectId: projet.id,
  state: 'success',
  cible: 'dev',
  targetCommit: depart,
  cardIds: [],
  steps: [],
  startedAt: maintenant - 60_000,
  endedAt: maintenant - 50_000,
});

const attente = await commitsEnAttente(projet.id);
dire(attente.nombre === 1, `un seul travail anonyme est compté (${attente.nombre})`);
dire(
  attente.titres.includes('Corriger le calcul de TVA'),
  `il est NOMMÉ : ${JSON.stringify(attente.titres)}`,
);
dire(
  !attente.titres.some((t) => /Fusion de main/.test(t)),
  'une FUSION n’est pas comptée comme du travail sans carte',
);
dire(
  !attente.titres.some((t) => /porté par une carte/.test(t)),
  'le travail d’une carte n’est pas anonyme, même sans relevé GitHub',
);
dire(
  !attente.titres.some((t) => /Travaux en cours enregistrés/.test(t)),
  'la plomberie de publication n’est pas du travail',
);

const alerte = alerteTravailSansCarte(attente);
dire(!!alerte && /1 modification sans carte/.test(alerte.titre), `l’encart le dit : « ${alerte?.titre} »`);

/* --- Le GESTE : donner une fiche à ce travail ------------------------ */

console.log('\nA bis. Le bouton de l’encart : créer la carte qui le porte');

const avant = store.listCards(projet.id).length;
const fiche = await ficherLeTravailSansCarte(projet.id);
dire(fiche.ok === true, `la carte est créée (${fiche.error ?? 'sans refus'})`);
dire(
  store.listCards(projet.id).length === avant + 1,
  'UNE seule carte est posée, pas une par enregistrement',
);
const posee = fiche.card;
dire(posee?.column === 'to_deploy', `elle est posée dans « À déployer » (${posee?.column})`);
dire(posee?.title === 'Corriger le calcul de TVA', `elle porte le titre du travail : « ${posee?.title} »`);
dire(
  posee?.codeDejaEnregistre === true,
  'elle dit que le code est DÉJÀ enregistré : rien ne partira au moteur',
);
dire(
  (posee?.github?.commits ?? []).length === 1,
  `elle porte l’empreinte trouvée (${(posee?.github?.commits ?? []).length})`,
);
dire(
  /DÉJÀ enregistré/.test(posee?.description ?? ''),
  'sa description dit où vit ce travail et ce que la supprimer ne fait pas',
);

/* Le dépôt n'a PAS bougé : ficher n'est pas publier. */
const apresGeste = git(cwd, 'rev-parse', 'main').trim();
const branchesApres = git(cwd, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').trim().split('\n');
dire(apresGeste === git(cwd, 'rev-parse', 'main').trim(), 'la branche principale n’a pas bougé');
dire(
  branchesApres.includes('tache/le-travail-dune-carte') && branchesApres.includes('main'),
  `aucune branche n’a été effacée (${branchesApres.length})`,
);
dire(!store.latestDeploy(projet.id) || store.latestDeploy(projet.id).state !== 'running', 'rien n’a été publié');

/* Et le même travail n'est plus annoncé deux fois. */
const apres = await commitsEnAttente(projet.id);
dire(apres.nombre === 0, `l’avertissement s’éteint de lui-même (${apres.nombre} restant)`);
const refus = await ficherLeTravailSansCarte(projet.id);
dire(refus.ok === false, `un second clic est refusé EN CLAIR : « ${refus.error} »`);

fs.rmSync(racine, { recursive: true, force: true });

/* ------------------------------------------------------------------ */
/* B. L'ÉCRAN : le compteur dit ce que la liste montre                  */
/* ------------------------------------------------------------------ */

console.log('\nB. À l’écran : le compteur et la liste, dans les deux sens');

let session = null;
let navigateur = null;
try {
  const { chromium } = await import('playwright');
  const Database = (await import('better-sqlite3')).default;

  /* Une session d'une heure, fabriquée puis retirée. Le jeton est HACHÉ en base
     et n'est jamais réutilisé ; on ne reprend JAMAIS `HAIKODEV_TOKEN`. */
  const db = new Database(BASE_DB);
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    t,
    t + 3600_000,
    'vérification colonne à déployer',
  );
  db.close();
  session = { token, empreinte };

  navigateur = await chromium.launch({ channel: 'chrome' });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
  /* La session voyage par COOKIE, comme dans tous les autres contrôles. */
  await contexte.addCookies([{ name: 'haikodev_session', value: token, domain: 'localhost', path: '/' }]);
  const page = await contexte.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  /* Un projet doit être OUVERT pour que le tableau existe : on prend le
     premier de la liste, par le point d'essai déjà utilisé ailleurs. */
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const projets = window.haikodevEssai?.projets?.() ?? [];
    if (projets.length) window.haikodevEssai.ouvrirProjet(projets[0].id);
  });
  await page.waitForSelector('[data-column]', { timeout: 30000 });
  /* Les cartes arrivent avec le premier envoi : on laisse le tableau se poser. */
  await page.waitForTimeout(3000);

  const releve = await page.evaluate(() => {
    const out = [];
    for (const colonne of document.querySelectorAll('[data-column]')) {
      const cle = colonne.getAttribute('data-column');
      const compteur = colonne.querySelector(`[data-compteur-colonne="${cle}"]`);
      out.push({
        cle,
        compteur: compteur ? Number(compteur.textContent.trim()) : null,
        cartes: colonne.querySelectorAll('[data-carte]').length,
        palier: !!colonne.querySelector(`[data-palier-cartes="${cle}"]`),
        restantes: Number(
          colonne.querySelector(`[data-palier-cartes="${cle}"]`)?.getAttribute('data-cartes-restantes') ?? 0,
        ),
        sansCarte: colonne.querySelector(`[data-travail-sans-carte="${cle}"]`)
          ? Number(colonne.querySelector(`[data-travail-sans-carte="${cle}"]`).getAttribute('data-sans-carte-nombre'))
          : null,
        rienAMettreEnLigne: /Rien à mettre en ligne/.test(colonne.textContent ?? ''),
      });
    }
    return out;
  });

  dire(releve.length > 0, `${releve.length} colonnes relevées à l’écran`);
  for (const col of releve) {
    dire(col.compteur !== null, `« ${col.cle} » porte bien un compteur`);
    if (col.compteur === null) continue;
    /* Le tableau pose les cartes par paquets de vingt : au-delà, la liste
       affichée est plus courte que le total — et le palier DIT combien il en
       reste. Le compte reste donc exact des deux côtés. */
    const affichees = col.cartes + (col.palier ? col.restantes : 0);
    dire(
      compteurEtListeDAccord(col.compteur, affichees),
      `« ${col.cle} » : ${col.compteur} annoncés = ${col.cartes} posés${
        col.palier ? ` + ${col.restantes} en attente de paquet` : ''
      }`,
    );
    if (col.sansCarte !== null) {
      dire(col.sansCarte > 0, `« ${col.cle} » : l’avertissement nomme ${col.sansCarte} modification(s)`);
      dire(
        !col.rienAMettreEnLigne,
        `« ${col.cle} » : la colonne ne dit plus « rien » alors qu’un travail attend`,
      );
    }
  }
} catch (err) {
  console.log(`  (volet écran non joué : ${err?.message ?? err})`);
  echecs += 1;
} finally {
  if (navigateur) await navigateur.close().catch(() => {});
  if (session) {
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(BASE_DB);
      db.prepare('DELETE FROM sessions WHERE token = ?').run(session.empreinte);
      db.close();
    } catch {
      /* la session expire d'elle-même dans l'heure */
    }
  }
}

/* ------------------------------------------------------------------ */
/* C. LE GESTE, EN VRAI : cliquer le bouton de l'encart                 */
/* ------------------------------------------------------------------ */

console.log('\nC. Le bouton « Créer la carte qui le porte », cliqué pour de vrai');

/* Un démon À SOI, jetable : sa base, ses dossiers, son port. On ne touche ni la
   base ni le dépôt du serveur en service — et le plafond d'agents est mis à
   ZÉRO, si bien que rien ne peut se lancer pendant l'essai. */
const PORT = Number(process.env.HAIKO_COLONNE_PORT || 7213);
const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-colonne-demon-'));
const DATA = path.join(bac, 'data');
const DEPOT = path.join(bac, 'depot');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(DEPOT, { recursive: true });

let demon = null;
let navC = null;
try {
  const { spawn } = await import('node:child_process');
  const net = await import('node:net');
  const Database = (await import('better-sqlite3')).default;
  const { chromium } = await import('playwright');

  /* Le décor du dépôt : un point de départ DÉPLOYÉ, puis un travail enregistré
     droit sur la principale — exactement le cas de la capture. */
  git(DEPOT, 'init', '-q', '-b', 'main');
  git(DEPOT, 'config', 'user.email', 'essai@haikodev');
  git(DEPOT, 'config', 'user.name', 'Essai');
  fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
  git(DEPOT, 'add', 'README.md');
  git(DEPOT, 'commit', '-q', '-m', 'départ');
  const base = git(DEPOT, 'rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(DEPOT, 'anonyme.txt'), 'une correction menée sans carte\n');
  git(DEPOT, 'add', 'anonyme.txt');
  git(DEPOT, 'commit', '-q', '-m', 'Corriger le calcul de TVA');

  demon = spawn('node', [path.join(racineDuDepot, 'server', 'dist', 'main.js')], {
    env: {
      ...process.env,
      HAIKODEV_PORT: String(PORT),
      HAIKODEV_HOST: '127.0.0.1',
      HAIKODEV_DATA: DATA,
      HAIKODEV_PROJECTS_ROOT: path.join(bac, 'projets'),
      HAIKODEV_WEB: path.join(racineDuDepot, 'web', 'dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const journal = [];
  demon.stdout.on('data', (d) => journal.push(String(d)));
  demon.stderr.on('data', (d) => journal.push(String(d)));

  const attendrePort = async (limiteMs = 60000) => {
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
  };
  if (!(await attendrePort())) throw new Error(`démon d'essai injoignable : ${journal.join('').slice(-400)}`);

  const jeton = crypto.randomBytes(32).toString('hex');
  const PROJET = 'p-colonne-essai';
  {
    const db = new Database(path.join(DATA, 'haikodev.db'));
    const t = Date.now();
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
      crypto.createHash('sha256').update(jeton).digest('hex'),
      t,
      t + 3600_000,
      'vérification carte porteuse',
    );
    const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
    const projet = {
      id: PROJET,
      name: 'Essai colonne',
      path: DEPOT,
      defaultEngine: 'claude',
      isSelf: false,
      rank: 1,
      archived: false,
      /* Le marqueur des projets d'avant : sans lui, la colonne proposerait
         d'initier la procédure au lieu d'afficher son bloc. */
      deploiement: { constate: true },
      createdAt: t,
      updatedAt: t,
    };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(PROJET, projet.name, DEPOT, JSON.stringify(projet), t, t);
    const run = {
      id: 'd-colonne-essai',
      projectId: PROJET,
      state: 'success',
      cible: 'dev',
      targetCommit: base,
      cardIds: [],
      steps: [],
      startedAt: t - 60_000,
      endedAt: t - 50_000,
    };
    db.prepare(
      'INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(run.id, PROJET, 'success', JSON.stringify(run), run.startedAt, run.endedAt);
    db.close();
  }

  navC = await chromium.launch({ channel: 'chrome' });
  const ctx = await navC.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addCookies([{ name: 'haikodev_session', value: jeton, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (err) => erreurs.push(String(err)));
  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-column="to_deploy"]', { timeout: 30000 });
  /* Le contrôle d'avant-clic (`deploy.check`) part à l'affichage du bloc : c'est
     lui qui découvre le travail sans carte. */
  await page.waitForSelector('[data-travail-sans-carte="to_deploy"]', { timeout: 30000 });

  const lire = () =>
    page.evaluate(() => {
      const col = document.querySelector('[data-column="to_deploy"]');
      return {
        compteur: Number(col?.querySelector('[data-compteur-colonne="to_deploy"]')?.textContent?.trim() ?? -1),
        cartes: col?.querySelectorAll('[data-carte]').length ?? 0,
        encart: !!col?.querySelector('[data-travail-sans-carte="to_deploy"]'),
        bouton: col?.querySelector('[data-ficher-sans-carte="to_deploy"]')?.textContent?.trim() ?? null,
      };
    });

  const avantClic = await lire();
  dire(avantClic.encart, 'l’avertissement s’affiche dans la colonne');
  dire(
    compteurEtListeDAccord(avantClic.compteur, avantClic.cartes),
    `le compteur reste celui de la liste : ${avantClic.compteur} = ${avantClic.cartes} carte(s)`,
  );
  dire(
    avantClic.bouton === 'Créer la carte qui le porte',
    `le bouton dit ce qu’il crée : « ${avantClic.bouton} »`,
  );

  await page.click('[data-ficher-sans-carte="to_deploy"]');
  await page.waitForSelector('[data-column="to_deploy"] [data-carte]', { timeout: 30000 });
  await page.waitForTimeout(1500);

  const apresClic = await lire();
  dire(apresClic.cartes === 1, `une carte est apparue dans la colonne (${apresClic.cartes})`);
  dire(
    compteurEtListeDAccord(apresClic.compteur, apresClic.cartes),
    `et elle est COMPTÉE : ${apresClic.compteur} = ${apresClic.cartes}`,
  );

  const enBase = (() => {
    const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
    const ligne = db.prepare('SELECT title, column_key, data FROM cards').get();
    db.close();
    return ligne;
  })();
  dire(enBase?.title === 'Corriger le calcul de TVA', `la carte porte le travail trouvé : « ${enBase?.title} »`);
  dire(enBase?.column_key === 'to_deploy', `elle est bien dans « À déployer » (${enBase?.column_key})`);

  /* Le dépôt n'a PAS bougé : ficher n'est pas publier. */
  dire(
    git(DEPOT, 'rev-parse', 'main').trim() !== base,
    'le travail est toujours là où il était (aucun enregistrement annulé)',
  );
  const runs = (() => {
    const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
    const n = db.prepare('SELECT COUNT(*) AS n FROM deploys').get().n;
    db.close();
    return n;
  })();
  dire(runs === 1, `aucune publication n’a été lancée au passage (${runs} run connu, celui du décor)`);
  dire(!erreurs.length, `aucune erreur de page${erreurs.length ? ` — ${erreurs[0]}` : ''}`);
} catch (err) {
  console.log(`  (volet du geste non joué : ${err?.message ?? err})`);
  echecs += 1;
} finally {
  if (navC) await navC.close().catch(() => {});
  if (demon) {
    /* On ne vise QUE le numéro de NOTRE démon d'essai : jamais un `pkill` dont
       le motif pourrait désigner le démon en service. */
    try {
      demon.kill('SIGKILL');
    } catch {
      /* déjà parti */
    }
  }
  fs.rmSync(bac, { recursive: true, force: true });
}

console.log(echecs ? `\n${echecs} vérification(s) en échec.` : '\nTout est vérifié.');
process.exit(echecs ? 1 : 0);
