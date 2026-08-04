#!/usr/bin/env node
/**
 * LE BOUTON D'ARRÊT D'UNE CARTE N'ARRÊTE QUE SA TÂCHE.
 *
 *   node scripts/verif-arret-carte.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve :
 * le démon de production n'est pas touché et aucun agent réel n'est lancé. Les
 * agents sont posés directement en base, « au travail » : on juge l'écran, la
 * base et la réponse du démon, jamais un vrai moteur.
 *
 * Ce qui est vérifié :
 *   1. deux cartes travaillent en même temps ; arrêter la première laisse la
 *      seconde intacte ;
 *   2. la première ne repart pas seule : sa file est vide et elle porte la
 *      marque « suspendu » que l'ordonnanceur respecte ;
 *   3. une carte dont le tiroir retombe sur l'agent d'une AUTRE tâche n'affiche
 *      pas de bouton d'arrêt — ni en haut, ni dans la barre d'écriture ;
 *   4. le démon REFUSE en toutes lettres un « agent.stop » qui vise un agent
 *      étranger à la carte annoncée.
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import ws from '/root/haikodev/node_modules/ws/index.js';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur : lancé depuis
// une copie de travail, il jugerait sinon le code du dossier principal.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7191);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-arret-'));

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
/* Le décor : deux cartes au travail, une troisième mal reliée         */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';

const CARTES = {
  A: { id: 'c-a', titre: 'Première tâche — celle qu’on arrête', agent: 'ag-a' },
  B: { id: 'c-b', titre: 'Seconde tâche — celle qui continue', agent: 'ag-b' },
  // Sa cascade de replis retombe sur l'agent de B : le bouton doit disparaître.
  C: { id: 'c-c', titre: 'Tâche mal reliée — agent d’une autre', agent: 'ag-b' },
};

function base(readonly = false) {
  return new Database(path.join(DATA, 'haikodev.db'), readonly ? { readonly: true } : undefined);
}

function ecrireCarte(db, carte, colonne, agentId) {
  const maintenant = Date.now();
  const donnees = {
    id: carte.id,
    projectId: PROJET_ID,
    title: carte.titre,
    description: 'Carte fabriquée par le script de vérification.',
    labels: [],
    column: colonne,
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    estimate: { machineSeconds: 60, seniorHours: 0.5, confidence: 'medium', failed: false },
    scheduling: { asap: false, attempts: 1, restarts: 0, suspendu: false },
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
  ).run(donnees.id, PROJET_ID, colonne, donnees.position, donnees.title, JSON.stringify(donnees), maintenant, maintenant);
}

/** Un agent qui a l'air de travailler. Aucun processus derrière. */
function ecrireAgent(db, id, cardId, titre) {
  const maintenant = Date.now();
  const agent = {
    id,
    projectId: PROJET_ID,
    cardId,
    role: 'task',
    title: titre,
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
  ).run(id, PROJET_ID, cardId, 'task', 'running', JSON.stringify(agent), maintenant, maintenant);
}

/** Une demande qui attend derrière l'agent : l'arrêt doit la balayer. */
function ecrireFile(db, agentId) {
  const maintenant = Date.now();
  const item = {
    id: `q-${agentId}`,
    agentId,
    text: 'Message resté en file',
    attachments: [],
    position: 1,
    createdAt: maintenant,
  };
  db.prepare('INSERT OR REPLACE INTO queue (id, agent_id, position, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    item.id,
    agentId,
    1,
    JSON.stringify(item),
    maintenant,
  );
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification arrêt de carte',
  );

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai arrêt',
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

  ecrireAgent(db, CARTES.A.agent, CARTES.A.id, CARTES.A.titre);
  ecrireAgent(db, CARTES.B.agent, CARTES.B.id, CARTES.B.titre);
  ecrireCarte(db, CARTES.A, 'running', CARTES.A.agent);
  ecrireCarte(db, CARTES.B, 'running', CARTES.B.agent);
  ecrireCarte(db, CARTES.C, 'running', CARTES.C.agent);
  ecrireFile(db, CARTES.A.agent);
  ecrireFile(db, CARTES.B.agent);
  db.close();
}

const lireCarte = (id) => {
  const db = base(true);
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(id);
  db.close();
  return ligne ? JSON.parse(ligne.data) : null;
};

const lireAgent = (id) => {
  const db = base(true);
  const ligne = db.prepare('SELECT data FROM agents WHERE id = ?').get(id);
  db.close();
  return ligne ? JSON.parse(ligne.data) : null;
};

const compterFile = (agentId) => {
  const db = base(true);
  const n = db.prepare('SELECT COUNT(*) AS n FROM queue WHERE agent_id = ?').get(agentId).n;
  db.close();
  return n;
};

/* ------------------------------------------------------------------ */
/* Une commande brute, sans passer par l'écran                         */
/* ------------------------------------------------------------------ */

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: `haikodev_session=${jeton}` } });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 20000);
    prise.on('open', () => prise.send(JSON.stringify({ id, cmd })));
    prise.on('message', (brut) => {
      const evenement = JSON.parse(String(brut));
      if (evenement.type !== 'ack' || evenement.id !== id) return;
      clearTimeout(minuteur);
      prise.close();
      resolve(evenement);
    });
    prise.on('error', (e) => (clearTimeout(minuteur), reject(e)));
  });
}

/* ------------------------------------------------------------------ */

async function ouvrirCarte(page, titre) {
  await page.locator(`article:has-text(${JSON.stringify(titre)})`).first().click();
  await page.waitForTimeout(2500);
}

async function fermerTiroir(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
}

const boutonArret = (page) => page.getByRole('button', { name: "Arrêter l'action en cours" });
/** Le carré d'arrêt de la BARRE D'ÉCRITURE, en bas — celui qu'on atteint sans remonter. */
const arretDeLaBarre = (page) => page.getByRole('button', { name: "Arrêter l'agent", exact: true });
const boutonEnvoyer = (page) => page.getByRole('button', { name: 'Envoyer', exact: true });

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  const tableau = await page.locator('body').innerText();
  noter(
    'les deux tâches travaillent en même temps',
    tableau.includes(CARTES.A.titre) && tableau.includes(CARTES.B.titre),
  );

  /* -------- 1. Arrêter la première -------- */

  await ouvrirCarte(page, CARTES.A.titre);
  noter('le tiroir de la première montre son bouton d’arrêt', (await boutonArret(page).count()) === 1);
  noter('la barre d’écriture porte elle aussi un carré d’arrêt', (await arretDeLaBarre(page).count()) === 1);
  noter(
    'rien n’étant écrit, la flèche d’envoi a laissé la place',
    (await boutonEnvoyer(page).count()) === 0,
    `envoi visible ${await boutonEnvoyer(page).count()}`,
  );

  // On écrit : l'envoi revient, l'arrêt reste à côté au lieu de voler sa place.
  await page.getByPlaceholder(/attendra son tour/).first().fill('un message qui attendra son tour');
  await page.waitForTimeout(600);
  noter('avec du texte écrit, l’envoi revient', (await boutonEnvoyer(page).count()) === 1);
  noter('et le carré d’arrêt reste à côté', (await arretDeLaBarre(page).count()) === 1);
  await page.getByPlaceholder(/attendra son tour/).first().fill('');
  await page.waitForTimeout(600);

  // L'arrêt part de la BARRE D'ÉCRITURE : c'est le chemin neuf qu'on juge.
  await arretDeLaBarre(page).first().click();
  await page.waitForTimeout(3000);

  const carteA = lireCarte(CARTES.A.id);
  noter('la première est marquée arrêtée à la main', carteA?.scheduling?.suspendu === true, `suspendu ${carteA?.scheduling?.suspendu}`);
  noter(
    'la raison est écrite sur la carte',
    /arrêté à la main/i.test(carteA?.scheduling?.waitingReason ?? ''),
    carteA?.scheduling?.waitingReason ?? '(aucune)',
  );
  noter('sa file est vidée : plus rien n’attend derrière', compterFile(CARTES.A.agent) === 0);

  /* -------- 2. La seconde continue -------- */

  noter('la seconde tâche travaille toujours', lireAgent(CARTES.B.agent)?.status === 'running');
  const carteB = lireCarte(CARTES.B.id);
  noter('la seconde n’est pas suspendue', !carteB?.scheduling?.suspendu, `suspendu ${carteB?.scheduling?.suspendu}`);
  noter('la file de la seconde est intacte', compterFile(CARTES.B.agent) === 1);

  await page.screenshot({ path: path.join(TMP, 'apres-arret.png') });
  await fermerTiroir(page);

  /* -------- 3. Pas de bouton quand l'agent n'est pas celui de la carte -------- */

  await ouvrirCarte(page, CARTES.C.titre);
  const texteC = await page.locator('body').innerText();
  noter('la carte mal reliée n’affiche AUCUN bouton d’arrêt', (await boutonArret(page).count()) === 0);
  noter('sa barre d’écriture non plus', (await arretDeLaBarre(page).count()) === 0);
  noter('elle montre pourtant bien qu’un travail tourne', /Réflexion en cours|en cours/i.test(texteC));
  await page.screenshot({ path: path.join(TMP, 'sans-bouton.png') });
  await fermerTiroir(page);

  /* -------- 4. Le démon refuse, et le dit -------- */

  const refus = await commande({ type: 'agent.stop', agentId: CARTES.B.agent, cardId: CARTES.C.id });
  noter('un arrêt visant l’agent d’une autre carte est REFUSÉ', refus.ok === false, String(refus.error ?? ''));
  noter(
    'le refus dit pourquoi, en toutes lettres',
    /ne travaille pas pour cette carte/i.test(refus.error ?? ''),
    refus.error ?? '(rien)',
  );
  noter('la seconde tâche a survécu au refus', lireAgent(CARTES.B.agent)?.status === 'running');
  noter('sa file aussi', compterFile(CARTES.B.agent) === 1);

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
