#!/usr/bin/env node
/**
 * LE TÉMOIN « RÉFLEXION EN COURS » S'ÉTEINT TOUT SEUL.
 *
 *   node scripts/verif-temoin-reflexion.mjs
 *
 * Le défaut constaté : un agent enregistré EN ÉCHEC, plus aucun processus de
 * moteur en vie, et le bandeau « Réflexion en cours… » toujours allumé une
 * demi-heure plus tard. La cause : le message du tour gardait sa marque « en
 * cours d'écriture », et l'interface allumait le bandeau sur cette seule marque.
 *
 * Ce script monte son PROPRE démon, sur un port libre et une base neuve — le
 * démon de production n'est pas touché, aucun tour de moteur n'est payé. Il
 * pose le décor exact du défaut, puis exige deux choses :
 *
 *   1. SANS RECHARGEMENT : la veille de l'ordonnanceur éteint la marque et
 *      DIFFUSE le message corrigé sur le canal ouvert.
 *   2. APRÈS UN REDÉMARRAGE : la reprise éteint toute marque restée en
 *      écriture, quel que soit le statut de l'agent.
 *
 * Et l'inverse, tout aussi important : le message d'un tour QUI DÉMARRE (né
 * après la dernière fin de tour) garde sa marque — sans quoi le témoin
 * clignoterait à chaque départ.
 */
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* La racine se déduit du script LUI-MÊME : lancé depuis une copie de travail
   (`.worktrees/…`), il doit juger le code de CETTE copie. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ws = require('ws');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7203);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-temoin-'));

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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  demon.stdout.on('data', (d) => journal.push(String(d)));
  demon.stderr.on('data', (d) => journal.push(String(d)));
}

function arreterLeDemon() {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  demon = null;
}

process.on('exit', () => {
  arreterLeDemon();
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort(ouvert = true, limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const joignable = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (joignable === ouvert) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le décor : le défaut exact, tel qu'il a été constaté                 */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
/** L'agent du constat : en échec, avec un message resté « en écriture ». */
const AGENT_TOMBE = 'a-tombe';
/** L'agent témoin : son tour DÉMARRE, sa marque doit rester. */
const AGENT_QUI_DEMARRE = 'a-demarre';

function base(options = {}) {
  return new Database(path.join(DATA, 'haikodev.db'), options);
}

function poserAgent(db, id, agent, message) {
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, session_id, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, '{}', ?, ?, ?)`,
  ).run(id, PROJET_ID, agent.role, agent.status, JSON.stringify(agent), agent.createdAt, agent.updatedAt);
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id,
    id,
    message.role,
    JSON.stringify(message),
    message.createdAt,
  );
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification témoin de réflexion',
  );

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai témoin',
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

  const gabaritMessage = (id, agentId, createdAt) => ({
    id,
    agentId,
    role: 'assistant',
    content: 'Une réponse à moitié écrite.',
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    streaming: true,
    plan: false,
    createdAt,
  });

  // 1. Le constat : tour parti il y a une demi-heure, refermé en échec, message
  //    resté marqué « en écriture » derrière la fermeture.
  poserAgent(
    db,
    AGENT_TOMBE,
    {
      id: AGENT_TOMBE,
      projectId: PROJET_ID,
      role: 'orchestrator',
      title: "Chef d'orchestre",
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status: 'failed',
      startedAt: maintenant - 1_800_000,
      endedAt: maintenant - 1_500_000,
      createdAt: maintenant - 1_800_000,
      updatedAt: maintenant - 1_500_000,
    },
    gabaritMessage('m-tombe', AGENT_TOMBE, maintenant - 1_800_000),
  );

  // 2. Le témoin inverse : le message vient de naître, le tour démarre.
  poserAgent(
    db,
    AGENT_QUI_DEMARRE,
    {
      id: AGENT_QUI_DEMARRE,
      projectId: PROJET_ID,
      role: 'orchestrator',
      title: "Chef d'orchestre (départ)",
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status: 'idle',
      startedAt: maintenant - 600_000,
      endedAt: maintenant - 600_000,
      createdAt: maintenant - 600_000,
      updatedAt: maintenant,
    },
    gabaritMessage('m-demarre', AGENT_QUI_DEMARRE, maintenant),
  );

  db.close();
}

function messageEnBase(id) {
  const db = base({ readonly: true });
  const ligne = db.prepare('SELECT data FROM messages WHERE id = ?').get(id);
  db.close();
  return JSON.parse(ligne?.data ?? '{}');
}

/**
 * Une connexion ouverte, comme un onglet resté ouvert sous les yeux : on écoute
 * ce que le démon diffuse TOUT SEUL, sans rien lui demander.
 */
function ecouter(dureeMs) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: `haikodev_session=${jeton}` },
    });
    const recus = [];
    prise.on('message', (brut) => recus.push(JSON.parse(String(brut))));
    prise.on('error', reject);
    prise.on('open', () => setTimeout(() => (prise.close(), resolve(recus)), dureeMs));
  });
}

/* ------------------------------------------------------------------ */

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  lancerLeDemon();
  if (!(await attendrePort())) {
    console.error(journal.join(''));
    throw new Error('le démon d’essai n’a pas démarré');
  }
  poserLeDecor();

  noter('le décor part bien du défaut : le message est marqué en écriture', messageEnBase('m-tombe').streaming === true);

  // La veille passe toutes les quinze secondes : on écoute vingt secondes,
  // exactement comme un onglet laissé ouvert.
  console.log('  …  écoute du canal pendant 20 s (la veille passe toutes les 15 s)');
  const recus = await ecouter(20_000);

  const diffuse = recus.filter((e) => e.type === 'message.upsert' && e.message?.id === 'm-tombe').pop();
  noter('le message corrigé est diffusé tout seul : le bandeau s’éteint sans rechargement', Boolean(diffuse));
  noter('la marque d’écriture est bien retombée dans ce qui est diffusé', diffuse?.message?.streaming === false);
  noter('la base ne garde plus la marque', messageEnBase('m-tombe').streaming === false);
  noter(
    'le contenu déjà écrit est gardé : on éteint une marque, on n’efface pas une réponse',
    messageEnBase('m-tombe').content === 'Une réponse à moitié écrite.',
  );
  noter(
    'le tour QUI DÉMARRE garde sa marque : pas de témoin qui clignote au départ',
    messageEnBase('m-demarre').streaming === true,
  );

  /* --- Le redémarrage du serveur --- */
  arreterLeDemon();
  await attendrePort(false);
  // Plus aucun moteur ne tourne : toute marque d'écriture est forcément orpheline.
  const db = base();
  const message = messageEnBase('m-demarre');
  db.prepare('UPDATE messages SET data = ? WHERE id = ?').run(
    JSON.stringify({ ...message, streaming: true }),
    'm-demarre',
  );
  db.close();

  lancerLeDemon();
  if (!(await attendrePort())) throw new Error('le démon d’essai n’a pas redémarré');
  await new Promise((r) => setTimeout(r, 2000));

  noter(
    'après un redémarrage, plus aucun message ne reste « en écriture »',
    messageEnBase('m-demarre').streaming === false && messageEnBase('m-tombe').streaming === false,
  );
}

main()
  .catch((err) => {
    noter('déroulement du script', false, err?.message ?? String(err));
  })
  .finally(() => {
    const echecs = resultats.filter((r) => !r.ok);
    console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés`);
    process.exit(echecs.length ? 1 : 0);
  });
