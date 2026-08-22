#!/usr/bin/env node
/**
 * LE PROMPT ENVOYÉ D'UNE CARTE LANCÉE PAR LE BOUTON.
 *
 *   npm run build && node scripts/verif-prompt-envoye-tour-lance.mjs
 *
 * `verif-contexte-envoye.mjs` juge l'AFFICHAGE, sur un instantané posé à la main
 * dans la base : il ne prouve donc rien sur le chemin qui l'écrit. Or c'est
 * justement là que le prompt d'une carte lancée se perdait — un tour parti d'un
 * BOUTON n'écrit aucune bulle de demande, et le texte réellement envoyé au
 * moteur n'était conservé que sur cette bulle absente. Résultat à l'écran :
 * l'onglet « Conversation » du tiroir s'ouvrait droit sur le déroulé des
 * étapes, sans la demande ni la mémoire retrouvée.
 *
 * Ce script fait donc le tour ENTIER, pour de vrai : son propre démon, sa base
 * neuve, un FAUX MOTEUR (un vrai processus, aucun jeton dépensé), une carte
 * lancée par la commande du bouton — puis il constate
 *   1. en BASE : la réponse du tour porte le prompt envoyé, ses morceaux nommés
 *      et les passages retrouvés dans la documentation du projet ;
 *   2. à l'ÉCRAN : le bloc « Demande envoyée à l'agent » est là, AU-DESSUS du
 *      déroulé, il se déplie sur le texte réel et son repère ouvre le prompt.
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
const PORT = Number(process.env.HAIKODEV_PROMPT_LANCE_PORT || 7199);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-prompt-lance-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
const SHOTS = path.join(RACINE, 'data', 'verification');
for (const dossier of [DATA, PROJETS, DEPOT, SHOTS]) fs.mkdirSync(dossier, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le dépôt d'essai : un vrai git, avec de la DOCUMENTATION à retrouver */
/* ------------------------------------------------------------------ */

const PROJET_ID = 'p-prompt-lance';
const CARTE_ID = 'c-prompt-lance';
const TITRE_CARTE = 'Montrer le prompt envoyé dans le tiroir de la carte';
const DESCRIPTION_CARTE =
  "Le bloc qui montre la demande envoyée à l'agent doit s'afficher au-dessus du déroulé, avec les passages de mémoire retrouvés.";

fs.mkdirSync(path.join(DEPOT, 'docs', 'regles'), { recursive: true });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# Projet d’essai\n\nUn dépôt monté pour la vérification.\n');
fs.writeFileSync(
  path.join(DEPOT, 'CLAUDE.md'),
  '# Instructions du moteur\n\nCourt et factuel : comment lancer, comment vérifier.\n',
);
/* La documentation que la recherche doit remonter : elle parle du prompt
   envoyé et du tiroir de la carte, comme la demande. */
fs.writeFileSync(
  path.join(DEPOT, 'docs', 'regles', 'interface.md'),
  [
    '# Interface — règles du moteur',
    '',
    '## Le prompt envoyé se relit sous la demande',
    '',
    "Un repère à gauche ouvre le prompt réellement parti au moteur, passages de mémoire compris.",
    'Le tiroir montre CE tour-là, jamais la pile des autres.',
    '',
    '## Le tiroir d’une carte montre la demande envoyée',
    '',
    "Une carte lancée par un bouton n'écrit aucune bulle : la demande envoyée à l'agent se pose alors",
    'sur la réponse du tour, au-dessus du déroulé des étapes.',
    '',
  ].join('\n'),
);
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
execFileSync('git', ['add', '.'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

/* ------------------------------------------------------------------ */
/* Un faux moteur : un vrai processus, le vrai flux de Claude          */
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

async function jouer() {
  dire({ type: 'system', subtype: 'init', session_id: 'session-essai' });
  // Un vrai travail : l'agent écrit dans sa copie, sinon la carte repart en
  // « Planifié » et le tiroir n'a plus rien à montrer d'un tour abouti.
  try {
    fs.writeFileSync('travail.txt', 'travail rendu par le faux moteur\\n');
  } catch {
    /* dossier introuvable : le tour se juge quand même */
  }
  await new Promise((r) => setTimeout(r, 300));
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Travail rendu, tout est en place.' }] } });
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

async function attendre(condition, limiteMs = 60_000, pasMs = 500) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, pasMs));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le décor : un projet, une carte en « Planifié », aucun agent         */
/* ------------------------------------------------------------------ */

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
    'vérification prompt envoyé (tour lancé)',
  );

  const projet = {
    id: PROJET_ID,
    name: 'Essai prompt envoyé',
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

  /* La carte NAÎT dans « Planifié » et n'a aucun agent : c'est le bouton
     « Lancer » (commande `card.start`) qui crée l'agent et part — sans écrire
     la moindre bulle de demande. Exactement le cas du bogue. */
  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    column: 'planned',
    position: 1,
    title: TITRE_CARTE,
    description: DESCRIPTION_CARTE,
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

/** Les messages de la carte, tels qu'ils sont écrits en base. */
function messagesDeLaCarte() {
  const db = base(true);
  const lignes = db
    .prepare(
      `SELECT m.data FROM messages m JOIN agents a ON a.id = m.agent_id
       WHERE a.card_id = ? ORDER BY m.created_at ASC`,
    )
    .all(CARTE_ID);
  db.close();
  return lignes.map((l) => JSON.parse(l.data));
}

/* ------------------------------------------------------------------ */

async function main() {
  lancerLeDemon();
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  // Le décor est posé après le démarrage : on relance pour que le démon le lise.
  demon.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 1500));
  lancerLeDemon();
  if (!(await attendrePort())) {
    console.error('Le démon n’a pas redémarré :\n' + journal.join(''));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1500));

  /* -------- 1. Le tour part du BOUTON, sans bulle de demande -------- */

  await commande({ type: 'card.start', id: CARTE_ID });
  const fini = await attendre(async () => {
    const etat = await commande({ type: 'daemon.status' });
    return (etat.data?.etat?.agentsEnCours ?? 1) === 0 && messagesDeLaCarte().length > 0;
  });
  noter('le tour lancé par le bouton est allé jusqu’au bout', fini);
  await new Promise((r) => setTimeout(r, 2000));

  const messages = messagesDeLaCarte();
  noter(
    'aucune bulle de demande n’a été écrite : le tour est parti d’un bouton',
    messages.length > 0 && !messages.some((m) => m.role === 'user'),
    messages.map((m) => m.role).join(', '),
  );

  const porteur = messages.find((m) => m.sentContext);
  noter('le prompt envoyé est conservé, malgré l’absence de bulle', !!porteur, porteur ? '' : 'aucun sentContext');
  noter(
    'c’est la RÉPONSE du tour qui le porte',
    porteur?.role === 'assistant',
    porteur ? `porté par un message « ${porteur.role} »` : '',
  );

  const contexte = porteur?.sentContext ?? {};
  const demande = (contexte.blocks ?? []).find((b) => b.kind === 'request');
  noter(
    'le texte réellement envoyé est là, en clair',
    typeof demande?.text === 'string' && demande.text.includes(TITRE_CARTE),
    (demande?.text ?? '(rien)').slice(0, 60),
  );
  noter(
    'la consigne système du tour est conservée',
    typeof contexte.systemInstruction?.content === 'string' && contexte.systemInstruction.content.length > 0,
  );
  const memoire = (contexte.blocks ?? []).find((b) => b.kind === 'memory');
  noter(
    'la mémoire partie en parallèle est nommée et gardée',
    !!memoire?.text,
    memoire ? memoire.label : '(aucun bloc de mémoire)',
  );

  /*
   * LES DONNÉES PARALLÈLES : les passages que la recherche est allée chercher
   * dans la documentation du projet. Sans passage, c'est la RAISON qui doit
   * être écrite — jamais un silence.
   */
  const passages = contexte.passages ?? [];
  noter(
    'les passages retrouvés voyagent avec le prompt, ou leur absence est expliquée',
    passages.length > 0 || Boolean(contexte.passagesRaison),
    passages.length ? `${passages.length} passage(s)` : (contexte.passagesRaison ?? '(rien)'),
  );
  if (passages.length) {
    noter(
      'chaque passage dit sa source et garde son texte',
      passages.every((p) => p.source && typeof p.texte === 'string' && p.texte.length > 0),
      passages.map((p) => p.source).join(', '),
    );
  }

  /* -------- 2. À l'écran : le bloc au-dessus du déroulé -------- */

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
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(5000);

    const carte = page.locator('article').filter({ hasText: TITRE_CARTE }).first();
    await carte.waitFor({ state: 'visible', timeout: 30_000 });
    await carte.click();
    await page.waitForTimeout(2000);

    const panneau = page.getByRole('dialog').last();
    const onglet = panneau.getByRole('tab', { name: 'Conversation' });
    if (await onglet.count()) await onglet.first().click();
    await page.waitForTimeout(1500);

    const bloc = panneau.locator('[data-prompt-envoye]').first();
    const visible = await bloc.isVisible().catch(() => false);
    noter('carte lancée sans recherche : aucun ancien pavé technique n’est affiché', !visible);

    await page.screenshot({ path: path.join(SHOTS, 'prompt-envoye-tour-lance.png'), fullPage: true });
    noter('aucune erreur de page', erreurs.length === 0, erreurs[0] ?? '');
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-40).join(''));
  process.exit(1);
});
