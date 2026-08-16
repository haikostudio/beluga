#!/usr/bin/env node
/**
 * UN BOUTON QUI PART EN REQUÊTE LE DIT TOUT DE SUITE.
 *
 *   node scripts/verif-bouton-en-attente.mjs
 *
 * Le défaut corrigé : « Terminer la tâche » restait exactement tel quel entre
 * le clic et la réponse du serveur. Rien ne distinguait un geste parti d'un
 * clic tombé à côté.
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve : le
 * démon de production n'est pas touché, aucun moteur n'est appelé, aucun quota
 * dépensé. La carte et son agent sont posés directement en base.
 *
 * Ce qui est vérifié, dans un vrai navigateur :
 *   1. le bouton passe par l'état « en cours » DÈS le clic (relevé par un
 *      observateur posé avant, pour ne pas rater un aller-retour rapide) ;
 *   2. la roue tourne réellement pendant ce temps, à la place du texte ;
 *   3. le geste a bien eu lieu : la carte est passée en « Terminé », et son
 *      bouton laisse la place au geste suivant ;
 *   4. sur un geste qui RESTE à l'écran (« Dès que possible »), la réussite
 *      allume une coche, puis le bouton revient de lui-même au repos ;
 *   5. un geste REFUSÉ — démon coupé — montre son attente, n'affiche AUCUNE
 *      coche et ramène le bouton à son état initial.
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
import { lireCarteParId } from './carte-en-base.mjs';

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7217);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-bouton-'));

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

function nettoyer() {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.on('exit', nettoyer);

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
/* Le décor : une tâche dont l'agent a rendu sa réponse                */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const CARTE = { id: 'c-a', titre: 'Tâche rendue — prête à clôturer', agent: 'ag-a' };
/* La seconde sert au refus : on coupe le démon avant de cliquer dessus. */
const CARTE_B = { id: 'c-b', titre: 'Tâche rendue — celle du refus', agent: 'ag-b' };
/*
 * La troisième dort dans « Planifié », SUSPENDUE : son bouton « Dès que
 * possible » reste à l'écran après le clic — c'est là qu'on voit la coche —
 * et l'ordonnanceur ne la lancera pas pour autant, donc aucun moteur n'est
 * appelé et aucun quota n'est dépensé.
 */
const CARTE_C = { id: 'c-c', titre: 'Tâche en attente — suspendue', agent: null };

const base = (readonly = false) =>
  new Database(path.join(DATA, 'haikodev.db'), readonly ? { readonly: true } : undefined);

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification bouton en attente',
  );

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai bouton',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, 0, JSON.stringify(projet), maintenant, maintenant);

  /* L'agent a RENDU sa réponse : c'est ce qui allume « Terminer la tâche ». */
  let position = 0;
  for (const cible of [CARTE, CARTE_B]) {
    position += 1;
    const agent = {
      id: cible.agent,
      projectId: PROJET_ID,
      cardId: cible.id,
      role: 'task',
      title: cible.titre,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status: 'idle',
      startedAt: maintenant,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(agent.id, PROJET_ID, cible.id, 'task', agent.status, JSON.stringify(agent), maintenant, maintenant);

    const carte = {
      id: cible.id,
      projectId: PROJET_ID,
      title: cible.titre,
      description: 'Carte fabriquée par le script de vérification.',
      labels: [],
      column: 'running',
      position,
      origin: 'user',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      estimate: { machineSeconds: 60, seniorHours: 0.5, confidence: 'medium', failed: false },
      /* `tourEnVolDepuis` retient le balayage des cartes oubliées : sans lui,
         le démon rangerait ces deux cartes d'essai en quinze secondes. */
      scheduling: { asap: false, attempts: 1, restarts: 0, suspendu: false, tourEnVolDepuis: maintenant },
      agentId: cible.agent,
      codeDejaEnregistre: true,
      excludedFromDeploy: false,
      horsTache: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(carte.id, PROJET_ID, 'running', carte.position, carte.title, JSON.stringify(carte), maintenant, maintenant);
  }

  const enAttente = {
    id: CARTE_C.id,
    projectId: PROJET_ID,
    title: CARTE_C.titre,
    description: 'Carte fabriquée par le script de vérification.',
    labels: [],
    column: 'planned',
    position: 3,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    estimate: { machineSeconds: 60, seniorHours: 0.5, confidence: 'medium', failed: false },
    /* Suspendue : le bouton répond, mais rien ne part au moteur. */
    scheduling: { asap: false, attempts: 0, restarts: 0, suspendu: true, waitingReason: 'Arrêtée à la main.' },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    enAttente.id,
    PROJET_ID,
    'planned',
    enAttente.position,
    enAttente.title,
    JSON.stringify(enAttente),
    maintenant,
    maintenant,
  );
  db.close();
}

const lireCarte = (id) => {
  const db = base(true);
  const carte = lireCarteParId(db, id);
  db.close();
  return carte;
};

/* ------------------------------------------------------------------ */

/**
 * Un observateur posé AVANT le clic : il note chaque valeur prise par le
 * repère `data-attente`. Sans lui, un aller-retour de quelques dizaines de
 * millisecondes passerait entre deux relevés et l'on conclurait à tort que le
 * bouton n'a jamais montré son attente.
 */
async function suivreLesEtats(page, libelle) {
  await page.evaluate((cherche) => {
    const vus = [];
    window.__etatsBouton = vus;
    window.__roueVue = false;
    const relever = () => {
      for (const bouton of document.querySelectorAll('button')) {
        if (!(bouton.textContent ?? '').includes(cherche)) continue;
        const etat = bouton.getAttribute('data-attente') ?? 'repos';
        if (vus[vus.length - 1] !== etat) vus.push(etat);
        // La roue n'est un vrai signe que si elle tourne À LA PLACE du texte.
        if (etat === 'en-cours' && bouton.querySelector('.animate-spin')) window.__roueVue = true;
      }
    };
    relever();
    const observateur = new MutationObserver(relever);
    observateur.observe(document.body, { subtree: true, childList: true, attributes: true });
    window.__stopObs = () => observateur.disconnect();
  }, libelle);
}

const etatsVus = (page) => page.evaluate(() => window.__etatsBouton ?? []);
const roueVue = (page) => page.evaluate(() => !!window.__roueVue);

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

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
  await page.waitForTimeout(6000);

  await page.locator(`article:has-text(${JSON.stringify(CARTE.titre)})`).first().click();
  await page.waitForTimeout(2500);

  const bouton = page.getByRole('button', { name: 'Terminer la tâche' });
  noter('le tiroir montre « Terminer la tâche »', (await bouton.count()) === 1);
  noter('au repos, le bouton ne porte aucun repère d’attente', (await bouton.first().getAttribute('data-attente')) === null);

  /* -------- 1 à 4 : le geste passe -------- */

  await suivreLesEtats(page, 'Terminer la tâche');
  await bouton.first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(TMP, 'pendant-la-requete.png') });
  await page.waitForTimeout(2500);

  const etats = await etatsVus(page);
  noter('le clic ouvre tout de suite l’état « en cours »', etats.includes('en-cours'), etats.join(' → '));
  noter('une roue tourne à la place du texte', await roueVue(page));

  const carte = lireCarte(CARTE.id);
  noter('le geste a réellement eu lieu : la carte est terminée', carte?.column === 'done', `colonne ${carte?.column}`);
  /* Une tâche clôturée n'a plus de clôture à proposer : le bouton laisse la
     place au geste suivant. C'est un changement visible, pas une coche. */
  noter(
    'la tâche close, le bouton laisse la place au geste suivant',
    (await page.getByRole('button', { name: 'Terminer la tâche' }).count()) === 0 &&
      (await page.getByRole('button', { name: 'Mettre en file de publication' }).count()) === 1,
  );

  /* -------- La coche, sur un geste qui RESTE à l'écran -------- */

  /*
   * « Dès que possible » ne fait pas disparaître son bouton : c'est là qu'on
   * voit l'enchaînement entier — roue, puis coche, puis retour au repos.
   */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  await page.locator(`article:has-text(${JSON.stringify(CARTE_C.titre)})`).first().click();
  await page.waitForTimeout(2000);

  await suivreLesEtats(page, 'Dès que possible');
  await page.getByRole('button', { name: 'Dès que possible' }).first().click();
  await page.waitForTimeout(2500);
  const etatsCoche = await etatsVus(page);
  noter('la réussite allume une coche', etatsCoche.includes('reussi'), etatsCoche.join(' → '));
  await page.waitForTimeout(1500);
  const etatsApres = await etatsVus(page);
  noter(
    'puis le bouton revient de lui-même à son état d’avant',
    etatsApres[etatsApres.length - 1] === 'repos',
    etatsApres.join(' → '),
  );

  /* -------- 5 : un refus ne ment pas -------- */

  /*
   * Le refus, sur une SECONDE carte : on coupe le démon, puis on clique. La
   * requête ne peut plus aboutir. Le bouton doit montrer son attente, puis
   * revenir exactement à son état d'avant — SANS coche, un geste refusé
   * n'ayant rien réussi.
   */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  await page.locator(`article:has-text(${JSON.stringify(CARTE_B.titre)})`).first().click();
  await page.waitForTimeout(2000);

  const secondBouton = page.getByRole('button', { name: 'Terminer la tâche' });
  noter('la seconde carte porte elle aussi son bouton', (await secondBouton.count()) === 1);

  demon.kill('SIGKILL');
  await page.waitForTimeout(2000);
  await suivreLesEtats(page, 'Terminer la tâche');
  await secondBouton.first().click();
  await page.waitForTimeout(3000);

  const etatsRefus = await etatsVus(page);
  noter('un geste refusé montre quand même son attente', etatsRefus.includes('en-cours'), etatsRefus.join(' → '));
  noter('un geste refusé n’affiche AUCUNE coche', !etatsRefus.includes('reussi'), etatsRefus.join(' → '));
  noter(
    'et le bouton revient à son état initial',
    etatsRefus[etatsRefus.length - 1] === 'repos',
    etatsRefus.join(' → '),
  );
  await page.screenshot({ path: path.join(TMP, 'apres-refus.png') });

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
