#!/usr/bin/env node
/**
 * LE FLUX COMPTE → RELÈVE → PLAN → VALIDATION → LANCEMENT → REDÉMARRAGE, BOUT EN BOUT.
 *
 *   npm run build:server && node scripts/verif-flux-compte-et-plan.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve,
 * DEUX COMPTES FACTICES (un « Pro », un « Max x20 ») dont les relevés sont
 * joués par un fichier (`BELUGA_QUOTAS_FACTICES`), et un FAUX MOTEUR qui
 * répond « requires usage credits » sur le compte Pro — exactement ce que le
 * relevé ne voit pas — et travaille normalement sur le compte Max. Aucun
 * compte réel n'est touché, pas un jeton dépensé.
 *
 * Ce qui est prouvé, sans navigateur (le canal temps réel et la base suffisent) :
 *   1. LA LIMITE ET LA RELÈVE — le premier tour part sur Pro (la règle), tombe,
 *      et la relève automatique repart sur Max SANS poser la question ; la
 *      reprise est CONSOMMÉE une fois, la limite de Pro est NOTÉE ;
 *   2. LE PARCOURS — le tour de reprise est rattaché au tour coupé : un seul
 *      point de plus dans aucune étape ;
 *   3. LE COMPTE TIENT — le tour suivant part DIRECTEMENT sur Max, sans
 *      tomber ni relever ;
 *   4. LE PLAN — une carte de cadrage avec un plan rendu ne se lance pas tant
 *      qu'il n'est pas validé ; « Valider » écrit UN état sur la carte, sans
 *      tour ; le lancement s'allume ensuite, et part sur Max ;
 *   5. LA DÉCISION OUVERTE — une carte dont l'agent attend un choix de compte
 *      refuse son lancement, côté serveur ;
 *   6. LE REDÉMARRAGE — aucune « file reprise » ne repart, aucune reprise
 *      ne reste ouverte, la limite connue survit.
 */
import { colonnesDeLaCarte } from '../shared/dist/carte-sql.js';
import { contenuDesPoints } from '../shared/dist/parcours-en-points.js';
import { gesteDuParcours } from '../shared/dist/parcours-carte.js';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ws = require('ws');
const PORT = Number(process.env.BELUGA_FLUX_PORT || 7207);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-flux-compte-plan-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor : un vrai dépôt git, deux comptes, un faux moteur          */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
const COFFRE_PRO = path.join(TMP, 'coffre-pro');
const COFFRE_MAX = path.join(TMP, 'coffre-max');
for (const dossier of [DATA, PROJETS, DEPOT, COFFRE_PRO, COFFRE_MAX]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
execFileSync('git', ['config', 'user.email', 'essai@local'], { cwd: DEPOT });
execFileSync('git', ['config', 'user.name', 'essai'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['commit', '-qm', 'départ'], { cwd: DEPOT });

/* LES RELEVÉS FACTICES : les deux comptes se disent DISPONIBLES — le manque
   de crédits de Pro ne se voit pas dans un relevé, c'est tout le sujet. */
const QUOTAS = path.join(TMP, 'quotas.json');
fs.writeFileSync(
  QUOTAS,
  JSON.stringify({
    'compte-pro': { available: true, plan: 'Pro', session: { usedPct: 20, resetsAt: Date.now() + 3 * 3600_000, durationSeconds: 18000 } },
    'compte-max': { available: true, plan: 'Max x20', session: { usedPct: 5, resetsAt: Date.now() + 4 * 3600_000, durationSeconds: 18000 } },
  }),
);

/*
 * LE FAUX MOTEUR lit son compte dans `CLAUDE_CONFIG_DIR` (c'est ainsi que le
 * démon impose un compte au moteur). Sur le coffre Pro : la bannière de manque
 * de crédits, puis la mort — sans événement structuré, comme le vrai. Sur le
 * coffre Max : une liste de tâches et une réponse.
 */
const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
let demande = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (demande += d));
process.stdin.on('end', () => jouer());
setTimeout(() => process.stdin.readable && process.stdin.read(), 50);
const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
async function jouer() {
  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
  if (/coffre-pro/.test(process.env.CLAUDE_CONFIG_DIR ?? '')) {
    dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Fable 5.1 requires usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage?from=cc_cli_limit_message, to continue.' }] } });
    await new Promise((r) => setTimeout(r, 200));
    process.exit(1);
  }
  dire({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'TodoWrite', input: { todos: [{ content: 'Lire le code', status: 'completed' }, { content: 'Écrire le correctif', status: 'completed' }] } }] } });
  await new Promise((r) => setTimeout(r, 200));
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Travail rendu sur le compte Max.' }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 10, output_tokens: 5 } });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

/* ------------------------------------------------------------------ */
/* Le démon                                                            */
/* ------------------------------------------------------------------ */

let demon = null;
let journal = [];

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
      BELUGA_QUOTAS_FACTICES: QUOTAS,
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

async function redemarrerLeDemon() {
  let sorti = false;
  demon.on('exit', () => (sorti = true));
  demon.kill('SIGKILL');
  await attendre(() => sorti, 15000, 200);
  lancerLeDemon();
  return attendrePort();
}

/* ------------------------------------------------------------------ */
/* La base                                                             */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET = 'p-flux';
const CARTE = 'c-flux-tache';
const CARTE_PLAN = 'c-flux-plan';
const AGENT_PLAN = 'a-flux-cadrage';
const CARTE_BLOQUEE = 'c-flux-bloquee';
const AGENT_BLOQUE = 'a-flux-bloque';

const base = (readonly = false) =>
  new Database(path.join(DATA, 'beluga.db'), readonly ? { readonly: true } : undefined);

function laCarte(id = CARTE) {
  const db = base(true);
  const ligne = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  db.close();
  if (!ligne) return null;
  const reste = ligne.data ? JSON.parse(ligne.data) : {};
  return { ...reste, column: ligne.column_key, agentId: ligne.agent_id ?? reste.agentId };
}

function lesAgents(cardId = CARTE) {
  const db = base(true);
  const lignes = db.prepare('SELECT data FROM agents WHERE card_id = ? ORDER BY updated_at DESC').all(cardId);
  db.close();
  return lignes.map((l) => JSON.parse(l.data));
}

function lesMessages(agentId) {
  const db = base(true);
  const lignes = db.prepare('SELECT data FROM messages WHERE agent_id = ? ORDER BY created_at ASC').all(agentId);
  db.close();
  return lignes.map((l) => JSON.parse(l.data));
}

function leJournal(cardId) {
  const db = base(true);
  const lignes = db.prepare('SELECT * FROM card_journal WHERE card_id = ? ORDER BY rang ASC').all(cardId);
  db.close();
  return lignes.map((l) => ({
    id: l.id,
    cardId: l.card_id,
    rang: l.rang,
    phase: l.phase,
    nature: l.nature,
    at: l.at,
    agentId: l.agent_id ?? undefined,
    agentRole: l.agent_role ?? undefined,
    tourId: l.tour_id ?? undefined,
    libelle: l.libelle,
    outil: l.outil ?? undefined,
    params: l.params ?? undefined,
    resultat: l.resultat ?? undefined,
    donnees: l.donnees ?? undefined,
  }));
}

function laFile() {
  const db = base(true);
  const n = db.prepare('SELECT COUNT(*) AS n FROM queue').get()?.n ?? 0;
  db.close();
  return n;
}

function limitesConnues() {
  const db = base(true);
  const ligne = db.prepare("SELECT value FROM meta WHERE key = 'limites-connues'").get();
  db.close();
  return ligne ? JSON.parse(ligne.value) : [];
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification flux compte et plan',
  );
  const projet = {
    id: PROJET,
    name: 'Essai flux compte et plan',
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

  for (const [id, label, plan, priority, configDir] of [
    ['compte-pro', 'Compte Pro', 'Pro', 1, COFFRE_PRO],
    ['compte-max', 'Compte Max', 'Max x20', 2, COFFRE_MAX],
  ]) {
    db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
      id,
      'claude',
      JSON.stringify({ id, engine: 'claude', label, plan, priority, configDir }),
      maintenant,
    );
  }

  const inserer = (carte) => {
    const colonnes = colonnesDeLaCarte(carte);
    const noms = Object.keys(colonnes);
    db.prepare(`INSERT INTO cards (${noms.join(', ')}) VALUES (${noms.map(() => '?').join(', ')})`).run(
      ...noms.map((nom) => colonnes[nom]),
    );
  };
  const commun = {
    projectId: PROJET,
    position: 1,
    origin: 'user',
    labels: [],
    attachments: [],
    estimate: { machineSeconds: 60, seniorHours: 0.25, confidence: 'medium', failed: false },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  inserer({
    ...commun,
    id: CARTE,
    column: 'planned',
    title: 'Carte de tâche : limite puis relève',
    description: 'Le premier tour tombe sur le compte Pro, la relève part sur Max.',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
  });
  inserer({
    ...commun,
    id: CARTE_PLAN,
    position: 2,
    column: 'planned',
    title: 'Carte de cadrage : plan à valider',
    description: 'Un plan rendu, à valider avant le lancement.',
    run: { engine: 'claude', thinking: 'none', mode: 'plan' },
    agentId: AGENT_PLAN,
    parcours: {
      /* LA COMPRÉHENSION EST LE PIVOT : c'est elle qu'on valide, le plan ne
         fait que l'accompagner (`comprehensionValideePourLaVersionCourante`). */
      comprehension: {
        texte: 'Vous voulez un plan à valider.',
        hypotheses: [],
        sujets: [],
        resumeDemande: 'Vous demandez un plan.',
        resumeComprehension: 'Je comprends qu’il faut un plan à valider.',
        at: maintenant,
      },
      plans: [{ numero: 1, titre: 'Plan v1', resume: 'Le plan.', texte: '# Plan v1\n\n## Faisabilité\nok\n\n## Chemin à suivre\n1. faire\n\n## Conséquences\nrien\n\n## Améliorations apportées\n- une', at: maintenant }],
    },
  });
  inserer({
    ...commun,
    id: CARTE_BLOQUEE,
    position: 3,
    column: 'planned',
    title: 'Carte bloquée : un choix de compte attend',
    description: 'Son agent porte une reprise de compte ouverte.',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    agentId: AGENT_BLOQUE,
  });
  for (const [id, cardId, role, mode, title] of [
    [AGENT_PLAN, CARTE_PLAN, 'cadrage', 'plan', 'Carte de cadrage : plan à valider'],
    [AGENT_BLOQUE, CARTE_BLOQUEE, 'task', 'direct', 'Carte bloquée'],
  ]) {
    const agent = { id, projectId: PROJET, cardId, role, title, run: { engine: 'claude', thinking: 'none', mode }, status: 'idle', createdAt: maintenant, updatedAt: maintenant };
    db.prepare(
      `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, PROJET, cardId, role, 'idle', JSON.stringify(agent), maintenant, maintenant);
  }
  /* Une demande sur la carte de cadrage : sans elle, le chapitre ne serait pas engagé. */
  const demande = { id: 'm-flux-demande', agentId: AGENT_PLAN, role: 'user', content: 'Je veux un plan.', steps: [], todos: [], proposals: [], questions: [], attachments: [], createdAt: maintenant };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(demande.id, AGENT_PLAN, 'user', JSON.stringify(demande), maintenant);
  /* Un tour coupé dont le choix de compte est encore OUVERT, sur la carte bloquée. */
  const coupe = {
    id: 'm-flux-coupe',
    agentId: AGENT_BLOQUE,
    role: 'assistant',
    content: 'Fable 5.1 requires usage credits.',
    steps: [], todos: [], proposals: [], questions: [], attachments: [],
    repriseCompte: { engine: 'claude', compteEpuise: 'compte-pro', compteEpuiseLabel: 'Compte Pro', motif: 'texte-de-limite', at: maintenant },
    createdAt: maintenant,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(coupe.id, AGENT_BLOQUE, 'assistant', JSON.stringify(coupe), maintenant);
  db.close();
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

const attendreColonne = (id, colonne, limiteMs = 90000) =>
  attendre(() => {
    const carte = laCarte(id);
    return carte?.column === colonne ? carte : null;
  }, limiteMs);

const agentAuRepos = (agentId, limiteMs = 90000) =>
  attendre(() => {
    const agent = lesAgents(laCarte()?.id ?? CARTE).find((a) => a.id === agentId);
    return agent && agent.status !== 'running' && agent.status !== 'starting' ? agent : null;
  }, limiteMs, 300);

async function main() {
  lancerLeDemon();
  if (!(await attendrePort())) {
    noter('le démon d’essai répond', false, journal.join('').slice(-800));
    return;
  }
  poserLeDecor();
  if (!(await redemarrerLeDemon())) {
    noter('le démon d’essai répond après le décor', false, journal.join('').slice(-800));
    return;
  }
  noter('le démon d’essai répond', true, `port ${PORT}`);
  await new Promise((r) => setTimeout(r, 1500));

  /* -------- 1. La limite et la relève automatique -------- */
  await commande({ type: 'card.start', id: CARTE });
  const lancee = await attendreColonne(CARTE, 'running', 30000);
  noter('le lancement pose la carte en « En cours »', !!lancee, lancee ? '' : `colonne « ${laCarte()?.column} »`);
  const agentId = await attendre(() => laCarte()?.agentId, 30000);
  noter('un agent de tâche tient la carte', !!agentId);

  const close = await attendreColonne(CARTE, 'done', 120000);
  noter('le rapport rendu ferme la carte, malgré la limite du premier compte', !!close, close ? '' : `colonne « ${laCarte()?.column} »`);
  await agentAuRepos(agentId);
  let messages = lesMessages(agentId);
  const tombe = messages.find((m) => m.repriseCompte);
  noter('le premier tour est parti sur Pro et est tombé sur sa limite', tombe?.account === 'Compte Pro' && tombe?.repriseCompte?.motif === 'texte-de-limite', `compte « ${tombe?.account ?? '—'} », motif ${tombe?.repriseCompte?.motif ?? '—'}`);
  noter(
    'la relève est partie TOUTE SEULE sur Max, sans question posée',
    tombe?.repriseCompte?.choisi === 'compte-max' && tombe?.repriseCompte?.automatique === true,
    `choisi « ${tombe?.repriseCompte?.choisiLabel ?? '—'} », automatique=${!!tombe?.repriseCompte?.automatique}`,
  );
  noter('la reprise est CONSOMMÉE, une fois', typeof tombe?.repriseCompte?.consommeeA === 'number', `consommeeA=${tombe?.repriseCompte?.consommeeA ?? '—'}`);
  const reprise = messages.find((m) => m.poursuiteDe === tombe?.id);
  noter('le tour de reprise porte le tour qu’il poursuit, et a tourné sur Max', reprise?.account === 'Compte Max' && !reprise?.repriseCompte, `compte « ${reprise?.account ?? '—'} »`);
  noter('aucune consigne de reprise n’apparaît comme un message de l’utilisateur', !messages.some((m) => m.role === 'user' && /REPRISE APRÈS/.test(m.content ?? '')));
  const limites = limitesConnues();
  noter('la limite de Pro est NOTÉE, et persiste en base', limites.some((l) => l.compte === 'compte-pro'), JSON.stringify(limites.map((l) => l.compte)));

  /* -------- 2. Le parcours -------- */
  const entrees = leJournal(CARTE);
  const departs = entrees.filter((e) => e.nature === 'jalon' && e.libelle === 'Tour lancé');
  const poursuite = departs.find((e) => (e.donnees ?? '').includes('poursuiteDe'));
  noter('le jalon « Tour lancé » de la reprise dit qu’il poursuit le tour coupé', !!poursuite, `${departs.length} départ(s)`);
  const points = contenuDesPoints(entrees);
  const parEtape = (etape) => points.filter((p) => p.etape === etape).length;
  noter('la reprise n’ouvre AUCUN point de plus : un seul passage « Travail », un seul « Rapport »', parEtape('travail') === 1 && parEtape('rapport') === 1, `travail ${parEtape('travail')}, rapport ${parEtape('rapport')}`);

  /* -------- 3. Le compte tient d'un tour à l'autre -------- */
  const avant = messages.length;
  await commande({ type: 'agent.prompt', agentId, text: 'Encore un point à revoir.' });
  await attendre(() => lesMessages(agentId).length >= avant + 2, 60000);
  await agentAuRepos(agentId);
  await attendreColonne(CARTE, 'done', 90000);
  messages = lesMessages(agentId);
  const suivant = messages.slice(avant).find((m) => m.role === 'assistant' && !m.streaming);
  noter(
    'le tour suivant part DIRECTEMENT sur Max, sans tomber ni relever',
    suivant?.account === 'Compte Max' && !suivant?.repriseCompte,
    `compte « ${suivant?.account ?? '—'} », reprise=${!!suivant?.repriseCompte}`,
  );
  noter('un seul tour est tombé sur toute la carte', messages.filter((m) => m.repriseCompte).length === 1, `${messages.filter((m) => m.repriseCompte).length} tour(s) tombé(s)`);
  noter('le journal dit le compte retenu d’un tour à l’autre', journal.join('').includes('compte retenu d\'un tour à l\'autre'));

  /* -------- 4. Le plan : validé en un état, puis lancé -------- */
  const contexte = (carte) => ({
    colonne: carte.column,
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: lesMessages(AGENT_PLAN),
    parcours: carte.parcours,
  });
  const avantValidation = gesteDuParcours(contexte(laCarte(CARTE_PLAN)));
  noter(
    'avant validation, le geste est « Valider et lancer », ALLUMÉ : un seul clic valide puis lance',
    avantValidation.geste === 'valider-et-lancer' && avantValidation.possible === true,
    `${avantValidation.geste} / ${avantValidation.possible}`,
  );
  const messagesAvant = lesMessages(AGENT_PLAN).length;
  await commande({ type: 'card.comprehension.validate', cardId: CARTE_PLAN, niveau: 'approfondi' });
  const validee = laCarte(CARTE_PLAN);
  noter(
    '« Valider » écrit la compréhension validée et le niveau sur la carte',
    !!validee?.parcours?.comprehensionValidee && validee?.run?.niveau === 'approfondi',
    JSON.stringify(validee?.parcours?.comprehensionValidee),
  );
  noter('…sans aucun tour : le fil de cadrage n’a pas bougé', lesMessages(AGENT_PLAN).length === messagesAvant && validee?.column === 'planned');
  const apresValidation = gesteDuParcours(contexte(validee));
  noter('après validation, le geste « lancer » s’allume', apresValidation.geste === 'lancer' && apresValidation.possible === true);
  await commande({ type: 'card.start', id: CARTE_PLAN });
  const planLancee = await attendreColonne(CARTE_PLAN, 'running', 30000);
  noter('la carte validée se lance', !!planLancee);
  const planClose = await attendreColonne(CARTE_PLAN, 'done', 120000);
  const agentDePlan = planClose?.agentId ? lesMessages(planClose.agentId) : [];
  noter('son tour de tâche part sur Max, la limite de Pro étant connue', !!planClose && agentDePlan.some((m) => m.account === 'Compte Max') && !agentDePlan.some((m) => m.repriseCompte), planClose ? `${agentDePlan.length} message(s)` : `colonne « ${laCarte(CARTE_PLAN)?.column} »`);

  /* -------- 5. Une décision ouverte refuse le lancement -------- */
  let refus = null;
  try {
    await commande({ type: 'card.start', id: CARTE_BLOQUEE });
  } catch (err) {
    refus = err;
  }
  noter('une carte dont l’agent attend un choix de compte refuse son lancement, en le disant', !!refus && /Lancement refusé/.test(refus.message) && /compte/.test(refus.message), refus?.message ?? 'lancée');
  noter('…et reste dans « Planifié »', laCarte(CARTE_BLOQUEE)?.column === 'planned');

  /* -------- 6. Le redémarrage -------- */
  journal = [];
  noter('la file est vide avant le redémarrage', laFile() === 0, `${laFile()} demande(s)`);
  if (!(await redemarrerLeDemon())) {
    noter('le démon d’essai répond après redémarrage', false, journal.join('').slice(-800));
    return;
  }
  await new Promise((r) => setTimeout(r, 20000));
  noter('aucune « file reprise » ne repart après le redémarrage', !journal.join('').includes('file reprise'), journal.join('').split('\n').filter((l) => l.includes('file reprise')).join(' | '));
  noter('la file est toujours vide', laFile() === 0);
  const tousLesMessages = [agentId, planClose?.agentId].filter(Boolean).flatMap((id) => lesMessages(id));
  noter('aucune reprise ne reste ouverte sur les cartes menées', tousLesMessages.filter((m) => m.repriseCompte).every((m) => m.repriseCompte.choisi && m.repriseCompte.consommeeA));
  noter('la limite connue de Pro a survécu au redémarrage', limitesConnues().some((l) => l.compte === 'compte-pro'));
  noter('les cartes menées sont restées closes', laCarte(CARTE)?.column === 'to_deploy' && laCarte(CARTE_PLAN)?.column === 'to_deploy', `${laCarte(CARTE)?.column}, ${laCarte(CARTE_PLAN)?.column}`);
}

main()
  .catch((err) => noter('le contrôle s’est déroulé sans erreur', false, String(err?.stack ?? err)))
  .finally(() => {
    const echecs = resultats.filter((r) => !r.ok);
    console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
    if (echecs.length) {
      console.log('\nJournal du démon (fin) :\n' + journal.join('').slice(-3000));
    }
    process.exit(echecs.length ? 1 : 0);
  });
