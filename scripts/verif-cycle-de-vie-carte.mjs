#!/usr/bin/env node
/**
 * LE CYCLE DE VIE D'UNE CARTE, REJOUÉ PLUSIEURS FOIS DE SUITE.
 *
 *   npm run build && node scripts/verif-cycle-de-vie-carte.mjs
 *
 * Chaque pièce du parcours a déjà son contrôle (lancement, listes de tâches,
 * arrêt, carte interrompue, carte oubliée). Ce qu'aucun ne regardait, c'est le
 * TOUR COMPLET, ENCHAÎNÉ : « Planifié » → lancement → « En cours » → rapport
 * rendu → « Terminé », puis un nouveau message qui doit REMETTRE la carte en
 * « En cours » et refaire exactement le même chemin — trois fois d'affilée,
 * sans que rien ne se décale.
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un FAUX MOTEUR (un vrai processus, aucun jeton dépensé) qui annonce une liste
 * de tâches, écrit un fichier dans la copie de travail, puis rend sa réponse.
 *
 * Ce qui est vérifié, sans navigateur (le canal temps réel et la base suffisent) :
 *   1. LE LANCEMENT — la carte passe en « En cours », un agent de tâche existe,
 *      la branche de la carte est notée ;
 *   2. LA FIN DE TOUR — la carte arrive en « Terminé », sa marque de vol est
 *      éteinte, sa liste de tâches est refermée et son décompte est d'accord
 *      avec elle ;
 *   3. TROIS ALLERS-RETOURS — chaque nouveau message repose la carte en
 *      « En cours » puis la ramène en « Terminé », avec un agent unique ;
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
 *      rejouée par l'ordonnanceur, sans second clic.
 */
import { colonnesDeLaCarte } from '../shared/dist/carte-sql.js';
import { travailRestant, phraseDuTravailRestant } from '../shared/dist/travail-restant.js';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import ws from '/root/haikodev/node_modules/ws/index.js';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_CYCLE_PORT || 7203);
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
import { execFileSync } from 'node:child_process';
let demande = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (demande += d));
process.stdin.on('end', () => jouer());
setTimeout(() => process.stdin.readable && process.stdin.read(), 50);

const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
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
   * « ZZMUET » : le moteur meurt sans écrire UNE SEULE ligne de protocole.
   * C'est exactement le cas que l'adaptateur doit signaler de lui-même
   * (jamaisDemarre), et non plus le démon le deviner à l'absence d'étapes.
   */
  if (/zzmuet/.test(demande)) {
    process.stderr.write('command not found\\n');
    process.exit(127);
  }

  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
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

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET = 'p-cycle';
const CARTE = 'c-cycle';

const base = (readonly = false) =>
  new Database(path.join(DATA, 'haikodev.db'), readonly ? { readonly: true } : undefined);

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

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification cycle de vie',
  );

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
  const colonnes = colonnesDeLaCarte(carte);
  const noms = Object.keys(colonnes);
  db.prepare(`INSERT INTO cards (${noms.join(', ')}) VALUES (${noms.map(() => '?').join(', ')})`).run(
    ...noms.map((nom) => colonnes[nom]),
  );

  db.close();
}

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: `haikodev_session=${jeton}` },
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

  /* -------- 3. La fin de tour -------- */
  const close = await attendreColonne('done');
  noter('le rapport rendu ferme la carte en « Terminé »', !!close, close ? '' : `colonne « ${laCarte()?.column} »`);
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
    await commande({ type: 'agent.prompt', agentId: agentDeLaCarte, text: `Encore un point à revoir (tour ${tour}).` });
    const repartie = await attendreColonne('running', 40000);
    if (!repartie) {
      tousBons = false;
      detail = `tour ${tour} : la carte n'est pas remontée en « En cours »`;
      break;
    }
    const refermee = await attendreColonne('done');
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
  await commande({ type: 'agent.prompt', agentId: agentDeLaCarte, text: 'Ce tour tombe volontairement.' });
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
  await commande({ type: 'agent.prompt', agentId: agentDeLaCarte, text: 'Reprends, cette fois ça doit passer.' });
  const reprise = await attendreColonne('done');
  noter(
    'un simple message suffit à refermer la carte après un échec',
    !!reprise,
    reprise ? '' : `colonne « ${laCarte()?.column} »`,
  );

  /* -------- 7. UN MOTEUR QUI N'A JAMAIS PARLÉ -------- */
  /*
   * Le moteur meurt sans écrire une seule ligne : ce n'est pas la TÂCHE qui a
   * échoué, c'est le lancement qui n'a jamais joint le moteur. L'adaptateur le
   * DIT lui-même ; la carte doit repartir en « Planifié » avec un essai de plus
   * — et non rester en « En cours » comme un échec ordinaire.
   */
  const reprisesAvant = laCarte()?.scheduling?.restarts ?? 0;
  await commande({ type: 'agent.prompt', agentId: agentDeLaCarte, text: 'Ce tour zzmuet ne dira rien du tout.' });
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
      /moteur/i.test(injoignable?.scheduling?.waitingReason ?? ''),
    `${reprisesAvant} → ${injoignable?.scheduling?.restarts ?? 0}, « ${injoignable?.scheduling?.waitingReason ?? '—'} »`,
  );
  const relancee = await attendreColonne('done', 120000);
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
  await commande({ type: 'agent.prompt', agentId: agentDeLaCarte, text: 'Un travail zzlong, à interrompre.' });
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
  const reprisApresArret = await attendreColonne('done', 120000);
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
    return c?.column === 'running' || c?.column === 'done' ? c : null;
  }, 90000, 300);
  noter(
    'un lancement refusé faute de quota repart tout seul, sans second clic',
    !!rejouee,
    `colonne « ${laCarte()?.column} », marque=${laCarte()?.scheduling?.reprendreDesQuePossible ?? 'effacée'}`,
  );
  const bouclee = await attendreColonne('done', 120000);
  noter(
    'et le départ consomme la marque au lieu de la laisser traîner',
    !!bouclee && bouclee.scheduling?.reprendreDesQuePossible === undefined,
    `marque : ${bouclee?.scheduling?.reprendreDesQuePossible ?? 'effacée'}`,
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
