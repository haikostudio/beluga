#!/usr/bin/env node
/**
 * LE TÉMOIN DE TRAVAIL RESTE ALLUMÉ PENDANT LES COMMANDES.
 *
 *   npm run build && node scripts/verif-temoin-pendant-commandes.mjs
 *
 * Un agent travaille aussi quand il lance des commandes, pas seulement quand le
 * modèle écrit du texte. Le témoin doit donc suivre le TOUR, pas l'écriture :
 * tant que le tour est vivant, le repère « Réflexion en cours » reste posé
 * au-dessus de la barre d'écriture et la flèche d'envoi reste un carré d'arrêt.
 *
 * Le contrôle fait le tour ENTIER, pour de vrai : son propre démon, sa base
 * neuve, un FAUX MOTEUR (un vrai processus, aucun jeton dépensé) qui écrit UNE
 * phrase puis enchaîne neuf commandes en silence — exactement la capture qui a
 * ouvert la carte. Pendant ce silence, un vrai navigateur constate que
 * l'interface dit bien que l'agent travaille, et qu'elle DIT ce qui tourne.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { colonnesDeLaCarte } from '../shared/dist/carte-sql.js';
import { WebSocket } from 'ws';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_TEMOIN_PORT || 7207);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-temoin-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const PROJET_ID = 'p-temoin';
const CARTE_ID = 'c-temoin';
const TITRE_CARTE = 'Constater l’état réel du dépôt';
const PHRASE = 'Je le fais ici. Je constate d’abord l’état réel du dépôt.';

fs.writeFileSync(path.join(DEPOT, 'README.md'), '# Projet d’essai\n\nUn dépôt monté pour la vérification.\n');
fs.writeFileSync(path.join(DEPOT, 'CLAUDE.md'), '# Instructions du moteur\n\nCourt et factuel.\n');
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
execFileSync('git', ['add', '.'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

/* ------------------------------------------------------------------ */
/* Le faux moteur : une phrase, puis NEUF commandes en silence          */
/* ------------------------------------------------------------------ */

const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';
let demande = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (demande += d));
process.stdin.on('end', () => jouer());
setTimeout(() => process.stdin.readable && process.stdin.read(), 50);

const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const COMMANDES = [
  'git branch --show-current && git status',
  'git worktree list',
  'cat .git/MERGE_MSG',
  'git log --oneline -3 main',
  'git branch --contains HEAD',
  'git reflog -12',
  'sqlite3 data/haikodev.db "SELECT id, status FROM deploys"',
  'sqlite3 data/haikodev.db ".tables"',
  'git log --oneline -12',
];

async function jouer() {
  dire({ type: 'system', subtype: 'init', session_id: 'session-essai' });
  // UNE phrase, tout de suite — puis plus un mot pendant les commandes.
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: ${JSON.stringify(PHRASE)} }] } });

  for (let i = 0; i < COMMANDES.length; i++) {
    const id = 'appel-' + i;
    dire({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: COMMANDES[i] } }] },
    });
    await dormir(1600);
    dire({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
    await dormir(400);
  }

  // Le silence d'après la dernière commande : le moteur réfléchit encore.
  await dormir(6000);
  try {
    fs.writeFileSync('travail.txt', 'travail rendu par le faux moteur\\n');
  } catch {
    /* dossier introuvable : le tour se juge quand même */
  }
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Le dépôt est propre, rien à reprendre.' }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 120, output_tokens: 20 } });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

/* ------------------------------------------------------------------ */
/* Le démon d'essai                                                     */
/* ------------------------------------------------------------------ */

let demon = null;
const journal = [];

function lancerLeDemon() {
  demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
    env: {
      ...process.env,
      HAIKODEV_PORT: String(PORT),
      HAIKODEV_HOST: '127.0.0.1',
      HAIKODEV_DATA: DATA,
      HAIKODEV_PROJECTS_ROOT: PROJETS,
      HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
      HAIKODEV_CLAUDE_BIN: FAUX_MOTEUR,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  demon.stdout.on('data', (d) => journal.push(String(d)));
  demon.stderr.on('data', (d) => journal.push(String(d)));
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

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const base = (readonly = false) =>
  new Database(path.join(DATA, 'haikodev.db'), readonly ? { readonly: true } : undefined);

function poserLeDecor() {
  const db = base();
  const t = Date.now();

  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3_600_000,
    'vérification témoin de travail',
  );

  const projet = {
    id: PROJET_ID,
    name: 'Essai témoin',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, DEPOT, JSON.stringify(projet), t, t);

  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'compte-essai',
    'claude',
    JSON.stringify({
      id: 'compte-essai',
      engine: 'claude',
      label: 'Compte d’essai',
      priority: 1,
      configDir: path.join(TMP, 'claude-config'),
    }),
    t,
  );

  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    column: 'planned',
    position: 1,
    title: TITRE_CARTE,
    description:
      'Regarder la branche, les copies de travail et la base, puis dire ce qui a réellement été enregistré.',
    origin: 'user',
    labels: [],
    attachments: [],
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    createdAt: t,
    updatedAt: t,
  };
  const colonnes = colonnesDeLaCarte(carte);
  const noms = Object.keys(colonnes);
  db.prepare(`INSERT INTO cards (${noms.join(', ')}) VALUES (${noms.map(() => '?').join(', ')})`).run(
    ...noms.map((nom) => colonnes[nom]),
  );

  db.close();
}

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: `haikodev_session=${jeton}` },
    });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 60_000);
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

async function main() {
  /*
   * LE PORT DOIT ÊTRE LIBRE. Un essai précédent tué à la main peut laisser son
   * démon derrière lui : le nôtre ne démarrerait pas, on parlerait à SA base, et
   * l'échec se lirait « no such table: sessions » — un faux mystère.
   */
  if (await attendrePort(1)) {
    console.error(
      `Le port ${PORT} est déjà pris (un essai précédent, sans doute).\n` +
        `Libérez-le, ou choisissez-en un autre avec HAIKODEV_TEMOIN_PORT.`,
    );
    process.exit(1);
  }

  lancerLeDemon();
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  demon.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 1500));
  lancerLeDemon();
  if (!(await attendrePort())) {
    console.error('Le démon n’a pas redémarré :\n' + journal.join(''));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1500));

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexteNav = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexteNav.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexteNav.newPage();

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(4000);

    // Le tiroir de la carte est ouvert AVANT le départ : on veut voir le tour
    // en direct, pas son résultat.
    const carte = page.locator('article').filter({ hasText: TITRE_CARTE }).first();
    await carte.waitFor({ state: 'visible', timeout: 30_000 });
    await carte.click();
    await page.waitForTimeout(1500);
    const panneau = page.getByRole('dialog').last();
    const onglet = panneau.getByRole('tab', { name: 'Conversation' });
    if (await onglet.count()) await onglet.first().click();
    await page.waitForTimeout(800);

    await commande({ type: 'card.start', id: CARTE_ID });

    // On attend que les commandes soient VRAIMENT parties : la phrase est
    // écrite, et le déroulé porte déjà plusieurs étapes.
    const deroule = panneau.locator('[data-steps]');
    await panneau.getByText(PHRASE.slice(0, 20)).first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(5000);

    /* -------- Le témoin, pendant que les commandes s'enchaînent -------- */

    const temoin = panneau.locator('[data-temoin-reflexion]').first();
    const temoinVisible = await temoin.isVisible().catch(() => false);
    noter('le témoin de travail est allumé pendant les commandes', temoinVisible);

    const texteTemoin = temoinVisible ? await temoin.innerText() : '';
    noter(
      'il DIT ce qui tourne, plutôt qu’un simple rond',
      /commande/i.test(texteTemoin) || /git|sqlite/i.test(texteTemoin),
      texteTemoin.replace(/\n/g, ' · ').slice(0, 90) || '(rien)',
    );

    const arret = panneau.getByRole('button', { name: "Arrêter l'agent" });
    const arretVisible = (await arret.count()) > 0 && (await arret.first().isVisible().catch(() => false));
    noter('la flèche d’envoi est devenue un carré d’arrêt', arretVisible);

    const champ = panneau.locator('textarea').first();
    const invite = (await champ.count()) ? await champ.getAttribute('placeholder') : '';
    noter(
      'la barre d’écriture dit que l’agent travaille',
      /travaille/i.test(invite ?? ''),
      invite ?? '(aucun champ)',
    );

    /* -------- Le silence d'APRÈS la dernière commande -------- */

    await page.waitForTimeout(17_000);
    const encoreAllume = await panneau.locator('[data-temoin-reflexion]').first().isVisible().catch(() => false);
    const encoreArret = (await panneau.getByRole('button', { name: "Arrêter l'agent" }).count()) > 0;
    noter(
      'il reste allumé dans le silence qui suit la dernière commande',
      encoreAllume && encoreArret,
      `témoin ${encoreAllume ? 'allumé' : 'éteint'}, arrêt ${encoreArret ? 'proposé' : 'absent'}`,
    );

    /* -------- La fin du tour l'éteint -------- */

    await panneau
      .getByText('Le dépôt est propre, rien à reprendre.')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(4000);
    const arretApres = await panneau.getByRole('button', { name: "Arrêter l'agent" }).count();
    noter('le tour rendu éteint le carré d’arrêt', arretApres === 0);
    const inviteApres = (await champ.count()) ? await champ.getAttribute('placeholder') : '';
    noter(
      'et la barre d’écriture redevient muette',
      !/travaille/i.test(inviteApres ?? ''),
      inviteApres ?? '(aucun champ)',
    );
    void deroule;

    /* -------- LE MÊME TOUR, DANS LA CONVERSATION DU CHEF -------- */
    /*
     * C'est l'écran de la capture : le fil de droite, pas le tiroir d'une
     * carte. L'agent y est le chef d'orchestre, sans carte — donc un autre
     * chemin d'affichage, à vérifier pour lui-même.
     */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);

    const chef = (await commande({ type: 'agent.orchestrator', projectId: PROJET_ID })).data?.agent;
    noter('le chef d’orchestre du projet existe', !!chef?.id);

    const ongletChef = page.getByRole('tab', { name: 'Chef' }).first();
    if (await ongletChef.count()) await ongletChef.click();
    await page.waitForTimeout(1000);

    await commande({ type: 'agent.prompt', agentId: chef.id, text: 'Constate l’état réel du dépôt.' });
    await page.getByText(PHRASE.slice(0, 20)).first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(5000);

    const temoinChef = page.locator('[data-temoin-reflexion]').first();
    const temoinChefVisible = await temoinChef.isVisible().catch(() => false);
    noter('conversation du chef : le témoin est allumé pendant les commandes', temoinChefVisible);
    noter(
      'conversation du chef : il dit ce qui tourne',
      temoinChefVisible && /commande/i.test(await temoinChef.innerText()),
      temoinChefVisible ? (await temoinChef.innerText()).replace(/\n/g, ' · ').slice(0, 80) : '(éteint)',
    );
    const arretChef = await page.getByRole('button', { name: "Arrêter l'agent" }).count();
    noter('conversation du chef : la flèche d’envoi est un carré d’arrêt', arretChef > 0);
  } finally {
    await navigateur.close().catch(() => {});
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées.`);
  if (echecs.length) {
    console.log('Journal du démon :\n' + journal.join('').slice(-3000));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  console.log('Journal du démon :\n' + journal.join('').slice(-3000));
  process.exit(1);
});
