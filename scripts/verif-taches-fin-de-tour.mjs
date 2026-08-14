#!/usr/bin/env node
/**
 * LA LISTE DES TÂCHES SE REFERME AVEC LE TOUR.
 *
 *   npm run build && node scripts/verif-taches-fin-de-tour.mjs
 *
 * Le bogue : une carte close, l'agent avait rendu sa réponse, et le volet
 * affichait encore « 4/5 faites » avec la dernière ligne en cours, pour
 * toujours. Le script monte son PROPRE démon, sur un port libre, avec une base
 * neuve, et un FAUX MOTEUR (un vrai processus, aucun jeton dépensé) qui rejoue
 * exactement ce que fait Claude : il annonce sa liste, en coche une partie,
 * laisse la dernière « en cours » et rend sa réponse sans plus jamais y revenir.
 *
 * Ce qui est vérifié, dans un vrai navigateur :
 *   1. TOUR RENDU — le volet affiche « 3/3 faites », plus une seule ligne en
 *      cours, et la dernière porte sa coche (posée par le démon) ;
 *   2. TOUR TOMBÉ — le moteur meurt en pleine liste : rien n'est coché à sa
 *      place, les lignes ouvertes disent « non faite » ;
 *   3. TOUR COUPÉ PAR UN REDÉMARRAGE — le démon est tué en plein vol puis
 *      relancé : la ligne qui tournait ne tourne plus, elle dit « non faite » ;
 *   4. LES ANCIENNES CARTES — une liste figée « en cours » en base est
 *      refermée par la migration 23, et l'écran ne montre plus de rond orange.
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

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKODEV_TACHES_PORT || 7196);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-taches-fin-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un faux moteur : un vrai processus, le vrai flux de Claude          */
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
 * Le faux moteur lit la demande sur son entrée standard et écrit le flux
 * « stream-json » de Claude, ligne par ligne. Trois conduites, choisies par le
 * texte de la demande :
 *   « rendu »  : liste annoncée, deux lignes cochées, la troisième laissée EN
 *                COURS, réponse rendue, sortie propre — le cas de la capture ;
 *   « tombe »  : même liste, puis mort brutale (code 1) sans une réponse ;
 *   « dort »   : liste annoncée puis attente, pour se faire couper par un
 *                redémarrage du démon.
 */
const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';
let demande = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (demande += d));
process.stdin.on('end', () => jouer());
setTimeout(() => process.stdin.readable && process.stdin.read(), 50);

const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const liste = (troisieme) => ({
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
            { content: 'Corriger le bogue', status: 'completed' },
            { content: 'Enregistrer et pousser', status: troisieme },
          ],
        },
      },
    ],
  },
});

async function jouer() {
  const quoi = /tombe/.test(demande) ? 'tombe' : /dort/.test(demande) ? 'dort' : 'rendu';
  dire({ type: 'system', subtype: 'init', session_id: 'session-essai' });
  dire(liste('in_progress'));
  await new Promise((r) => setTimeout(r, 400));

  if (quoi === 'dort') {
    // On attend d'être coupé : le démon meurt, ce processus avec lui.
    await new Promise(() => {});
  }

  if (quoi === 'tombe') {
    process.stderr.write('API Error: fatal\\n');
    process.exit(1);
  }

  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Travail rendu, tout est en place.' }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 10, output_tokens: 5 } });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

let demon = null;
let sorti = false;
const journal = [];

function lancerLeDemon() {
  sorti = false;
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
  demon.on('exit', () => (sorti = true));
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
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function attendre(condition, limiteMs = 30000, pasMs = 400) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, pasMs));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le décor : un projet, trois conversations, une liste figée d'AVANT  */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');

/*
 * UN PROJET PAR CAS. La conversation du chef est celle de son PROJET : quatre
 * projets, donc quatre fils qu'on ouvre d'un clic dans la colonne de gauche,
 * sans jamais confondre deux listes.
 */
const AGENTS = {
  rendu: { id: 'ag-rendu', projet: 'p-rendu', nom: 'Essai tour rendu', titre: 'Tour rendu' },
  tombe: { id: 'ag-tombe', projet: 'p-tombe', nom: 'Essai tour tombé', titre: 'Tour tombé' },
  dort: { id: 'ag-dort', projet: 'p-dort', nom: 'Essai tour coupé', titre: 'Tour coupé' },
  ancien: { id: 'ag-ancien', projet: 'p-ancien', nom: 'Essai ancienne liste', titre: 'Ancienne conversation' },
};

const base = (readonly = false) =>
  new Database(path.join(DATA, 'haikodev.db'), readonly ? { readonly: true } : undefined);

function ecrireProjet(db, id, nom, rang) {
  const maintenant = Date.now();
  const projet = {
    id,
    name: nom,
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: rang,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(id, nom, DEPOT, JSON.stringify(projet), maintenant, maintenant);
}

function ecrireAgent(db, id, projectId, titre) {
  const maintenant = Date.now();
  const agent = {
    id,
    projectId,
    role: 'orchestrator',
    title: titre,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, null, 'orchestrator', 'idle', JSON.stringify(agent), maintenant, maintenant);
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification listes de tâches',
  );

  db.prepare('DELETE FROM projects').run();
  let rang = 1;
  for (const agent of Object.values(AGENTS)) {
    ecrireProjet(db, agent.projet, agent.nom, rang++);
    ecrireAgent(db, agent.id, agent.projet, agent.titre);
  }

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
   * LA LISTE FIGÉE D'AVANT : un message déjà clos, réponse rendue, dernière
   * ligne restée « en cours ». On efface la migration 23 de la liste des
   * migrations posées pour qu'elle se rejoue au redémarrage — c'est bien la
   * VRAIE migration qu'on juge, pas une réécriture du script.
   */
  const message = {
    id: 'm-ancien',
    agentId: AGENTS.ancien.id,
    role: 'assistant',
    content: 'Voilà, c’est fait.',
    steps: [],
    todos: [
      { label: 'Lire le code', state: 'done', startedAt: maintenant - 5000, endedAt: maintenant - 4000 },
      { label: 'Corriger le bogue', state: 'done', startedAt: maintenant - 4000, endedAt: maintenant - 3000 },
      { label: 'Enregistrer et pousser', state: 'running', startedAt: maintenant - 3000 },
    ],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    streaming: false,
    plan: false,
    durationMs: 5000,
    createdAt: maintenant - 6000,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id,
    message.agentId,
    message.role,
    JSON.stringify(message),
    message.createdAt,
  );
  db.prepare('DELETE FROM migrations WHERE id = 23').run();

  db.close();
}

/** La liste de tâches du dernier message d'un agent, telle qu'elle est en base. */
function listeEnBase(agentId) {
  const db = base(true);
  const ligne = db
    .prepare('SELECT data FROM messages WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(agentId);
  db.close();
  return ligne ? (JSON.parse(ligne.data).todos ?? []) : [];
}

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: `haikodev_session=${jeton}` } });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 30000);
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

/* ------------------------------------------------------------------ */
/* L'écran                                                             */
/* ------------------------------------------------------------------ */

/** Ouvre le fil du chef d'un projet : un clic sur son nom, à gauche. */
async function ouvrirLaConversation(page, cas) {
  await page.getByText(cas.nom, { exact: true }).first().click({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const onglet = page.getByRole('tab', { name: /^Chef/ });
  if (await onglet.count()) await onglet.first().click();
  await page.waitForTimeout(2500);
}

/** Ce que le volet des tâches montre : en-tête, lignes, états. */
async function lireLeVolet(page) {
  return page.evaluate(() => {
    const volet = document.querySelector('[data-volet="taches"]');
    if (!volet) return null;
    return {
      entete: volet.querySelector('button')?.innerText ?? '',
      texte: volet.innerText,
      nonFaites: volet.querySelectorAll('[data-tache="non-faite"]').length,
      // Le rond orange et le tourniquet : les deux visages d'une ligne en cours.
      enCours: volet.querySelectorAll('.text-en-cours, .border-en-cours').length,
    };
  });
}

async function main() {
  lancerLeDemon();
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  // Le décor posé, on relance : la migration 23 se rejoue sur la liste d'avant.
  demon.kill('SIGKILL');
  await attendre(() => sorti, 15000, 200);
  lancerLeDemon();
  if (!(await attendrePort())) {
    console.error('Le démon n’a pas redémarré :\n' + journal.join(''));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));

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

  /* -------- 1. Un tour RENDU referme sa liste -------- */

  await commande({ type: 'agent.prompt', agentId: AGENTS.rendu.id, text: 'travaille et rends ta réponse' });
  await attendre(async () => {
    const etat = await commande({ type: 'daemon.status' });
    return (etat.data?.etat?.agentsEnCours ?? 0) === 0;
  });
  await new Promise((r) => setTimeout(r, 2000));

  const apresRendu = listeEnBase(AGENTS.rendu.id);
  noter(
    'tour rendu : AUCUNE ligne ne reste « en cours » en base',
    apresRendu.length === 3 && !apresRendu.some((t) => t.state === 'running'),
    apresRendu.map((t) => t.state).join(', '),
  );
  noter(
    'tour rendu : la dernière ligne est cochée, et dit que c’est le démon qui l’a cochée',
    apresRendu[2]?.state === 'done' && apresRendu[2]?.closedByTurnEnd === true,
    JSON.stringify(apresRendu[2] ?? {}),
  );

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await ouvrirLaConversation(page, AGENTS.rendu);
  const voletRendu = await lireLeVolet(page);
  noter('tour rendu : le volet des tâches est visible', !!voletRendu, voletRendu ? '' : 'volet absent');
  noter(
    'tour rendu : l’en-tête annonce « 3/3 faites »',
    /3\/3 faites/.test(voletRendu?.entete ?? ''),
    voletRendu?.entete ?? '(rien)',
  );
  noter('tour rendu : plus une seule ligne orange à l’écran', (voletRendu?.enCours ?? 1) === 0);
  noter('tour rendu : aucune ligne « non faite »', (voletRendu?.nonFaites ?? 1) === 0);
  await page.screenshot({ path: path.join(TMP, 'tour-rendu.png') });

  /* -------- 2. Un tour TOMBÉ ne coche rien -------- */

  await commande({ type: 'agent.prompt', agentId: AGENTS.tombe.id, text: 'tombe en plein travail' });
  await attendre(async () => {
    const etat = await commande({ type: 'daemon.status' });
    return (etat.data?.etat?.agentsEnCours ?? 0) === 0;
  });
  await new Promise((r) => setTimeout(r, 2000));

  const apresChute = listeEnBase(AGENTS.tombe.id);
  noter(
    'tour tombé : la ligne qui tournait dit « non faite », elle n’est pas cochée',
    apresChute[2]?.state === 'unfinished',
    apresChute.map((t) => t.state).join(', '),
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await ouvrirLaConversation(page, AGENTS.tombe);
  const voletChute = await lireLeVolet(page);
  noter(
    'tour tombé : l’écran dit « non faite » à côté de la ligne',
    (voletChute?.nonFaites ?? 0) >= 1,
    voletChute?.entete ?? '(rien)',
  );
  noter('tour tombé : plus une seule ligne orange', (voletChute?.enCours ?? 1) === 0);
  await page.screenshot({ path: path.join(TMP, 'tour-tombe.png') });

  /* -------- 3. Un tour COUPÉ par un redémarrage -------- */

  await commande({ type: 'agent.prompt', agentId: AGENTS.dort.id, text: 'dort sans jamais finir' });
  const enVol = await attendre(async () => listeEnBase(AGENTS.dort.id).some((t) => t.state === 'running'));
  noter('tour coupé : la liste tourne bien avant la coupure', enVol);

  demon.kill('SIGKILL');
  await attendre(() => sorti, 15000, 200);
  lancerLeDemon();
  if (!(await attendrePort())) {
    console.error('Le démon n’a pas redémarré :\n' + journal.join(''));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2500));

  const apresCoupure = listeEnBase(AGENTS.dort.id);
  noter(
    'tour coupé : la ligne qui tournait ne tourne plus, elle dit « non faite »',
    !apresCoupure.some((t) => t.state === 'running') && apresCoupure.some((t) => t.state === 'unfinished'),
    apresCoupure.map((t) => t.state).join(', '),
  );

  /* -------- 4. Les ANCIENNES cartes, refermées par la migration -------- */

  const ancienne = listeEnBase(AGENTS.ancien.id);
  noter(
    'ancienne liste : la migration a coché la ligne restée en cours',
    ancienne[2]?.state === 'done' && ancienne[2]?.closedByTurnEnd === true,
    JSON.stringify(ancienne[2] ?? {}),
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await ouvrirLaConversation(page, AGENTS.ancien);
  const voletAncien = await lireLeVolet(page);
  noter(
    'ancienne conversation rouverte : « 3/3 faites », aucune étape en suspens',
    /3\/3 faites/.test(voletAncien?.entete ?? '') && (voletAncien?.enCours ?? 1) === 0,
    voletAncien?.entete ?? '(rien)',
  );
  await page.screenshot({ path: path.join(TMP, 'ancienne-liste.png') });

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) console.log(`(captures et journal dans ${TMP})`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.error(journal.slice(-30).join(''));
  process.exit(1);
});
