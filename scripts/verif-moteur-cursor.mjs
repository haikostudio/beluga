#!/usr/bin/env node
/**
 * CURSOR EST-IL VRAIMENT UN MOTEUR COMME LES AUTRES ?
 *
 * Le contrôle demandé par la carte, joué en entier sur un démon à soi et dans
 * un vrai navigateur :
 *
 *   1. la clé est acceptée et le CATALOGUE réel remonte — plusieurs modèles,
 *      annoncés « en direct » et non par une liste de secours ;
 *   2. Cursor apparaît dans le SÉLECTEUR de la barre d'écriture, à côté de
 *      Claude et de GPT, et se choisit à la souris ;
 *   3. un VRAI TOUR part depuis l'interface et rend une réponse complète, avec
 *      sa mesure ;
 *   4. les RÉGLAGES disent ce que la clé permet : son nom, et les dépôts
 *      GitHub qu'elle peut ouvrir — jamais une jauge de quota inventée, Cursor
 *      n'en publiant aucune ;
 *   5. une clé REFUSÉE se dit en clair, le tour se referme, et le témoin
 *      « au travail » s'éteint — jamais un rond qui tourne sans fin ;
 *   6. les moteurs déjà là ne changent pas de comportement.
 *
 *   CURSOR_API_KEY=… node scripts/verif-moteur-cursor.mjs
 *
 * Démon à soi, base jetable, dossier temporaire : aucune donnée réelle n'est
 * touchée. Le script juge le dépôt d'où il PART, jamais le dossier principal,
 * et ne reprend NI `HAIKODEV_URL` (qui désigne l'application publiée) NI
 * `HAIKODEV_TOKEN`. Les tours 3 et 4 appellent réellement Cursor : ils coûtent
 * quelques centimes, rien d'autre.
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
const PORT = Number(process.env.HAIKO_CURSOR_PORT || 7197);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-cursor-'));
const CLE = (process.env.CURSOR_API_KEY ?? '').trim();

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

console.log(`  …  dépôt jugé : ${RACINE}`);
if (!CLE) {
  console.error("Aucune clé : poser CURSOR_API_KEY avant de lancer ce contrôle.");
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const DEPOT = path.join(TMP, 'projet');
for (const dossier of [DATA, DEPOT]) fs.mkdirSync(dossier, { recursive: true });
// Un vrai dépôt git, sans dépôt distant : c'est le cas le plus courant, et
// celui où l'agent Cursor doit partir SANS dépôt au lieu d'échouer.
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'CLAUDE.md'), '# Projet d’essai\n');

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-cursor';
const AGENT_ID = 'a-cursor';

let demon;
let navigateur;
const journal = [];

function lancerLeDemon(cle) {
  const enfant = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
    env: {
      ...process.env,
      HAIKODEV_PORT: String(PORT),
      HAIKODEV_HOST: '127.0.0.1',
      HAIKODEV_DATA: DATA,
      HAIKODEV_PROJECTS_ROOT: path.join(TMP, 'projets'),
      HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
      CURSOR_API_KEY: cle,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  enfant.stdout.on('data', (d) => journal.push(String(d)));
  enfant.stderr.on('data', (d) => journal.push(String(d)));
  return enfant;
}

async function arreterLeDemon() {
  if (!demon) return;
  demon.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  demon = null;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

process.on('exit', () => {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort(limiteMs = 60_000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le décor : un projet, une conversation, une session d'une heure     */
/* ------------------------------------------------------------------ */

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const t = Date.now();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3_600_000,
    'vérification moteur Cursor',
  );

  const projet = {
    id: PROJET_ID,
    name: 'Essai Cursor',
    path: DEPOT,
    defaultEngine: 'cursor',
    isSelf: false,
    branchesDePublication: {},
    deploiement: {},
    miseEnProduction: {},
    rank: 1,
    archived: false,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);

  db.close();
}

function baseLecture() {
  return new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
}

/**
 * Les moteurs tels que le SERVEUR les annonce à l'interface : c'est l'événement
 * « ready » du canal, celui-là même que reçoit l'application au chargement.
 */
async function moteursDuServeur() {
  const { WebSocket } = await import('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { cookie: `haikodev_session=${jeton}` },
    });
    const minuteur = setTimeout(() => (ws.close(), reject(new Error('aucun « ready » reçu'))), 90_000);
    ws.on('message', (raw) => {
      const evenement = JSON.parse(raw.toString());
      if (evenement.type !== 'ready') return;
      clearTimeout(minuteur);
      ws.close();
      resolve(evenement.engines ?? []);
    });
    ws.on('error', (err) => (clearTimeout(minuteur), reject(err)));
  });
}

/* ------------------------------------------------------------------ */
/* Le déroulé                                                          */
/* ------------------------------------------------------------------ */

async function main() {
  demon = lancerLeDemon(CLE);
  if (!(await attendrePort())) {
    noter('le démon démarre', false, journal.join('').slice(-800));
    return;
  }
  poserLeDecor();
  await arreterLeDemon();
  // Redémarrage : le décor est en base AVANT que le démon ne le charge.
  demon = lancerLeDemon(CLE);
  if (!(await attendrePort())) {
    noter('le démon redémarre avec le décor', false, journal.join('').slice(-800));
    return;
  }

  /* -------- 1. Le catalogue réel -------- */

  const liste = await moteursDuServeur();
  const cursor = liste.find((m) => m.id === 'cursor');
  noter('Cursor est annoncé par le serveur', !!cursor);
  noter(
    'la clé est acceptée et le moteur est disponible',
    !!cursor?.installed,
    cursor?.version ? `clé « ${cursor.version} »` : '',
  );
  // Le menu s'arrête aux modèles les plus récents (`limiterAuxPlusRecents`,
  // règle commune à tous les moteurs) : on juge la PROVENANCE, pas le nombre.
  noter(
    'le catalogue vient de Cursor, pas d\'une liste de secours',
    !!cursor?.live && (cursor?.models?.length ?? 0) > 1,
    `${cursor?.models?.length ?? 0} modèles${cursor?.catalogError ? ` — ${cursor.catalogError}` : ''}`,
  );
  const avecReflexion = (cursor?.models ?? []).find((m) => (m.thinking ?? []).length > 1);
  noter(
    'les modèles portent leurs niveaux de réflexion',
    !!avecReflexion,
    avecReflexion ? `${avecReflexion.label} : ${avecReflexion.thinking.map((t) => t.id).join(', ')}` : '',
  );

  /* Les moteurs déjà là ne changent pas : ils sont toujours annoncés. */
  noter(
    'Claude et Codex sont toujours annoncés',
    !!liste.find((m) => m.id === 'claude') && !!liste.find((m) => m.id === 'codex'),
    liste.map((m) => `${m.id}${m.installed ? '' : ' (absent)'}`).join(', '),
  );

  /* -------- 2. Le sélecteur, à la souris -------- */

  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  // Le chef d'orchestre du projet se crée à l'ouverture du panneau de droite :
  // on attend sa barre d'écriture avant de toucher à quoi que ce soit.
  await page.goto(`${BASE}/#projet/${PROJET_ID}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea[placeholder="Écrivez votre demande…"]', { timeout: 40_000 });

  await page.locator('[data-selecteur="config"]').first().click();
  await page.locator('[data-selecteur="moteur"]').first().click();
  const choixCursor = page.getByRole('menuitem').filter({ hasText: /^Cursor/ }).first();
  const vuDansLeMenu = await choixCursor
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  noter('Cursor se choisit dans le sélecteur de la barre d\'écriture', vuDansLeMenu);
  if (vuDansLeMenu) await choixCursor.click();
  // Les deux tiroirs sont empilés : on referme jusqu'à ce que le VOILE soit
  // parti, sinon le clic suivant tomberait dessus au lieu de la barre.
  for (let essai = 0; essai < 4; essai += 1) {
    if (!(await page.locator('div.fixed.inset-0[data-state="open"]').count())) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(300);
  noter(
    'le moteur retenu est bien Cursor',
    (await page.locator('[data-selecteur="moteur"]').first().getAttribute('data-valeur').catch(() => null)) ===
      'Cursor' ||
      (await page.locator('[data-selecteur="config"]').first().innerText()).includes('Cursor'),
  );

  /* -------- 3. Un vrai tour, de bout en bout -------- */

  const composeur = page.locator('textarea[placeholder="Écrivez votre demande…"]:visible').first();
  await composeur.click();
  await composeur.fill('Réponds seulement par le mot MARGUERITE, en majuscules, sans rien d\'autre.');
  await page.keyboard.press('Enter');

  // On n'attend PAS le mot à l'écran : la demande le contient déjà, et la bulle
  // de l'utilisateur suffirait à faire passer le contrôle. C'est la RÉPONSE de
  // l'assistant, en base, qui fait foi.
  await page
    .locator('text=MARGUERITE')
    .first()
    .waitFor({ timeout: 300_000 })
    .catch(() => {});

  /* Le chef d'orchestre que l'application vient d'ouvrir pour ce projet. */
  const AGENT = baseLecture()
    .prepare("SELECT id FROM agents WHERE project_id = ? AND role = 'orchestrator' ORDER BY updated_at DESC LIMIT 1")
    .get(PROJET_ID)?.id;
  noter("la conversation du projet a bien un chef d'orchestre", !!AGENT, AGENT ?? 'aucun');

  /* Le texte paraît AVANT la fin du tour : la mesure et la clôture arrivent
     ensuite. On attend donc que l'agent ait fini avant de juger l'un ou l'autre. */
  const finDuTour = Date.now() + 180_000;
  let statutFinal = '';
  while (Date.now() < finDuTour) {
    statutFinal = JSON.parse(baseLecture().prepare('SELECT data FROM agents WHERE id = ?').get(AGENT).data).status;
    if (statutFinal !== 'running') break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  noter('le tour se termine de lui-même', statutFinal !== 'running', `statut « ${statutFinal} »`);

  const dernier = baseLecture()
    .prepare("SELECT data FROM messages WHERE agent_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1")
    .get(AGENT);
  const message = dernier ? JSON.parse(dernier.data) : null;
  noter(
    'un vrai tour sur Cursor rend une réponse complète',
    !!message && !message.streaming && (message.content ?? '').includes('MARGUERITE'),
    message?.content?.trim().slice(0, 80) ?? 'aucune réponse',
  );
  noter(
    "l'écran montre bien la réponse de l'agent, et pas seulement la demande",
    (await page.locator('text=MARGUERITE').count()) >= 2,
  );

  /* La mesure du moteur vit dans la table des usages (`recordUsage`) : c'est
     elle que lisent le parcours de la carte et le tableau de bord. */
  const mesure = baseLecture()
    .prepare("SELECT * FROM usage WHERE agent_id = ? AND engine = 'cursor' ORDER BY created_at DESC LIMIT 1")
    .get(AGENT);
  noter(
    'le tour porte la mesure rendue par Cursor',
    !!mesure && (mesure.tokens ?? 0) > 0,
    mesure ? `${mesure.tokens} jetons (${mesure.tokens_in} entrée, ${mesure.tokens_out} sortie)` : 'aucune mesure',
  );

  // Le fil vit dans la colonne `session_id` de l'agent, rangé par clé de
  // session : sans lui, le tour suivant repartirait d'une conversation vide.
  const fil = baseLecture().prepare('SELECT session_id FROM agents WHERE id = ?').get(AGENT)?.session_id ?? '';
  noter(
    "le fil de l'agent cloud est retenu pour le tour suivant",
    fil.includes('bc-'),
    fil.slice(0, 120),
  );

  /* -------- 4. Ce que la clé permet, dans les réglages -------- */

  await page.evaluate(() => {
    window.location.hash = 'reglages';
  });
  await page.getByRole('tab', { name: 'Comptes' }).click({ timeout: 20_000 });
  const ligneCursor = page.locator('text=/clé « .* » acceptée/').first();
  const cleDite = await ligneCursor
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  noter("les réglages disent que la clé Cursor est acceptée", cleDite, cleDite ? await ligneCursor.innerText() : '');

  // Cursor ne publie AUCUN quota : sa ligne ne doit pas afficher de jauge, même
  // à zéro — ce serait une mesure inventée.
  const zoneComptes = await page.locator('section', { hasText: 'Comptes et quotas' }).first().innerText();
  const ligneQuotaCursor = zoneComptes
    .split('\n')
    .some((ligne) => /Cursor/i.test(ligne) && /fenêtre \d+ %/.test(ligne));
  noter('aucune jauge de quota inventée sur le compte Cursor', !ligneQuotaCursor);

  const depotsDits = await page
    .locator('text=/dépôts? ouverts?|aucun dépôt relié|dépôts illisibles/')
    .first()
    .innerText()
    .catch(() => '');
  noter('les dépôts que la clé peut ouvrir sont dits', !!depotsDits, depotsDits);
  await page.keyboard.press('Escape');

  /* -------- 5. Une clé refusée se dit en clair -------- */

  await arreterLeDemon();
  demon = lancerLeDemon('crsr_cette_cle_nexiste_pas');
  if (!(await attendrePort())) {
    noter('le démon redémarre avec une clé refusée', false);
    return;
  }
  await page.goto(`${BASE}/#projet/${PROJET_ID}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea[placeholder="Écrivez votre demande…"]', { timeout: 40_000 });

  const composeur2 = page.locator('textarea[placeholder="Écrivez votre demande…"]:visible').first();
  await composeur2.click();
  await composeur2.fill('Un second essai, avec une clé qui ne vaut rien.');
  await page.keyboard.press('Enter');

  const refusVisible = await page
    .locator('text=/refusé la clé|clé d.accès Cursor/i')
    .first()
    .waitFor({ timeout: 120_000 })
    .then(() => true)
    .catch(() => false);
  noter('une clé refusée se dit en clair à l\'écran', refusVisible);

  // Le témoin doit s'éteindre : l'agent ne reste pas « au travail ».
  const eteint = await page
    .waitForFunction(() => !document.body.innerText.includes('Réflexion en cours'), null, { timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  const agentFinal = JSON.parse(baseLecture().prepare('SELECT data FROM agents WHERE id = ?').get(AGENT).data);
  noter(
    'le tour se referme au lieu de laisser le témoin tourner',
    eteint && agentFinal.status !== 'running',
    `statut « ${agentFinal.status} »`,
  );
}

try {
  await main();
} catch (err) {
  noter('le contrôle va au bout', false, err?.message ?? String(err));
} finally {
  await navigateur?.close().catch(() => {});
  await arreterLeDemon();
}

// Le journal du démon reste lisible après coup : un contrôle qui tombe se
// diagnostique sur la sortie du serveur, pas sur une supposition.
fs.writeFileSync('/tmp/journal-verif-cursor.log', journal.join(''));

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
if (echecs.length) {
  console.log(journal.join('').slice(-2000));
  process.exit(1);
}
