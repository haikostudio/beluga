#!/usr/bin/env node
/**
 * CURSOR EST-IL VRAIMENT UN MOTEUR COMME LES AUTRES ?
 *
 * Cursor n'est plus une API d'agents cloud : c'est l'outil en ligne de commande
 * `cursor-agent`, lancé DANS le dossier de la carte, qui lit et modifie les
 * fichiers sur la machine comme Claude et Codex. Le contrôle joue donc d'abord
 * ce qui fait toute la différence — un fichier LOCAL réellement modifié —, puis
 * le reste sur un démon à soi et dans un vrai navigateur :
 *
 *   0. un VRAI TOUR lancé par l'adaptateur, dans un dépôt d'essai, ÉCRIT un
 *      fichier sur le disque, sans créer ni pousser aucune branche « cursor/… »
 *      et sans qu'aucune fusion distante n'ait à ramener quoi que ce soit ;
 *   1. la clé est acceptée et le CATALOGUE réel remonte — plusieurs modèles,
 *      lus dans `cursor-agent --list-models` et non dans une liste de secours ;
 *   2. Cursor apparaît dans le SÉLECTEUR de la barre d'écriture, à côté de
 *      Claude et de GPT, et se choisit à la souris ;
 *   3. un VRAI TOUR part depuis l'interface et rend une réponse complète, avec
 *      sa mesure ;
 *   4. les RÉGLAGES disent ce qu'il faut pour travailler : le nom de la clé et
 *      l'outil `cursor-agent` sur le serveur — jamais une jauge de quota
 *      inventée, Cursor n'en publiant aucune ;
 *   5. une clé REFUSÉE se dit en clair, le tour se referme, et le témoin
 *      « au travail » s'éteint — jamais un rond qui tourne sans fin ;
 *   6. les moteurs déjà là ne changent pas de comportement.
 *
 *   CURSOR_API_KEY=… node scripts/verif-moteur-cursor.mjs
 *
 * Démon à soi, base jetable, dossier temporaire : aucune donnée réelle n'est
 * touchée. Le script juge le dépôt d'où il PART, jamais le dossier principal,
 * et ne reprend NI `HAIKODEV_URL` (qui désigne l'application publiée) NI
 * `HAIKODEV_TOKEN`. Les tours 0, 3 et 5 appellent réellement Cursor : ils
 * coûtent quelques centimes, rien d'autre.
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
// l'agent doit y travailler comme sous Claude ou Codex — le travail se fait
// sur la machine, aucun dépôt GitHub n'entre en jeu.
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

/* ------------------------------------------------------------------ */
/* 0. Le tour LOCAL : un fichier réellement écrit sur le disque        */
/* ------------------------------------------------------------------ */

/**
 * LE CONTRÔLE QUI DIT TOUT : l'adaptateur lancé pour de vrai dans un dépôt
 * d'essai doit y ÉCRIRE un fichier. C'est ce que l'ancien pilotage cloud ne
 * savait pas faire — l'agent tournait chez Cursor, sur un dépôt GitHub, et son
 * travail devait être rapatrié par une branche « cursor/… ». On vérifie donc le
 * disque, puis l'absence de toute branche distante à ramener.
 */
async function tourLocal() {
  process.env.HAIKODEV_DATA = DATA;
  const { cursorAdapter } = await import(path.join(RACINE, 'server', 'dist', 'engines', 'cursor.js'));

  const ATELIER = path.join(TMP, 'atelier');
  fs.mkdirSync(ATELIER, { recursive: true });
  const g = (...args) => execFileSync('git', args, { cwd: ATELIER, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'essai@haikodev.local');
  g('config', 'user.name', 'Essai');
  fs.writeFileSync(path.join(ATELIER, 'note.txt'), 'avant\n');
  g('add', 'note.txt');
  g('commit', '-q', '-m', 'Base');

  const vus = [];
  const handle = cursorAdapter.run({
    cwd: ATELIER,
    prompt:
      'Remplace tout le contenu du fichier note.txt de ce dossier par le seul mot GENÊT, ' +
      'en majuscules et suivi d’un retour à la ligne. Ne crée aucun autre fichier, ' +
      'ne lance aucune commande git, puis réponds seulement « fait ».',
    model: 'composer-2.5',
    fullAccess: true,
    plafondMs: 300_000,
    env: { CURSOR_API_KEY: CLE },
    onEvent: (e) => vus.push(e),
  });
  const fin = await handle.finished;

  noter('le tour local va au bout', fin.ok, fin.error ?? '');
  const ecrit = fs.readFileSync(path.join(ATELIER, 'note.txt'), 'utf8');
  noter(
    'un vrai tour Cursor MODIFIE un fichier du dossier de travail',
    ecrit.includes('GENÊT'),
    ecrit.trim().slice(0, 60),
  );

  // Rien à rapatrier : le travail est déjà là, sur la branche du dossier.
  const branches = g('branch', '-a');
  noter(
    'aucune branche « cursor/… » à ramener : le travail est déjà sur place',
    !/cursor\//.test(branches) && /\bmain\b/.test(branches),
    branches.trim().replace(/\n/g, ' | '),
  );
  const modifie = g('status', '--porcelain');
  noter(
    'la modification est visible dans la copie de travail, sans aucune fusion',
    /note\.txt/.test(modifie),
    modifie.trim() || 'aucun changement',
  );

  // Le contrat commun aux moteurs : un fil, des étapes, une mesure.
  const fil = vus.find((e) => e.kind === 'session')?.sessionId ?? '';
  noter('le tour rend un identifiant de fil, pour la reprise', !!fil, fil.slice(0, 60));
  const etapes = vus.filter((e) => e.kind === 'step');
  noter(
    'les gestes de l’agent remontent en étapes lisibles',
    etapes.some((e) => /Modification|Écriture|Lecture|Commande/i.test(e.step?.label ?? '')),
    etapes.map((e) => e.step?.label).slice(0, 4).join(' · '),
  );
  const mesure = vus.find((e) => e.kind === 'usage')?.usage;
  noter(
    'le tour local porte sa mesure',
    !!mesure && (mesure.inputTokens ?? 0) + (mesure.outputTokens ?? 0) > 0,
    mesure ? `${mesure.inputTokens} entrée, ${mesure.outputTokens} sortie` : 'aucune mesure',
  );
}

async function main() {
  await tourLocal();

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
  // Le menu ne garde que la version la plus récente de chaque FAMILLE
  // (`limiterAuxPlusRecents`, règle commune à tous les moteurs) : aucune
  // famille ne disparaît, et aucune vieille version ne traîne.
  noter(
    'le catalogue vient de Cursor, pas d\'une liste de secours',
    !!cursor?.live && (cursor?.models?.length ?? 0) > 1,
    `${cursor?.models?.length ?? 0} modèles${cursor?.catalogError ? ` — ${cursor.catalogError}` : ''}`,
  );
  /*
   * LE DÉFAUT RÉPARÉ : couper la liste ENTIÈRE aux trois plus récents ne
   * retirait pas des vieilleries, il retirait des modèles ENTIERS — le menu ne
   * proposait plus que les trois variantes de GPT-5.6, sans Composer ni Grok
   * (constaté le 14/08/2026). Cursor revendant une dizaine de familles à la
   * fois, on vérifie que les siennes sont bien là.
   */
  const noms = (cursor?.models ?? []).map((m) => `${m.id} ${m.label}`.toLowerCase());
  for (const [famille, motif] of [
    ['Composer', /composer/],
    ['Grok', /grok/],
    ['Opus', /opus/],
    ['Sonnet', /sonnet/],
  ]) {
    noter(`${famille} figure dans le menu des modèles`, noms.some((n) => motif.test(n)));
  }
  // …et aucune version périmée d'une famille déjà présente ne reste proposée.
  const familles = new Set((cursor?.models ?? []).map((m) => m.id.split('-').filter((s) => !/^v?\d+(\.\d+)*$/.test(s)).join('-')));
  noter(
    'aucune famille n’apparaît deux fois, en deux versions',
    familles.size === (cursor?.models?.length ?? 0),
    `${familles.size} familles pour ${cursor?.models?.length ?? 0} modèles`,
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
    .prepare("SELECT id FROM agents WHERE project_id = ? AND role = 'cadrage' ORDER BY updated_at DESC LIMIT 1")
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
  // C'est désormais l'identifiant de session du CLI, celui que `--resume` reprend.
  const fil = baseLecture().prepare('SELECT session_id FROM agents WHERE id = ?').get(AGENT)?.session_id ?? '';
  noter(
    'le fil du CLI est retenu pour le tour suivant',
    fil.trim().length > 0,
    fil.slice(0, 120),
  );

  /* -------- 4. Ce qu'il faut pour travailler, dans les réglages -------- */

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

  /*
   * CE QUI REMPLACE LA JAUGE DOIT SE LIRE SUR LA CARTE DU COMPTE, pas seulement
   * dans un onglet à part. Le montant (ou la raison de son absence) voyage
   * avec le relevé de quota.
   */
  const ligneComptes = await page.locator('section', { hasText: 'Comptes et quotas' }).first().innerText();
  noter(
    'la ligne Cursor des comptes dit le montant dépensé, ou pourquoi il manque',
    /USD/.test(ligneComptes) || /administration d'équipe|administration d’équipe|n’a pas pu être lu|n'a pas pu être lu/i.test(ligneComptes),
    ligneComptes.split('\n').filter((l) => /USD|équipe|équipe|dépens/i.test(l)).slice(0, 2).join(' · ').slice(0, 160),
  );

  /*
   * …ET AUSSI DANS L'ONGLET CONSOMMATION. Cursor facture à la dépense :
   * l'onglet « Consommation » porte son CRÉDIT DÉPENSÉ. Le montant vient
   * de Cursor (`POST /teams/spend`) et, quand la clé n'a pas le droit de le
   * lire — une clé personnelle reçoit « Invalid Team API Key » —, la raison
   * s'écrit en clair : jamais un zéro, qui serait un chiffre inventé.
   */
  await page.getByRole('tab', { name: 'Consommation' }).click({ timeout: 20_000 });
  const blocCredit = page.locator('[data-essai="credit-cursor"]').first();
  const creditAffiche = await blocCredit
    .waitFor({ timeout: 40_000 })
    .then(() => true)
    .catch(() => false);
  noter('le crédit dépensé chez Cursor a sa place dans « Consommation »', creditAffiche);
  const texteCredit = creditAffiche ? await blocCredit.innerText() : '';
  noter(
    'un montant se lit, ou la raison de son absence — jamais un zéro muet',
    /USD/.test(texteCredit) || /clé d’administration|clé d'administration|n’a pas pu être lu/i.test(texteCredit),
    texteCredit.split('\n').slice(-2).join(' · ').slice(0, 140),
  );
  await page.getByRole('tab', { name: 'Comptes' }).click({ timeout: 20_000 });

  /* Une clé de PLUS se déclare depuis cet écran : c'est la seule porte pour qui
     n'ouvre pas de terminal. Une clé refusée doit le dire et ne rien laisser. */
  await page.getByRole('button', { name: /Ajouter une clé Cursor/i }).click({ timeout: 20_000 });
  await page.getByPlaceholder(/Nom du compte/i).fill('Cursor — relève d’essai');
  await page.getByPlaceholder(/Clé d'accès Cursor|Clé d’accès Cursor/i).fill('crsr_cette_cle_nexiste_pas');
  await page.getByRole('button', { name: /^Ajouter$/ }).click();
  const refusDit = await page
    .locator('text=/refusé la clé/i')
    .first()
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  const comptesApresRefus = await page.locator('section', { hasText: 'Comptes et quotas' }).first().innerText();
  noter(
    "une clé refusée est dite et ne laisse aucun compte mort",
    refusDit && !comptesApresRefus.includes('relève d’essai'),
  );

  await page.getByPlaceholder(/Clé d'accès Cursor|Clé d’accès Cursor/i).fill(CLE);
  await page.getByRole('button', { name: /^Ajouter$/ }).click();
  const compteAjoute = await page
    .locator('text=Cursor — relève d’essai')
    .first()
    .waitFor({ timeout: 40_000 })
    .then(() => true)
    .catch(() => false);
  noter("une clé éprouvée ajoute son compte sans toucher au serveur", compteAjoute);

  // L'outil sur la machine est la SECONDE pièce d'un tour : sans lui, une clé
  // acceptée ne suffit pas, et l'écran doit le dire au lieu de laisser croire
  // que tout va bien.
  const outilDit = await page
    .locator('text=/outil « cursor-agent » (installé|absent)/')
    .first()
    .innerText()
    .catch(() => '');
  noter("les réglages disent si l'outil « cursor-agent » est sur le serveur", !!outilDit, outilDit);
  noter(
    "plus aucune promesse de dépôt GitHub sur un compte Cursor",
    !/dépôts? ouverts?|aucun dépôt relié|dépôts illisibles/.test(
      await page.locator('section', { hasText: 'Comptes et quotas' }).first().innerText(),
    ),
  );
  await page.keyboard.press('Escape');

  /* -------- 5. La relève prend le relais, puis le refus se dit -------- */

  // Le compte PRINCIPAL perd sa clé (celle de l'environnement). Le compte
  // ajouté à l'instant, lui, garde la sienne : c'est tout l'intérêt d'un second
  // compte, et le tour doit passer par lui sans que personne n'intervienne.
  await arreterLeDemon();
  demon = lancerLeDemon('crsr_cette_cle_nexiste_pas');
  if (!(await attendrePort())) {
    noter('le démon redémarre avec une clé principale refusée', false);
    return;
  }
  // RECHARGEMENT COMPLET, pas un simple changement d'adresse : le démon vient
  // de redémarrer, donc le canal de la page est mort. Écrire avant qu'il ne
  // soit rétabli, c'est envoyer dans le vide — sans rien à l'écran.
  await page.goto(`${BASE}/#projet/${PROJET_ID}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea[placeholder="Écrivez votre demande…"]', { timeout: 40_000 });
  await page.waitForTimeout(1500);
  const composeurReleve = page.locator('textarea[placeholder="Écrivez votre demande…"]:visible').first();
  await composeurReleve.click();
  await composeurReleve.fill('Réponds seulement par le mot GENTIANE, en majuscules, sans rien d\'autre.');
  await page.keyboard.press('Enter');
  const parLaReleve = await page
    .locator('text=GENTIANE')
    .nth(1)
    .waitFor({ timeout: 300_000 })
    .then(() => true)
    .catch(() => false);
  noter('le second compte prend le relais quand la clé du premier est refusée', parLaReleve);

  /* -------- 6. Plus aucune clé valable : le refus se dit -------- */

  await arreterLeDemon();
  // On retire le compte de relève : il ne doit plus rester UNE seule clé
  // valable, sinon c'est la bascule qu'on éprouverait, pas le refus.
  const baseEcriture = new Database(path.join(DATA, 'haikodev.db'));
  baseEcriture.prepare("DELETE FROM accounts WHERE engine = 'cursor' AND id != 'cursor-principal'").run();
  baseEcriture.close();
  fs.rmSync(path.join(DATA, 'accounts'), { recursive: true, force: true });
  demon = lancerLeDemon('crsr_cette_cle_nexiste_pas');

  if (!(await attendrePort())) {
    noter('le démon redémarre sans aucune clé valable', false);
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
