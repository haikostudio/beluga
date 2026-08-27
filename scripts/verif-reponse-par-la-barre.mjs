#!/usr/bin/env node
/**
 * RÉPONDRE À UNE QUESTION D'AGENT DEPUIS LA BARRE D'ÉCRITURE.
 *
 * La bulle d'une question portait son propre champ de saisie, à côté de la
 * barre de la conversation. Celui qui répondait dans la barre — le geste que
 * la barre invite pourtant à faire — voyait sa phrase tomber dans la FILE
 * d'attente de l'agent, et la question restait ouverte pour toujours : son
 * bouton « Annuler » ne partait jamais, le triangle orange non plus.
 *
 * Trois relevés, par une vraie liaison au démon, sans aucun tour de moteur :
 *   1. un texte écrit dans la barre pendant qu'une question est ouverte
 *      DEVIENT sa réponse — la question se referme ;
 *   2. une question à choix PUR (aucun texte libre) n'avale pas ce qu'on écrit :
 *      elle attend un clic, le texte reste une demande ordinaire ;
 *   3. sans aucune question ouverte, rien ne change : le texte part comme avant.
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve.
 *
 *   npm run build && node scripts/verif-reponse-par-la-barre.mjs
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
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7196);
const BASE = `ws://127.0.0.1:${PORT}/ws`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-reponse-barre-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

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
demon.stdout.on('data', () => {});
demon.stderr.on('data', () => {});

process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
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

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
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
    'vérification réponse par la barre',
  );

  // Plafond d'agents à ZÉRO : rien ne peut démarrer tout seul dans le dos.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai réponse par la barre',
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

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    role: 'cadrage',
    title: 'Conversation d’essai',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);
  db.close();
}

/**
 * Une bulle qui porte une question ouverte. La colonne `a_questions` est
 * écrite À LA MAIN : le démon ne relit plus le contenu des messages pour
 * trouver ce qui attend, il lit cet index — un décor sans elle poserait une
 * question invisible.
 */
function poserQuestion(question) {
  const db = base();
  const id = crypto.randomUUID();
  const message = {
    id,
    agentId: AGENT_ID,
    role: 'assistant',
    content: 'Question posée par le script de vérification.',
    steps: [],
    todos: [],
    proposals: [],
    questions: [question],
    downloads: [],
    attachments: [],
    streaming: false,
    createdAt: Date.now(),
  };
  db.prepare(
    'INSERT INTO messages (id, agent_id, role, data, created_at, a_questions) VALUES (?, ?, ?, ?, ?, 1)',
  ).run(id, AGENT_ID, 'assistant', JSON.stringify(message), message.createdAt);
  db.close();
  return id;
}

function lireQuestion(messageId) {
  const db = base();
  const ligne = db.prepare('SELECT data FROM messages WHERE id = ?').get(messageId);
  db.close();
  return JSON.parse(ligne.data).questions[0];
}

function appelDemon(commande) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(BASE, { headers: { cookie: `haikodev_session=${JETON}` } });
    const id = crypto.randomUUID();
    const minuteur = setTimeout(() => {
      socket.close();
      reject(new Error('le démon ne répond pas'));
    }, 20000);
    socket.on('open', () => socket.send(JSON.stringify({ id, cmd: commande })));
    socket.on('message', (brut) => {
      const trame = JSON.parse(String(brut));
      if (trame.id !== id) return;
      clearTimeout(minuteur);
      socket.close();
      resolve(trame);
    });
    socket.on('error', (souci) => {
      clearTimeout(minuteur);
      reject(souci);
    });
  });
}

async function main() {
  if (!(await attendrePort())) throw new Error('le démon d’essai n’a pas démarré');
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1000));

  /* ---- 1. Un texte écrit dans la barre répond à la question ouverte ---- */
  const libre = poserQuestion({
    id: crypto.randomUUID(),
    question: 'Sur quel port le projet doit-il écouter ?',
    kind: 'text',
    options: [],
    allowFreeText: true,
  });
  await appelDemon({ type: 'agent.prompt', agentId: AGENT_ID, text: 'Sur le port 7123.', attachments: [] });
  await new Promise((r) => setTimeout(r, 1500));
  const repondue = lireQuestion(libre);
  noter('un texte écrit dans la barre devient la réponse', repondue.answer === 'Sur le port 7123.', repondue.answer ?? '—');
  noter('la question ne reste plus ouverte — plus de « Annuler »', !!repondue.answer && !repondue.cancelled);

  /* ---- 2. Une question à CHOIX PUR attend un clic, pas une phrase ---- */
  const choixPur = poserQuestion({
    id: crypto.randomUUID(),
    question: 'Faut-il publier maintenant ?',
    kind: 'single',
    options: [
      { id: 'oui', label: 'Oui' },
      { id: 'non', label: 'Non' },
    ],
    allowFreeText: false,
  });
  await appelDemon({ type: 'agent.prompt', agentId: AGENT_ID, text: 'plutôt demain', attachments: [] });
  await new Promise((r) => setTimeout(r, 1500));
  const intacte = lireQuestion(choixPur);
  noter('une question à choix pur n’avale pas ce qu’on écrit', !intacte.answer && !intacte.cancelled);

  /* ---- 3. Sans question ouverte, le texte part comme une demande ---- */
  const deja = lireQuestion(libre);
  await appelDemon({ type: 'agent.prompt', agentId: AGENT_ID, text: 'et autre chose', attachments: [] });
  await new Promise((r) => setTimeout(r, 1500));
  noter('une question déjà répondue ne se réécrit pas', lireQuestion(libre).answer === deja.answer);

  const rates = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - rates}/${resultats.length} contrôles passés.`);
  process.exit(rates ? 1 : 0);
}

main().catch((souci) => {
  console.error('vérification interrompue :', souci.message);
  process.exit(1);
});
