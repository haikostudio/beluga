#!/usr/bin/env node
/**
 * LA DEMANDE ENVOYÉE S'ENREGISTRE ET S'AFFICHE AVANT QUE L'AGENT NE PARTE.
 *
 *   npm run build:server && node scripts/verif-demande-affichee-aussitot.mjs
 *
 * Une phrase envoyée dans une conversation était écrite APRÈS le relevé des
 * quotas, et sa ligne « Demande » dans le parcours de la carte APRÈS le
 * lancement du moteur. Entre les deux, des dizaines de secondes d'écran vide —
 * et rien du tout quand le tour ne partait pas : il fallait redémarrer le démon
 * et recharger l'application pour voir enfin ce qu'on avait écrit.
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un FAUX MOTEUR : le démon de production n'est pas touché, et pas un jeton
 * n'est dépensé. Tout passe par le canal temps réel et la base — pas de
 * navigateur : ce qui est en cause est l'ORDRE des écritures du démon.
 *
 * Ce qui est vérifié :
 *   1. SANS AUCUN COMPTE — donc sans qu'un tour puisse partir — la demande est
 *      quand même enregistrée (la bulle) ET posée dans le parcours de la carte
 *      (la ligne « Demande »), en moins de deux secondes ;
 *   2. …et elle attend en file en EMPORTANT l'identifiant de sa bulle, pour que
 *      son départ plus tard ne la redise pas ;
 *   3. UN COMPTE REVENU — la file repart toute seule et le tour se fait : il
 *      reste UNE seule bulle et UNE seule ligne « Demande », jamais deux ;
 *   4. …et cette ligne PRÉCÈDE « Tour lancé » dans la ligne de temps : la
 *      demande ouvre le parcours, elle ne s'y glisse pas après coup.
 */
import Database from 'better-sqlite3';
import * as ws from 'ws';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur : lancé depuis
// une copie de travail, il jugerait sinon le code du dossier principal.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_DEMANDE_PORT || 7213);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-demande-'));
const PROJET_ID = 'projet-demande';
const DEMANDE = 'Ajoute un bouton pour exporter la liste en CSV';
/** Au-delà, l'affichage n'est plus « immédiat » : c'est une attente. */
const DELAI_MAX_MS = 2000;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor : un vrai dépôt git, un faux moteur qui répond court        */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
/*
 * UN DOSSIER PERSONNEL À SOI. Sans lui, le démon d'essai adopterait le compte
 * Claude RÉEL de la machine (`bootstrapAccounts` lit `~/.claude`) : le contrôle
 * partirait avec un compte alors qu'il commence précisément SANS.
 */
const MAISON = path.join(TMP, 'maison');
const COMPTE = path.join(TMP, 'compte-claude');
for (const dossier of [DATA, PROJETS, DEPOT, MAISON, COMPTE]) fs.mkdirSync(dossier, { recursive: true });
/* Un compte « connecté » : la lecture de quota partira, échouera faute de jeton
   valable, et laissera le compte DISPONIBLE — ce que fait déjà tout relevé
   illisible. Aucun quota réel n'est consulté. */
fs.writeFileSync(
  path.join(COMPTE, '.credentials.json'),
  JSON.stringify({ claudeAiOauth: { accessToken: 'jeton-d-essai', expiresAt: Date.now() + 3600_000 } }),
);

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
/* LE DÉMON ÉPROUVE D'ABORD LE MOTEUR (« --version ») : sans réponse, aucun
   moteur n'est vu installé. */
if (process.argv.includes('--version')) {
  process.stdout.write('faux-moteur 0.0.0 (essai)\\n');
  process.exit(0);
}

let demande = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (demande += d));
process.stdin.on('end', () => jouer());
setTimeout(() => process.stdin.readable && process.stdin.read(), 50);

const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');

async function jouer() {
  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
  await new Promise((r) => setTimeout(r, 200));
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Bien reçu, je regarde.' }] } });
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
      HOME: MAISON,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  demon.stdout.on('data', (d) => journal.push(String(d)));
  demon.stderr.on('data', (d) => journal.push(String(d)));
}

async function arreterLeDemon() {
  if (!demon) return;
  let sorti = false;
  demon.on('exit', () => (sorti = true));
  demon.kill('SIGKILL');
  await attendre(() => sorti, 15000, 200);
  demon = null;
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

const attendre = async (lire, limiteMs = 30000, pasMs = 150) => {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const vu = lire();
    if (vu) return vu;
    await new Promise((r) => setTimeout(r, pasMs));
  }
  return null;
};

/* ------------------------------------------------------------------ */
/* La base : une session d'une heure, un projet, AUCUN compte           */
/* ------------------------------------------------------------------ */

const jeton = crypto.randomBytes(24).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const base = (lecture = false) => new Database(path.join(DATA, 'beluga.db'), { readonly: lecture });

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification demande affichée',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai demande',
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
  /* AUCUN COMPTE pour commencer : c'est tout l'intérêt du premier temps — le
     tour ne peut PAS partir, et la demande doit s'afficher quand même. */
  db.prepare('DELETE FROM accounts').run();
  db.close();
}

function poserLeCompte() {
  const db = base();
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'compte-essai',
    'claude',
    JSON.stringify({
      id: 'compte-essai',
      engine: 'claude',
      label: 'Compte d’essai',
      priority: 1,
      configDir: COMPTE,
    }),
    Date.now(),
  );
  db.close();
}

const messagesDe = (agentId) => {
  const db = base(true);
  const lignes = db
    .prepare('SELECT data FROM messages WHERE agent_id = ? ORDER BY created_at')
    .all(agentId)
    .map((l) => JSON.parse(l.data));
  db.close();
  return lignes;
};

const journalDe = (cardId) => {
  const db = base(true);
  const lignes = db
    .prepare('SELECT rang, nature, libelle, resultat, donnees FROM card_journal WHERE card_id = ? ORDER BY rang')
    .all(cardId);
  db.close();
  return lignes;
};

const fileDe = (agentId) => {
  const db = base(true);
  const lignes = db
    .prepare('SELECT data FROM queue WHERE agent_id = ? ORDER BY position')
    .all(agentId)
    .map((l) => JSON.parse(l.data));
  db.close();
  return lignes;
};

function commande(cmd, limiteMs = 40000) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: `beluga_session=${jeton}` },
    });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), limiteMs);
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

async function main() {
  /*
   * LE SCHÉMA DE LA BASE APPARTIENT AU DÉMON : on le laisse le créer, on pose
   * le décor dans la base ainsi née, puis on relance.
   */
  lancerLeDemon();
  if (!(await attendrePort())) {
    noter('le démon d’essai répond', false, journal.join('').slice(-800));
    return;
  }
  poserLeDecor();
  await arreterLeDemon();
  lancerLeDemon();
  if (!(await attendrePort())) {
    noter('le démon d’essai répond', false, journal.join('').slice(-800));
    return;
  }
  noter('le démon d’essai répond', true, `port ${PORT}`);

  /* -------- 1. Une carte neuve et sa conversation de cadrage -------- */

  const nee = await commande({
    type: 'card.create',
    projectId: PROJET_ID,
    title: '',
    description: '',
    cadrage: true,
  });
  const carte = nee?.data?.card;
  const agent = nee?.data?.agent;
  noter('la carte neuve ouvre sa conversation de cadrage', !!carte?.id && !!agent?.id, carte?.id ?? 'aucune carte');
  if (!carte?.id || !agent?.id) return;

  /* -------- 2. La demande, SANS aucun compte pour la porter -------- */

  const envoyeeA = Date.now();
  await commande({ type: 'agent.prompt', agentId: agent.id, text: DEMANDE });

  const bulle = await attendre(
    () => messagesDe(agent.id).find((m) => m.role === 'user' && m.content === DEMANDE),
    10000,
    100,
  );
  const delaiBulle = Date.now() - envoyeeA;
  noter(
    'la demande est ENREGISTRÉE alors qu’aucun compte ne peut la porter',
    !!bulle,
    bulle ? `en ${delaiBulle} ms` : 'aucune bulle écrite',
  );
  noter(
    '…et elle l’est tout de suite, pas au bout d’une attente',
    !!bulle && delaiBulle <= DELAI_MAX_MS,
    `${delaiBulle} ms (plafond ${DELAI_MAX_MS} ms)`,
  );

  const ligne = await attendre(
    () => journalDe(carte.id).find((e) => e.libelle === 'Demande'),
    10000,
    100,
  );
  const delaiLigne = Date.now() - envoyeeA;
  noter(
    'la demande OUVRE le parcours de la carte, sans attendre le moteur',
    !!ligne && ligne.resultat === DEMANDE,
    ligne ? `en ${delaiLigne} ms` : 'aucune ligne « Demande »',
  );
  noter(
    '…et le parcours la porte tout de suite, lui aussi',
    !!ligne && delaiLigne <= DELAI_MAX_MS,
    `${delaiLigne} ms (plafond ${DELAI_MAX_MS} ms)`,
  );

  /* -------- 3. Elle attend en file, avec l'identifiant de sa bulle -------- */

  const enFile = await attendre(() => fileDe(agent.id)[0], 15000, 200);
  noter(
    'faute de quota, la demande attend en file',
    !!enFile && enFile.text === DEMANDE,
    enFile ? `1 demande en file` : 'file vide',
  );
  noter(
    '…en emportant l’identifiant de sa bulle, pour ne pas la redire au départ',
    !!enFile && !!bulle && enFile.messageId === bulle.id,
    enFile ? `messageId « ${enFile.messageId ?? '—'} »` : 'file vide',
  );

  /* -------- 4. Le compte revient : la file repart, sans doublon -------- */

  await arreterLeDemon();
  poserLeCompte();
  lancerLeDemon();
  if (!(await attendrePort())) {
    noter('le démon repart avec un compte', false, journal.join('').slice(-800));
    return;
  }

  // Le filet de veille reprend les files en attente toutes les quinze secondes.
  const partie = await attendre(() => (fileDe(agent.id).length === 0 ? true : null), 90000, 500);
  noter('la file repart toute seule dès qu’un compte est disponible', !!partie, partie ? '' : 'la file n’a pas bougé');

  const reponse = await attendre(
    () => messagesDe(agent.id).find((m) => m.role === 'assistant' && !m.error && (m.content ?? '').trim()),
    90000,
    500,
  );
  noter('le tour se fait pour de bon', !!reponse, reponse ? '' : 'aucune réponse rendue');

  const bulles = messagesDe(agent.id).filter((m) => m.role === 'user' && m.content === DEMANDE);
  noter(
    'la demande n’a été écrite QU’UNE FOIS, malgré son passage par la file',
    bulles.length === 1,
    `${bulles.length} bulle(s)`,
  );

  const entrees = journalDe(carte.id);
  const demandes = entrees.filter((e) => e.libelle === 'Demande');
  noter(
    '…et le parcours ne porte qu’UNE ligne « Demande »',
    demandes.length === 1,
    `${demandes.length} ligne(s)`,
  );

  const lance = entrees.find((e) => e.libelle === 'Tour lancé');
  noter(
    'la demande PRÉCÈDE le lancement du tour dans la ligne de temps',
    !!lance && demandes.length === 1 && demandes[0].rang < lance.rang,
    lance ? `demande rang ${demandes[0]?.rang}, tour lancé rang ${lance.rang}` : 'aucun « Tour lancé »',
  );
}

main()
  .catch((err) => noter('le contrôle est allé au bout', false, String(err?.message ?? err)))
  .then(() => {
    const echecs = resultats.filter((r) => !r.ok).length;
    console.log(`\n${resultats.length - echecs}/${resultats.length} contrôle(s) au vert`);
    if (echecs) console.log(journal.join('').slice(-2000));
    process.exit(echecs ? 1 : 0);
  });
