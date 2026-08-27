#!/usr/bin/env node
/**
 * UN SIGNAL D'ARRÊT VENU DU DEHORS NE COUPE PAS UNE TÂCHE EN VOL.
 *
 *   node scripts/verif-signal-arret-attend-tache.mjs
 *
 * Le bouton de redémarrage était bien gardé ; le signal, lui, ne l'était pas.
 * Le 14/08/2026, un agent faisant le ménage de ses processus d'essai avec
 * `pkill -f "server/dist/main.js"` a frappé le démon de production trois fois
 * en cinq minutes, coupant quatre tâches en plein travail.
 *
 * Le script monte ses PROPRES démons, sur des ports libres, avec des bases
 * neuves : celui de production n'est jamais touché. Un « moteur » factice (un
 * vrai processus qui dort puis sort) tient lieu d'agent réellement au travail.
 *
 * Ce qui est vérifié :
 *   1. sans rien en vol, un SIGTERM est obéi — le serveur reste arrêtable ;
 *   2. pendant qu'un agent travaille, un SIGTERM est RETENU : le processus
 *      survit, et l'état du démon annonce le redémarrage en attente ;
 *   3. le même signal répété — le cas réel — ne passe jamais outre ;
 *   4. dès la tâche finie, l'arrêt retenu part TOUT SEUL ;
 *   5. `pkill -f "server/dist/main.js"` ne retrouve plus le démon : son nom de
 *      processus ne porte plus le chemin de son fichier construit.
 */
import ws from '/root/haikodev/node_modules/ws/index.js';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import { spawn, execFileSync, execFileSync as exec } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT_LIBRE = Number(process.env.HAIKODEV_VERIF_PORT || 7194);
const PORT_OCCUPE = PORT_LIBRE + 1;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-signal-arret-'));
const DUREE_MOTEUR_S = 12;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Le décor commun : un dépôt d'essai et un faux moteur                */
/* ------------------------------------------------------------------ */

const DEPOT = path.join(TMP, 'depot');
fs.mkdirSync(DEPOT, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

const FAUX_MOTEUR = path.join(TMP, 'faux-claude.sh');
fs.writeFileSync(FAUX_MOTEUR, `#!/bin/sh\ncat >/dev/null &\nsleep ${DUREE_MOTEUR_S}\nexit 0\n`);
fs.chmodSync(FAUX_MOTEUR, 0o755);

const demons = [];

function lancerDemon(port, nom) {
  const data = path.join(TMP, `data-${nom}`);
  const projets = path.join(TMP, `projets-${nom}`);
  for (const dossier of [data, projets]) fs.mkdirSync(dossier, { recursive: true });
  const processus = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
    env: {
      ...process.env,
      HAIKODEV_PORT: String(port),
      HAIKODEV_HOST: '127.0.0.1',
      HAIKODEV_DATA: data,
      HAIKODEV_PROJECTS_ROOT: projets,
      HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
      HAIKODEV_CLAUDE_BIN: FAUX_MOTEUR,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const journal = [];
  processus.stdout.on('data', (d) => journal.push(String(d)));
  processus.stderr.on('data', (d) => journal.push(String(d)));
  const etat = { processus, journal, data, port, sorti: false, jeton: crypto.randomBytes(32).toString('hex') };
  processus.on('exit', () => (etat.sorti = true));
  demons.push(etat);
  return etat;
}

function nettoyer() {
  for (const demon of demons) {
    try {
      demon.processus.kill('SIGKILL');
    } catch {
      /* déjà parti */
    }
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.on('exit', nettoyer);

async function attendrePort(port, limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(port, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await dormir(500);
  }
  return false;
}

async function attendre(condition, limiteMs = 15000, pasMs = 300) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await dormir(pasMs);
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const PROJET_ID = 'p-essai';
const AGENT_ID = 'ag-essai';

function poserLeDecor(demon) {
  const db = new Database(path.join(demon.data, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(demon.jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification signal d’arrêt',
  );

  const projet = {
    id: PROJET_ID,
    name: 'Essai signal d’arrêt',
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
    title: 'Conversation d’essai',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(agent.id, PROJET_ID, null, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);

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
    maintenant,
  );

  db.close();
}

function commande(demon, cmd) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${demon.port}/ws`, {
      headers: { Cookie: `haikodev_session=${demon.jeton}` },
    });
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

async function main() {
  /* -------- 1. Au repos, le serveur reste arrêtable -------- */

  const auRepos = lancerDemon(PORT_LIBRE, 'repos');
  if (!(await attendrePort(PORT_LIBRE))) {
    console.error('Le démon d’essai (repos) n’a pas démarré :\n' + auRepos.journal.join(''));
    process.exit(1);
  }
  auRepos.processus.kill('SIGTERM');
  noter(
    'sans rien en vol, un SIGTERM arrête bien le serveur',
    await attendre(() => auRepos.sorti, 15000, 300),
  );

  /* -------- 2. Un agent au travail : le signal est retenu -------- */

  const occupe = lancerDemon(PORT_OCCUPE, 'occupe');
  if (!(await attendrePort(PORT_OCCUPE))) {
    console.error('Le démon d’essai (occupé) n’a pas démarré :\n' + occupe.journal.join(''));
    process.exit(1);
  }
  poserLeDecor(occupe);

  const envoi = await commande(occupe, { type: 'agent.prompt', agentId: AGENT_ID, text: 'dis bonjour' });
  noter('la demande part sans erreur', envoi.ok !== false, JSON.stringify(envoi));

  const enTravail = await attendre(async () => {
    const etat = await commande(occupe, { type: 'daemon.status' });
    return (etat.data?.etat?.agentsEnCours ?? 0) > 0;
  });
  noter('le démon voit un agent réellement au travail', enTravail);

  /* Le geste exact du 14/08/2026 : le même signal, trois fois de suite. */
  for (let essai = 1; essai <= 3; essai += 1) {
    occupe.processus.kill('SIGTERM');
    await dormir(1500);
    noter(`le signal d’arrêt n° ${essai} ne coupe PAS le serveur`, !occupe.sorti);
  }

  const etatApres = occupe.sorti ? null : await commande(occupe, { type: 'daemon.status' }).catch(() => null);
  noter(
    'le démon annonce un redémarrage en attente',
    etatApres?.data?.etat?.redemarrageEnAttente === true,
    JSON.stringify(etatApres?.data?.etat ?? {}),
  );

  /* -------- 3. Le nom du processus n'appelle plus le pkill -------- */

  let vises = '';
  try {
    vises = String(exec('pgrep', ['-f', 'server/dist/main.js'], { encoding: 'utf8' }));
  } catch {
    vises = ''; // pgrep sort en 1 quand il ne trouve rien : c'est le bon cas.
  }
  const pids = vises.split('\n').map((l) => l.trim()).filter(Boolean);
  noter(
    'un pkill visant « server/dist/main.js » ne retrouve plus le démon',
    !pids.includes(String(occupe.processus.pid)),
    pids.length ? `processus trouvés : ${pids.join(', ')}` : 'aucun processus trouvé',
  );

  /* -------- 4. La tâche finie, l'arrêt retenu part tout seul -------- */

  noter(
    'dès la fin de la tâche, l’arrêt retenu part TOUT SEUL',
    await attendre(() => occupe.sorti, DUREE_MOTEUR_S * 1000 + 20000, 400),
  );

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(occupe.journal.join('').slice(-2000));
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  for (const demon of demons) console.error(demon.journal.join('').slice(-1500));
  process.exit(1);
});
