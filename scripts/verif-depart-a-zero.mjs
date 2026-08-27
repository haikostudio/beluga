#!/usr/bin/env node
/**
 * REPARTIR DE ZÉRO VIDE VRAIMENT LE CONTEXTE.
 *
 *   node scripts/verif-nouveau-depart.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve : le
 * démon de production n'est pas touché, et aucun tour de moteur n'est payé — le
 * geste vérifié est une commande, pas une conversation.
 *
 * Le décor : un chef d'orchestre au repos, avec deux messages, une session de
 * moteur ouverte, une mesure de contexte à 9 %, un état de remplissage porteur
 * d'un RÉSUMÉ DE CONTINUITÉ et un avancement de liste de tâches. C'est
 * exactement l'état d'où venait le défaut : la conversation paraissait vide,
 * mais le composeur affichait encore un pourcentage.
 *
 * Après `agent.reset`, on exige :
 *   - l'événement `agent.upsert` part, sans mesure ni état de contexte ;
 *   - la base ne garde ni mesure, ni résumé de continuité, ni session moteur ;
 *   - le repère de départ est posé et les messages sont TOUS encore là :
 *     rien n'est supprimé, l'ancien fil reste consultable.
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
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7198);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-depart-zero-'));

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

/* ------------------------------------------------------------------ */
/* Le décor : un chef chargé de tout ce qu'il doit oublier              */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const AGENT_ID = 'a-chef-essai';
const RESUME = 'RÉSUMÉ DU FIL PRÉCÉDENT : ce texte ne doit plus jamais repartir au moteur.';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification nouveau départ',
  );

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai nouveau départ',
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

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    role: 'cadrage',
    title: "Chef d'orchestre",
    run: { engine: 'claude', model: 'claude-haiku-4-5-20251001', thinking: 'medium', mode: 'direct' },
    status: 'idle',
    todos: { done: 3, total: 3 },
    contextUsage: { usedTokens: 18_000, capacityTokens: 200_000, percentage: 9, measuredAt: maintenant },
    context: {
      tokens: 18_000,
      window: 200_000,
      ratio: 0.09,
      armed: true,
      pending: false,
      compressionCount: 1,
      continuitySummary: RESUME,
    },
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, session_id, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  ).run(
    agent.id,
    PROJET_ID,
    agent.role,
    agent.status,
    JSON.stringify({ claude: 'session-du-fil-precedent' }),
    JSON.stringify(agent),
    maintenant,
    maintenant,
  );

  for (const [index, role] of ['user', 'assistant'].entries()) {
    const message = {
      id: `m-essai-${index}`,
      agentId: AGENT_ID,
      role,
      content: index ? 'Réponse du chef.' : 'Une demande déjà posée.',
      steps: [],
      todos: [],
      proposals: [],
      questions: [],
      downloads: [],
      attachments: [],
      streaming: false,
      plan: false,
      createdAt: maintenant - (2 - index) * 1000,
    };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      message.id,
      AGENT_ID,
      role,
      JSON.stringify(message),
      message.createdAt,
    );
  }
  db.close();
}

/* ------------------------------------------------------------------ */
/* Une commande, et tout ce que le démon diffuse pendant ce temps       */
/* ------------------------------------------------------------------ */

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: `haikodev_session=${jeton}` },
    });
    const id = crypto.randomBytes(6).toString('hex');
    const recus = [];
    let ack = null;
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 20000);
    prise.on('open', () => prise.send(JSON.stringify({ id, cmd })));
    prise.on('message', (brut) => {
      const evenement = JSON.parse(String(brut));
      recus.push(evenement);
      if (evenement.type !== 'ack' || evenement.id !== id) return;
      ack = evenement;
      // On laisse une seconde aux diffusions qui suivent l'accusé.
      setTimeout(() => (clearTimeout(minuteur), prise.close(), resolve({ ack, recus })), 1000);
    });
    prise.on('error', (e) => (clearTimeout(minuteur), reject(e)));
  });
}

function agentEnBase() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const ligne = db.prepare('SELECT session_id, data FROM agents WHERE id = ?').get(AGENT_ID);
  const messages = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE agent_id = ?').get(AGENT_ID).n;
  const repere = db.prepare('SELECT value FROM meta WHERE key = ?').get(`chat.depart.${AGENT_ID}`)?.value;
  db.close();
  return { sessions: ligne?.session_id ?? '', agent: JSON.parse(ligne?.data ?? '{}'), messages, repere };
}

/* ------------------------------------------------------------------ */

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  if (!(await attendrePort())) {
    console.error(journal.join(''));
    throw new Error('le démon d’essai n’a pas démarré');
  }
  poserLeDecor();

  const avant = agentEnBase();
  noter('le décor part bien d’un contexte chargé', avant.agent.contextUsage?.percentage === 9, 'mesure à 9 %');

  const { ack, recus } = await commande({ type: 'agent.reset', agentId: AGENT_ID });
  noter('la commande est acceptée', ack?.ok === true && ack?.data?.ok === true);

  const diffuse = recus.filter((e) => e.type === 'agent.upsert' && e.agent?.id === AGENT_ID).pop();
  noter('l’agent remis à zéro est diffusé tout de suite', Boolean(diffuse));
  // Rien de diffusé = rien de prouvé : chaque absence exige d'abord l'agent.
  noter(
    'la mesure de contexte diffusée est absente : le composeur affiche un tiret, pas 9 %',
    Boolean(diffuse) && diffuse.agent.contextUsage === undefined,
    `reçu : ${JSON.stringify(diffuse?.agent?.contextUsage)}`,
  );
  noter('l’état de remplissage diffusé est absent', Boolean(diffuse) && diffuse.agent.context === undefined);
  noter('l’avancement de la liste de tâches est oublié', Boolean(diffuse) && diffuse.agent.todos === undefined);
  noter('les réglages du chef survivent', diffuse?.agent?.run?.engine === 'claude');

  const apres = agentEnBase();
  noter('la base ne garde plus la mesure', apres.agent.contextUsage === undefined);
  noter(
    'le résumé de continuité ne repartira plus au moteur',
    !JSON.stringify(apres.agent).includes(RESUME),
  );
  noter('la session du moteur est coupée', !apres.sessions.includes('session-du-fil-precedent'));
  noter('le repère de départ est posé', Number(apres.repere) > 0);
  noter('rien n’est supprimé : les deux messages sont encore là', apres.messages === 2);

  const conversation = recus.filter((e) => e.type === 'agent.snapshot' && e.agentId === AGENT_ID).pop();
  noter('la conversation affichée repart vide', conversation?.messages?.length === 0);
  noter('les échanges d’avant restent comptés derrière le lien', conversation?.precedents === 2);
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
