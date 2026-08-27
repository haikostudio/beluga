#!/usr/bin/env node
/**
 * JAMAIS DE REDÉMARRAGE TANT QU'UNE TÂCHE TOURNE.
 *
 *   node scripts/verif-redemarrage-attend-tache.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve —
 * le démon de production n'est jamais touché, et pour cause : c'est justement
 * son redémarrage réel qu'on observe ici. Un « moteur » factice (un script qui
 * dort quelques secondes puis sort) tient lieu d'agent réellement AU TRAVAIL —
 * pas une ligne posée en base, mais un vrai processus dans la table `live` du
 * démon, celle que regarde le bouton de redémarrage.
 *
 * Ce qui est vérifié :
 *   1. tant que le faux moteur tourne, une demande de redémarrage — au clic
 *      dans un vrai navigateur comme par commande brute — est REFUSÉE et
 *      RETENUE, jamais exécutée ;
 *   2. le bouton passe sur « Redémarrage requis », et la fenêtre NOMME ce
 *      qu'elle va interrompre avant d'offrir de FORCER ;
 *   3. dès que le faux moteur se termine, le redémarrage retenu part tout
 *      seul, sans neuf geste.
 */
import { chromium } from 'playwright';
import ws from '/root/haikodev/node_modules/ws/index.js';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7192);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-redemarrage-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un faux moteur : un vrai processus qui dort, puis sort              */
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

const FAUX_MOTEUR = path.join(TMP, 'faux-claude.sh');
const DUREE_S = 6;
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/bin/sh\ncat >/dev/null &\nsleep ${DUREE_S}\nexit 0\n`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

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
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function attendre(condition, limiteMs = 15000, pasMs = 300) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, pasMs));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le décor : un projet, un agent AU REPOS (le vrai travail part par WS) */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const AGENT_ID = 'ag-essai';

function base(readonly = false) {
  return new Database(path.join(DATA, 'haikodev.db'), readonly ? { readonly: true } : undefined);
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification redémarrage',
  );

  const projet = {
    id: PROJET_ID,
    name: 'Essai redémarrage',
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

  const compte = {
    id: 'compte-essai',
    engine: 'claude',
    label: 'Compte d’essai',
    priority: 1,
    configDir: path.join(TMP, 'claude-config'),
  };
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    compte.id,
    compte.engine,
    JSON.stringify(compte),
    maintenant,
  );

  db.close();
}

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: `haikodev_session=${jeton}` } });
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
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const boutonRedemarrage = page.getByRole('button', { name: /Redémarrer le serveur|Redémarrage/ });
  noter('le bouton de redémarrage est visible, au repos', (await boutonRedemarrage.count()) === 1);

  /* -------- 1. Lance une vraie tâche (le faux moteur, un vrai processus) -------- */

  const envoi = await commande({ type: 'agent.prompt', agentId: AGENT_ID, text: 'dis bonjour' });
  noter('la demande part sans erreur', envoi.ok !== false, JSON.stringify(envoi));

  const enTravail = await attendre(async () => {
    const etat = await commande({ type: 'daemon.status' });
    return (etat.data?.etat?.agentsEnCours ?? 0) > 0;
  });
  noter('le démon voit un agent réellement au travail', enTravail);

  /* -------- 2. Demande un redémarrage pendant que ça tourne -------- */

  const refus = await commande({ type: 'daemon.restart' });
  noter('le redémarrage est REFUSÉ tant que l’agent travaille', refus.data?.ok === false, JSON.stringify(refus));
  noter(
    'la raison nomme l’agent au travail',
    /agent/i.test(refus.data?.raison ?? ''),
    refus.data?.raison ?? '(aucune)',
  );
  noter('le processus du démon n’a PAS quitté', !sorti);

  /*
   * ON VISE LE BOUTON PAR SON REPÈRE, JAMAIS PAR SON TEXTE. `:has-text()` ignore
   * la casse : « Essai redémarrage », le nom du projet de ce décor, matchait
   * « Redémarrage » et recevait le clic à sa place. La fenêtre ne s'ouvrait donc
   * jamais, et le bloc qui la vérifiait — muet — n'en disait rien.
   */
  await page.click('[data-bouton-redemarrage]');
  await page.waitForTimeout(600);
  const dialogue = page.getByRole('dialog').filter({ hasText: 'Redémarrer le serveur ?' });

  /*
   * LA FENÊTRE DIT CE QU'ELLE VA INTERROMPRE, ET OFFRE DE FORCER.
   *
   * Forcer est un geste de dernier recours, pris les yeux ouverts : le second
   * bouton n'a de sens que si la fenêtre a d'abord nommé ce qui sera coupé. Les
   * deux se vérifient ici, sur un agent RÉELLEMENT au travail — c'est la seule
   * situation où ils s'affichent.
   */
  const ouverte = (await dialogue.count()) > 0;
  noter('le clic ouvre bien la fenêtre du redémarrage', ouverte);

  if (ouverte) {
    const annonce = await dialogue.locator('[data-redemarrage-interrompu]').innerText().catch(() => '');
    noter(
      'la fenêtre NOMME ce qui va être interrompu avant de confirmer',
      /interrompus/i.test(annonce) && /agent/i.test(annonce),
      annonce.slice(0, 120),
    );
    noter(
      'elle offre un bouton « Forcer le redémarrage », distinct de « Redémarrer »',
      (await dialogue.locator('[data-redemarrage-force]').count()) === 1,
    );
    noter(
      'et ce bouton ne part JAMAIS tout seul : le serveur est toujours là',
      !sorti,
    );

    // « Redémarrer dès que possible » quand un travail retient : le geste pose
    // la demande retenue, il ne force rien.
    await dialogue.getByRole('button', { name: /^Redémarrer/ }).click();
    await page.waitForTimeout(1200);
  }

  const libelleApresClic = await page.locator('[data-bouton-redemarrage]').innerText().catch(() => '');
  noter(
    'après le clic, le bouton affiche « Redémarrage requis »',
    /Redémarrage requis/i.test(libelleApresClic),
    libelleApresClic,
  );
  await page.screenshot({ path: path.join(TMP, 'redemarrage-requis.png') });

  /* -------- 3. Le faux moteur finit : le redémarrage part tout seul -------- */

  const redemarreToutSeul = await attendre(() => sorti, DUREE_S * 1000 + 15000, 400);
  noter('dès la fin de la tâche, le démon redémarre TOUT SEUL', redemarreToutSeul);

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(`(captures et journal dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.join(''));
  process.exit(1);
});
