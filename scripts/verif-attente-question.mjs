#!/usr/bin/env node
/**
 * UNE QUESTION ARRÊTE-T-ELLE VRAIMENT L'AGENT JUSQU'À LA RÉPONSE ?
 *
 * Le contrôle est joué sur le VRAI pont d'outils (`server/mcp-bridge.mjs`),
 * parlé en MCP comme le ferait un moteur, contre un démon à soi :
 *
 *   1. l'appel d'outil `ask_user` NE REND RIEN tant que personne n'a répondu —
 *      c'est ce silence qui empêche le moteur de faire les étapes suivantes ;
 *   2. pendant ce temps, la question est bien posée dans la conversation et
 *      l'agent porte le repère « attend une réponse » ;
 *   3. la réponse, envoyée par la vraie liaison, fait revenir l'appel d'outil
 *      AVEC son texte — et RIEN n'est passé par la file d'attente de l'agent
 *      (le bug d'origine : « votre message part dès que l'agent a fini ») ;
 *   4. une question ANNULÉE libère l'appel au lieu de le laisser pendre, en
 *      disant qu'il ne faut rien deviner.
 *
 * Aucun moteur n'est lancé, aucun quota dépensé : c'est le pont qu'on
 * interroge, pas un modèle. Base neuve, dossiers jetables, démon à soi sur un
 * port d'essai — le démon de production n'est jamais touché.
 *
 *   npm run build && node scripts/verif-attente-question.mjs
 */
import WebSocket from 'ws';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7194);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-attente-question-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

console.log(`  …  dépôt jugé : ${RACINE}`);

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DOSSIER = path.join(TMP, 'projet');
for (const dossier of [DATA, PROJETS, DOSSIER]) fs.mkdirSync(dossier, { recursive: true });

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

let pont;
process.on('exit', () => {
  // On ne vise QUE ses propres processus, par leur objet : jamais un motif de
  // nom qui pourrait désigner le démon de production.
  for (const enfant of [pont, demon]) {
    try {
      enfant?.kill('SIGKILL');
    } catch {
      /* déjà parti */
    }
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
/* Le décor : un projet, un agent au travail, une session              */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const JETON_INTERNE = crypto.randomBytes(24).toString('hex');
const PROJET_ID = 'p-essai';
const AGENT_ID = 'a-essai';
const base = () => new Database(path.join(DATA, 'haikodev.db'));

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification attente de réponse',
  );

  // Plafond d'agents à ZÉRO : rien ne peut démarrer tout seul dans le dos.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  /*
   * Le jeton du pont d'outils n'est fabriqué qu'au premier lancement d'un
   * moteur : ici aucun tour ne part, on le pose donc soi-même. Le démon le
   * relira en base au premier appel, exactement comme il aurait relu le sien.
   */
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('internal.token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JETON_INTERNE);

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai attente de réponse',
    path: DOSSIER,
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

  // Un agent de TÂCHE, marqué au travail : c'est la situation de la capture —
  // un agent en pleine exécution qui pose une question.
  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    role: 'task',
    title: 'Agent d’essai',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'running',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, 'task', 'running', JSON.stringify(agent), maintenant, maintenant);

  // Un message d'assistant en cours d'écriture : c'est à lui que la question
  // vient s'accrocher, comme pendant un vrai tour.
  const message = {
    id: 'm-essai',
    agentId: AGENT_ID,
    role: 'assistant',
    content: 'Travail en cours…',
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    streaming: true,
    createdAt: maintenant,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id,
    AGENT_ID,
    'assistant',
    JSON.stringify(message),
    maintenant,
  );
  db.close();
}

function lireAgent() {
  const db = base();
  const ligne = db.prepare('SELECT data FROM agents WHERE id = ?').get(AGENT_ID);
  db.close();
  return ligne ? JSON.parse(ligne.data) : null;
}

function questionsPosees() {
  const db = base();
  const lignes = db.prepare('SELECT data FROM messages WHERE agent_id = ?').all(AGENT_ID);
  db.close();
  return lignes.flatMap((ligne) => JSON.parse(ligne.data).questions ?? []);
}

function fileDAttente() {
  const db = base();
  const lignes = db.prepare('SELECT data FROM queue WHERE agent_id = ?').all(AGENT_ID);
  db.close();
  return lignes.map((ligne) => JSON.parse(ligne.data));
}

/** Une commande envoyée au démon par la vraie liaison, et sa réponse. */
function appelDemon(commande) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { cookie: `haikodev_session=${JETON}` },
    });
    const id = crypto.randomUUID();
    const minuteur = setTimeout(() => {
      socket.close();
      reject(new Error('le démon ne répond pas'));
    }, 20000);
    socket.on('open', () => socket.send(JSON.stringify({ id, cmd: commande })));
    socket.on('message', (brut) => {
      const message = JSON.parse(String(brut));
      if (message.id !== id) return;
      clearTimeout(minuteur);
      socket.close();
      if (message.error) reject(new Error(message.error));
      else resolve(message.result ?? {});
    });
    socket.on('error', (err) => {
      clearTimeout(minuteur);
      reject(err);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Le pont d'outils, parlé comme un moteur le parle                    */
/* ------------------------------------------------------------------ */

function ouvrirLePont(token) {
  const enfant = spawn('node', [path.join(RACINE, 'server', 'mcp-bridge.mjs')], {
    env: {
      ...process.env,
      HAIKODEV_URL: BASE,
      HAIKODEV_TOKEN: token,
      HAIKODEV_AGENT: AGENT_ID,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const recues = [];
  const guetteurs = new Set();
  let reste = '';
  enfant.stdout.on('data', (bloc) => {
    reste += String(bloc);
    const lignes = reste.split('\n');
    reste = lignes.pop() ?? '';
    for (const ligne of lignes) {
      if (!ligne.trim()) continue;
      const message = JSON.parse(ligne);
      recues.push(message);
      for (const guetteur of [...guetteurs]) guetteur(message);
    }
  });
  const envoyer = (message) => enfant.stdin.write(`${JSON.stringify(message)}\n`);
  const reponseDe = (id) =>
    new Promise((resolve) => {
      const dejaLa = recues.find((m) => m.id === id);
      if (dejaLa) return resolve(dejaLa);
      const guetteur = (message) => {
        if (message.id !== id) return;
        guetteurs.delete(guetteur);
        resolve(message);
      };
      guetteurs.add(guetteur);
    });
  return { enfant, envoyer, reponseDe, recues };
}

const dort = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Le déroulé                                                          */
/* ------------------------------------------------------------------ */

try {
  if (!(await attendrePort())) {
    console.error(`Le démon d'essai n'a pas démarré.\n${journal.join('')}`);
    process.exit(1);
  }
  poserLeDecor();

  const { enfant, envoyer, reponseDe, recues } = ouvrirLePont(JETON_INTERNE);
  pont = enfant;
  envoyer({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  await reponseDe(1);

  /* 1. L'appel d'outil ne rend RIEN tant que personne n'a répondu ----- */

  envoyer({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'ask_user',
      arguments: { question: 'Que fait-on de la base de données ?', kind: 'text' },
    },
  });

  await dort(3000);
  noter(
    "l'appel d'outil reste sans réponse tant que personne ne répond",
    !recues.some((m) => m.id === 2),
    'le moteur est donc arrêté sur sa question',
  );

  /* 2. La question est bien posée, et l'agent le DIT ------------------ */

  const posees = questionsPosees();
  noter('la question est posée dans la conversation', posees.length === 1, posees[0]?.question ?? '');
  noter("l'agent porte le repère « attend une réponse »", lireAgent()?.attendReponse === true);

  /* 3. La réponse fait revenir l'appel d'outil, sans passer par la file */

  const question = posees[0];
  await appelDemon({
    type: 'question.answer',
    messageId: 'm-essai',
    questionId: question.id,
    answer: 'Déplace-la sur l’instance dev, puis supprime l’ancienne.',
    attachments: [],
  });

  const rendue = await Promise.race([reponseDe(2), dort(15000).then(() => null)]);
  const texte = rendue?.result?.content?.[0]?.text ?? '';
  noter("l'appel d'outil rend enfin la main", !!rendue);
  noter(
    'la réponse de l’utilisateur est ce que reçoit le moteur',
    texte.includes('Déplace-la sur l’instance dev'),
    texte.slice(0, 80),
  );
  noter(
    'le moteur est invité à reprendre à partir de cette réponse',
    /Reprends ton travail à partir de cette réponse/.test(texte),
  );
  noter(
    'rien n’est parti dans la file d’attente de l’agent',
    fileDAttente().length === 0,
    'la réponse n’attend plus la fin du tour',
  );
  noter("le repère « attend une réponse » est retiré", !lireAgent()?.attendReponse);

  /* 4. Une question ANNULÉE libère l'appel au lieu de le laisser pendre */

  envoyer({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'ask_user', arguments: { question: 'Faut-il aussi purger les sauvegardes ?', kind: 'text' } },
  });
  await dort(1500);
  const secondes = questionsPosees().filter((q) => q.question.startsWith('Faut-il aussi purger'));
  const aAnnuler = secondes[0];
  const messageDeLaQuestion = (() => {
    const db = base();
    const lignes = db.prepare('SELECT id, data FROM messages WHERE agent_id = ?').all(AGENT_ID);
    db.close();
    return lignes.find((ligne) => JSON.parse(ligne.data).questions?.some((q) => q.id === aAnnuler?.id))?.id;
  })();

  await appelDemon({
    type: 'question.cancel',
    messageId: messageDeLaQuestion,
    questionId: aAnnuler.id,
  });
  const apresAnnulation = await Promise.race([reponseDe(3), dort(15000).then(() => null)]);
  const texteAnnule = apresAnnulation?.result?.content?.[0]?.text ?? '';
  noter("une question annulée libère l'appel d'outil", !!apresAnnulation);
  noter(
    'et le moteur reçoit l’ordre de ne rien deviner',
    /Ne devine pas à la place de l'utilisateur/.test(texteAnnule),
    texteAnnule.slice(0, 80),
  );
} catch (err) {
  noter('le contrôle est allé au bout', false, err?.message ?? String(err));
  console.error(journal.join('').split('\n').slice(-25).join('\n'));
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} relevés au vert.`);
process.exit(echecs.length ? 1 : 0);
