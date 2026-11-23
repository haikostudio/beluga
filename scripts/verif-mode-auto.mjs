#!/usr/bin/env node
/**
 * LE MODE « AUTO » D'UNE CARTE, DE BOUT EN BOUT (carte « Services homogènes et centrés », 14/11/2026).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-mode-auto.mjs
 *
 * Le script monte son PROPRE démon (port libre, base neuve) avec un FAUX MOTEUR — un vrai processus, aucun jeton
 * dépensé — qui ouvre le pont d'outils comme un vrai moteur. Ce qui est vérifié :
 *   1. UNE QUESTION D'UN AGENT DE TÂCHE en Auto reçoit AUSSITÔT la réponse conseillée (« (recommandé) »), marquée
 *      « parAuto », par le chemin d'un clic : le moteur arrêté sur `ask_user` reçoit la réponse et finit son tour ;
 *   2. L'OUTIL DE BILAN n'est servi qu'en Auto, et un bilan INACHEVÉ relance le travail par le cadrage (relance 1/2) :
 *      le compteur monte, le journal le dit, la demande « MODE AUTO — RELANCE 1 » arrive à l'agent de cadrage ;
 *   3. AU-DELÀ DE DEUX RELANCES, Auto S'ARRÊTE : un jalon rouge « Auto arrêté » au journal, plus de relance.
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
const PORT = Number(process.env.BELUGA_AUTO_PORT || 7219);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-mode-auto-'));
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

/*
 * LE FAUX MOTEUR. Il ouvre le pont d'outils comme un vrai moteur (poignée de main, liste d'outils), puis selon la
 * demande : « zzquestion » appelle `ask_user` et attend la réponse ; « zzinacheve » déclare par `bilan_du_travail`
 * un travail qui n'est pas fini (« zzlent » attend d'abord quelques secondes) ; sinon il rend son travail.
 */
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
let pont = null;
process.on('exit', () => { try { pont?.kill(); } catch {} });
function ouvrirLePont() {
  const i = process.argv.indexOf('--mcp-config');
  if (i < 0) return null;
  const config = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
  const serveur = config?.mcpServers?.beluga;
  if (!serveur?.command) return null;
  const p = spawn(serveur.command, serveur.args ?? [], { env: { ...process.env, ...(serveur.env ?? {}) }, stdio: ['pipe', 'pipe', 'ignore'] });
  p.stdout.setEncoding('utf8');
  return p;
}
const attendre = (id, limite) =>
  new Promise((resolve) => {
    let tampon = '';
    const lire = (bout) => {
      tampon += bout;
      for (const ligne of tampon.split('\\n')) {
        if (!ligne.trim()) continue;
        try { const rep = JSON.parse(ligne); if (rep.id === id) { pont.stdout.off('data', lire); resolve(rep); return; } } catch {}
      }
    };
    pont.stdout.on('data', lire);
    setTimeout(() => { pont.stdout.off('data', lire); resolve(null); }, limite);
  });
const demander = (id, method, params, limite = 5000) => { pont.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n'); return attendre(id, limite); };
async function jouer() {
  pont = ouvrirLePont();
  let outils = [];
  if (pont) {
    await demander(1, 'initialize', { protocolVersion: '2024-11-05' });
    const liste = await demander(2, 'tools/list', {});
    outils = (liste?.result?.tools ?? []).map((t) => t.name);
  }
  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
  let texte = 'Travail rendu. Outils : ' + outils.join(',');
  if (/zzquestion/.test(demande) && pont) {
    const rep = await demander(3, 'tools/call', { name: 'ask_user', arguments: { question: 'Quel ton pour le texte ?', options: [{ label: 'Doux' }, { label: 'Direct (recommandé)' }] } }, 90000);
    texte = 'Réponse reçue : ' + JSON.stringify(rep?.result ?? null) + ' — outils : ' + outils.join(',');
  }
  const drapeau = (nom) => fs.existsSync(${JSON.stringify(TMP)} + '/' + nom);
  if (/zzlent/.test(demande) || drapeau('lent')) await new Promise((r) => setTimeout(r, 4000));
  if ((/zzinacheve/.test(demande) || drapeau('inacheve')) && pont) {
    await demander(4, 'tools/call', { name: 'bilan_du_travail', arguments: { abouti: false, restes: ['les tests échouent encore'] } }, 15000);
  }
  const nom = 'travail-' + Date.now() + '.txt';
  fs.writeFileSync(nom, 'fait\\n');
  try {
    execFileSync('git', ['add', nom], { cwd: process.cwd() });
    execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'travail'], { cwd: process.cwd() });
  } catch {}
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: texte }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 10, output_tokens: 5 } });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

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
process.on('exit', () => {
  try {
    demon?.kill('SIGKILL');
  } catch {}
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
const PROJET = 'p-auto';
const CARTE = 'c-auto';
const base = (readonly = false) => new Database(path.join(DATA, 'beluga.db'), readonly ? { readonly: true } : undefined);

function laCarte() {
  const db = base(true);
  const ligne = db.prepare('SELECT * FROM cards WHERE id = ?').get(CARTE);
  db.close();
  if (!ligne) return null;
  const reste = ligne.data ? JSON.parse(ligne.data) : {};
  return { column: ligne.column_key, parcours: reste.parcours ?? {} };
}
function ecrireLeParcours(modifier) {
  const db = base();
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(CARTE);
  const carte = JSON.parse(ligne.data);
  carte.parcours = modifier(carte.parcours ?? {});
  db.prepare('UPDATE cards SET data = ? WHERE id = ?').run(JSON.stringify(carte), CARTE);
  db.close();
}
function lesAgents() {
  const db = base(true);
  const lignes = db.prepare('SELECT data FROM agents WHERE card_id = ? ORDER BY updated_at DESC').all(CARTE);
  db.close();
  return lignes.map((l) => JSON.parse(l.data));
}
function lesMessages(agentId) {
  const db = base(true);
  const lignes = db.prepare('SELECT data FROM messages WHERE agent_id = ? ORDER BY created_at ASC').all(agentId);
  db.close();
  return lignes.map((l) => JSON.parse(l.data));
}
function leJournal() {
  const db = base(true);
  const lignes = db.prepare('SELECT * FROM card_journal WHERE card_id = ?').all(CARTE);
  db.close();
  return lignes.map((l) => JSON.stringify(l)).join('\n');
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), maintenant, maintenant + 3600_000, 'vérification mode Auto');
  const projet = { id: PROJET, name: 'Essai mode Auto', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, DEPOT, JSON.stringify(projet), maintenant, maintenant);
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'compte-essai',
    'claude',
    JSON.stringify({ id: 'compte-essai', engine: 'claude', label: 'Compte d’essai', priority: 1, configDir: path.join(TMP, 'claude-config') }),
    maintenant,
  );
  const carte = {
    id: CARTE,
    projectId: PROJET,
    column: 'planned',
    position: 1,
    title: 'Carte en mode Auto',
    description: 'zzquestion : poser une question, puis rendre le travail.',
    origin: 'user',
    labels: [],
    attachments: [],
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    estimate: { machineSeconds: 60, seniorHours: 0.25, confidence: 'medium', failed: false },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    parcours: { plans: [], lancementAutomatique: true },
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  const colonnes = colonnesDeLaCarte(carte);
  const noms = Object.keys(colonnes);
  db.prepare(`INSERT INTO cards (${noms.join(', ')}) VALUES (${noms.map(() => '?').join(', ')})`).run(...noms.map((nom) => colonnes[nom]));
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
const attendreColonne = (colonne, limiteMs = 90000) => attendre(() => (laCarte()?.column === colonne ? laCarte() : null), limiteMs);
const agentDeTache = () => lesAgents().find((a) => a.role === 'task');

/** Un tour de l'agent de tâche : la carte close repasse en « Planifié » (une carte interrompue), puis le message part. */
async function unTourDeTache(texte) {
  if (laCarte()?.column === 'to_deploy') await commande({ type: 'card.move', id: CARTE, column: 'planned' });
  const agent = agentDeTache();
  await commande({ type: 'agent.prompt', agentId: agent.id, text: texte });
}

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

  /* -------- 1. La question de l'agent reçoit la réponse conseillée, sans clic -------- */
  await commande({ type: 'card.start', id: CARTE });
  const repondue = await attendre(() => {
    const agent = agentDeTache();
    if (!agent) return null;
    for (const m of lesMessages(agent.id)) for (const q of m.questions ?? []) if (q.answer) return { q, agent };
    return null;
  }, 60000);
  noter('la question de l’agent reçoit la réponse conseillée, sans clic', repondue?.q.answer === 'Direct (recommandé)', repondue ? repondue.q.answer : 'aucune réponse');
  noter('la réponse est marquée « Choisi par Auto »', repondue?.q.parAuto === true);
  const rendue = await attendreColonne('to_deploy', 60000);
  noter('le moteur reçoit la réponse et rend son travail', !!rendue, `colonne « ${laCarte()?.column} »`);
  const derniers = repondue ? lesMessages(repondue.agent.id).filter((m) => m.role === 'assistant').map((m) => m.content).join('\n') : '';
  noter('le moteur a bien lu « Direct (recommandé) »', /Direct \(recommandé\)/.test(derniers));
  noter('l’outil de bilan est servi à l’agent de tâche en Auto', /bilan_du_travail/.test(derniers));

  /* -------- 2. Un bilan inachevé relance le travail par le cadrage (1/2) -------- */
  await unTourDeTache('zzinacheve : continue le travail.');
  const relance = await attendre(() => ((laCarte()?.parcours?.relancesAuto ?? 0) >= 1 ? laCarte() : null), 60000);
  noter('un bilan inachevé compte une relance', relance?.parcours?.relancesAuto === 1, JSON.stringify(laCarte()?.parcours?.bilanAuto ?? null));
  const cadrage = await attendre(() => {
    const agent = lesAgents().find((a) => a.role === 'cadrage');
    if (!agent) return null;
    return lesMessages(agent.id).some((m) => m.role === 'user' && /MODE AUTO — RELANCE 1 SUR 2/.test(m.content)) ? agent : null;
  }, 30000);
  noter('la demande « MODE AUTO — RELANCE 1 » arrive au cadrage, avec ce qui reste', !!cadrage);
  noter('le journal de la carte dit la relance', await attendre(() => (/Auto relance le travail \(1\/2\)/.test(leJournal()) ? true : null), 10000));

  /* -------- 3. Au-delà de deux relances, Auto s'arrête -------- */
  await attendre(() => (lesAgents().every((a) => !['running', 'starting'].includes(a.status)) ? true : null), 60000);
  /* Le prochain tour de travail sera lent et inachevé ; on pose deux relances déjà faites, puis on relance la carte. */
  fs.writeFileSync(path.join(TMP, 'inacheve'), '1');
  fs.writeFileSync(path.join(TMP, 'lent'), '1');
  /* Le cadrage relancé rend sa compréhension (posée ici, le faux moteur ne cadre pas), puis la carte repart — comme le
     ferait le lancement automatique. Deux relances sont déjà comptées. */
  ecrireLeParcours((p) => ({ ...p, comprehension: { texte: '### Terminer\nFinir ce qui reste.', at: Date.now(), hypotheses: [], questions: [] } }));
  ecrireLeParcours((p) => ({ ...p, relancesAuto: 2 }));
  const depart = await commande({ type: 'card.start', id: CARTE }).then(() => true).catch((err) => String(err?.message ?? err));
  noter('la carte repart pour un troisième tour', depart === true, depart === true ? '' : depart);
  const arret = await attendre(() => (/Auto arrêté/.test(leJournal()) ? true : null), 60000);
  noter('après deux relances, Auto s’arrête et le dit au journal', !!arret);
  await new Promise((r) => setTimeout(r, 3000));
  noter('plus aucune relance après l’arrêt', (laCarte()?.parcours?.relancesAuto ?? 0) === 2, String(laCarte()?.parcours?.relancesAuto));
}

main()
  .catch((err) => noter('le scénario va au bout', false, String(err?.stack ?? err)))
  .finally(() => {
    const echecs = resultats.filter((r) => !r.ok).length;
    console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passent.`);
    if (echecs) console.log(journal.join('').slice(-3000));
    process.exit(echecs ? 1 : 0);
  });
