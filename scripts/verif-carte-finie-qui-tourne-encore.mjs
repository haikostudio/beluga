#!/usr/bin/env node
/**
 * UNE CARTE FINIE NE PEUT PLUS TOURNER ENCORE.
 *
 *   node scripts/verif-carte-finie-qui-tourne-encore.mjs
 *
 * LE CAS RÉEL DU 09.09.2026. Une carte affichait son compte rendu, validé et
 * lu, et le témoin « Réflexion en cours » tournait pourtant depuis 47 minutes.
 * L'agent de tâche travaillait SUR les fiches de sauvegarde ; en appelant
 * l'outil il était devenu le « fil d'assistant » de la fiche (`assistantId` =
 * l'agent appelant), et en retirant ensuite la fiche en double — le travail
 * même qu'on lui avait demandé — la suppression en cascade a effacé SON PROPRE
 * enregistrement et tous ses messages, en plein tour. Dès lors :
 *
 *   - la fermeture du tour ne trouvait plus d'agent et rendait « false » ;
 *   - la veille des tours bloqués part de la table des agents : elle était
 *     aveugle ;
 *   - AUCUN événement ne disait la suppression, donc le navigateur gardait sa
 *     copie « au travail » — seul un rechargement effaçait le fantôme.
 *
 * Ce script monte son PROPRE démon, sur un port libre et une base neuve, et
 * exige quatre choses, sans jamais payer un tour de moteur :
 *
 *   1. Retirer une fiche n'efface plus l'agent de tâche qui l'avait posée.
 *   2. Un assistant réellement jetable part toujours avec sa fiche.
 *   3. Ce retrait est DIFFUSÉ sur le canal ouvert (`agent.delete`), pour que
 *      l'écran ne garde jamais un agent qui n'existe plus.
 *   4. Le filet d'écran : un compte rendu rendu depuis plus que le plafond de
 *      rangement éteint le témoin, alors qu'un rangement en cours le garde.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur : lancé depuis une
   copie de travail, il doit juger le code de CETTE copie. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ws = require('ws');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7207);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-carte-finie-'));

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
const FICHIERS = path.join(TMP, 'fichiers');
for (const dossier of [DATA, PROJETS, FICHIERS]) fs.mkdirSync(dossier, { recursive: true });

let demon = null;
const journal = [];

function lancerLeDemon() {
  demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
    env: {
      ...process.env,
      BELUGA_PORT: String(PORT),
      BELUGA_HOST: '127.0.0.1',
      BELUGA_DATA: DATA,
      BELUGA_PROJECTS_ROOT: PROJETS,
      BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
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

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const joignable = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (joignable) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le décor : le défaut exact, tel qu'il a été constaté                 */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-carte-finie';
/** L'agent du cas réel : de tâche, rattaché à sa carte, en plein tour. */
const AGENT_DE_TACHE = 'a-de-tache';
/** Un assistant de fiche, celui-là réellement jetable. */
const ASSISTANT = 'a-assistant';

const base = (options = {}) => new Database(path.join(DATA, 'beluga.db'), options);

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification carte finie qui tourne encore',
  );

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai carte finie',
    path: PROJETS,
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

  // La carte, en travail, et son agent de tâche : tour vivant depuis 47
  // minutes, compte rendu rendu il y a 21 minutes.
  const carte = {
    id: 'c-du-cas-reel',
    projectId: PROJET_ID,
    title: 'Vérifier les sauvegardes',
    description: '',
    labels: [],
    column: 'running',
    position: 1,
    origin: 'user',
    attachments: [],
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    agentId: AGENT_DE_TACHE,
    createdAt: maintenant - 47 * 60_000,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    carte.id,
    carte.projectId,
    carte.column,
    carte.position,
    carte.title,
    JSON.stringify(carte),
    carte.createdAt,
    carte.updatedAt,
    AGENT_DE_TACHE,
  );

  const poserAgent = (agent, cardId) =>
    db
      .prepare(
        `INSERT INTO agents (id, project_id, card_id, role, status, session_id, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
      )
      .run(agent.id, PROJET_ID, cardId, agent.role, agent.status, JSON.stringify(agent), agent.createdAt, agent.updatedAt);

  poserAgent(
    {
      id: AGENT_DE_TACHE,
      projectId: PROJET_ID,
      cardId: carte.id,
      role: 'task',
      title: 'Agent de tâche',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status: 'running',
      tourVivantDepuis: maintenant - 47 * 60_000,
      startedAt: maintenant - 47 * 60_000,
      createdAt: maintenant - 47 * 60_000,
      updatedAt: maintenant,
    },
    carte.id,
  );
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'm-compte-rendu',
    AGENT_DE_TACHE,
    'assistant',
    JSON.stringify({
      id: 'm-compte-rendu',
      agentId: AGENT_DE_TACHE,
      role: 'assistant',
      content: '## 1. Ce qui est fait\n\nLes sauvegardes sont corrigées.',
      steps: [],
      todos: [],
      proposals: [],
      questions: [],
      downloads: [],
      attachments: [],
      streaming: false,
      plan: false,
      createdAt: maintenant - 21 * 60_000,
    }),
    maintenant - 21 * 60_000,
  );

  poserAgent(
    {
      id: ASSISTANT,
      projectId: PROJET_ID,
      role: 'analysis',
      title: 'Assistant de sauvegarde',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status: 'done',
      startedAt: maintenant - 3600_000,
      endedAt: maintenant - 3000_000,
      createdAt: maintenant - 3600_000,
      updatedAt: maintenant - 3000_000,
    },
    null,
  );

  // Les deux fiches de sauvegarde : chacune garde le fil de « l'assistant » qui
  // l'a posée — pour la première, c'est l'agent de tâche lui-même.
  const fiche = (id, assistantId) => ({
    id,
    nom: `Fiche ${id}`,
    projectId: PROJET_ID,
    actif: true,
    base: { moteur: 'aucune', hote: '', port: '', nom: '', utilisateur: '', motDePasse: '' },
    fichiers: { moyen: 'local', chemin: FICHIERS, hote: '', port: '', utilisateur: '', motDePasse: '' },
    conservationJours: 30,
    frequenceMinutes: 1440,
    note: '',
    assistantId,
    assistantProjectId: PROJET_ID,
    relueLe: 0,
    creeLe: maintenant,
    modifieLe: maintenant,
  });
  for (const f of [fiche('f-en-double', AGENT_DE_TACHE), fiche('f-assistant', ASSISTANT)]) {
    db.prepare(
      `INSERT INTO backup_sites (id, project_id, nom, actif, data, cree_le, modifie_le)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
    ).run(f.id, PROJET_ID, f.nom, JSON.stringify(f), f.creeLe, f.modifieLe);
  }

  db.close();
}

const agentEnBase = (id) => {
  const db = base({ readonly: true });
  const ligne = db.prepare('SELECT data FROM agents WHERE id = ?').get(id);
  db.close();
  return ligne ? JSON.parse(ligne.data) : null;
};

const messagesEnBase = (id) => {
  const db = base({ readonly: true });
  const n = db.prepare('SELECT count(*) AS n FROM messages WHERE agent_id = ?').get(id).n;
  db.close();
  return n;
};

/**
 * Un onglet resté ouvert : on écoute ce que le démon diffuse tout seul pendant
 * qu'on retire les fiches par l'interface HTTP.
 */
function ouvrirLeCanal() {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: `beluga_session=${jeton}` },
    });
    const recus = [];
    const attentes = new Map();
    prise.on('message', (brut) => {
      const event = JSON.parse(String(brut));
      recus.push(event);
      const attente = event.id ? attentes.get(event.id) : undefined;
      if (attente) {
        attentes.delete(event.id);
        attente(event);
      }
    });
    prise.on('error', reject);
    prise.on('open', () =>
      resolve({
        recus,
        fermer: () => prise.close(),
        /* Une commande, telle que l'interface l'envoie, et sa réponse. */
        envoyer: (cmd) =>
          new Promise((repondre, rater) => {
            const id = crypto.randomUUID();
            attentes.set(id, repondre);
            setTimeout(() => rater(new Error(`aucune réponse à ${cmd.type}`)), 15_000);
            prise.send(JSON.stringify({ id, cmd }));
          }),
      }),
    );
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

  noter('le décor part bien du cas : un agent de tâche en plein tour', agentEnBase(AGENT_DE_TACHE)?.status === 'running');

  const canal = await ouvrirLeCanal();

  /* --- 1. La cause : la fiche part, l'agent de tâche reste --- */
  const retrait = await canal.envoyer({ type: 'backups.supprimerSite', id: 'f-en-double' });
  noter('la fiche en double est bien retirée', retrait.type !== 'error', JSON.stringify(retrait.error ?? ''));
  noter("l'agent de tâche survit au retrait de la fiche qu'il avait posée", agentEnBase(AGENT_DE_TACHE) !== null);
  noter('son tour vit toujours : rien ne lui a été volé', agentEnBase(AGENT_DE_TACHE)?.tourVivantDepuis !== undefined);
  noter('ses messages sont intacts : la conversation n’est pas vidée', messagesEnBase(AGENT_DE_TACHE) === 1);

  /* --- 2 et 3. L'assistant jetable part, ET sa disparition se dit --- */
  await canal.envoyer({ type: 'backups.supprimerSite', id: 'f-assistant' });
  await new Promise((r) => setTimeout(r, 1000));
  canal.fermer();

  noter('un assistant réellement jetable part avec sa fiche, comme avant', agentEnBase(ASSISTANT) === null);
  const disparitions = canal.recus.filter((e) => e.type === 'agent.delete').map((e) => e.id);
  noter(
    'la disparition de cet assistant est DITE à l’écran : plus aucun agent fantôme',
    disparitions.includes(ASSISTANT),
    `reçus : ${JSON.stringify(disparitions)}`,
  );
  noter(
    'et l’agent de tâche, lui, n’est jamais annoncé disparu',
    !disparitions.includes(AGENT_DE_TACHE),
  );

  /* --- 4. Le filet d'écran, sur la règle même que lit l'interface --- */
  const { temoinDeTravail, PLAFOND_FERMETURE_MS } = await import(
    path.join(RACINE, 'shared', 'dist', 'index.js')
  );
  const maintenant = Date.now();
  noter(
    'un compte rendu rendu depuis 21 min éteint le témoin, quoi que dise l’agent',
    temoinDeTravail({
      statut: 'running',
      tourVivantDepuis: maintenant - 47 * 60_000,
      reponseRendueA: maintenant - 21 * 60_000,
      maintenant,
    }) === false,
  );
  noter(
    'le rangement d’après-réponse garde son témoin : on ne masque aucun travail',
    temoinDeTravail({
      statut: 'done',
      tourVivantDepuis: maintenant - 30 * 60_000,
      reponseRendueA: maintenant - 2 * 60_000,
      maintenant,
    }) === true && PLAFOND_FERMETURE_MS > 2 * 60_000,
  );
  noter(
    'le compte rendu du tour PRÉCÉDENT n’éteint jamais le tour qui démarre',
    temoinDeTravail({
      statut: 'running',
      tourVivantDepuis: maintenant - 5_000,
      reponseRendueA: maintenant - 24 * 3600_000,
      maintenant,
    }) === true,
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
