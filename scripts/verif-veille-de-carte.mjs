#!/usr/bin/env node
/**
 * LA VEILLE D'UNE CARTE, DE BOUT EN BOUT, ET LES CARTES MARKETING VISIBLES.
 *
 *   npm run build && node scripts/verif-veille-de-carte.mjs
 *
 * Le script monte son PROPRE démon (port libre, base neuve, FAUX MOTEUR qui
 * ouvre le vrai pont d'outils) — jamais depuis le dépôt principal, jamais sur
 * l'application publiée. Un petit site local répond d'abord « Profil en cours
 * de vérification », puis « Profil validé ».
 *
 *   1. LA POSE — l'agent appelle « veille_poser » par son pont : la carte reste
 *      en « En cours », en pause sur place, avec son résumé de veille, et la fin
 *      de son tour ne la range pas ;
 *   2. « PAS ENCORE » — un passage tant que le site attend ne lève rien ;
 *   3. LE BLOCAGE LEVÉ — le site répond « validé », un passage lève la veille,
 *      et la carte REPART SEULE : un nouveau tour de l'agent, avec le message
 *      « Le blocage est levé », puis la carte se range comme toute tâche ;
 *   4. L'ÉCHÉANCE — une seconde veille, dont l'échéance est avancée en base,
 *      pose sa question dans la cloche (événement « attention ») ;
 *      « Abandonner » termine la carte ;
 *   5. UNE CARTE MARKETING QUI ATTEND — en « En cours » avec une question
 *      ouverte, elle paraît sur les tableaux de bord et dans la cloche ; rangée
 *      dans « Archivé », elle n'y paraît plus.
 */
import { colonnesDeLaCarte } from '../shared/dist/carte-sql.js';
import Database from 'better-sqlite3';
import * as ws from 'ws';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le dépôt d'où PART ce script — jamais un chemin écrit en dur.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (path.resolve(RACINE) === '/root/beluga') {
  console.error('Ce contrôle monte un démon jetable : lance-le depuis la copie de travail d’une carte, jamais depuis le dépôt principal.');
  process.exit(2);
}
const PORT = Number(process.env.BELUGA_VEILLE_PORT || 7207);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-veille-carte-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le site qui valide                                                   */
/* ------------------------------------------------------------------ */

let statutDuSite = 'Profil en cours de vérification';
const site = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<html><body><p>${statutDuSite}</p></body></html>`);
});
await new Promise((resolve) => site.listen(0, 'localhost', resolve));
const ADRESSE = `http://localhost:${site.address().port}/statut`;

/* ------------------------------------------------------------------ */
/* Le décor                                                             */
/* ------------------------------------------------------------------ */

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
 * LE FAUX MOTEUR. « ZZVEILLE <adresse> <heures> » : il pose une veille par son
 * VRAI pont d'outils, puis rend une phrase courte. Une demande qui porte « Le
 * blocage est levé » : il reprend, écrit un fichier, et rend son compte rendu.
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
const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
let pont = null;
process.on('exit', () => { try { pont?.kill(); } catch {} });

async function ouvrirLePont() {
  const i = process.argv.indexOf('--mcp-config');
  if (i < 0) return null;
  const config = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
  const serveur = config?.mcpServers?.beluga;
  if (!serveur?.command) return null;
  pont = spawn(serveur.command, serveur.args ?? [], { env: { ...process.env, ...(serveur.env ?? {}) }, stdio: ['pipe', 'pipe', 'ignore'] });
  pont.stdout.setEncoding('utf8');
  let tampon = '';
  const enAttente = new Map();
  pont.stdout.on('data', (bout) => {
    tampon += bout;
    const lignes = tampon.split('\\n');
    tampon = lignes.pop();
    for (const ligne of lignes) {
      try { const rep = JSON.parse(ligne); enAttente.get(rep.id)?.(rep); } catch {}
    }
  });
  const demander = (id, method, params) => new Promise((resolve) => {
    enAttente.set(id, resolve);
    setTimeout(() => resolve(null), 30000);
    pont.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n');
  });
  await demander(1, 'initialize', { protocolVersion: '2024-11-05' });
  await demander(2, 'tools/list', {});
  return demander;
}

async function jouer() {
  const demander = await ouvrirLePont();
  dire({ type: 'system', subtype: 'init', session_id: 'session-veille' });
  dire({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu-liste', name: 'TodoWrite', input: { todos: [{ content: 'Attendre la validation', status: 'in_progress' }] } }] } });
  const veille = /ZZVEILLE (\\S+) (\\S+)/.exec(demande);
  if (veille && !/Le blocage est levé/.test(demande)) {
    const rep = demander
      ? await demander(3, 'tools/call', {
          name: 'veille_poser',
          arguments: { raison: 'Le réseau valide le profil', url: veille[1], recette: { type: 'appel', motAttendu: 'Profil validé' }, intervalleMinutes: 15, dureeHeures: Number(veille[2]) },
        })
      : null;
    const texte = rep?.result?.content?.[0]?.text ?? 'pont muet';
    fs.writeFileSync('reponse-veille.txt', texte);
    dire({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu-liste2', name: 'TodoWrite', input: { todos: [{ content: 'Attendre la validation', status: 'completed' }] } }] } });
    dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Une veille attend que le réseau valide le profil.' }] } });
  } else {
    const nom = 'reprise-' + Date.now() + '.txt';
    fs.writeFileSync(nom, 'repris\\n');
    try {
      execFileSync('git', ['add', nom]);
      execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'reprise']);
    } catch {}
    dire({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu-liste3', name: 'TodoWrite', input: { todos: [{ content: 'Attendre la validation', status: 'completed' }] } }] } });
    dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reprise faite après la validation.' }] } });
  }
  dire({ type: 'result', subtype: 'success', session_id: 'session-veille', usage: { input_tokens: 10, output_tokens: 5 } });
  setTimeout(() => process.exit(0), 200);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

/* ------------------------------------------------------------------ */
/* Le démon                                                             */
/* ------------------------------------------------------------------ */

let demon = null;
const journal = [];
function lancerLeDemon() {
  demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
    env: {
      ...process.env,
      BELUGA_TOKEN: '',
      BELUGA_URL: '',
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
  site.close();
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
const PROJET = 'p-veille';
const base = (readonly = false) => new Database(path.join(DATA, 'beluga.db'), readonly ? { readonly: true } : undefined);

function laCarte(id) {
  const db = base(true);
  const ligne = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  db.close();
  if (!ligne) return null;
  const reste = ligne.data ? JSON.parse(ligne.data) : {};
  return { column: ligne.column_key, agentId: ligne.agent_id ?? reste.agentId, scheduling: reste.scheduling ?? {}, veille: reste.veille };
}
function laVeille(cardId) {
  const db = base(true);
  const ligne = db.prepare('SELECT * FROM veilles_de_carte WHERE card_id = ? ORDER BY cree_a DESC LIMIT 1').get(cardId);
  db.close();
  return ligne ?? null;
}
function messagesDe(agentId) {
  const db = base(true);
  const lignes = db.prepare('SELECT data FROM messages WHERE agent_id = ? ORDER BY created_at ASC').all(agentId);
  db.close();
  return lignes.map((l) => JSON.parse(l.data));
}

function insererCarte(db, carte) {
  const colonnes = colonnesDeLaCarte(carte);
  const noms = Object.keys(colonnes);
  db.prepare(`INSERT INTO cards (${noms.join(', ')}) VALUES (${noms.map(() => '?').join(', ')})`).run(...noms.map((nom) => colonnes[nom]));
  (carte.labels ?? []).forEach((label, i) => db.prepare('INSERT INTO card_labels (card_id, position, label) VALUES (?, ?, ?)').run(carte.id, i, label));
}

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), maintenant, maintenant + 3600_000, 'vérification veille');
  const projet = { id: PROJET, name: 'Essai veille', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, DEPOT, JSON.stringify(projet), maintenant, maintenant);
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'compte-essai',
    'claude',
    JSON.stringify({ id: 'compte-essai', engine: 'claude', label: 'Compte d’essai', priority: 1, configDir: path.join(TMP, 'claude-config') }),
    maintenant,
  );
  const carte = (id, titre, extra = {}) => ({
    id,
    projectId: PROJET,
    column: 'planned',
    position: 1,
    title: titre,
    description: `ZZVEILLE ${ADRESSE} ${extra.heures ?? 48}`,
    origin: 'user',
    labels: [],
    attachments: [],
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    estimate: { machineSeconds: 60, seniorHours: 0.25, confidence: 'medium', failed: false },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    createdAt: maintenant,
    updatedAt: maintenant,
    ...extra.carte,
  });
  insererCarte(db, carte('c-levee', 'Attendre la validation du profil'));
  insererCarte(db, carte('c-echue', 'Attendre une validation qui ne vient pas', { heures: 1 }));
  /* La carte de l'atelier : en « En cours », son agent a posé une question. */
  insererCarte(db, carte('c-mk', 'Ouvrir Instagram — essai', { carte: { column: 'running', labels: ['marketing'], agentId: 'a-mk', description: 'marketing' } }));
  const agent = { id: 'a-mk', projectId: PROJET, role: 'task', title: 'Agent marketing', cardId: 'c-mk', run: { engine: 'claude' }, status: 'done', createdAt: maintenant, updatedAt: maintenant };
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    agent.id, PROJET, 'c-mk', 'task', 'done', JSON.stringify(agent), maintenant, maintenant,
  );
  const message = {
    id: 'm-mk', agentId: 'a-mk', role: 'assistant', content: 'Une question.', steps: [], todos: [], proposals: [],
    questions: [{ id: 'q-mk', question: 'Quel genre indiquer sur le compte ?', kind: 'single', options: [{ id: 'o0', label: 'Homme' }], allowFreeText: true, answerAttachments: [], cancelled: false }],
    createdAt: maintenant,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at, a_questions, streaming) VALUES (?, ?, ?, ?, ?, 1, 0)').run('m-mk', 'a-mk', 'assistant', JSON.stringify(message), maintenant);
  db.close();
}

/** Une commande, et — si demandé — le premier événement d'un type donné reçu sur la même prise. */
function commande(cmd, evenementVoulu) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 60000);
    prise.on('open', () => (cmd ? prise.send(JSON.stringify({ id, cmd })) : null));
    prise.on('message', (brut) => {
      const evenement = JSON.parse(String(brut));
      if (evenementVoulu && evenement.type === evenementVoulu) {
        clearTimeout(minuteur);
        prise.close();
        return resolve(evenement);
      }
      if (!cmd || evenement.type !== 'ack' || evenement.id !== id) return;
      clearTimeout(minuteur);
      prise.close();
      if (evenement.error) reject(new Error(evenement.error));
      else resolve(evenement);
    });
    prise.on('error', (e) => (clearTimeout(minuteur), reject(e)));
  });
}
const cloche = async () => (await commande(null, 'attention')).decisions ?? [];

/* ------------------------------------------------------------------ */

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

  /* -------- 5. La carte marketing qui attend : visible, puis rangée -------- */
  const enRoute = async () => (await commande({ type: 'cards.enRoute', onglet: 'actif' })).data?.cards?.map((c) => c.id) ?? [];
  const actifs = await enRoute();
  noter('une carte marketing qui attend paraît sur les tableaux de bord', actifs.includes('c-mk'), actifs.join(', '));
  const decisions = await cloche();
  noter('…et sa question est dans la cloche', decisions.some((d) => d.cardId === 'c-mk' && !d.reglee), `${decisions.length} décision(s)`);

  /* -------- 1. La pose -------- */
  await commande({ type: 'card.start', id: 'c-levee' });
  const posee = await attendre(() => {
    const v = laVeille('c-levee');
    const c = laCarte('c-levee');
    return v && c?.scheduling?.enPause && !c.scheduling.tourEnVolDepuis ? { v, c } : null;
  }, 90000);
  noter('l’agent pose sa veille par son outil, la carte reste en « En cours » en pause', !!posee && posee.c.column === 'running', posee ? `état ${posee.v.etat}` : journal.join('').slice(-600));
  noter('la carte porte son résumé de veille', posee?.c?.veille?.etat === 'en_cours', JSON.stringify(posee?.c?.veille ?? null).slice(0, 160));
  const agentLevee = laCarte('c-levee')?.agentId;

  /* -------- 2. Pas encore -------- */
  const pasEncore = await commande({ type: 'card.veille.verifier', cardId: 'c-levee' });
  noter('un passage tant que le site attend ne lève rien', pasEncore.data?.issue === 'pas-encore' && laCarte('c-levee')?.column === 'running', JSON.stringify(pasEncore.data));

  /* -------- 3. Le blocage levé : la carte repart seule -------- */
  statutDuSite = 'Profil validé';
  const levee = await commande({ type: 'card.veille.verifier', cardId: 'c-levee' });
  noter('le site validé lève la veille', levee.data?.etat === 'levee', JSON.stringify(levee.data));
  const relance = await attendre(() => messagesDe(agentLevee).some((m) => m.role === 'user' && /Le blocage est levé/.test(m.content)), 30000);
  noter('l’agent est relancé par un message, sans clic', !!relance);
  const rangee = await attendre(() => (laCarte('c-levee')?.column === 'to_deploy' ? laCarte('c-levee') : null), 90000);
  noter('la reprise mène la carte au bout, comme toute tâche', !!rangee, `colonne « ${laCarte('c-levee')?.column} »`);
  noter('la pause et le résumé de veille sont tombés', !!rangee && !rangee.scheduling.enPause && !rangee.veille);

  /* -------- 4. L'échéance -------- */
  statutDuSite = 'Profil en cours de vérification';
  await commande({ type: 'card.start', id: 'c-echue' });
  const poseeEchue = await attendre(() => {
    const c = laCarte('c-echue');
    return laVeille('c-echue') && c?.scheduling?.enPause && !c.scheduling.tourEnVolDepuis ? true : null;
  }, 90000);
  noter('une seconde veille est posée', !!poseeEchue);
  const db = base();
  db.prepare("UPDATE veilles_de_carte SET echeance = ? WHERE card_id = 'c-echue'").run(Date.now() - 1000);
  db.close();
  await commande({ type: 'card.veille.verifier', cardId: 'c-echue' });
  noter('l’échéance passe la veille à « expirée »', laVeille('c-echue')?.etat === 'expiree');
  const question = (await cloche()).find((d) => d.cardId === 'c-echue' && !d.reglee);
  noter('la question de l’échéance est dans la cloche', !!question && /Prolonger la veille/.test(question.texte ?? ''), question?.texte);
  const messageDeQuestion = messagesDe(laCarte('c-echue')?.agentId).find((m) => m.questions?.some((q) => q.veille));
  const q = messageDeQuestion?.questions.find((x) => x.veille);
  await commande({ type: 'question.answer', messageId: messageDeQuestion?.id, questionId: q?.id, answer: 'Abandonner' });
  const abandonnee = await attendre(() => (laCarte('c-echue')?.column === 'to_deploy' ? laCarte('c-echue') : null), 20000);
  noter('« Abandonner » termine la carte, la pause tombe', !!abandonnee && !abandonnee.scheduling.enPause, `colonne « ${laCarte('c-echue')?.column} »`);
  noter('la veille est abandonnée', laVeille('c-echue')?.etat === 'abandonnee');

  /* -------- 5 bis. La carte marketing rangée quitte les tableaux de bord -------- */
  await commande({ type: 'card.move', id: 'c-mk', column: 'archived' }).catch(() => null);
  const apres = await enRoute();
  noter('rangée, la carte marketing quitte les tableaux de bord', !apres.includes('c-mk'), apres.join(', '));
}

try {
  await main();
} catch (err) {
  noter('le contrôle s’est déroulé jusqu’au bout', false, String(err?.stack ?? err).slice(0, 600));
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passent.`);
if (echecs) console.log(journal.join('').split('\n').filter((l) => /veille|ERROR|WARN/.test(l)).slice(-30).join('\n'));
process.exit(echecs ? 1 : 0);
