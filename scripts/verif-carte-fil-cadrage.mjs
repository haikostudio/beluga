#!/usr/bin/env node
/**
 * LE « + » DE « PLANIFIÉ » OUVRE UNE CONVERSATION, PAS UN FORMULAIRE.
 *
 *   node scripts/verif-carte-fil-cadrage.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve et
 * un FAUX moteur : le démon de production n'est pas touché, et pas un jeton
 * n'est dépensé. Tout le parcours est joué à la souris, dans un vrai navigateur.
 *
 * Ce qui est vérifié :
 *   1. le clic sur « + » crée la carte TOUT DE SUITE et ouvre son tiroir sur la
 *      conversation — plus aucun titre à inventer dans un petit formulaire ;
 *   2. rien n'est encore parti au moteur : la conversation invite à dire ce
 *      qu'on veut faire, et le bouton « Lancer la tâche » est là mais éteint ;
 *   3. un message ouvre un tour de CADRAGE, sur le modèle économe, et la carte
 *      ne bouge pas de « Planifié » ;
 *   4. le bouton s'allume alors, prend TOUTE la largeur de la barre d'écriture
 *      et se tient AU-DESSUS du champ de saisie ;
 *   5. le clic lance la tâche : la carte passe en « En cours », prend son titre
 *      de la discussion, et l'agent d'exécution reçoit TOUTE la discussion en
 *      contexte de départ.
 */
import { chromium } from 'playwright';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
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
const PORT = Number(process.env.HAIKODEV_CADRAGE_PORT || 7207);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-cadrage-'));
const PROJET_ID = 'projet-cadrage';
const DEMANDE = 'Ajouter un bouton pour exporter la liste en CSV';

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor : un vrai dépôt git, un faux moteur qui garde ses demandes */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
const DEMANDES = path.join(TMP, 'demandes');
for (const dossier of [DATA, PROJETS, DEPOT, DEMANDES]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

/*
 * LE FAUX MOTEUR ÉCRIT CHAQUE DEMANDE REÇUE dans un dossier : c'est ainsi qu'on
 * prouve que la discussion de cadrage voyage vraiment jusqu'à l'exécution. Il
 * répond court, sans rien modifier — un tour de cadrage ne code pas.
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

async function jouer() {
  fs.writeFileSync(${JSON.stringify(DEMANDES)} + '/' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.txt', demande);
  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
  await new Promise((r) => setTimeout(r, 200));
  const texte = /Réalise cette tâche/.test(demande)
    ? 'Travail rendu, tout est en place.'
    : 'Compris : un bouton d’export CSV. Vous pouvez lancer la tâche.';
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: texte }] } });
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

/* ------------------------------------------------------------------ */
/* La base : une session d'une heure, un projet, rien d'autre           */
/* ------------------------------------------------------------------ */

const jeton = crypto.randomBytes(24).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const base = (lecture = false) => new Database(path.join(DATA, 'haikodev.db'), { readonly: lecture });

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification carte-fil',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai cadrage',
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
  db.close();
}

const cartes = () => {
  const db = base(true);
  const lignes = db.prepare('SELECT id, column_key, title, data FROM cards').all();
  db.close();
  return lignes;
};

const agents = () => {
  const db = base(true);
  const lignes = db.prepare('SELECT id, role, card_id, data FROM agents').all();
  db.close();
  return lignes;
};

const demandesRecues = () =>
  fs
    .readdirSync(DEMANDES)
    .sort()
    .map((nom) => fs.readFileSync(path.join(DEMANDES, nom), 'utf8'));

/* ------------------------------------------------------------------ */

const boutonLancer = (page) => page.locator('[data-lancer-la-tache]');
const boutonPlus = (page) => page.locator('[data-nouvelle-carte="planned"]');

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const contexte = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  /* -------- 1. Le « + » crée la carte et ouvre sa conversation -------- */

  noter('le « + » de « Planifié » est bien là', (await boutonPlus(page).count()) === 1);
  await boutonPlus(page).click();
  await page.waitForTimeout(3000);

  const nees = cartes();
  noter('un clic suffit à faire naître la carte', nees.length === 1, `${nees.length} carte(s)`);
  noter('elle naît dans « Planifié »', nees[0]?.column_key === 'planned', nees[0]?.column_key ?? '—');

  const agentsNes = agents();
  noter(
    'elle naît avec SON agent de cadrage, et lui seul',
    agentsNes.length === 1 && agentsNes[0].role === 'cadrage',
    agentsNes.map((a) => a.role).join(', ') || 'aucun',
  );
  const runCadrage = JSON.parse(agentsNes[0]?.data ?? '{}').run ?? {};
  noter(
    'il tourne sur un modèle ÉCONOME, pas sur le modèle d’exécution',
    /haiku/i.test(String(runCadrage.model ?? '')),
    String(runCadrage.model ?? 'aucun'),
  );
  noter('rien n’est encore parti au moteur', demandesRecues().length === 0, `${demandesRecues().length} demande(s)`);

  /* -------- 2. Le tiroir s'ouvre sur la conversation -------- */

  const tiroir = await page.locator('body').innerText();
  noter(
    'le tiroir s’ouvre sur la conversation, et invite à dire ce qu’on veut faire',
    tiroir.includes('Dites ce que vous voulez faire'),
  );
  noter('le bouton « Lancer la tâche » est déjà à sa place', (await boutonLancer(page).count()) === 1);
  noter(
    'mais il attend qu’on ait parlé',
    (await boutonLancer(page).getAttribute('aria-disabled')) === 'true',
  );

  /* -------- 3. Un message ouvre le tour de cadrage -------- */

  const champ = page.locator('[data-composer] textarea').last();
  await champ.click();
  await champ.fill(DEMANDE);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);

  const apresCadrage = cartes()[0];
  noter('la carte n’a pas bougé de « Planifié »', apresCadrage?.column_key === 'planned', apresCadrage?.column_key ?? '—');
  const recues = demandesRecues();
  noter('le tour de cadrage est bien parti', recues.length === 1, `${recues.length} demande(s)`);
  noter(
    'et ce tour ne réclame NI compte rendu à titres NI chiffrage',
    recues.length === 1 && !/Analyse de la demande/.test(recues[0]) && !/machineSeconds/.test(recues[0]),
  );
  noter(
    'l’agent de cadrage reçoit l’identifiant de SA carte, pour l’écrire',
    recues.length === 1 && recues[0].includes(apresCadrage.id),
  );
  noter('la réponse du cadrage s’affiche dans le fil', (await page.locator('body').innerText()).includes('Vous pouvez lancer la tâche'));

  /* -------- 4. Le bouton s'allume, en pleine largeur, au-dessus du champ -------- */

  noter('le bouton s’allume une fois la demande dite', (await boutonLancer(page).getAttribute('aria-disabled')) === 'false');
  const cadreBouton = await boutonLancer(page).boundingBox();
  const cadreChamp = await champ.boundingBox();
  noter(
    'il se tient AU-DESSUS du champ de saisie',
    !!cadreBouton && !!cadreChamp && cadreBouton.y + cadreBouton.height <= cadreChamp.y + 2,
    cadreBouton && cadreChamp ? `bouton ${Math.round(cadreBouton.y)}, champ ${Math.round(cadreChamp.y)}` : 'non mesuré',
  );
  noter(
    'et il prend TOUTE la largeur de la barre d’écriture',
    !!cadreBouton && !!cadreChamp && Math.abs(cadreBouton.width - cadreChamp.width) < 24,
    cadreBouton && cadreChamp ? `${Math.round(cadreBouton.width)} px contre ${Math.round(cadreChamp.width)} px` : 'non mesuré',
  );

  /* -------- 5. Le clic lance la tâche, discussion comprise -------- */

  await boutonLancer(page).click();
  await page.waitForTimeout(12000);

  const lancee = cartes()[0];
  noter('la carte passe en « En cours »', lancee?.column_key === 'running', lancee?.column_key ?? '—');
  noter(
    'elle prend son titre de la discussion, plus « Nouvelle tâche »',
    lancee?.title === DEMANDE,
    lancee?.title ?? '—',
  );
  const roles = agents().map((a) => a.role).sort();
  noter(
    'un agent d’EXÉCUTION prend la suite du cadrage',
    roles.includes('task') && roles.includes('cadrage'),
    roles.join(', '),
  );

  const lancement = demandesRecues().find((texte) => /Réalise cette tâche/.test(texte));
  noter('la demande d’exécution est partie', !!lancement);
  noter(
    'elle emporte TOUTE la discussion de cadrage',
    !!lancement && lancement.includes(DEMANDE) && /FIN DE LA CONVERSATION DE CADRAGE/.test(lancement),
  );
  noter(
    'et elle dit d’où vient cette discussion, pour ne pas la prendre pour une étude',
    !!lancement && /n'a PAS ouvert le projet/.test(lancement),
  );

  noter('aucune erreur de page pendant tout le parcours', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await navigateur.close();
}

main()
  .catch((err) => {
    console.error(err);
    noter('le parcours est allé au bout', false, String(err).split('\n')[0]);
  })
  .finally(() => {
    const rates = resultats.filter((r) => !r.ok).length;
    console.log(`\n${resultats.length - rates}/${resultats.length} au vert`);
    process.exit(rates ? 1 : 0);
  });
