#!/usr/bin/env node
/**
 * Glisser une carte dans « En cours » la LANCE ; la sortir vers « Planifié »
 * SUSPEND son agent. Contrôle dans un vrai navigateur, à la souris et au doigt.
 *
 *   node scripts/verif-glissement-lancement.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un dossier de projets vide : le démon de production n'est pas touché, et
 * aucun agent réel n'est lancé (le plafond d'agents est mis à zéro, ce qui est
 * justement le refus qu'on veut voir s'afficher).
 *
 * Ce qui est vérifié :
 *   1. déposer dans « En cours » quand le lancement est IMPOSSIBLE : la carte
 *      revient à sa colonne d'origine et le refus se lit en toutes lettres ;
 *   2. déposer une carte en travail vers « Planifié » : l'agent est arrêté, la
 *      carte reste en file et porte la raison ;
 *   3. le geste se comporte pareil à la souris (1) et au doigt (2).
 *
 * Le chemin du lancement RÉUSSI n'est pas rejoué ici : il dépenserait un vrai
 * quota. Il est verrouillé autrement — le dépôt appelle `startCard`, le même
 * point d'entrée que « Lancer maintenant », et les règles pures sont testées
 * par `server/src/test/suivi-colonne.test.ts`.
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
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7188);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-glissement-'));

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
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(PROJETS, { recursive: true });
fs.mkdirSync(DEPOT, { recursive: true });

// Un vrai petit dépôt git : la préparation de branche doit avoir de quoi mordre.
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
/* Le décor : un projet, une carte, une session                        */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const CARTE_ID = 'c-essai';
const AGENT_ID = 'a-essai';
const TITRE = 'Carte d’essai — glissement';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification glissement',
  );

  /* Plafond d'agents à ZÉRO : aucun agent réel ne peut démarrer, et c'est
     exactement le refus qu'on veut voir s'afficher sur le tableau. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify({ ...reglages, maxAgents: 0 }),
  );

  // Un seul projet à l'écran : celui d'essai.
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai glissement',
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

  ecrireCarte(db, 'planned', undefined);
  db.close();
}

function ecrireCarte(db, colonne, agentId) {
  const maintenant = Date.now();
  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    title: TITRE,
    description: 'Carte fabriquée par le script de vérification.',
    labels: [],
    column: colonne,
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    estimate: { machineSeconds: 60, seniorHours: 0.5, confidence: 'medium', failed: false },
    scheduling: { asap: false, attempts: 0, restarts: 0, suspendu: false },
    agentId,
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET column_key = excluded.column_key, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(carte.id, PROJET_ID, colonne, 1, carte.title, JSON.stringify(carte), maintenant, maintenant);
}

/** Un agent qui a l'air de travailler. Aucun processus derrière : on juge l'écran et la base. */
function poserAgentEnTravail() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();
  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    cardId: CARTE_ID,
    role: 'task',
    title: TITRE,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'running',
    startedAt: maintenant,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data`,
  ).run(agent.id, PROJET_ID, CARTE_ID, 'task', 'running', JSON.stringify(agent), maintenant, maintenant);
  ecrireCarte(db, 'running', AGENT_ID);
  db.close();
}

function lireCarte() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(CARTE_ID);
  db.close();
  return ligne ? JSON.parse(ligne.data) : null;
}

/* ------------------------------------------------------------------ */
/* Le geste                                                            */
/* ------------------------------------------------------------------ */

/**
 * Glisser la carte jusqu'à une colonne, à la souris ou au doigt. Le tableau
 * n'utilise PAS le glisser-déposer natif : il suit les événements de pointeur,
 * et le doigt doit d'abord appuyer sans bouger.
 */
async function glisser(page, versColonne, pointerType) {
  const carte = page.locator(`article:has-text(${JSON.stringify(TITRE)})`).first();
  const colonne = page.locator(`[data-column="${versColonne}"]`);
  await colonne.scrollIntoViewIfNeeded();
  const depart = await carte.boundingBox();
  const arrivee = await colonne.boundingBox();
  if (!depart || !arrivee) throw new Error('carte ou colonne introuvable à l’écran');

  const x0 = depart.x + depart.width / 2;
  const y0 = depart.y + 12;
  const x1 = arrivee.x + arrivee.width / 2;
  const y1 = arrivee.y + Math.min(140, arrivee.height / 2);

  await page.evaluate(
    async ([x0, y0, x1, y1, type]) => {
      const commun = { bubbles: true, cancelable: true, pointerId: 1, pointerType: type, button: 0, buttons: 1 };
      const cible = document.elementFromPoint(x0, y0);
      cible?.dispatchEvent(new PointerEvent('pointerdown', { ...commun, clientX: x0, clientY: y0 }));
      // Au doigt, la carte ne se décroche qu'après un appui maintenu (260 ms) ;
      // bouger avant l'échéance de l'appui long (520 ms) évite le menu.
      if (type !== 'mouse') await new Promise((r) => setTimeout(r, 340));
      for (let i = 1; i <= 12; i++) {
        const x = x0 + ((x1 - x0) * i) / 12;
        const y = y0 + ((y1 - y0) * i) / 12;
        window.dispatchEvent(new PointerEvent('pointermove', { ...commun, clientX: x, clientY: y }));
        await new Promise((r) => setTimeout(r, 25));
      }
      window.dispatchEvent(new PointerEvent('pointerup', { ...commun, buttons: 0, clientX: x1, clientY: y1 }));
    },
    [x0, y0, x1, y1, pointerType],
  );
  await page.waitForTimeout(2500);
}

/** Dans quelle colonne la carte se trouve-t-elle À L'ÉCRAN ? */
async function colonneAffichee(page) {
  return page.evaluate((titre) => {
    for (const col of document.querySelectorAll('[data-column]')) {
      if (col.textContent?.includes(titre)) return col.getAttribute('data-column');
    }
    return null;
  }, TITRE);
}

/* ------------------------------------------------------------------ */

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

  /* -------- 1. À LA SOURIS : un lancement impossible se dit et se défait -------- */

  const bureau = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await bureau.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await bureau.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  noter('la carte d’essai est visible sur le tableau', (await colonneAffichee(page)) === 'planned');

  await glisser(page, 'running', 'mouse');

  const apresRefus = await colonneAffichee(page);
  noter('à la souris, la carte revient à « Planifié » : rien n’a été lancé', apresRefus === 'planned', String(apresRefus));
  noter('en base, la carte n’a pas changé de colonne', lireCarte()?.column === 'planned', lireCarte()?.column);

  const texte = await page.locator('body').innerText();
  noter(
    'le refus se dit en toutes lettres',
    /Plafond atteint|Quota épuisé|suspendus/i.test(texte),
    (texte.match(/(Plafond atteint[^\n]*|Quota épuisé[^\n]*|[^\n]*suspendus[^\n]*)/) ?? [''])[0].slice(0, 90),
  );
  await page.screenshot({ path: path.join(TMP, 'refus.png') });

  /* -------- 2. AU DOIGT : sortir vers « Planifié » suspend l'agent -------- */

  poserAgentEnTravail();

  /* Écran tactile, mais assez large pour voir DEUX colonnes : le geste du doigt
     se juge sur le pointeur (appui maintenu, puis déplacement), pas sur la
     largeur — et on ne peut pas glisser vers une colonne hors de l'écran. */
  const telephone = await navigateur.newContext({
    viewport: { width: 700, height: 900 },
    isMobile: true,
    hasTouch: true,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await telephone.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const mobile = await telephone.newPage();
  mobile.on('pageerror', (e) => erreurs.push(String(e)));
  await mobile.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await mobile.waitForTimeout(6000);
  const ongletTableau = mobile.getByRole('button', { name: /^Tableau$/ });
  if (await ongletTableau.count()) {
    await ongletTableau.first().click();
    await mobile.waitForTimeout(2000);
  }

  noter('au doigt, la carte est bien en « En cours » au départ', (await colonneAffichee(mobile)) === 'running');

  await glisser(mobile, 'planned', 'touch');

  const apresSuspension = await colonneAffichee(mobile);
  noter('au doigt, la carte redescend en « Planifié »', apresSuspension === 'planned', String(apresSuspension));

  const carte = lireCarte();
  noter('en base, la carte est en file et marquée suspendue', carte?.column === 'planned' && carte?.scheduling?.suspendu === true, `colonne ${carte?.column}, suspendu ${carte?.scheduling?.suspendu}`);
  noter('la raison est écrite sur la carte', /suspendu/i.test(carte?.scheduling?.waitingReason ?? ''), carte?.scheduling?.waitingReason ?? '(aucune)');

  const texteMobile = await mobile.locator('body').innerText();
  noter('la raison se lit à l’écran', /suspendu/i.test(texteMobile));
  await mobile.screenshot({ path: path.join(TMP, 'suspension.png') });

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
