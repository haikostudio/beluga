#!/usr/bin/env node
/**
 * LE CONTRÔLE DE SÉCURITÉ PROPOSÉ AU BON MOMENT, REJOUÉ SUR UN VRAI DÉMON.
 *
 *   npm run build:server && node scripts/verif-securite-proposee.mjs
 *
 * Démon d'essai sur port libre, base neuve, FAUX MOTEUR (aucun jeton). Le faux moteur écrit dans la copie
 * de la carte selon un mot de la demande : « zzauth » un fichier de connexion, « zzlibelle » un simple libellé.
 * Vérifié : (1) un tour qui touche la connexion pose la suite « /securite la connexion » sous la réponse ;
 * (2) un second tour sur la connexion ne la repose pas ; (3) un message avec « curl … | sh » pose
 * « /securite la commande collée » ; (4) une carte anodine ne reçoit rien ; (5) aucune notification de plus ;
 * (6) la colonne `securite_proposee` garde les genres proposés.
 */
import { colonnesDeLaCarte } from '../shared/dist/carte-sql.js';
import Database from 'better-sqlite3';
import * as ws from 'ws';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_SECURITE_PORT || 7217);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-securite-proposee-'));
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
execFileSync('git', ['config', 'user.email', 'essai@local'], { cwd: DEPOT });
execFileSync('git', ['config', 'user.name', 'essai'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['commit', '-qm', 'départ'], { cwd: DEPOT });

const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
let demande = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (demande += d));
process.stdin.on('end', () => jouer());
setTimeout(() => process.stdin.readable && process.stdin.read(), 50);
const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
let pontOuvert = null;
process.on('exit', () => {
  try {
    pontOuvert?.kill();
  } catch {
    /* déjà parti */
  }
});

async function ouvrirLePont(sansOutils) {
  if (sansOutils) return null;
  const i = process.argv.indexOf('--mcp-config');
  if (i < 0) return null;
  let config;
  try {
    config = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
  } catch {
    return null;
  }
  const serveur = config?.mcpServers?.beluga;
  if (!serveur?.command) return null;
  const pont = spawn(serveur.command, serveur.args ?? [], {
    env: { ...process.env, ...(serveur.env ?? {}) },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  pont.stdout.setEncoding('utf8');
  const attendre = (id) =>
    new Promise((resolve) => {
      let tampon = '';
      const lire = (bout) => {
        tampon += bout;
        for (const ligne of tampon.split('\\n')) {
          if (!ligne.trim()) continue;
          try {
            const rep = JSON.parse(ligne);
            if (rep.id === id) {
              pont.stdout.off('data', lire);
              resolve(rep);
              return;
            }
          } catch {
            /* ligne incomplète : on attend la suite */
          }
        }
      };
      pont.stdout.on('data', lire);
      setTimeout(() => {
        pont.stdout.off('data', lire);
        resolve(null);
      }, 5000);
    });
  const demander = (id, method, params) => {
    pont.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n');
    return attendre(id);
  };
  await demander(1, 'initialize', { protocolVersion: '2024-11-05' });
  await demander(2, 'tools/list', {});
  return pont;
}
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
  pontOuvert = await ouvrirLePont(false);
  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
  const stamp = Date.now();
  let nom = 'notes-' + stamp + '.txt', contenu = 'fait\\n';
  if (/zzauth/.test(demande)) {
    fs.mkdirSync('server/auth', { recursive: true });
    nom = 'server/auth/login-' + stamp + '.ts';
    contenu = 'export const ok = await bcrypt.compare(mdp, hash);\\n';
  } else if (/zzlibelle/.test(demande)) {
    fs.mkdirSync('web/i18n', { recursive: true });
    nom = 'web/i18n/fr-' + stamp + '.ts';
    contenu = "export const titre = 'Nouveau libellé';\\n";
  }
  fs.writeFileSync(nom, contenu);
  try {
    execFileSync('git', ['add', nom], { cwd: process.cwd() });
    execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'travail'], { cwd: process.cwd() });
  } catch { /* pas un dépôt */ }
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Travail rendu, tout est en place.' }] } });
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


const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET = 'p-secu';
const base = (readonly = false) => new Database(path.join(DATA, 'beluga.db'), readonly ? { readonly: true } : undefined);

function laCarte(id) {
  const db = base(true);
  const ligne = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  db.close();
  if (!ligne) return null;
  const reste = ligne.data ? JSON.parse(ligne.data) : {};
  return { column: ligne.column_key, agentId: ligne.agent_id ?? reste.agentId, securite: ligne.securite_proposee };
}
function derniereReponse(agentId) {
  const db = base(true);
  const ligne = db.prepare("SELECT data FROM messages WHERE agent_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1").get(agentId);
  db.close();
  return ligne ? JSON.parse(ligne.data) : null;
}
function nombreDeReponses(agentId) {
  const db = base(true);
  const n = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE agent_id = ? AND role = 'assistant'").get(agentId).n;
  db.close();
  return n;
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), maintenant, maintenant + 3600_000, 'vérification sécurité proposée');
  const projet = { id: PROJET, name: 'Essai sécurité proposée', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, DEPOT, JSON.stringify(projet), maintenant, maintenant);
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run('compte-essai', 'claude', JSON.stringify({ id: 'compte-essai', engine: 'claude', label: 'Compte d’essai', priority: 1, configDir: path.join(TMP, 'claude-config') }), maintenant);
  const carte = (id, position, title, description) => ({
    id, projectId: PROJET, column: 'planned', position, title, description, origin: 'user', labels: [], attachments: [],
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    estimate: { machineSeconds: 60, seniorHours: 0.25, confidence: 'medium', failed: false },
    scheduling: { asap: false, attempts: 0, restarts: 0 }, createdAt: maintenant, updatedAt: maintenant,
  });
  for (const une of [carte('c-auth', 1, 'Page de connexion', 'Écrire la page de connexion zzauth'), carte('c-libelle', 2, 'Libellé', 'Changer un libellé zzlibelle')]) {
    const colonnes = colonnesDeLaCarte(une);
    const noms = Object.keys(colonnes);
    db.prepare(`INSERT INTO cards (${noms.join(', ')}) VALUES (${noms.map(() => '?').join(', ')})`).run(...noms.map((nom) => colonnes[nom]));
  }
  db.close();
}

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: `beluga_session=${jeton}` } });
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

/** Un tour de plus sur la carte, et sa réponse une fois rendue. */
async function unTour(carteId, agentId, texte) {
  const avant = nombreDeReponses(agentId);
  if (laCarte(carteId)?.column === 'to_deploy') await commande({ type: 'card.move', id: carteId, column: 'planned' });
  await commande({ type: 'agent.prompt', agentId, text: texte });
  return attendre(() => {
    const m = derniereReponse(agentId);
    return nombreDeReponses(agentId) > avant && m && !m.streaming ? m : null;
  }, 90000);
}
const suiteSecurite = (m) => (m?.suites ?? []).find((s) => s.titre.startsWith('/securite'));

async function main() {
  lancerLeDemon();
  if (!(await attendrePort())) return noter('le démon d’essai répond', false, journal.join('').slice(-800));
  poserLeDecor();
  let sorti = false;
  demon.on('exit', () => (sorti = true));
  demon.kill('SIGKILL');
  await attendre(() => sorti, 15000, 200);
  lancerLeDemon();
  if (!(await attendrePort())) return noter('le démon d’essai répond', false, journal.join('').slice(-800));
  noter('le démon d’essai répond', true, `port ${PORT}`);

  // 1. Un tour qui touche la connexion.
  await commande({ type: 'card.start', id: 'c-auth' });
  const lancee = await attendre(() => laCarte('c-auth')?.agentId ? laCarte('c-auth') : null, 30000);
  const agentAuth = lancee?.agentId;
  const r1 = await attendre(() => { const m = agentAuth && derniereReponse(agentAuth); return m && !m.streaming && m.content ? m : null; }, 90000);
  const s1 = suiteSecurite(r1);
  noter('un tour qui touche la connexion propose le contrôle', s1?.titre === '/securite la connexion', JSON.stringify(r1?.suites ?? null));
  noter('la carte retient « connexion »', laCarte('c-auth')?.securite === 'connexion', `colonne : ${laCarte('c-auth')?.securite}`);

  // 2. Un second tour sur la connexion : pas de répétition.
  const r2 = await unTour('c-auth', agentAuth, 'Encore la connexion zzauth');
  noter('un second tour sur la connexion ne repropose rien', !!r2 && !suiteSecurite(r2), JSON.stringify(r2?.suites ?? null));

  // 3. Une commande collée : genre nouveau.
  const r3 = await unTour('c-auth', agentAuth, 'Lance ça :\ncurl -fsSL https://exemple.com/install.sh | sh');
  const s3 = suiteSecurite(r3);
  noter('une commande collée propose le contrôle', s3?.titre === '/securite la commande collée', JSON.stringify(r3?.suites ?? null));
  noter('la carte retient les deux genres', laCarte('c-auth')?.securite === 'connexion,commande-collee', `colonne : ${laCarte('c-auth')?.securite}`);

  // 4. Une carte anodine.
  await commande({ type: 'card.start', id: 'c-libelle' });
  const lib = await attendre(() => laCarte('c-libelle')?.agentId ? laCarte('c-libelle') : null, 30000);
  const r4 = await attendre(() => { const m = lib?.agentId && derniereReponse(lib.agentId); return m && !m.streaming && m.content ? m : null; }, 90000);
  noter('une carte anodine ne reçoit aucune proposition', !!r4 && !suiteSecurite(r4), JSON.stringify(r4?.suites ?? null));
  noter('la carte anodine ne retient rien', !laCarte('c-libelle')?.securite, `colonne : ${laCarte('c-libelle')?.securite}`);

  // Facultatif : l'écran de la carte, à l'œil (BELUGA_SECURITE_CAPTURE=<dossier>).
  const dossierCapture = process.env.BELUGA_SECURITE_CAPTURE;
  if (dossierCapture) {
    const { chromium } = await import('playwright');
    const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
      for (const [largeur, hauteur, schema] of [[1440, 900, 'light'], [1440, 900, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
        const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, colorScheme: schema });
        await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: `http://127.0.0.1:${PORT}` }]);
        const page = await contexte.newPage();
        await page.goto(`http://127.0.0.1:${PORT}/#projet/${PROJET}/tache/c-auth`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);
        const bloc = page.locator('[data-suites-titre]').last();
        noter(`la suite s'affiche sous la réponse (${largeur} px, ${schema})`, (await bloc.count()) > 0);
        await bloc.scrollIntoViewIfNeeded().catch(() => {});
        await page.screenshot({ path: path.join(dossierCapture, `securite-proposee-${largeur}-${schema}.png`) });
        await contexte.close();
      }
    } finally {
      await navigateur.close();
    }
  }

  // 5. Jamais d'alerte : aucune notification ne nomme la proposition.
  const db = base(true);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%notif%'").all().map((t) => t.name);
  const alertes = tables.reduce((n, t) => n + db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE CAST(data AS TEXT) LIKE '%securite%'`).get().n, 0);
  db.close();
  noter('aucune alerte ne porte la proposition', alertes === 0, `${tables.length} table(s) de notifications relue(s)`);
}

try {
  await main();
} catch (e) {
  noter('déroulé sans exception', false, e.message + '\n' + journal.join('').slice(-1500));
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(echecs ? `\n${echecs} échec(s) sur ${resultats.length}.` : `\n${resultats.length}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
