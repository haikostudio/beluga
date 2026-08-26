#!/usr/bin/env node
/**
 * L'ASSISTANT VOCAL GLOBAL : où va la phrase dictée ?
 *
 * Cinq choses vérifiées sur un vrai démon :
 *   1. une phrase qui NOMME un projet ouvre une carte de cadrage dans CE
 *      projet, et le tour part ;
 *   2. une phrase VAGUE ne dépose rien : elle pose une question, qui compte
 *      comme décision attendue (l'événement « attention » part) ;
 *   3. la réponse cochée à l'écran fait partir la demande d'ORIGINE dans le
 *      projet choisi — et non un tour dans la conversation qui l'affichait ;
 *   4. la réponse peut être DICTÉE : la phrase suivante est lue comme la
 *      réponse tant que la question est fraîche ;
 *   5. un nom de projet sans action fait demander quoi faire, et la réponse
 *      devient la demande.
 *
 *   node scripts/verif-assistant-vocal.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve, un
 * dossier de projets vide et un dossier personnel vide : AUCUN compte de moteur
 * n'est donc trouvé, aucun quota n'est dépensé, et le démon de production n'est
 * pas touché. Le tour part quand même : il s'arrête sur « aucun compte
 * disponible », ce qui prouve que la demande est bien allée jusqu'au moteur.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* La racine est celle d'où PART le script : lancé depuis une copie de travail,
 * il doit juger ce code-là, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { WebSocket } = require('ws');

const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7203);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-assistant-vocal-'));

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
const MAISON = path.join(TMP, 'maison');
const BOUTIQUE = path.join(TMP, 'boutique');
const PORTAIL = path.join(TMP, 'portail');
for (const dossier of [DATA, PROJETS, MAISON, BOUTIQUE, PORTAIL]) {
  fs.mkdirSync(dossier, { recursive: true });
}

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HAIKODEV_PORT: String(PORT),
    HAIKODEV_HOST: '127.0.0.1',
    HAIKODEV_DATA: DATA,
    HAIKODEV_PROJECTS_ROOT: PROJETS,
    HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
    // Dossier personnel vide : aucun compte de moteur, donc aucun quota dépensé.
    HOME: MAISON,
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

async function attendrePort() {
  for (let essai = 0; essai < 120; essai++) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => {
        prise.end();
        resolve(true);
      });
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le décor : deux projets, une session                                 */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJETS_ESSAI = [
  { id: 'p-boutique', name: 'Boutique Lumière', path: BOUTIQUE, rank: 1 },
  { id: 'p-portail', name: 'Portail Interne', path: PORTAIL, rank: 2 },
];

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification assistant vocal',
  );

  db.prepare('DELETE FROM projects').run();
  for (const projet of PROJETS_ESSAI) {
    const data = {
      id: projet.id,
      name: projet.name,
      path: projet.path,
      defaultEngine: 'claude',
      isSelf: false,
      rank: projet.rank,
      archived: false,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(projet.id, projet.name, projet.path, JSON.stringify(data), maintenant, maintenant);
  }
  db.close();
}

/* ------------------------------------------------------------------ */
/* Un client WebSocket minuscule                                       */
/* ------------------------------------------------------------------ */

function connecter() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws`, {
      headers: { Cookie: `haikodev_session=${jeton}` },
    });
    const attentes = new Map();
    const evenements = [];
    ws.on('message', (raw) => {
      let evenement;
      try {
        evenement = JSON.parse(raw.toString());
      } catch {
        return;
      }
      evenements.push(evenement);
      if (evenement.type === 'ack' && attentes.has(evenement.id)) {
        attentes.get(evenement.id)(evenement);
        attentes.delete(evenement.id);
      }
    });
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        evenements,
        appeler(cmd, delai = 20000) {
          const id = crypto.randomUUID();
          return new Promise((ok, ko) => {
            const minuterie = setTimeout(() => ko(new Error(`pas de réponse à ${cmd.type}`)), delai);
            attentes.set(id, (evenement) => {
              clearTimeout(minuterie);
              evenement.ok ? ok(evenement.data ?? {}) : ko(new Error(evenement.error));
            });
            ws.send(JSON.stringify({ id, cmd }));
          });
        },
        fermer: () => ws.close(),
      }),
    );
  });
}

/* ------------------------------------------------------------------ */
/* Lire ce que le démon a écrit                                        */
/* ------------------------------------------------------------------ */

function lireBase() {
  return new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
}

/** Les messages d'un projet, du plus ancien au plus récent. */
function messagesDuProjet(projectId) {
  const db = lireBase();
  const lignes = db
    .prepare(
      `SELECT m.role AS role, m.data AS data FROM messages m
       JOIN agents a ON a.id = m.agent_id
       WHERE a.project_id = ? AND a.role = 'cadrage'
       ORDER BY m.created_at ASC`,
    )
    .all(projectId);
  db.close();
  return lignes.map((ligne) => ({ role: ligne.role, ...JSON.parse(ligne.data) }));
}

/** La dernière question posée, tous projets confondus. */
function derniereQuestion() {
  const db = lireBase();
  const ligne = db
    .prepare(
      `SELECT d.question_id AS questionId, d.message_id AS messageId, d.project_id AS projectId,
              d.reglee_a AS regleeA, a.project_id AS lieu
       FROM dictees d JOIN agents a ON a.id = d.agent_id
       ORDER BY d.created_at DESC LIMIT 1`,
    )
    .get();
  db.close();
  return ligne ?? null;
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/** Attend qu'une demande soit déposée dans le chef d'un projet. */
async function attendreDepot(projectId, extrait, secondes = 20) {
  for (let essai = 0; essai < secondes * 4; essai++) {
    const trouve = messagesDuProjet(projectId).some(
      (message) => message.role === 'user' && message.content.includes(extrait),
    );
    if (trouve) return true;
    await attendre(250);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* L'essai                                                             */
/* ------------------------------------------------------------------ */

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const client = await connecter();
  await attendre(1000);

  /* ---------- 1. Un projet nommé reçoit la demande ---------- */

  const nomme = await client.appeler({
    type: 'voix.demande',
    texte: 'sur Boutique Lumière, ajoute un bouton de partage en bas de page',
  });
  noter(
    'une phrase qui nomme un projet part chez LUI',
    nomme.projectId === 'p-boutique' && nomme.motif === 'nom-cite',
    JSON.stringify(nomme),
  );
  noter(
    'le fil de la carte de cadrage montre la phrase telle qu’elle a été comprise',
    await attendreDepot('p-boutique', 'bouton de partage'),
  );
  const suiteBoutique = messagesDuProjet('p-boutique');
  noter(
    'le tour est bien parti (il s’arrête faute de compte, aucun quota dépensé)',
    suiteBoutique.some((m) => m.role === 'assistant' && (m.error === 'quota' || m.steps?.length)),
  );
  noter(
    'rien n’est déposé chez l’autre projet',
    !messagesDuProjet('p-portail').some((m) => m.role === 'user'),
  );

  /* ---------- 2. Une phrase vague pose la question ---------- */

  const avant = client.evenements.length;
  const vague = await client.appeler({
    type: 'voix.demande',
    texte: 'il faudrait revoir le menu de navigation, il est illisible',
  });
  noter(
    'une phrase vague ne dépose rien : elle demande',
    !vague.projectId && Boolean(vague.question) && vague.motif === 'aucun-nom',
    JSON.stringify(vague),
  );
  await attendre(500);
  const attention = client.evenements
    .slice(avant)
    .filter((evenement) => evenement.type === 'attention')
    .pop();
  const total = attention
    ? Object.values(attention.byProject).reduce((somme, n) => somme + n, 0)
    : 0;
  noter(
    'la question compte comme décision attendue (triangle orange, annonce vocale)',
    total >= 1,
    `décisions annoncées : ${total}`,
  );

  /* ---------- 3. La réponse cochée route la demande d'origine ---------- */

  const question = derniereQuestion();
  noter('la dictée attend sa réponse en base', Boolean(question) && !question.regleeA);
  await client.appeler({
    type: 'question.answer',
    messageId: question.messageId,
    questionId: question.questionId,
    answer: 'Portail Interne',
  });
  noter(
    'la réponse fait partir la demande d’ORIGINE dans le projet choisi',
    await attendreDepot('p-portail', 'menu de navigation'),
  );

  /* ---------- 4. La réponse peut être dictée ---------- */

  const vague2 = await client.appeler({
    type: 'voix.demande',
    texte: 'ajoute une page de contact avec un formulaire',
  });
  noter('deuxième phrase vague : question posée', Boolean(vague2.question));
  const parLaVoix = await client.appeler({ type: 'voix.demande', texte: 'c’est pour Boutique Lumière' });
  noter(
    'la phrase suivante est lue comme la RÉPONSE, pas comme une nouvelle demande',
    parLaVoix.projectId === 'p-boutique' && parLaVoix.motif === 'projet-donne',
    JSON.stringify(parLaVoix),
  );
  noter(
    'la demande mise en attente part alors chez le projet nommé',
    await attendreDepot('p-boutique', 'page de contact'),
  );
  const reglee = derniereQuestion();
  noter('la question répondue à la voix ne réclame plus rien', Boolean(reglee?.regleeA));

  /* ---------- 5. Un projet clair mais aucune action ---------- */

  const seul = await client.appeler({ type: 'voix.demande', texte: 'Portail Interne' });
  noter(
    'un nom de projet sans action fait demander quoi faire',
    !seul.projectId && seul.motif === 'action-floue' && seul.lieu === 'p-portail',
    JSON.stringify(seul),
  );
  const questionAction = derniereQuestion();
  noter(
    'la question se pose dans le projet déjà retenu',
    questionAction?.lieu === 'p-portail' && questionAction?.projectId === 'p-portail',
  );
  await client.appeler({
    type: 'question.answer',
    messageId: questionAction.messageId,
    questionId: questionAction.questionId,
    answer: 'mets à jour la page des mentions légales',
  });
  noter(
    'la réponse devient la demande, déposée chez le projet retenu',
    await attendreDepot('p-portail', 'mentions légales'),
  );

  client.fermer();

  /* ---------- Verdict ---------- */

  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
  if (rates.length) {
    console.log('Journal du démon :\n' + journal.join('').slice(-3000));
    process.exit(1);
  }
  // Le démon d'essai tourne encore : sans cette sortie explicite, le script
  // attendrait indéfiniment que son enfant s'arrête.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.join('').slice(-3000));
  process.exit(1);
});
