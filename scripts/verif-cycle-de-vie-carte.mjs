#!/usr/bin/env node
/**
 * LE CYCLE DE VIE D'UNE CARTE, REJOUÉ PLUSIEURS FOIS DE SUITE.
 *
 *   npm run build && node scripts/verif-cycle-de-vie-carte.mjs
 *
 * Chaque pièce du parcours a déjà son contrôle (lancement, listes de tâches,
 * arrêt, carte interrompue, carte oubliée). Ce qu'aucun ne regardait, c'est le
 * TOUR COMPLET, ENCHAÎNÉ : « Planifié » → lancement → « En cours » → rapport
 * rendu → « À déployer » (directement, « Terminé » a disparu), puis un
 * nouveau message qui doit REMETTRE la carte en « En cours » et refaire
 * exactement le même chemin — trois fois d'affilée, sans que rien ne se
 * décale.
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un FAUX MOTEUR (un vrai processus, aucun jeton dépensé) qui annonce une liste
 * de tâches, écrit un fichier dans la copie de travail, puis rend sa réponse.
 *
 * Ce qui est vérifié, sans navigateur (le canal temps réel et la base suffisent) :
 *   1. LE LANCEMENT — la carte passe en « En cours », un agent de tâche existe,
 *      la branche de la carte est notée, et sa ligne de temps dit une
 *      PRÉPARATION : entre le clic et le premier mot du moteur, aucun point ne
 *      prétend que le travail est fait ni que le compte rendu est rendu ;
 *   2. LA FIN DE TOUR — la carte arrive en « À déployer », sa marque de vol
 *      est éteinte, sa liste de tâches est refermée et son décompte est
 *      d'accord avec elle ;
 *   3. TROIS ALLERS-RETOURS — chaque nouveau message repose la carte en
 *      « En cours » puis la ramène en « À déployer », avec un agent unique ;
 *   4. UN TOUR TOMBÉ — la carte RESTE en « En cours » (c'est la règle) et le
 *      balayage de l'ordonnanceur ne la ramasse pas ; elle DIT alors qu'elle
 *      attend une relance, et ne promet plus de rangement automatique ;
 *   5. LA RELANCE APRÈS ÉCHEC — un message de plus suffit à la ramener au
 *      bout du cycle, sans geste de rattrapage ;
 *   6. UN MOTEUR QUI N'A JAMAIS PARLÉ — l'adaptateur le DIT (signal explicite,
 *      plus un faisceau d'absences) : la carte retombe en « Planifié », son
 *      compteur de reprises monte, et l'ordonnanceur la relance tout seul ;
 *   7. LE BOUTON D'ARRÊT — la carte retombe en « Planifié », suspendue, et
 *      RIEN ne la relance sans un geste : le tableau ne montre plus une tâche
 *      « en cours » que plus personne ne fait ;
 *   8. LE LANCEMENT REFUSÉ FAUTE DE QUOTA — la reprise armée par le refus est
 *      rejouée par l'ordonnanceur, sans second clic ;
 *   9. LA RELANCE APRÈS ERREUR — un tour coupé sur une liste 7/8, un clic
 *      « Relancer », et le nouveau tour repart AVEC les sept étapes faites et
 *      la huitième restante : jamais une liste vide ;
 *  12. LA RELANCE APRÈS RAPPORT — un message sous le rapport part au cadrage
 *      et la carte passe AUSSITÔT en « Demande » ; si le cadrage n'a fait que
 *      répondre, elle revient seule dans « À déployer » (deux fois de suite) ;
 *      s'il a cadré un nouveau travail, elle reste en « Demande », d'où elle
 *      ne repart pas toute seule ;
 *  13. LE DÉPART PROGRAMMÉ D'UNE CARTE CADRÉE SANS PLAN — datée mais jamais
 *      validée, elle reste en « Demande » ; validée, elle part TOUTE SEULE à
 *      l'heure dite, par la vraie boucle de l'ordonnanceur, et sa date est
 *      consommée (`carteLibreDePartirSeule`, `shared/src/parcours-carte.ts`).
 */
import { colonnesDeLaCarte } from '../shared/dist/carte-sql.js';
import { chapitreDuParcours } from '../shared/dist/parcours-carte.js';
import { PHRASES_DU_POINT, pointsDuParcours } from '../shared/dist/parcours-en-points.js';
import { travailRestant, phraseDuTravailRestant } from '../shared/dist/travail-restant.js';
import Database from 'better-sqlite3';
import { poserSessionDEssai } from './lib/session-d-essai.mjs';
import * as ws from 'ws';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_CYCLE_PORT || 7203);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-cycle-carte-'));
/** Le nombre d'allers-retours à enchaîner après le premier lancement. */
const ALLERS_RETOURS = 3;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor : un vrai dépôt git, un faux moteur                        */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
execFileSync('git', ['config', 'user.email', 'essai@local'], { cwd: DEPOT });
execFileSync('git', ['config', 'user.name', 'essai'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['commit', '-qm', 'départ'], { cwd: DEPOT });

/*
 * LE FAUX MOTEUR REJOUE UN VRAI TOUR DE TÂCHE : il annonce sa liste, la coche,
 * ÉCRIT UN FICHIER dans sa copie de travail (sans quoi le démon constaterait
 * « aucun fichier n'a changé », qui est un autre cas), l'enregistre sur la
 * branche de la carte, puis rend sa réponse. Une demande qui contient « tombe »
 * le fait mourir en pleine liste, sans réponse.
 */
const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
let demande = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (demande += d));
process.stdin.on('end', () => jouer());
setTimeout(() => process.stdin.readable && process.stdin.read(), 50);

const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');

/*
 * LE PONT D'OUTILS, COMME UN VRAI MOTEUR L'OUVRE. Sans lui, ce faux moteur
 * travaillait dans un monde où les outils du projet n'arrivaient JAMAIS : le
 * démon posait son étape rouge à chaque tour, et la règle qui rejoue un tour
 * privé de ses outils ne pouvait pas être éprouvée ici. On rejoue donc les deux
 * seuls gestes qui prouvent le pont : la poignée de main, puis la demande de la
 * liste d'outils.
 *
 * « ZZSANSOUTILS » saute exactement ces deux gestes — c'est la panne qu'on veut
 * mettre à l'épreuve.
 */
let pontOuvert = null;
process.on('exit', () => {
  try {
    pontOuvert?.kill();
  } catch {
    /* déjà parti */
  }
});

async function ouvrirLePont(sansOutils) {
  if (sansOutils) return null;
  const i = process.argv.indexOf('--mcp-config');
  if (i < 0) return null;
  let config;
  try {
    config = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
  } catch {
    return null;
  }
  const serveur = config?.mcpServers?.beluga;
  if (!serveur?.command) return null;
  const pont = spawn(serveur.command, serveur.args ?? [], {
    env: { ...process.env, ...(serveur.env ?? {}) },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  pont.stdout.setEncoding('utf8');
  const attendre = (id) =>
    new Promise((resolve) => {
      let tampon = '';
      const lire = (bout) => {
        tampon += bout;
        for (const ligne of tampon.split('\\n')) {
          if (!ligne.trim()) continue;
          try {
            const rep = JSON.parse(ligne);
            if (rep.id === id) {
              pont.stdout.off('data', lire);
              resolve(rep);
              return;
            }
          } catch {
            /* ligne incomplète : on attend la suite */
          }
        }
      };
      pont.stdout.on('data', lire);
      setTimeout(() => {
        pont.stdout.off('data', lire);
        resolve(null);
      }, 5000);
    });
  const demander = (id, method, params) => {
    pont.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n');
    return attendre(id);
  };
  await demander(1, 'initialize', { protocolVersion: '2024-11-05' });
  await demander(2, 'tools/list', {});
  return pont;
}
const liste = (derniere) => ({
  type: 'assistant',
  message: {
    content: [
      {
        type: 'tool_use',
        id: 'tu-' + Math.random().toString(16).slice(2),
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'Lire le code', status: 'completed' },
            { content: 'Écrire le correctif', status: derniere },
          ],
        },
      },
    ],
  },
});

async function jouer() {
  /*
   * « ZZDODO » : le moteur se tait quelques secondes AVANT d'ouvrir la bouche.
   * C'est la fenêtre pendant laquelle on peut lire ce que le DÉMON a posé sur
   * le message du tour — notamment la liste de tâches reprise d'un tour coupé,
   * avant que le moteur ne renvoie la sienne par-dessus.
   */
  if (/zzdodo/.test(demande)) {
    await new Promise((r) => setTimeout(r, 8000));
  }

  /*
   * « ZZMUET » : le moteur meurt sans écrire UNE SEULE ligne de protocole.
   * C'est exactement le cas que l'adaptateur doit signaler de lui-même
   * (jamaisDemarre), et non plus le démon le deviner à l'absence d'étapes.
   */
  if (/zzmuet/.test(demande)) {
    process.stderr.write('command not found\\n');
    process.exit(127);
  }

  // Un vrai moteur ouvre son pont d'outils avant de parler. « zzsansoutils »
  // est le seul cas où il ne le fait pas.
  pontOuvert = await ouvrirLePont(/zzsansoutils/.test(demande));

  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });

  /*
   * « ZZSEPT » : une VRAIE liste de travail — huit lignes, sept faites, la
   * huitième en cours —, puis le tour meurt. C'est l'avancement qu'une relance
   * après erreur doit retrouver, au lieu de repartir sur une liste vide.
   */
  if (/zzsept/.test(demande)) {
    dire({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu-sept',
            name: 'TodoWrite',
            input: {
              todos: [
                ...Array.from({ length: 7 }, (_, i) => ({
                  content: 'Étape déjà faite numéro ' + (i + 1),
                  status: 'completed',
                })),
                { content: 'Dernière étape, celle du zzdodo', status: 'in_progress' },
              ],
            },
          },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 300));
    process.stderr.write('API Error: fatal\\n');
    process.exit(1);
  }

  dire(liste('in_progress'));
  await new Promise((r) => setTimeout(r, 300));

  // « zzlong » : le moteur reste en vie assez longtemps pour qu'on l'arrête.
  if (/zzlong/.test(demande)) {
    await new Promise((r) => setTimeout(r, 120000));
  }

  if (/tombe/.test(demande)) {
    process.stderr.write('API Error: fatal\\n');
    process.exit(1);
  }

  // « zzrien » : un rapport rendu SANS AUCUNE modification (section 15).
  if (/zzrien/.test(demande)) {
    dire(liste('completed'));
    dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Vérifié : rien à changer.' }] } });
    dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 10, output_tokens: 5 } });
    process.exit(0);
  }

  // Un vrai travail : un fichier écrit puis enregistré sur la branche de la carte.
  const nom = 'travail-' + Date.now() + '.txt';
  fs.writeFileSync(nom, 'fait\\n');
  try {
    execFileSync('git', ['add', nom], { cwd: process.cwd() });
    execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'travail'], {
      cwd: process.cwd(),
    });
  } catch {
    /* le dossier n'est pas un dépôt : le fichier suffit au constat */
  }

  dire(liste('completed'));
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Travail rendu, tout est en place.' }] } });
  dire({
    type: 'result',
    subtype: 'success',
    session_id: 'session-essai',
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

/* ------------------------------------------------------------------ */
/* Le démon                                                            */
/* ------------------------------------------------------------------ */

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
      BELUGA_CLAUDE_BIN: FAUX_MOTEUR,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  demon.stdout.on('data', (d) => journal.push(String(d)));
  demon.stderr.on('data', (d) => journal.push(String(d)));
}

function nettoyer() {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.on('exit', nettoyer);

async function attendrePort(limiteMs = 60000) {
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

async function attendre(condition, limiteMs = 60000, pasMs = 300) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const vu = await condition();
    if (vu) return vu;
    await new Promise((r) => setTimeout(r, pasMs));
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* La base                                                             */
/* ------------------------------------------------------------------ */

/** Le cookie de la session d'essai, posé par `poserLeDecor` (jeton haché en base). */
let jeton = '';
const PROJET = 'p-cycle';
const CARTE = 'c-cycle';
/** La suite d'étapes de la section 14 : une carte globale, trois étapes (`shared/src/suite-de-cartes.ts`). */
const SUITE = 'c-suite';
const ETAPES = ['c-suite-1', 'c-suite-2', 'c-suite-3'];
/** La carte de la section 15 : un rapport rendu sans aucune modification. */
const SANS_CODE = 'c-sans-code';

const base = (readonly = false) =>
  new Database(path.join(DATA, 'beluga.db'), readonly ? { readonly: true } : undefined);

/** La carte telle qu'elle est enregistrée, relue à chaque question. */
function laCarte() {
  const db = base(true);
  const ligne = db.prepare('SELECT * FROM cards WHERE id = ?').get(CARTE);
  db.close();
  if (!ligne) return null;
  const reste = ligne.data ? JSON.parse(ligne.data) : {};
  return {
    column: ligne.column_key,
    agentId: ligne.agent_id ?? reste.agentId,
    doneAt: ligne.done_at ?? reste.doneAt,
    sansModification: reste.sansModification,
    scheduling: reste.scheduling ?? {},
    github: reste.github ?? {},
    parcours: reste.parcours ?? {},
  };
}

/**
 * ARMER LA CARTE COMME LE FERAIT UN REFUS DE QUOTA — sans avoir à vider un vrai
 * compte. Le refus lui-même est verrouillé par les tests du démon ; ce qui se
 * vérifie ici, c'est l'autre moitié, celle qui manquait : une carte armée
 * repart-elle TOUTE SEULE, sans second clic ?
 */
function armerLaReprise() {
  const db = base();
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(CARTE);
  const carte = JSON.parse(ligne.data);
  carte.column = 'planned';
  carte.scheduling = {
    ...(carte.scheduling ?? {}),
    // Remis à ZÉRO : sans cela, `attempts > 0` suffirait à la reprise et la
    // marque ne prouverait rien.
    asap: false,
    attempts: 0,
    restarts: 0,
    suspendu: false,
    departPrevu: undefined,
    waitingReason: 'Quota épuisé sur tous les comptes',
    reprendreDesQuePossible: true,
  };
  db.prepare('UPDATE cards SET column_key = ?, data = ? WHERE id = ?').run('planned', JSON.stringify(carte), CARTE);
  db.close();
}

/**
 * POSER LA CARTE EN « RAPPORT », tour refermé — comme au bout d'un travail
 * rendu. La scène précédente peut laisser un tour relancé en route : on part
 * d'un état écrit, pas d'une attente qui dépend du faux moteur.
 */
function poserAuRapport() {
  const db = base();
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(CARTE);
  const carte = JSON.parse(ligne.data);
  carte.column = 'to_deploy';
  carte.doneAt = Date.now();
  carte.scheduling = {
    ...(carte.scheduling ?? {}),
    suspendu: false,
    waitingReason: undefined,
    tourEnVolDepuis: undefined,
    departPrevu: undefined,
    reprendreDesQuePossible: undefined,
  };
  db.prepare('UPDATE cards SET column_key = ?, data = ? WHERE id = ?').run('to_deploy', JSON.stringify(carte), CARTE);
  db.close();
}

/** Les agents de la carte, du plus récent au plus ancien. */
function lesAgents() {
  const db = base(true);
  const lignes = db.prepare('SELECT data FROM agents WHERE card_id = ? ORDER BY updated_at DESC').all(CARTE);
  db.close();
  return lignes.map((l) => JSON.parse(l.data));
}

/** La liste de tâches du dernier message d'un agent. */
function derniereListe(agentId) {
  const db = base(true);
  const ligne = db
    .prepare("SELECT data FROM messages WHERE agent_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1")
    .get(agentId);
  db.close();
  return ligne ? (JSON.parse(ligne.data).todos ?? []) : [];
}

/**
 * Les messages d'un agent qui portent une erreur de tour non tranchée.
 *
 * Il peut y en avoir PLUSIEURS : ce contrôle fait tomber des tours plus tôt
 * dans le parcours sans jamais répondre à leur décision. On les rend donc tous,
 * du plus récent au plus ancien, et l'appelant dit lequel il attend — sans quoi
 * on relancerait un vieux tour en croyant relancer le dernier.
 */
function messagesEnErreur(agentId) {
  const db = base(true);
  const lignes = db
    .prepare("SELECT data FROM messages WHERE agent_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 12")
    .all(agentId);
  db.close();
  return lignes.map((l) => JSON.parse(l.data)).filter((m) => m.erreurDeTour && !m.erreurDeTour.choix);
}

function poserLeDecor() {
  /* La session passe par l'aide commune, AVANT d'ouvrir la base ici : elle
     s'ouvre et se referme d'elle-même. Elle vit dans la base du démon jetable,
     qui disparaît avec son dossier temporaire. */
  jeton = poserSessionDEssai('vérification cycle de vie', { chemin: path.join(DATA, 'beluga.db') }).cookie;
  const db = base();
  const maintenant = Date.now();

  const projet = {
    id: PROJET,
    name: 'Essai cycle de vie',
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
  ).run(PROJET, projet.name, DEPOT, JSON.stringify(projet), maintenant, maintenant);

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

  /*
   * LA CARTE NAÎT DANS « PLANIFIÉ », comme toute carte, et SANS date de départ :
   * rien ne doit partir avant le geste de lancement — c'est la première chose
   * que ce contrôle vérifie.
   */
  const carte = {
    id: CARTE,
    projectId: PROJET,
    column: 'planned',
    position: 1,
    title: 'Carte du cycle complet',
    description: 'Une carte menée du lancement à la clôture, plusieurs fois de suite.',
    origin: 'user',
    labels: [],
    attachments: [],
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    estimate: { machineSeconds: 60, seniorHours: 0.25, confidence: 'medium', failed: false },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  const inserer = (une) => {
    const colonnes = colonnesDeLaCarte(une);
    const noms = Object.keys(colonnes);
    db.prepare(`INSERT INTO cards (${noms.join(', ')}) VALUES (${noms.map(() => '?').join(', ')})`).run(
      ...noms.map((nom) => colonnes[nom]),
    );
  };
  inserer(carte);

  /*
   * LA SUITE D'ÉTAPES DE LA SECTION 14, posée comme la validation d'une
   * proposition à étapes la poserait (`poserLaSuite`) : une carte globale qui
   * ne publie rien, trois étapes groupées dans « Planifié », sans date. Rien
   * ne doit partir avant le lancement de la carte globale.
   */
  inserer({
    ...carte,
    id: SUITE,
    position: 2,
    title: 'Suite en trois étapes',
    description: 'Une carte globale et trois étapes qui partent une à une.',
    estimate: undefined,
    teteDeSuite: true,
    excludedFromDeploy: true,
    cartesFilles: ETAPES.map((cardId) => ({ projectId: PROJET, cardId })),
  });
  ETAPES.forEach((id, index) =>
    inserer({
      ...carte,
      id,
      position: 3 + index,
      title: `Étape ${index + 1} de la suite`,
      description: `L’étape ${index + 1} de la suite.`,
      estimate: undefined,
      carteMereId: SUITE,
      rangDansLaSuite: index + 1,
    }),
  );

  inserer({
    ...carte,
    id: SANS_CODE,
    position: 6,
    title: 'Vérification sans rien à changer',
    description: 'zzrien : vérifier, sans modifier aucun fichier.',
  });

  db.close();
}

/** Une carte de la suite, lue en base : colonne, branche de départ, branche réelle, marques de la suite. */
function carteDeLaSuite(id) {
  const db = base(true);
  const ligne = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  const agents = db.prepare('SELECT data FROM agents WHERE card_id = ?').all(id).map((l) => JSON.parse(l.data));
  db.close();
  const reste = ligne?.data ? JSON.parse(ligne.data) : {};
  return {
    column: ligne?.column_key,
    brancheDeDepart: ligne?.branche_de_depart ?? undefined,
    branche: reste.github?.branch,
    etapeFinieAt: ligne?.etape_finie_at ?? undefined,
    excludedFromDeploy: ligne?.excluded_from_deploy === 1,
    auTravail: agents.some((a) => a.role === 'task' && ['running', 'starting'].includes(a.status)),
  };
}

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: `beluga_session=${jeton}` },
    });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 40000);
    prise.on('open', () => prise.send(JSON.stringify({ id, cmd })));
    prise.on('message', (brut) => {
      const evenement = JSON.parse(String(brut));
      if (evenement.type !== 'ack' || evenement.id !== id) return;
      clearTimeout(minuteur);
      prise.close();
      if (evenement.error) reject(new Error(evenement.error));
      else resolve(evenement);
    });
    prise.on('error', (e) => (clearTimeout(minuteur), reject(e)));
  });
}

/* ------------------------------------------------------------------ */
/* Le parcours                                                         */
/* ------------------------------------------------------------------ */

const attendreColonne = (colonne, limiteMs = 90000) =>
  attendre(() => {
    const carte = laCarte();
    return carte?.column === colonne ? carte : null;
  }, limiteMs);

/*
 * REJOUER UN TOUR DE TRAVAIL SUR LA CARTE. Un message sous un rapport rendu ne
 * remet plus la carte au travail : il rouvre son CADRAGE
 * (`shared/src/relance-apres-rapport.ts`, vérifié en section 12). Les scènes de
 * ce contrôle ont pourtant besoin d'un vrai tour de l'agent de tâche : une carte
 * close est donc d'abord ramenée en « Planifié » à la main — une carte
 * interrompue, qui se reprend —, puis on écrit à son agent, et on attend que
 * le tour l'ait sortie de « Planifié » (ou que le délai dise qu'il est déjà
 * retombé).
 */
async function ecrireAuTravail(agentId, texte) {
  const avant = laCarte()?.column;
  if (avant === 'to_deploy') await commande({ type: 'card.move', id: CARTE, column: 'planned' });
  await commande({ type: 'agent.prompt', agentId, text: texte });
  if (avant === 'to_deploy') await attendre(() => (laCarte()?.column !== 'planned' ? true : null), 20000, 100);
}

async function main() {
  /*
   * LE SCHÉMA DE LA BASE APPARTIENT AU DÉMON : on le laisse le créer, on pose
   * le décor dans la base ainsi née, puis on relance — c'est la seule façon
   * d'écrire dedans sans réécrire ses migrations ici.
   */
  lancerLeDemon();
  if (!(await attendrePort())) {
    noter('le démon d’essai répond', false, journal.join('').slice(-800));
    return;
  }
  poserLeDecor();
  let sorti = false;
  demon.on('exit', () => (sorti = true));
  demon.kill('SIGKILL');
  await attendre(() => sorti, 15000, 200);
  lancerLeDemon();
  if (!(await attendrePort())) {
    noter('le démon d’essai répond', false, journal.join('').slice(-800));
    return;
  }
  noter('le démon d’essai répond', true, `port ${PORT}`);

  /* -------- 1. Rien ne part sans le geste de lancement -------- */
  await new Promise((r) => setTimeout(r, 3000));
  noter(
    'la carte dort dans « Planifié » tant que personne ne la lance',
    laCarte()?.column === 'planned' && lesAgents().length === 0,
    `colonne « ${laCarte()?.column} », ${lesAgents().length} agent(s)`,
  );

  /* -------- 2. Le lancement -------- */
  await commande({ type: 'card.start', id: CARTE });
  const lancee = await attendreColonne('running', 30000);
  noter('le lancement pose la carte en « En cours »', !!lancee, lancee ? '' : `colonne « ${laCarte()?.column} »`);
  noter(
    'la carte porte sa branche et son agent',
    !!lancee?.agentId && !!lancee?.github?.branch,
    `branche « ${lancee?.github?.branch ?? '—'} »`,
  );

  /*
   * -------- 2 bis. ENTRE LE CLIC ET LE PREMIER MOT DU MOTEUR --------
   *
   * La carte est en « En cours » dès le clic, avant que le moteur n'ait lu la
   * première ligne. La ligne de temps cochait alors « Le travail est fait » et
   * « Le compte rendu est rendu » : elle doit dire une PRÉPARATION, et laisser
   * les deux points suivants gris. La règle est pure — on la rejoue sur la
   * carte telle que le démon vient de l'écrire.
   */
  const enPreparation = {
    colonne: 'running',
    roleAgent: 'task',
    tourEnCours: false,
    messages: [{ role: 'user', content: 'Réalise cette tâche' }],
    tourEnVolDepuis: lancee?.scheduling?.tourEnVolDepuis,
  };
  const chapitreAuDepart = chapitreDuParcours(enPreparation);
  noter(
    'entre le clic et le premier mot du moteur, la carte est en PRÉPARATION',
    chapitreAuDepart === 'preparation',
    `chapitre « ${chapitreAuDepart} », marque de vol ${lancee?.scheduling?.tourEnVolDepuis ?? 'aucune'}`,
  );
  const pointsAuDepart = pointsDuParcours([], {
    chapitre: chapitreAuDepart,
    colonne: 'running',
    tourEnCours: false,
    parcours: null,
    questionsOuvertes: 0,
    tourEnVolDepuis: enPreparation.tourEnVolDepuis,
  });
  const mensonges = pointsAuDepart.filter(
    (point) => point.phrase === PHRASES_DU_POINT.travail.fait || point.phrase === PHRASES_DU_POINT.rapport.fait,
  );
  noter(
    'aucun point ne dit « le travail est fait » ni « le compte rendu est rendu »',
    mensonges.length === 0,
    mensonges.map((p) => `${p.etape} : ${p.phrase}`).join(' / ') || 'aucun',
  );
  noter(
    'le moment « Préparation » tourne, seul',
    pointsAuDepart.filter((p) => p.etape === 'preparation' && p.etat === 'encours').length === 1,
    pointsAuDepart.map((p) => `${p.etape}=${p.etat}`).join(', '),
  );

  /* -------- 3. La fin de tour -------- */
  const close = await attendreColonne('to_deploy');
  noter('le rapport rendu ferme la carte en « À déployer »', !!close, close ? '' : `colonne « ${laCarte()?.column} »`);
  noter(
    'la marque de vol s’éteint avec le tour',
    close?.scheduling?.tourEnVolDepuis === undefined,
    `marque : ${close?.scheduling?.tourEnVolDepuis ?? 'aucune'}`,
  );
  noter(
    'une carte close ne garde ni suspension ni attente d’un tour précédent',
    !close?.scheduling?.suspendu && !close?.scheduling?.waitingReason,
    `suspendu=${!!close?.scheduling?.suspendu}, attente=${close?.scheduling?.waitingReason ?? 'aucune'}`,
  );

  const agentDeLaCarte = close?.agentId;
  const liste = derniereListe(agentDeLaCarte);
  noter(
    'la liste de tâches se referme avec le tour',
    liste.length > 0 && !liste.some((t) => t.state === 'running'),
    `${liste.length} ligne(s), ${liste.filter((t) => t.state === 'running').length} en cours`,
  );
  const agent = lesAgents().find((a) => a.id === agentDeLaCarte);
  noter(
    'le décompte de l’agent est d’accord avec sa liste',
    agent?.todos?.done === liste.filter((t) => t.state === 'done').length && agent?.todos?.total === liste.length,
    `agent ${agent?.todos?.done}/${agent?.todos?.total}, liste ${liste.filter((t) => t.state === 'done').length}/${liste.length}`,
  );
  noter(
    'plus aucune étape en cours n’est gravée sur l’agent',
    agent?.etapeEnCours === undefined,
    `étape : ${agent?.etapeEnCours ?? 'aucune'}`,
  );

  /* -------- 4. Les allers-retours -------- */
  let tousBons = true;
  let detail = '';
  for (let tour = 1; tour <= ALLERS_RETOURS; tour++) {
    await ecrireAuTravail(agentDeLaCarte, `Encore un point à revoir (tour ${tour}).`);
    const repartie = await attendreColonne('running', 40000);
    if (!repartie) {
      tousBons = false;
      detail = `tour ${tour} : la carte n'est pas remontée en « En cours »`;
      break;
    }
    const refermee = await attendreColonne('to_deploy');
    if (!refermee) {
      tousBons = false;
      detail = `tour ${tour} : la carte n'est pas revenue en « Terminé »`;
      break;
    }
    if (refermee.agentId !== agentDeLaCarte) {
      tousBons = false;
      detail = `tour ${tour} : la carte a changé d'agent`;
      break;
    }
    if (refermee.scheduling?.tourEnVolDepuis !== undefined) {
      tousBons = false;
      detail = `tour ${tour} : la marque de vol est restée posée`;
      break;
    }
  }
  noter(
    `${ALLERS_RETOURS} allers-retours refont exactement le même chemin`,
    tousBons,
    detail || `un seul agent, ${ALLERS_RETOURS} cycles complets`,
  );

  /* -------- 5. Un tour tombé -------- */
  await ecrireAuTravail(agentDeLaCarte, 'Ce tour tombe volontairement.');
  const enEchec = await attendre(() => {
    const a = lesAgents().find((x) => x.id === agentDeLaCarte);
    return a && (a.status === 'failed' || a.status === 'stopped') ? a : null;
  }, 60000);
  noter('un tour tombé se dit en échec', !!enEchec, `statut « ${enEchec?.status ?? '—'} »`);

  /*
   * LE BALAYAGE NE RAMASSE PAS UNE CARTE EN ÉCHEC : c'est la règle, on doit
   * pouvoir la relire et la corriger là où on la relance. On laisse passer deux
   * tours de veille (15 s) pour le prouver au lieu de le supposer.
   */
  await new Promise((r) => setTimeout(r, 35000));
  const bloquee = laCarte();
  noter(
    'une carte en échec reste en « En cours », le balayage n’y touche pas',
    bloquee?.column === 'running',
    `colonne « ${bloquee?.column} »`,
  );

  const restant = travailRestant(
    {
      colonne: bloquee?.column ?? '',
      suspendu: bloquee?.scheduling?.suspendu,
      dernierTourEnEchec: !!enEchec,
      finDuDernierTour: lesAgents().find((a) => a.id === agentDeLaCarte)?.endedAt,
      tourEnVolDepuis: bloquee?.scheduling?.tourEnVolDepuis,
    },
    Date.now(),
  );
  const phrase = restant ? phraseDuTravailRestant(restant) : '';
  noter(
    'elle dit qu’elle attend une relance, et ne promet plus de rangement automatique',
    restant?.nature === 'relance' && !/quinze secondes/.test(phrase),
    phrase || 'aucune phrase',
  );

  /* -------- 6. La relance après échec -------- */
  await ecrireAuTravail(agentDeLaCarte, 'Reprends, cette fois ça doit passer.');
  const reprise = await attendreColonne('to_deploy');
  noter(
    'un simple message suffit à refermer la carte après un échec',
    !!reprise,
    reprise ? '' : `colonne « ${laCarte()?.column} »`,
  );

  /* -------- 6 bis. UN TOUR QUI N'A JAMAIS EU SES OUTILS -------- */
  /*
   * Le pont d'outils ne démarre pas — le serveur ne peut plus lancer de
   * processus, cas relevé le 08.09.2026 — et le tour tombe. L'agent n'avait ni
   * mémoire du projet, ni écriture de mémoire, ni le moindre geste de tableau :
   * il ne pouvait même pas ranger sa propre carte, qui restait figée en « En
   * cours » sans agent au travail. Elle doit repartir en « Planifié », avec sa
   * phrase à elle et une reprise différée — le pont ne renaîtra pas en quinze
   * secondes si la machine est encore pleine.
   */
  const repriseSansOutils = laCarte()?.scheduling?.restarts ?? 0;
  await ecrireAuTravail(agentDeLaCarte, 'Ce tour zzsansoutils tombe sans avoir reçu ses outils.');
  const sansOutils = await attendre(() => {
    const c = laCarte();
    return c?.column === 'planned' ? c : null;
  }, 60000, 200);
  noter(
    'un tour privé de ses outils renvoie la carte en « Planifié », il ne la fige pas',
    !!sansOutils,
    `colonne « ${laCarte()?.column} »`,
  );
  noter(
    'la carte DIT que les outils du projet ne sont jamais arrivés',
    /* Phrase simplifiée le 21.09.2026 (`shared/src/suivi-colonne.ts`) : « sans ses outils ». */
    /outils du projet|sans ses outils/i.test(sansOutils?.scheduling?.waitingReason ?? '') &&
      (sansOutils?.scheduling?.restarts ?? 0) > repriseSansOutils,
    `${repriseSansOutils} → ${sansOutils?.scheduling?.restarts ?? 0}, « ${sansOutils?.scheduling?.waitingReason ?? '—'} »`,
  );
  noter(
    'elle attend avant de repartir : le pont ne renaît pas en quinze secondes',
    /* Le seuil est celui de la PHRASE — quinze secondes —, pas le délai lui-même :
       le premier rejeu est posé à 60 s pile (`DELAIS_DE_REJEU_DU_PONT_MS`), si
       bien qu'un seuil de 60 000 ms ne pouvait jamais être franchi, la lecture
       arrivant toujours quelques millisecondes après la pose. */
    (sansOutils?.scheduling?.departPrevu ?? 0) > Date.now() + 15000,
    sansOutils?.scheduling?.departPrevu
      ? `reprise dans ${Math.round((sansOutils.scheduling.departPrevu - Date.now()) / 1000)} s`
      : 'aucune date de reprise',
  );
  /*
   * On la remet au travail à la main : le délai de reprise dépasse largement la
   * durée de ce contrôle, et la suite du cycle a besoin d'une carte vivante.
   */
  await ecrireAuTravail(agentDeLaCarte, 'Reprends ce travail normalement.');
  await attendreColonne('to_deploy', 60000);

  /* -------- 7. UN MOTEUR QUI N'A JAMAIS PARLÉ -------- */
  /*
   * Le moteur meurt sans écrire une seule ligne : ce n'est pas la TÂCHE qui a
   * échoué, c'est le lancement qui n'a jamais joint le moteur. L'adaptateur le
   * DIT lui-même ; la carte doit repartir en « Planifié » avec un essai de plus
   * — et non rester en « En cours » comme un échec ordinaire.
   */
  const reprisesAvant = laCarte()?.scheduling?.restarts ?? 0;
  await ecrireAuTravail(agentDeLaCarte, 'Ce tour zzmuet ne dira rien du tout.');
  const injoignable = await attendre(() => {
    const c = laCarte();
    return c?.column === 'planned' ? c : null;
  }, 60000, 200);
  noter(
    'un moteur jamais joint renvoie la carte en « Planifié », il ne la fige pas',
    !!injoignable,
    `colonne « ${laCarte()?.column} »`,
  );
  noter(
    'le compteur de reprises monte, et la carte dit pourquoi',
    (injoignable?.scheduling?.restarts ?? 0) > reprisesAvant &&
      /* « L'IA n'a pas répondu » depuis le 21.09.2026 (`shared/src/suivi-colonne.ts`). */
      /moteur|IA n.a pas répondu/i.test(injoignable?.scheduling?.waitingReason ?? ''),
    `${reprisesAvant} → ${injoignable?.scheduling?.restarts ?? 0}, « ${injoignable?.scheduling?.waitingReason ?? '—'} »`,
  );
  const relancee = await attendreColonne('to_deploy', 120000);
  noter(
    'et l’ordonnanceur la ramène au bout du cycle sans un geste',
    !!relancee,
    relancee ? '' : `colonne « ${laCarte()?.column} »`,
  );

  /* -------- 8. LE BOUTON D'ARRÊT RANGE LA CARTE -------- */
  /*
   * Le geste ne changeait que la PHRASE : la carte restait en « En cours »,
   * sans agent au travail, et le balayage s'interdit d'y toucher après un tour
   * arrêté. Elle doit maintenant retomber en « Planifié », comme le fait déjà
   * la sortie à la souris.
   */
  await ecrireAuTravail(agentDeLaCarte, 'Un travail zzlong, à interrompre.');
  const auTravail = await attendreColonne('running', 40000);
  noter('le tour long repart bien en « En cours »', !!auTravail, `colonne « ${laCarte()?.column} »`);

  await attendre(() => lesAgents().find((a) => a.id === agentDeLaCarte)?.status === 'running', 40000, 200);
  await commande({ type: 'agent.stop', agentId: agentDeLaCarte, cardId: CARTE });
  const arretee = await attendre(() => {
    const c = laCarte();
    return c?.column === 'planned' ? c : null;
  }, 40000, 200);
  noter(
    'le bouton d’arrêt ramène la carte en « Planifié », comme la souris',
    !!arretee,
    `colonne « ${laCarte()?.column} »`,
  );
  noter(
    'elle est marquée suspendue, et le dit',
    !!arretee?.scheduling?.suspendu && !!arretee?.scheduling?.waitingReason,
    `suspendu=${!!arretee?.scheduling?.suspendu}, « ${arretee?.scheduling?.waitingReason ?? '—'} »`,
  );
  noter(
    'plus aucune marque de vol ne traîne : rien ne se dit « en cours de rangement »',
    arretee?.scheduling?.tourEnVolDepuis === undefined,
    `marque : ${arretee?.scheduling?.tourEnVolDepuis ?? 'aucune'}`,
  );

  // Deux tours de veille : une carte suspendue ne repart pas toute seule.
  await new Promise((r) => setTimeout(r, 35000));
  noter(
    'suspendue, elle ne repart pas d’elle-même',
    laCarte()?.column === 'planned' && !!laCarte()?.scheduling?.suspendu,
    `colonne « ${laCarte()?.column} »`,
  );

  /* -------- 9. LA RELANCE À LA MAIN EFFACE LA SUSPENSION -------- */
  await commande({ type: 'card.start', id: CARTE });
  const reprisApresArret = await attendreColonne('to_deploy', 120000);
  noter(
    'un clic la relance et la mène au bout, la suspension effacée',
    !!reprisApresArret && !reprisApresArret.scheduling?.suspendu,
    reprisApresArret ? `suspendu=${!!reprisApresArret.scheduling?.suspendu}` : `colonne « ${laCarte()?.column} »`,
  );

  /* -------- 10. UN LANCEMENT REFUSÉ FAUTE DE QUOTA EST REJOUÉ -------- */
  /*
   * La carte n'est jamais partie (`attempts` à zéro), elle n'est ni « dès que
   * possible » ni datée : avant, rien au monde ne la reprenait, et elle
   * attendait un second clic que personne ne savait devoir donner.
   */
  armerLaReprise();
  const rejouee = await attendre(() => {
    const c = laCarte();
    return c?.column === 'running' || c?.column === 'to_deploy' ? c : null;
  }, 90000, 300);
  noter(
    'un lancement refusé faute de quota repart tout seul, sans second clic',
    !!rejouee,
    `colonne « ${laCarte()?.column} », marque=${laCarte()?.scheduling?.reprendreDesQuePossible ?? 'effacée'}`,
  );
  const bouclee = await attendreColonne('to_deploy', 120000);
  noter(
    'et le départ consomme la marque au lieu de la laisser traîner',
    !!bouclee && bouclee.scheduling?.reprendreDesQuePossible === undefined,
    `marque : ${bouclee?.scheduling?.reprendreDesQuePossible ?? 'effacée'}`,
  );

  /* -------- 11. UNE RELANCE APRÈS ERREUR GARDE LA LISTE DE TÂCHES -------- */
  /*
   * Le 06/09/2026, un tour coupé net a été relancé au clic « Relancer » : la
   * liste de huit étapes, dont sept faites, avait disparu de l'écran, et
   * l'agent est reparti sans savoir où il en était. La relance ne posait pas le
   * drapeau `poursuite` — le seul qui recopie l'avancement du tour d'avant.
   *
   * On rejoue la scène : un tour qui annonce 7/8 puis meurt, un clic
   * « Relancer », et la liste doit être là DÈS LA PREMIÈRE SECONDE du nouveau
   * tour — c'est pourquoi la huitième étape porte le mot « zzdodo », qui fait
   * taire le faux moteur huit secondes : on lit ce que le DÉMON a posé, pas ce
   * que le moteur a renvoyé.
   */
  // Les erreurs DÉJÀ posées plus tôt dans ce parcours, jamais tranchées : on
  // attend une erreur NOUVELLE, pas la première qui traîne.
  const dejaEnErreur = new Set(messagesEnErreur(agentDeLaCarte).map((m) => m.id));
  await ecrireAuTravail(agentDeLaCarte, 'Un travail zzsept, coupé net au milieu.');
  const coupe = await attendre(
    () => messagesEnErreur(agentDeLaCarte).find((m) => !dejaEnErreur.has(m.id)) ?? null,
    60000,
    200,
  );
  noter(
    'un tour coupé net pose sa décision « Relancer / Ignorer / Arrêter »',
    !!coupe,
    coupe ? `cause « ${String(coupe.erreurDeTour.cause).slice(0, 60)} »` : 'aucune erreur posée',
  );
  const listeCoupee = coupe?.todos ?? [];
  noter(
    'la liste du tour coupé compte bien sept étapes faites sur huit',
    listeCoupee.length === 8 && listeCoupee.filter((t) => t.state === 'done').length === 7,
    `${listeCoupee.filter((t) => t.state === 'done').length}/${listeCoupee.length}`,
  );

  if (coupe) {
    await commande({ type: 'erreur.repondre', messageId: coupe.id, choix: 'relancer' });
    const reprises = await attendre(
      () => {
        const todos = derniereListe(agentDeLaCarte);
        // Le message du tour coupé porte la même liste : on attend celui d'APRÈS.
        const db = base(true);
        const ligne = db
          .prepare(
            "SELECT data FROM messages WHERE agent_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1",
          )
          .get(agentDeLaCarte);
        db.close();
        const dernier = ligne ? JSON.parse(ligne.data) : null;
        return dernier && dernier.id !== coupe.id && todos.length ? todos : null;
      },
      60000,
      200,
    );
    noter(
      'la relance après erreur repart AVEC la liste du tour coupé, jamais vide',
      !!reprises && reprises.length === 8,
      reprises ? `${reprises.length} ligne(s) dès le départ` : 'liste vide au nouveau tour',
    );
    noter(
      'les sept étapes faites le restent, la huitième est encore à faire',
      !!reprises &&
        reprises.filter((t) => t.state === 'done').length === 7 &&
        reprises.filter((t) => t.state !== 'done').length === 1,
      reprises
        ? `${reprises.filter((t) => t.state === 'done').length} faite(s), ${reprises.filter((t) => t.state !== 'done').length} restante(s)`
        : 'aucune liste',
    );
  }

  /* -------- 12. UNE RELANCE APRÈS RAPPORT REFAIT LE PARCOURS -------- */
  /*
   * Capture #8bbb, 13.09.2026 : un message écrit sous un rapport rendu a lancé
   * un tour de « Travail » au lieu d'une compréhension. Il doit partir à l'agent
   * de CADRAGE (rouvert, ou créé pour une carte qui n'en avait pas), la carte
   * passe AUSSITÔT en « Demande » (captures #f374 du 23.09.2026 et #35079 du
   * 04.10.2026 : attendre la compréhension la laissait une minute en
   * « À déployer », avec son bouton de fin de tâche), puis REVIENT dans
   * « À déployer » si l'échange n'était qu'une question. Un tour de travail,
   * lui, ne part jamais.
   * Scène jouée en DERNIER : un cadrage rouvert retient ensuite la carte.
   */
  if (lesAgents().find((a) => a.id === agentDeLaCarte)?.status === 'running') {
    await commande({ type: 'agent.stop', agentId: agentDeLaCarte, cardId: CARTE }).catch(() => undefined);
  }
  await attendre(() => (lesAgents().find((a) => a.id === agentDeLaCarte)?.status !== 'running' ? true : null), 40000, 200);
  // Le rangement d'après l'arrêt écrit la carte juste après : on le laisse passer.
  await new Promise((r) => setTimeout(r, 3000));
  poserAuRapport();
  const auRapport = await attendreColonne('to_deploy', 10000);
  const messagesDeLaTache = () => {
    const db = base(true);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE agent_id = ?').get(agentDeLaCarte);
    db.close();
    return n;
  };
  const tacheAvant = messagesDeLaTache();
  /*
   * UN SEUL AGENT PAR CARTE (`shared/src/agent-unique-de-carte.ts`) : l'agent
   * de la carte REVIENT lui-même au cadrage — même identifiant, même fil. Ses
   * messages augmentent donc ; ce qui ne doit pas partir, c'est un tour de
   * TRAVAIL : l'agent n'est plus en rôle « task » pendant la discussion.
   */
  const revenuAuCadrage = () => lesAgents().find((a) => a.id === agentDeLaCarte)?.role === 'cadrage';
  const aucunTravail = () => revenuAuCadrage() || messagesDeLaTache() === tacheAvant;
  const tacheEnTravail = () => {
    const agent = lesAgents().find((a) => a.id === agentDeLaCarte);
    return agent?.role === 'task' && agent?.status === 'running';
  };
  const tourFini = () =>
    attendre(() => (lesAgents().find((a) => a.id === agentDeLaCarte)?.status === 'running' ? null : true), 40000, 200);

  /* « zzdodo » : le cadrage se tait huit secondes — le temps de lire la carte
     PENDANT sa réflexion, là où l'utilisateur la voyait rester en place. */
  await commande({ type: 'agent.prompt', agentId: agentDeLaCarte, text: 'Une question après le rapport zzdodo.' });
  const cadrage = await attendre(() => lesAgents().find((a) => a.role === 'cadrage') ?? null, 20000, 200);
  noter(
    'un message sous le rapport part à l’agent de cadrage',
    !!auRapport && !!cadrage,
    auRapport ? `agent de cadrage : ${cadrage ? 'oui' : 'aucun'}` : `colonne « ${laCarte()?.column} » avant le message`,
  );
  noter(
    'c’est le MÊME agent qui revient au cadrage : aucun second agent ne naît',
    !!cadrage && cadrage.id === agentDeLaCarte && lesAgents().filter((a) => a.cardId === CARTE).length === 1,
    `cadrage ${cadrage?.id === agentDeLaCarte ? 'identique' : 'distinct'}, ${lesAgents().filter((a) => a.cardId === CARTE).length} agent(s) sur la carte`,
  );
  const pendantLaReflexion = laCarte();
  const statutPendant = lesAgents().find((a) => a.id === agentDeLaCarte)?.status;
  noter(
    'la carte passe AUSSITÔT en « Demande », pendant la réflexion du cadrage',
    pendantLaReflexion?.column === 'planned' &&
      !!pendantLaReflexion?.parcours?.cadrageRouvertA &&
      ['starting', 'running'].includes(statutPendant),
    `colonne « ${pendantLaReflexion?.column} », agent « ${statutPendant} »`,
  );
  const premiereDate = pendantLaReflexion?.parcours?.cadrageRouvertA;

  /* Le tour ne fait que RÉPONDRE (ni compréhension, ni plan) : retour au lot. */
  await tourFini();
  const revenue = await attendreColonne('to_deploy', 15000);
  noter(
    'une simple réponse ramène la carte dans « À déployer », relance refermée',
    !!revenue && !revenue.parcours?.cadrageRouvertA && !tacheEnTravail() && aucunTravail(),
    `colonne « ${laCarte()?.column} », cadrageRouvertA ${laCarte()?.parcours?.cadrageRouvertA ?? 'absent'}, messages de la tâche ${tacheAvant} → ${messagesDeLaTache()}`,
  );

  /* Une seconde question : même aller-retour, avec une NOUVELLE date. */
  await commande({ type: 'agent.prompt', agentId: agentDeLaCarte, text: 'Encore une précision zzdodo.' });
  await new Promise((r) => setTimeout(r, 1500));
  const secondeRelance = laCarte();
  noter(
    'une seconde question repasse la carte en « Demande », redatée',
    secondeRelance?.column === 'planned' &&
      !!secondeRelance?.parcours?.cadrageRouvertA &&
      secondeRelance.parcours.cadrageRouvertA !== premiereDate,
    `colonne « ${secondeRelance?.column} », dates ${premiereDate} → ${secondeRelance?.parcours?.cadrageRouvertA}`,
  );
  await tourFini();
  const revenueEncore = await attendreColonne('to_deploy', 15000);
  noter(
    'et revient encore dans « À déployer », sans tour de travail',
    !!revenueEncore && laCarte()?.scheduling?.tourEnVolDepuis === undefined && !tacheEnTravail(),
    `colonne « ${laCarte()?.column} »`,
  );

  /*
   * UN NOUVEAU TRAVAIL CADRÉ : la compréhension est posée en base PENDANT la
   * réflexion, comme l'outil `rendre_comprehension` l'écrirait. La fin du tour
   * doit alors LAISSER la carte en « Demande ».
   */
  await commande({ type: 'agent.prompt', agentId: agentDeLaCarte, text: 'Un nouveau travail à faire zzdodo.' });
  await attendre(() => (laCarte()?.column === 'planned' && laCarte()?.parcours?.cadrageRouvertA ? true : null), 10000, 200);
  {
    const db = base();
    const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(CARTE);
    const carte = JSON.parse(ligne.data);
    const rouvert = carte.parcours?.cadrageRouvertA ?? Date.now();
    carte.parcours = {
      ...(carte.parcours ?? { plans: [] }),
      cadrageRouvertA: rouvert,
      comprehension: { texte: 'Nouveau travail cadré', hypotheses: [], sujets: [], at: rouvert + 1 },
    };
    db.prepare('UPDATE cards SET data = ? WHERE id = ?').run(JSON.stringify(carte), CARTE);
    db.close();
  }
  await tourFini();
  /*
   * Deux lectures espacées, plus longues qu'un passage de l'ordonnanceur : la
   * carte relancée a déjà été lancée (`attempts` > 0), et sans la retenue de la
   * relance il la ferait repartir toute seule depuis « Demande ».
   */
  await new Promise((r) => setTimeout(r, 20000));
  const cadreeANouveau = laCarte();
  noter(
    'un nouveau travail cadré garde la carte en « Demande », et elle ne part pas seule',
    cadreeANouveau?.column === 'planned' &&
      !!cadreeANouveau.parcours?.cadrageRouvertA &&
      cadreeANouveau.scheduling?.tourEnVolDepuis === undefined &&
      !tacheEnTravail(),
    `colonne « ${cadreeANouveau?.column} », cadrageRouvertA ${cadreeANouveau?.parcours?.cadrageRouvertA ?? 'absent'}`,
  );

  /*
   * ET LE LANCEMENT REND LE TRAVAIL AU MÊME AGENT. Moteur et modèle inchangés :
   * l'agent qui vient de discuter repasse en exécution, dans la copie de
   * travail de la carte, au lieu d'en faire naître un second.
   */
  await attendre(() => (lesAgents().find((a) => a.id === agentDeLaCarte)?.status !== 'running' ? true : null), 40000, 200);
  await commande({ type: 'card.start', id: CARTE });
  const relance = await attendre(() => {
    const agent = lesAgents().find((a) => a.id === agentDeLaCarte);
    return agent?.role === 'task' ? agent : null;
  }, 30000, 200);
  noter(
    'le lancement après recadrage rend le travail au MÊME agent, repassé en exécution',
    !!relance && laCarte()?.agentId === agentDeLaCarte && lesAgents().length === 1 && !!relance.workdir,
    `rôle « ${relance?.role ?? lesAgents().find((a) => a.id === agentDeLaCarte)?.role} », ${lesAgents().length} agent(s), dossier ${relance?.workdir ? 'de la carte' : 'absent'}`,
  );

  /* -------- 13. UNE CARTE VALIDÉE PART À L'HEURE DITE, SANS PLAN -------- */
  /*
   * Le 04.10.2026, une carte cadrée sans plan, validée puis datée depuis le
   * tiroir de programmation, a attendu six heures : l'ordonnanceur la tenait
   * pour « encore en cadrage » tant qu'aucun plan n'existait. On rejoue la
   * scène avec la VRAIE boucle : la carte est recadrée (agent en rôle
   * « cadrage », compréhension rendue, aucun plan), puis datée, puis validée.
   */
  await attendreColonne('to_deploy', 120000);
  poserAuRapport();
  await attendreColonne('to_deploy', 10000);
  await commande({ type: 'agent.prompt', agentId: agentDeLaCarte, text: 'Un travail à programmer zzdodo.' });
  await attendre(() => (laCarte()?.column === 'planned' && laCarte()?.parcours?.cadrageRouvertA ? true : null), 10000, 200);
  {
    const db = base();
    const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(CARTE);
    const carte = JSON.parse(ligne.data);
    const rouvert = carte.parcours?.cadrageRouvertA ?? Date.now();
    carte.parcours = {
      ...(carte.parcours ?? {}),
      /* AUCUN PLAN : c'est le cas ordinaire, et c'est lui qui retenait la carte. */
      plans: [],
      cadrageRouvertA: rouvert,
      comprehension: { texte: 'Travail à faire partir à l’heure dite', hypotheses: [], sujets: [], at: rouvert + 1 },
      comprehensionValidee: undefined,
    };
    db.prepare('UPDATE cards SET data = ? WHERE id = ?').run(JSON.stringify(carte), CARTE);
    db.close();
  }
  await tourFini();

  /* Datée, heure déjà passée, mais PERSONNE n'a validé : plus d'un passage de
     l'ordonnanceur, et elle n'a pas bougé. */
  await commande({ type: 'card.schedule', id: CARTE, date: Date.now() - 1000 });
  await new Promise((r) => setTimeout(r, 20000));
  const dateeSansAccord = laCarte();
  noter(
    'datée sans avoir été validée, la carte en cadrage reste en « Demande »',
    dateeSansAccord?.column === 'planned' && !!dateeSansAccord.scheduling?.departPrevu && !tacheEnTravail() && revenuAuCadrage(),
    `colonne « ${dateeSansAccord?.column} », date ${dateeSansAccord?.scheduling?.departPrevu ? 'posée' : 'absente'}`,
  );

  /* La validation seule — aucun clic de lancement, aucun plan : le prochain
     passage de l'ordonnanceur la fait partir. */
  await commande({ type: 'card.comprehension.validate', cardId: CARTE });
  const partieSeule = await attendre(() => {
    const agent = lesAgents().find((a) => a.id === agentDeLaCarte);
    return agent?.role === 'task' && ['running', 'to_deploy'].includes(laCarte()?.column) ? laCarte() : null;
  }, 60000, 200);
  noter(
    'validée, elle part toute seule à l’heure dite, sans plan et sans clic',
    !!partieSeule && (partieSeule.parcours?.plans ?? []).length === 0,
    `colonne « ${laCarte()?.column} », rôle « ${lesAgents().find((a) => a.id === agentDeLaCarte)?.role} », ${(laCarte()?.parcours?.plans ?? []).length} plan(s)`,
  );
  const consommee = await attendre(() => (laCarte()?.scheduling?.departPrevu === undefined ? laCarte() : null), 30000, 200);
  noter(
    'et le départ consomme la date : elle ne repartira pas une seconde fois',
    !!consommee,
    `date : ${laCarte()?.scheduling?.departPrevu ?? 'effacée'}`,
  );

  /* -------- 14. UNE SUITE D'ÉTAPES PART UNE À UNE, GROUPÉE JUSQU'AU BOUT -------- */
  /*
   * Les sous-cartes d'un travail découpé partaient « n'importe comment ». Une
   * suite (`shared/src/suite-de-cartes.ts`) ne lance que sa première étape au
   * clic ; chaque étape suivante part quand la précédente a rendu son travail,
   * depuis sa branche ; les étapes finies restent en « En cours » ; tout passe
   * ensemble en « À déployer » après la dernière. On le prouve avec la vraie
   * boucle et le faux moteur, qui enregistre un fichier à chaque tour.
   */
  noter(
    'la suite dort dans « Planifié » tant que sa carte globale n’est pas lancée',
    [SUITE, ...ETAPES].every((id) => carteDeLaSuite(id).column === 'planned'),
    [SUITE, ...ETAPES].map((id) => carteDeLaSuite(id).column).join(', '),
  );
  await commande({ type: 'card.start', id: SUITE });
  let auPlus = 0;
  let deployeeTropTot = false;
  const finie = await attendre(
    () => {
      const etapes = ETAPES.map(carteDeLaSuite);
      auPlus = Math.max(auPlus, etapes.filter((e) => e.auTravail).length);
      const deployees = etapes.filter((e) => e.column === 'to_deploy').length;
      // La libération écrit les trois étapes l'une après l'autre : un relevé entre deux écritures n'est pas une faute.
      if (deployees > 0 && deployees < 3 && etapes[2].etapeFinieAt === undefined) deployeeTropTot = true;
      return deployees === 3 ? etapes : null;
    },
    300000,
    250,
  );
  noter(
    'les étapes partent une à une : jamais deux au travail en même temps',
    !!finie && auPlus === 1,
    `au plus ${auPlus} étape(s) au travail ensemble`,
  );
  noter(
    'rien n’entre en « À déployer » avant la fin de la dernière étape, puis toute la suite y passe ensemble',
    !!finie && !deployeeTropTot,
    ETAPES.map((id) => carteDeLaSuite(id).column).join(', '),
  );
  const [e1, e2, e3] = ETAPES.map(carteDeLaSuite);
  const voitLeCode = (avant, apres) => {
    if (!avant.branche || !apres.branche) return false;
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', avant.branche, apres.branche], { cwd: DEPOT });
      return true;
    } catch {
      return false;
    }
  };
  noter(
    'chaque étape part de la branche de la précédente, et en voit le code',
    e2.brancheDeDepart === e1.branche && e3.brancheDeDepart === e2.branche && voitLeCode(e1, e2) && voitLeCode(e2, e3),
    `étape 2 depuis « ${e2.brancheDeDepart} » (étape 1 : « ${e1.branche} »), étape 3 depuis « ${e3.brancheDeDepart} »`,
  );
  const tete = await attendre(() => (carteDeLaSuite(SUITE).column === 'to_deploy' ? carteDeLaSuite(SUITE) : null), 20000, 200);
  noter(
    'la carte globale suit ses étapes en « À déployer », sans jamais entrer dans le lot',
    !!tete && tete.excludedFromDeploy,
    `colonne « ${carteDeLaSuite(SUITE).column} »`,
  );

  /*
   * -------- 15. Un rapport rendu SANS AUCUNE modification --------
   *
   * Décision de l'utilisateur (12.11.2026) : rien dans la branche, rien à
   * déployer — la carte va DIRECTEMENT dans « Archivé », sa branche vide et sa
   * copie de travail rangées par l'archivage ordinaire.
   */
  const lireSansCode = () => {
    const db = base(true);
    const ligne = db.prepare('SELECT * FROM cards WHERE id = ?').get(SANS_CODE);
    db.close();
    const reste = ligne?.data ? JSON.parse(ligne.data) : {};
    return { column: ligne?.column_key, doneAt: ligne?.done_at ?? reste.doneAt, archivedAt: ligne?.archived_at ?? reste.archivedAt, sansModification: reste.sansModification, github: reste.github ?? {} };
  };
  await commande({ type: 'card.start', id: SANS_CODE });
  const archivee = await attendre(() => {
    const c = lireSansCode();
    return c.column === 'archived' && c.archivedAt ? c : null;
  }, 120000, 250);
  noter(
    'une tâche rendue sans aucune modification va DIRECTEMENT dans « Archivé »',
    !!archivee,
    `colonne « ${lireSansCode().column} »`,
  );
  noter(
    '…en le disant, datée comme une carte finie',
    !!archivee && /aucune modification/.test(archivee.sansModification ?? '') && typeof archivee.doneAt === 'number',
    (archivee?.sansModification ?? '(aucune phrase)').slice(0, 120),
  );
  const brancheVide = archivee?.github?.branch;
  let brancheEncoreLa = true;
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${brancheVide}`], { cwd: DEPOT });
  } catch {
    brancheEncoreLa = false;
  }
  noter(
    '…et sa branche vide est retirée du dépôt, rien n’entre dans le lot',
    !!brancheVide && !brancheEncoreLa && archivee?.github?.brancheSupprimee === true,
    `branche « ${brancheVide ?? 'aucune'} » ${brancheEncoreLa ? 'encore là' : 'retirée'}`,
  );
  const copies = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: DEPOT, encoding: 'utf8' });
  noter(
    '…comme sa copie de travail',
    !!brancheVide && !copies.includes(`branch refs/heads/${brancheVide}`),
    copies.split('\n').filter((l) => l.startsWith('worktree ')).length + ' copie(s) restante(s)',
  );
}

main()
  .catch((err) => noter('le contrôle est allé au bout', false, String(err?.message ?? err)))
  .then(() => {
    const rates = resultats.filter((r) => !r.ok);
    console.log(`\n${resultats.length - rates.length}/${resultats.length} au vert`);
    if (rates.length) {
      console.log('\n--- journal du démon ---');
      console.log(journal.join('').split('\n').slice(-40).join('\n'));
    }
    process.exit(rates.length ? 1 : 0);
  });
