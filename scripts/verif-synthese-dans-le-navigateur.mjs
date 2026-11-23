#!/usr/bin/env node
/*
 * LA SYNTHÈSE DE LA DEMANDE S'AFFICHE SOUS LES YEUX, SANS RECHARGEMENT.
 *
 *   npm run build && node scripts/verif-synthese-dans-le-navigateur.mjs
 *
 * Le contrôle des règles (`verif-synthese-de-la-demande.mjs`) prouve que le fil
 * CALCULE la synthèse dès le début du tour. Celui-ci prouve l'autre moitié :
 * qu'elle ARRIVE À L'ÉCRAN toute seule, pendant que l'agent travaille encore.
 * C'est le point qui décide de tout — l'écran écartait jusqu'ici la mise à jour
 * d'une ligne déjà affichée, et le résultat n'aurait paru qu'au rechargement
 * suivant.
 *
 * Le décor est un démon À SOI, sur un port libre, base neuve, et un FAUX moteur
 * (un vrai processus, aucun jeton dépensé) qui joue le geste 1 du cadrage —
 * titre et synthèse — puis TRAÎNE plusieurs secondes avant de rendre sa
 * réponse. C'est pendant cette traîne que l'écran est regardé : le tour n'est
 * pas fini, et la synthèse doit déjà être là.
 *
 * Ce qui est vérifié, dans un vrai navigateur :
 *   1. la synthèse rédigée paraît sous le point « Demande » ;
 *   2. elle paraît PENDANT le tour : la compréhension n'est pas encore rendue ;
 *   3. la page n'a été chargée qu'UNE fois — la preuve que c'est bien le canal
 *      temps réel qui a livré la mise à jour ;
 *   4. la phrase passe-partout (« Votre demande est notée. ») a cédé la place,
 *      au lieu de se lire en double au-dessus de la synthèse.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script — jamais un chemin écrit en dur : lancé depuis
   une copie de travail, il jugerait sinon le code du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_SYNTHESE_PORT || 7219);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-synthese-nav-'));
const PROJET_ID = 'projet-synthese';
const DEMANDE = 'Pourquoi je n’ai pas la synthèse sous chaque point du fil ?';
const SYNTHESE = 'Vous demandez que la synthèse de votre message paraisse sous le point « Demande », dès l’envoi.';
/* Le faux moteur TRAÎNE après son geste 1 : c'est la fenêtre pendant laquelle
   l'écran doit déjà montrer la synthèse, tour non terminé. */
const TRAINE_MS = 12000;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor : un dépôt d'essai, un faux moteur qui pose le geste 1      */
/* ------------------------------------------------------------------ */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
/* UN DOSSIER PERSONNEL À SOI : sans lui, le démon d'essai adopterait le compte
   Claude RÉEL de la machine, et le contrôle dépendrait du quota du jour. */
const MAISON = path.join(TMP, 'maison');
const COMPTE = path.join(TMP, 'compte-claude');
for (const dossier of [DATA, PROJETS, DEPOT, MAISON, COMPTE]) fs.mkdirSync(dossier, { recursive: true });
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
import fs from 'node:fs';

/* Le démon éprouve d'abord le moteur : sans réponse, l'assistant de démarrage
   couvre tout l'écran et plus aucun clic n'atteint le tableau. */
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
  const cheminMcp = process.argv[process.argv.indexOf('--mcp-config') + 1];
  const pont = cheminMcp && fs.existsSync(cheminMcp)
    ? JSON.parse(fs.readFileSync(cheminMcp, 'utf8')).mcpServers?.beluga?.env
    : null;
  const appeler = async (name, args) => {
    if (!pont) return null;
    try {
      const res = await fetch(pont.BELUGA_URL + '/internal/call', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-beluga-token': pont.BELUGA_TOKEN,
          'x-beluga-agent': pont.BELUGA_AGENT,
          'x-beluga-tour': pont.BELUGA_TOUR,
        },
        body: JSON.stringify({ name, args }),
      });
      const rendu = await res.json();
      fs.appendFileSync(${JSON.stringify(TMP)} + '/pont.log', JSON.stringify({ name, rendu }) + '\\n');
      return rendu;
    } catch (err) {
      fs.appendFileSync(${JSON.stringify(TMP)} + '/pont.log', JSON.stringify({ name, erreur: String(err) }) + '\\n');
      return null;
    }
  };
  /* LE GESTE 1 DU CADRAGE, tel que la consigne le demande : le titre ET la
     synthèse de la demande, en UN SEUL appel, avant toute lecture. */
  const cardId = /Identifiant de cette carte[^:]*:\\s*([0-9a-f-]{36})/i.exec(demande)?.[1];
  if (cardId) {
    await appeler('board_update_card', {
      cardId,
      title: 'Résumé sous le point Demande',
      resumeDemande: ${JSON.stringify(SYNTHESE)},
    });
  }
  /* PUIS L'AGENT TRAÎNE : il lit le projet, cherche, réfléchit. Le tour n'est
     pas fini, et c'est justement là que l'écran est regardé. */
  await new Promise((r) => setTimeout(r, ${TRAINE_MS}));
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Je regarde.' }] } });
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

const journal = [];
const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
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

function nettoyer() {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  if (!process.env.BELUGA_SYNTHESE_GARDER) fs.rmSync(TMP, { recursive: true, force: true });
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
    'vérification synthèse',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai synthèse',
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
    maintenant,
  );
  db.close();
}

/** La compréhension est-elle rendue ? Tant qu'elle ne l'est pas, le tour tourne. */
function comprehensionRendue() {
  const db = base(true);
  const lignes = db.prepare('SELECT data FROM cards').all();
  db.close();
  return lignes.some((l) => !!JSON.parse(l.data ?? '{}').parcours?.comprehension?.texte);
}

/* ------------------------------------------------------------------ */

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
    { name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  /* CHAQUE CHARGEMENT DE PAGE EST COMPTÉ : la synthèse doit arriver SANS. */
  let chargements = 0;
  page.on('load', () => (chargements += 1));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  /* L'assistant des moteurs a son propre contrôle : ici il ne ferait que
     couvrir l'écran — le compte d'essai n'a pas de quota lisible. */
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });

  /* Deux boutons portent ce repère depuis la refonte : celui de la tête de
     « Demande » (ordinateur) et celui du bas de l'écran (téléphone, caché ici). */
  await page.locator('[data-nouvelle-carte="planned"]:visible').first().click();
  await page.waitForTimeout(3000);

  const champ = page.locator('[data-composer] textarea').last();
  await champ.click();
  await champ.fill(DEMANDE);
  await page.keyboard.press('Enter');

  /* LE RÉSUMÉ DU POINT N'A PLUS SON PARAGRAPHE `data-point-resume` : depuis la
     refonte du fil en discussion, il s'écrit dans la ligne de la carte du
     passage (`[data-carte-du-passage] [data-point-phrase]`), où il REMPLACE la
     phrase de l'étape. On cherche donc le TEXTE de la synthèse dans le point
     « Demande », où qu'il s'y pose — pas la présence d'un élément, qui existe
     parfois avant elle. */
  const pointDemande = page.locator('[data-point="demande"]');
  const chargementsAuDepart = chargements;

  /* -------- 1. La synthèse paraît, sans rechargement -------- */

  let vue = '';
  let lu = '';
  let comprisAuMoment = null;
  for (let i = 0; i < 40 && !vue; i += 1) {
    await page.waitForTimeout(400);
    if ((await pointDemande.count()) === 0) continue;
    lu = (await pointDemande.last().innerText()).trim();
    if (lu.includes(SYNTHESE)) {
      vue = SYNTHESE;
      comprisAuMoment = comprehensionRendue();
    }
  }
  noter(
    'la synthèse rédigée paraît sous le point « Demande »',
    vue === SYNTHESE,
    vue || `absente du point « Demande », qui montre : « ${lu.replace(/\s+/g, ' ').slice(0, 160) || 'rien'} »`,
  );

  /* -------- 2. …alors que le tour n'est pas fini -------- */

  noter(
    'elle paraît PENDANT le tour : la compréhension n’est pas encore rendue',
    comprisAuMoment === false,
    comprisAuMoment === null ? 'jamais mesuré' : comprisAuMoment ? 'déjà comprise' : 'tour en cours',
  );

  /* -------- 3. C'est bien le canal temps réel qui l'a livrée -------- */

  noter(
    'la page n’a pas été rechargée : c’est le canal temps réel qui l’a livrée',
    chargements === chargementsAuDepart,
    `${chargements - chargementsAuDepart} rechargement(s)`,
  );

  /* -------- 4. La phrase passe-partout a cédé la place -------- */

  const phrases = await page.locator('[data-point="demande"] [data-point-phrase]').allInnerTexts();
  noter(
    'la phrase passe-partout ne double plus la synthèse',
    !phrases.some((texte) => texte.includes('demande est notée')),
    phrases.join(' | ') || 'aucune phrase',
  );

  await navigateur.close();
}

await main().catch((err) => {
  console.error(err);
  noter('le contrôle est allé au bout', false, String(err));
});

const rates = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - rates.length}/${resultats.length} au vert`);
process.exit(rates.length ? 1 : 0);
