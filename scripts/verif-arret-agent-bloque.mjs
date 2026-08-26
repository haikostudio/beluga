#!/usr/bin/env node
/**
 * LE BOUTON D'ARRÊT MARCHE AUSSI SUR UN AGENT BLOQUÉ DEPUIS TOUJOURS.
 *
 *   node scripts/verif-arret-agent-bloque.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve : le
 * démon de production n'est pas touché et aucun moteur réel n'est lancé.
 *
 * Le décor est justement celui du bug : des agents marqués « au travail » que
 * plus aucun tour vivant ne porte — l'un depuis des milliers d'heures, l'autre
 * resté dans la fenêtre de préparation (« starting »). Le clic d'arrêt
 * glissait alors sans effet ni message.
 *
 * Ce qui est vérifié :
 *   1. arrêter un agent « au travail » depuis 3 000 heures le referme pour de
 *      bon : il ne se dit plus au travail ;
 *   2. la réponse du démon DIT ce qu'elle a fait (geste « secours ») ;
 *   3. un agent coincé en « starting » s'arrête de la même façon ;
 *   4. un agent déjà au repos ne ment pas : geste « inactif », message clair ;
 *   5. la pile d'agents de la colonne de gauche porte un vrai bouton d'arrêt.
 */
import { chromium } from 'playwright';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import ws from '/root/haikodev/node_modules/ws/index.js';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_VERIF_PORT || 7193);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-arret-bloque-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

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

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const MILLE_HEURES = 3000 * 3600_000;

function base(readonly = false) {
  return new Database(path.join(DATA, 'haikodev.db'), readonly ? { readonly: true } : undefined);
}

/** Un agent qui se DIT au travail : aucun processus, aucun tour vivant. */
function ecrireAgent(db, id, statut, depuisMs) {
  const maintenant = Date.now();
  const agent = {
    id,
    projectId: PROJET_ID,
    role: 'cadrage',
    title: `Agent ${id}`,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: statut,
    startedAt: maintenant - depuisMs,
    createdAt: maintenant - depuisMs,
    updatedAt: maintenant - depuisMs,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data`,
  ).run(id, PROJET_ID, 'cadrage', statut, JSON.stringify(agent), agent.createdAt, agent.updatedAt);
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification arrêt agent bloqué',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai arrêt bloqué',
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

  ecrireAgent(db, 'ag-vieux', 'running', MILLE_HEURES);
  ecrireAgent(db, 'ag-preparation', 'starting', MILLE_HEURES);
  ecrireAgent(db, 'ag-repos', 'idle', MILLE_HEURES);
  db.close();
}

const lireAgent = (id) => {
  const db = base(true);
  const ligne = db.prepare('SELECT data FROM agents WHERE id = ?').get(id);
  db.close();
  return ligne ? JSON.parse(ligne.data) : null;
};

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

const auTravail = (statut) => statut === 'running' || statut === 'starting';

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  /* -------- 1 & 2. L'agent « au travail » depuis 3 000 heures -------- */

  noter('le décor pose bien un agent au travail depuis toujours', auTravail(lireAgent('ag-vieux')?.status));

  const arret = await commande({ type: 'agent.stop', agentId: 'ag-vieux' });
  noter('le démon accepte l’arrêt', arret.ok !== false, String(arret.error ?? ''));
  noter(
    'il DIT ce qu’il a fait : le tour a été refermé d’autorité',
    arret.data?.geste === 'secours',
    `geste ${arret.data?.geste ?? '(rien)'}`,
  );
  noter(
    'le message explique qu’aucun moteur ne tournait',
    /plus de moteur en marche|refermé/i.test(arret.data?.message ?? ''),
    arret.data?.message ?? '(rien)',
  );
  noter(
    'et l’agent ne se dit PLUS au travail',
    !auTravail(lireAgent('ag-vieux')?.status),
    `statut ${lireAgent('ag-vieux')?.status}`,
  );

  /* -------- 3. Le tour coincé dans sa préparation -------- */

  const prep = await commande({ type: 'agent.stop', agentId: 'ag-preparation' });
  noter('un tour coincé en préparation s’arrête aussi', prep.data?.geste === 'secours', `geste ${prep.data?.geste}`);
  noter(
    'lui non plus ne se dit plus au travail',
    !auTravail(lireAgent('ag-preparation')?.status),
    `statut ${lireAgent('ag-preparation')?.status}`,
  );

  /* -------- 4. Un agent déjà au repos -------- */

  const repos = await commande({ type: 'agent.stop', agentId: 'ag-repos' });
  noter('un agent déjà au repos rend « inactif »', repos.data?.geste === 'inactif', `geste ${repos.data?.geste}`);
  noter(
    'et le dit au lieu de laisser le clic sans réponse',
    /ne travaille plus|rien à arrêter/i.test(repos.data?.message ?? ''),
    repos.data?.message ?? '(rien)',
  );

  /* -------- 5. Le bouton d'arrêt de la colonne de gauche -------- */

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  const arretColonne = page.locator('[data-arret-agent-colonne]');

  /*
   * Un agent fabriqué sans moteur ne reste pas « au travail » longtemps : la
   * veille du démon le referme légitimement au bout de quelques secondes. On
   * le repose donc juste avant de regarder l'écran, et on réessaie deux fois
   * si le tour de veille est passé entre les deux.
   */
  for (let essai = 0; essai < 3 && (await arretColonne.count()) === 0; essai += 1) {
    const db = base();
    ecrireAgent(db, 'ag-affiche', 'running', 60_000);
    db.close();
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(essai === 0 ? 4500 : 3000);
    // Le SURVOL ouvre la pile ; un clic par-dessus la refermerait aussitôt
    // (le pointeur l'a déjà ouverte, et le bouton ne fait que basculer).
    await page.locator('[data-pile-agents-colonne] button').first().hover();
    await page.waitForTimeout(800);
  }

  noter('la pile d’agents porte un bouton d’arrêt', (await arretColonne.count()) >= 1);
  await page.screenshot({ path: '/tmp/verif-arret-pile-agents.png' });

  if (await arretColonne.count()) {
    await arretColonne.first().click();
    await page.waitForTimeout(2500);
    noter(
      'un clic dessus arrête vraiment l’agent',
      !auTravail(lireAgent('ag-affiche')?.status),
      `statut ${lireAgent('ag-affiche')?.status}`,
    );
  }

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await navigateur.close();

  const passes = resultats.filter((r) => r.ok).length;
  console.log(`\n${passes}/${resultats.length} vérifications passées`);
  console.log(`(captures dans ${TMP})`);
  /*
   * ON REND LA MAIN POUR DE BON. Le démon d'essai est lancé avec ses sorties
   * branchées sur ce script : ces tuyaux restent des travaux en cours aux yeux
   * de node, qui n'a donc aucune raison de s'arrêter — les douze vérifications
   * passaient en quinze secondes, puis le script tournait dans le vide jusqu'à
   * ce qu'on le coupe. Un contrôle qui ne rend jamais la main se lit comme un
   * contrôle bloqué. On range et on sort, avec le bon code de sortie.
   */
  nettoyer();
  process.exit(passes === resultats.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
