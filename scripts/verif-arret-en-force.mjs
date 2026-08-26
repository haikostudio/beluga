#!/usr/bin/env node
/**
 * LES TROIS BOUTONS D'ARRÊT, ÉPROUVÉS SUR UN VRAI PROCESSUS QUI REFUSE DE
 * S'ARRÊTER.
 *
 *   node scripts/verif-arret-en-force.mjs
 *
 * Trois endroits promettent de reprendre la main : le bouton d'arrêt D'UN agent
 * (conversation ou carte), le bouton d'arrêt de TOUS les agents (en haut), et le
 * redémarrage du serveur (en bas de la colonne de gauche). Lire le code ne
 * prouve rien ici : tout se joue sur un moteur qui IGNORE son signal — c'est le
 * cas réel du « j'ai cliqué et rien ne se passe ».
 *
 * Le décor est donc fait de VRAIS processus. Le faux moteur est un shell qui
 * pose `trap '' TERM`, lance un enfant à lui (le pont d'outils du cas réel) et
 * dort cinq minutes. Le démon est un VRAI démon, monté sur un port et une base à
 * lui : le démon de production n'est jamais touché — et pour cause, c'est
 * l'arrêt du serveur d'essai qu'on observe à la fin.
 *
 * Ce qui est vérifié, dans l'ordre :
 *   1. le bouton d'UN agent coupe le moteur récalcitrant ET sa descendance,
 *      puis DIT ce qu'il a fait ;
 *   2. le bouton de TOUS les agents fait de même sur plusieurs à la fois, et
 *      rend un bilan qui nomme les gestes (coupé / refermé d'autorité) ;
 *   3. le redémarrage ORDINAIRE reste refusé tant qu'un agent travaille ;
 *   4. le redémarrage FORCÉ passe outre : le démon quitte pour de bon, et le
 *      moteur récalcitrant ne lui survit pas.
 *
 * Aucun moteur de langage n'est appelé, pas un jeton n'est dépensé.
 */
import ws from '/root/haikodev/node_modules/ws/index.js';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_ARRET_PORT || 7196);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-arret-force-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ce numéro de processus répond-il encore ? Le signal 0 ne tue rien, il constate. */
function vivant(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/* ------------------------------------------------------------------ */
/* Le décor : un dépôt, un démon d'essai, un moteur qui n'obéit pas    */
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

/*
 * LE MOTEUR QUI FAIT LA SOURDE OREILLE. `trap '' TERM` lui fait ignorer le
 * signal d'arrêt, exactement comme un processus pendu dans un appel qui ne
 * revient jamais ; `sleep 300 &` lui donne une descendance, celle qui gardait la
 * sortie ouverte et empêchait le tour de se refermer. Il écrit son propre numéro
 * et celui de son enfant dans un fichier, pour qu'on puisse les constater après.
 */
const TEMOINS = path.join(TMP, 'temoins');
fs.mkdirSync(TEMOINS, { recursive: true });
const FAUX_MOTEUR = path.join(TMP, 'faux-claude.sh');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/bin/bash
# Le démon éprouve d'abord le moteur ('--version') : cette question-là se
# répond tout de suite, sinon le serveur n'achève jamais son démarrage.
for arg in "$@"; do
  if [ "$arg" = "--version" ]; then
    echo "faux-moteur 0.0.0 (essai)"
    exit 0
  fi
done
trap '' TERM
cat >/dev/null &
sleep 300 &
enfant=$!
echo "$$ $enfant" > ${TEMOINS}/$$.txt
wait $enfant
exit 0
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

/** Les couples (moteur, enfant) que les faux moteurs ont déclarés. */
function moteursLances() {
  return fs
    .readdirSync(TEMOINS)
    .map((nom) => fs.readFileSync(path.join(TEMOINS, nom), 'utf8').trim().split(/\s+/).map(Number))
    .filter(([moteur, enfant]) => Number.isInteger(moteur) && Number.isInteger(enfant))
    .map(([moteur, enfant]) => ({ moteur, enfant }));
}

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
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
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));
let sorti = false;
demon.on('exit', () => (sorti = true));

function nettoyer() {
  // On achève ce qui traîne : ce script est le père de tout ce petit monde, et
  // il ne laisse aucun `sleep 300` derrière lui.
  for (const { moteur, enfant } of moteursLances()) {
    for (const pid of [moteur, enfant]) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* déjà parti */
      }
    }
  }
  try {
    demon.kill('SIGKILL');
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
    await dormir(500);
  }
  return false;
}

async function attendre(condition, limiteMs = 20000, pasMs = 300) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await dormir(pasMs);
  }
  return false;
}

const { cheminDossierDeCarte, nomDeBranche } = await import(
  pathToFileURL(path.join(RACINE, 'shared', 'dist', 'index.js')).href
);

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const AGENTS = ['ag-un', 'ag-deux'];
/* Le troisième porte une CARTE, une branche et une copie de travail : c'est le
   seul qui a du travail à sauver avant la coupure. */
const AGENT_CARTE = 'ag-carte';
const CARTE_ID = 'c-essai';
const CARTE_TITRE = 'Carte coupée en vol';
const FICHIER_EN_COURS = 'travail-en-cours.txt';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification arrêt en force',
  );

  const projet = {
    id: PROJET_ID,
    name: 'Essai arrêt',
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

  for (const id of AGENTS) {
    const agent = {
      id,
      projectId: PROJET_ID,
      role: 'cadrage',
      title: `Conversation ${id}`,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status: 'idle',
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, PROJET_ID, null, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);
  }

  /*
   * LA CARTE QUI A DU TRAVAIL À SAUVER. Sa copie de travail est un VRAI
   * `git worktree` sur une VRAIE branche, avec un fichier écrit et pas encore
   * enregistré — exactement l'état d'un agent qu'on coupe en plein vol.
   */
  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    title: CARTE_TITRE,
    description: 'Une carte dont le travail ne doit pas se perdre.',
    column: 'running',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(carte.id, PROJET_ID, 'running', 1, carte.title, JSON.stringify(carte), maintenant, maintenant);

  const agentDeCarte = {
    id: AGENT_CARTE,
    projectId: PROJET_ID,
    cardId: CARTE_ID,
    role: 'task',
    title: CARTE_TITRE,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(AGENT_CARTE, PROJET_ID, CARTE_ID, 'task', 'idle', JSON.stringify(agentDeCarte), maintenant, maintenant);

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

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: `haikodev_session=${jeton}` },
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

/** Lance un vrai tour sur cet agent, et attend que son moteur soit là. */
async function lancerUnTour(agentId, attendus) {
  await commande({ type: 'agent.prompt', agentId, text: 'travaille longtemps' });
  await attendre(() => moteursLances().length >= attendus, 30000, 200);
  // Le shell doit avoir eu le temps de poser son `trap` et son enfant.
  await dormir(600);
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  /* La copie de travail de la carte, avec du travail NON enregistré dedans. */
  const COPIE = cheminDossierDeCarte(DEPOT, CARTE_TITRE, CARTE_ID);
  const BRANCHE = nomDeBranche(CARTE_TITRE, CARTE_ID);
  execFileSync('git', ['worktree', 'add', '-q', '-b', BRANCHE, COPIE], { cwd: DEPOT });
  fs.writeFileSync(path.join(COPIE, FICHIER_EN_COURS), 'du travail que personne ne doit perdre\n');

  /* ---------------- 1. Le bouton d'arrêt D'UN agent ---------------- */

  await lancerUnTour(AGENTS[0], 1);
  const premier = moteursLances()[0];
  noter(
    'le décor pose bien un moteur qui ignore son signal, avec sa descendance',
    !!premier && vivant(premier.moteur) && vivant(premier.enfant),
    premier ? `moteur ${premier.moteur}, enfant ${premier.enfant}` : 'aucun moteur lancé',
  );

  const arret = await commande({ type: 'agent.stop', agentId: AGENTS[0] });
  noter('le bouton d’UN agent répond tout de suite', arret.ok !== false, JSON.stringify(arret.data ?? {}));
  noter(
    'et il DIT ce qu’il a fait (coupé, refermé d’autorité, ou déjà inactif)',
    typeof arret.data?.message === 'string' && arret.data.message.length > 10,
    arret.data?.message ?? '(rien)',
  );
  noter(
    'le geste est nommé',
    ['coupe', 'secours', 'inactif'].includes(arret.data?.geste),
    String(arret.data?.geste),
  );

  const moteurParti = await attendre(async () => !vivant(premier.moteur), 12000, 250);
  noter(
    'le moteur RÉCALCITRANT est coupé pour de bon, sans terminal',
    moteurParti,
    `moteur ${premier?.moteur}`,
  );
  const enfantParti = await attendre(async () => !vivant(premier.enfant), 8000, 250);
  noter('sa DESCENDANCE part avec lui', enfantParti, `enfant ${premier?.enfant}`);

  const libere = await attendre(async () => {
    const etat = await commande({ type: 'daemon.status' });
    return (etat.data?.etat?.agentsEnCours ?? 0) === 0;
  }, 15000);
  noter('l’agent cesse enfin de se dire au travail', libere);

  /* ---------------- 2. Le bouton d'arrêt de TOUS les agents ---------------- */

  await lancerUnTour(AGENTS[0], 2);
  await lancerUnTour(AGENTS[1], 3);
  const avantTout = moteursLances();
  const enCours = avantTout.filter((m) => vivant(m.moteur));
  noter('deux moteurs récalcitrants tournent en même temps', enCours.length >= 2, `${enCours.length} vivants`);

  const tout = await commande({ type: 'agents.stop-all' });
  noter('le bouton de TOUS les agents répond tout de suite', tout.ok !== false);
  noter(
    'son bilan NOMME les gestes faits, au lieu d’un simple nombre',
    /moteur|tour|agent/i.test(tout.data?.bilan?.message ?? ''),
    tout.data?.bilan?.message ?? '(aucun bilan)',
  );
  noter(
    'le bilan compte au moins les deux agents touchés',
    (tout.data?.bilan?.total ?? 0) >= 2,
    `total ${tout.data?.bilan?.total}`,
  );

  const tousPartis = await attendre(async () => enCours.every((m) => !vivant(m.moteur)), 15000, 250);
  noter('les deux moteurs récalcitrants sont coupés', tousPartis);
  const toutesDescendances = await attendre(async () => enCours.every((m) => !vivant(m.enfant)), 8000, 250);
  noter('leurs descendances aussi', toutesDescendances);

  /* ---------------- 3 & 4. Le redémarrage, retenu puis FORCÉ ---------------- */

  await lancerUnTour(AGENTS[0], avantTout.length + 1);
  const tenace = moteursLances().find((m) => vivant(m.moteur));
  noter('un dernier moteur récalcitrant retient le serveur', !!tenace, tenace ? `moteur ${tenace.moteur}` : '');

  const enTravail = await attendre(async () => {
    const etat = await commande({ type: 'daemon.status' });
    return (etat.data?.etat?.agentsEnCours ?? 0) > 0;
  });
  noter('le démon voit bien un agent au travail', enTravail);

  const ordinaire = await commande({ type: 'daemon.restart' });
  noter(
    'le redémarrage ORDINAIRE reste refusé : la règle d’attente ne bouge pas',
    ordinaire.data?.ok === false,
    JSON.stringify(ordinaire.data ?? {}),
  );
  noter('et il dit pourquoi', /agent/i.test(ordinaire.data?.raison ?? ''), ordinaire.data?.raison ?? '(aucune)');
  noter('le serveur n’a PAS quitté', !sorti);

  /*
   * L'agent de la CARTE part lui aussi : c'est son travail non enregistré qui
   * doit être sauvé — et DIT dans sa conversation — avant la coupure.
   */
  await lancerUnTour(AGENT_CARTE, moteursLances().length + 1);

  const force = await commande({ type: 'daemon.restart', force: true });
  noter('le redémarrage FORCÉ est accepté', force.data?.ok === true, JSON.stringify(force.data ?? {}));

  const quitte = await attendre(() => sorti, 20000, 250);
  noter('le serveur s’arrête pour de bon, sans ouvrir un terminal', quitte);

  const tenaceParti = await attendre(async () => !tenace || !vivant(tenace.moteur), 12000, 250);
  noter(
    'le moteur qui le retenait ne lui survit pas',
    tenaceParti,
    tenace ? `moteur ${tenace.moteur}` : '(aucun)',
  );

  /* ------- Le travail sauvé, et DIT dans la conversation de l'agent ------- */

  const surLaBranche = execFileSync('git', ['show', '--name-only', '--format=%s', BRANCHE], {
    cwd: DEPOT,
    encoding: 'utf8',
  });
  noter(
    'le travail non enregistré de la carte est bien sauvé sur SA branche avant la coupure',
    surLaBranche.includes(FICHIER_EN_COURS),
    surLaBranche.split('\n').slice(0, 2).join(' · '),
  );

  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const dits = db
    .prepare('SELECT data FROM messages WHERE agent_id = ?')
    .all(AGENT_CARTE)
    .map((ligne) => JSON.parse(ligne.data).content ?? '');
  db.close();
  const annonce = dits.find((texte) => texte.includes(FICHIER_EN_COURS));
  noter(
    'et la CONVERSATION de l’agent dit ce qui a été enregistré, fichier par fichier',
    !!annonce,
    (annonce ?? dits.join(' | ')).slice(0, 140),
  );
  noter(
    'elle nomme aussi la branche où le retrouver',
    !!annonce && annonce.includes(BRANCHE),
    BRANCHE,
  );

  /* ---------------- Le refus de sûreté ---------------- */

  noter('le père de tout ce monde — ce script — est toujours vivant', vivant(process.pid));

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(journal.join('').slice(-3000));
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.join('').slice(-3000));
  process.exit(1);
});
