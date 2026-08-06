#!/usr/bin/env node
/**
 * Un projet peut déclarer que sa branche principale déclenche un déploiement
 * automatique chez le client. Quand c'est le cas, la publication S'ARRÊTE avant
 * le moindre envoi et pose une décision : rien ne part tant que le clic n'est
 * pas donné, un refus laisse le lot intact, un accord envoie pour de bon.
 *
 *   node scripts/verif-envoi-surveille.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve, un
 * dépôt d'essai et son « origin » local : le démon de production et GitHub ne
 * sont jamais touchés. Aucun quota n'est dépensé — la commande de publication
 * du projet d'essai est un `true`, et aucun agent ne tourne.
 *
 * La preuve tient dans `git log origin/main` : c'est le dépôt distant lui-même
 * qui dit si quelque chose est parti, jamais l'écran.
 */
import Database from 'better-sqlite3';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* La racine se déduit du script : lancé depuis une copie de travail, il doit
   juger CE code-là, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7207);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-envoi-surveille-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un dépôt d'essai, son « origin », et un démon à soi                 */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
const ORIGIN = path.join(TMP, 'origin.git');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

const git = (args, cwd = DEPOT) =>
  execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

execFileSync('git', ['init', '-q', '--bare', '-b', 'main', ORIGIN]);
git(['init', '-q', '-b', 'main']);
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
git(['add', 'README.md']);
git(['commit', '-qm', 'départ']);
git(['remote', 'add', 'origin', ORIGIN]);
git(['push', '-qu', 'origin', 'main']);

/* Une branche de carte, avec un enregistrement à elle : c'est ce que l'envoi
   emporterait. */
git(['checkout', '-q', '-b', 'tache/essai-envoi']);
fs.writeFileSync(path.join(DEPOT, 'nouveau.txt'), 'du travail\n');
git(['add', 'nouveau.txt']);
git(['commit', '-qm', 'Ajoute le fichier de la carte']);
git(['checkout', '-q', 'main']);

/** Ce que le dépôt DISTANT contient réellement, la seule preuve qui vaille. */
const enregistrementsDistants = () =>
  git(['log', '--format=%s', 'origin/main'], DEPOT).split('\n').filter(Boolean);

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
/* Le décor : un projet déclaré « se déploie sur envoi », une carte    */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-envoi';
const CARTE_ID = 'c-envoi';

function poserLeDecor(deployeSurEnvoi) {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT OR REPLACE INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification envoi surveillé',
  );

  db.prepare('DELETE FROM projects').run();
  db.prepare('DELETE FROM cards').run();
  db.prepare('DELETE FROM deploys').run();

  const projet = {
    id: PROJET_ID,
    name: 'Site du client',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    // Une commande de publication : elle suffit à rendre la mise en ligne
    // possible sans aucun droit d'administration (mémoire n°144).
    deployCommand: 'true',
    deployeSurEnvoi,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    title: 'Carte d’essai — envoi surveillé',
    description: 'Carte fabriquée par le script de vérification.',
    labels: [],
    column: 'to_deploy',
    position: 1,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    github: { branch: 'tache/essai-envoi' },
    excludedFromDeploy: false,
    horsTache: false,
    codeDejaEnregistre: true,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(carte.id, PROJET_ID, 'to_deploy', 1, carte.title, JSON.stringify(carte), maintenant, maintenant);
  db.close();
}

/** La carte telle qu'elle est en base : colonne et raison d'attente. */
function carteEnBase() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const ligne = db.prepare('SELECT column_key AS colonne, data FROM cards WHERE id = ?').get(CARTE_ID);
  db.close();
  const carte = JSON.parse(ligne.data);
  return { colonne: ligne.colonne, raison: carte?.scheduling?.waitingReason ?? '', deployedAt: carte?.deployedAt };
}

/* ------------------------------------------------------------------ */
/* Parler au démon par la vraie liaison                                */
/* ------------------------------------------------------------------ */

/**
 * UNE seule liaison pour tout le script : c'est elle qui envoie les commandes
 * et qui reçoit les événements poussés — dont `attention`, par lequel le
 * triangle orange s'allume.
 */
let liaison = null;
const evenements = [];
const enAttenteDeReponse = new Map();

async function ouvrirLaLiaison() {
  liaison = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
    headers: { cookie: `haikodev_session=${JETON}` },
  });
  liaison.addEventListener('message', (evenement) => {
    const trame = JSON.parse(String(evenement.data));
    if (trame.id && enAttenteDeReponse.has(trame.id)) {
      const resoudre = enAttenteDeReponse.get(trame.id);
      enAttenteDeReponse.delete(trame.id);
      resoudre(trame);
      return;
    }
    evenements.push(trame);
  });
  await new Promise((resolve, reject) => {
    liaison.addEventListener('open', resolve, { once: true });
    liaison.addEventListener('error', reject, { once: true });
  });
}

function appelDemon(commande, limiteMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const minuteur = setTimeout(() => {
      enAttenteDeReponse.delete(id);
      reject(new Error('le démon ne répond pas'));
    }, limiteMs);
    enAttenteDeReponse.set(id, (trame) => {
      clearTimeout(minuteur);
      resolve(trame);
    });
    liaison.send(JSON.stringify({ id, cmd: commande }));
  });
}

/** Le dernier signal d'attention reçu : le compte par projet et ses décisions. */
const dernierSignalAttention = () => [...evenements].reverse().find((t) => t.type === 'attention') ?? null;

/** La dernière publication du projet, lue en base. */
function derniereePublication() {
  const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
  const ligne = db
    .prepare('SELECT data FROM deploys WHERE project_id = ? ORDER BY started_at DESC LIMIT 1')
    .get(PROJET_ID);
  db.close();
  return ligne ? JSON.parse(ligne.data) : null;
}

/** Attendre qu'une publication atteigne l'un des états annoncés. */
async function attendreEtat(etats, limiteMs = 90000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const run = derniereePublication();
    if (run && etats.includes(run.state)) return run;
    await new Promise((r) => setTimeout(r, 400));
  }
  return derniereePublication();
}

/* ------------------------------------------------------------------ */
/* Le déroulé                                                          */
/* ------------------------------------------------------------------ */

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }

  /* --- 1. Projet MARQUÉ : la publication s'arrête avant tout envoi --- */
  poserLeDecor(true);
  await ouvrirLaLiaison();
  const avant = enregistrementsDistants();

  const depart = await appelDemon({ type: 'deploy.start', projectId: PROJET_ID });
  noter('la publication démarre sans être refusée', depart.ok !== false, depart.error ?? '');

  const attente = await attendreEtat(['awaiting', 'failed', 'success'], 30000);
  noter('elle s’arrête et attend l’accord', attente?.state === 'awaiting', `état « ${attente?.state} »`);
  noter(
    'la décision nomme le projet, la branche et ce qui partirait',
    Boolean(
      attente?.attente?.texte?.includes('Site du client') &&
        attente?.attente?.texte?.includes('« main »') &&
        attente?.attente?.texte?.includes('Ajoute le fichier de la carte'),
    ),
    (attente?.attente?.texte ?? '').split('\n')[0],
  );

  const apresAttente = enregistrementsDistants();
  noter(
    'rien n’est parti sur le dépôt distant',
    JSON.stringify(apresAttente) === JSON.stringify(avant),
    `origin/main : ${apresAttente.join(' · ')}`,
  );
  noter(
    'aucune étape n’a été jouée : le dépôt n’a pas été touché',
    (attente?.steps ?? []).every((etape) => etape.state === 'todo'),
  );

  const signal = dernierSignalAttention();
  noter(
    'le projet allume son triangle : une décision attendue de plus',
    (signal?.byProject?.[PROJET_ID] ?? 0) >= 1,
    JSON.stringify(signal?.byProject ?? {}),
  );
  noter(
    'cette décision est bien celle de l’envoi, sans conversation à ouvrir',
    (signal?.decisions ?? []).some((d) => d.genre === 'envoi' && d.projectId === PROJET_ID && !d.agentId),
  );

  const carteEnAttente = carteEnBase();
  noter(
    'la carte du lot dit pourquoi elle ne part pas',
    carteEnAttente.raison.includes('accord est attendu'),
    carteEnAttente.raison,
  );

  /* --- 2. Refus : le lot reste intact, et l'écrit --- */
  const refus = await appelDemon({ type: 'deploy.envoi', runId: attente.id, accord: false });
  noter('le refus est accepté par le démon', refus.ok !== false, refus.error ?? '');

  const apresRefus = enregistrementsDistants();
  noter(
    'après refus, toujours rien sur le dépôt distant',
    JSON.stringify(apresRefus) === JSON.stringify(avant),
    `origin/main : ${apresRefus.join(' · ')}`,
  );
  const carteRefusee = carteEnBase();
  noter('la carte reste dans « À déployer »', carteRefusee.colonne === 'to_deploy', carteRefusee.colonne);
  noter('la carte n’est pas marquée publiée', !carteRefusee.deployedAt);
  noter('le refus est écrit sur la carte', carteRefusee.raison.includes('refusé'), carteRefusee.raison);
  const runRefuse = derniereePublication();
  noter('la publication refusée ne se dit pas réussie', runRefuse?.state === 'stopped', runRefuse?.state);

  /* --- 3. Accord : l'envoi part pour de bon --- */
  const relance = await appelDemon({ type: 'deploy.start', projectId: PROJET_ID });
  noter('une nouvelle publication redemande l’accord', relance.ok !== false, relance.error ?? '');
  const attente2 = await attendreEtat(['awaiting', 'failed', 'success'], 30000);
  noter('elle attend de nouveau', attente2?.state === 'awaiting', `état « ${attente2?.state} »`);

  await appelDemon({ type: 'deploy.envoi', runId: attente2.id, accord: true }, 120000);
  const fini = await attendreEtat(['success', 'failed', 'stopped'], 180000);
  noter('après accord, la publication va au bout', fini?.state === 'success', fini?.error ?? fini?.state);
  const apresAccord = enregistrementsDistants();
  noter(
    'après accord, le travail est bien parti sur le dépôt distant',
    apresAccord.includes('Ajoute le fichier de la carte'),
    `origin/main : ${apresAccord.slice(0, 3).join(' · ')}`,
  );
  noter(
    'l’accord fait repartir LA MÊME publication, pas une seconde ligne',
    fini?.id === attente2?.id,
    `${attente2?.id} → ${fini?.id}`,
  );
  noter('la mention d’envoi est effacée de la carte', !carteEnBase().raison.includes('accord est attendu'));

  /* --- 4. Projet NON marqué : rien ne change --- */
  poserLeDecor(false);
  git(['push', '-q', '--force', 'origin', 'main']);
  git(['checkout', '-q', '-B', 'tache/essai-envoi', 'main']);
  fs.writeFileSync(path.join(DEPOT, 'encore.txt'), 'suite\n');
  git(['add', 'encore.txt']);
  git(['commit', '-qm', 'Ajoute un second fichier']);
  git(['checkout', '-q', 'main']);

  await appelDemon({ type: 'deploy.start', projectId: PROJET_ID });
  const sansAttente = await attendreEtat(['success', 'failed', 'stopped', 'awaiting'], 180000);
  noter(
    'un projet non marqué ne demande rien et part directement',
    sansAttente?.state === 'success',
    sansAttente?.error ?? sansAttente?.state,
  );
  noter(
    'son travail est parti sur le dépôt distant',
    enregistrementsDistants().includes('Ajoute un second fichier'),
    (sansAttente?.steps ?? [])
      .map((e) => `${e.key}:${e.state}`)
      .join(' ') + ` | ${enregistrementsDistants().slice(0, 3).join(' · ')}`,
  );

  // La liaison reste ouverte tant qu'on ne la ferme pas : sans cela le script
  // affiche son bilan puis ne rend jamais la main.
  liaison?.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passent.`);
  if (echecs.length) {
    console.log('Journal du démon :\n' + journal.join('').slice(-2000));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((souci) => {
  console.error(souci);
  console.log('Journal du démon :\n' + journal.join('').slice(-2000));
  process.exit(1);
});
