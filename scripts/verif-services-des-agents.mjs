#!/usr/bin/env node
/**
 * TOUT AGENT SE SERT DE TOUS LES SERVICES (02/11/2026), sur un démon JETABLE
 * et un FAUX moteur — aucun quota dépensé :
 *
 *   1. un agent de projet reçoit l'outil « services » et le guide des services
 *      dans sa consigne ;
 *   2. « fais-moi une vidéo » : l'agent appelle services/studio/video → une
 *      création naît dans le Studio avec son directeur artistique (carte
 *      étiquetée studio), et un bloc de suivi (étape + lien vers le Studio)
 *      paraît dans la conversation de l'agent ;
 *   3. il crée une note dans son projet ;
 *   4. il propose une publication datée : elle reste « à valider » ;
 *   5. l'auteur du message est retenu comme interlocuteur de l'agent.
 *
 * Les droits d'un accès limité, le clic « Programmer », la réponse au client et
 * le miroir d'un bouton à prix se vérifient sans démon :
 * `server/src/test/services-des-agents.test.ts`.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-services-des-agents.mjs
 *
 * Jamais depuis le dépôt principal : depuis la copie de travail d'une carte.
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const exiger = createRequire(import.meta.url);
const Database = exiger('better-sqlite3');
const { WebSocket } = exiger('ws');
const PORT = Number(process.env.BELUGA_SERVICES_PORT || 7241);

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const envPropre = { ...process.env };
delete envPropre.BELUGA_TOKEN;
delete envPropre.BELUGA_URL;
for (const cle of Object.keys(envPropre)) if (cle.startsWith('BELUGA_')) delete process.env[cle];

const decor = demarrerDemonDEssai({
  prefixe: 'verif-services-agents-',
  port: PORT,
  env: {},
  garder: !!process.env.BELUGA_SERVICES_GARDER,
});
const { TMP, DATA, DEPOT, demon, journal, attendrePort } = decor;
const MAISON = path.join(TMP, 'maison');
const COMPTE = path.join(TMP, 'compte-claude');
const DEMANDES = path.join(TMP, 'demandes');
for (const d of [MAISON, COMPTE, DEMANDES]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(COMPTE, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'jeton-d-essai', expiresAt: Date.now() + 3600_000 } }));

/* Le démon est relancé avec le faux moteur : on tue celui du décor et on en démarre un avec nos variables. */
demon.kill('SIGKILL');
const { spawn } = await import('node:child_process');
const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';
if (process.argv.includes('--version')) { process.stdout.write('faux-moteur 0.0.0 (essai)\\n'); process.exit(0); }
let demande = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (demande += d));
process.stdin.on('end', () => jouer());
const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const TMP = ${JSON.stringify(TMP)};
async function jouer() {
  fs.writeFileSync(${JSON.stringify(DEMANDES)} + '/' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.txt', demande + '\\n---ARGV---\\n' + process.argv.join(' '));
  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
  const cheminMcp = process.argv[process.argv.indexOf('--mcp-config') + 1];
  const pont = cheminMcp && fs.existsSync(cheminMcp) ? JSON.parse(fs.readFileSync(cheminMcp, 'utf8')).mcpServers?.beluga?.env : null;
  const entetes = pont ? { 'content-type': 'application/json', 'x-beluga-token': pont.BELUGA_TOKEN, 'x-beluga-agent': pont.BELUGA_AGENT, 'x-beluga-tour': pont.BELUGA_TOUR } : {};
  const appeler = async (name, args) => {
    const res = await fetch(pont.BELUGA_URL + '/internal/call', { method: 'POST', headers: entetes, body: JSON.stringify({ name, args }) });
    const rendu = await res.json().catch(() => null);
    fs.appendFileSync(TMP + '/pont.log', JSON.stringify({ agent: pont.BELUGA_AGENT, name, args, rendu }) + '\\n');
    return rendu;
  };
  if (pont && demande.includes('ESSAI-SERVICES')) {
    const res = await fetch(pont.BELUGA_URL + '/internal/tools', { method: 'POST', headers: entetes, body: '{}' });
    const outils = ((await res.json().catch(() => ({}))).tools ?? []).map((t) => t.name);
    fs.writeFileSync(TMP + '/outils.json', JSON.stringify(outils));
    await appeler('services', { service: 'studio', action: 'video', demande: 'Une vidéo de 10 secondes qui présente le produit.', titre: 'Présentation essai' });
    await appeler('services', { service: 'notes', action: 'creer', titre: 'Note de l’agent' });
    await appeler('services', { service: 'reseaux', action: 'proposer', texte: 'Nouveauté !', canal: 'instagram', date: '2026-12-01', heure: '18:30' });
  }
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Compris.' }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', result: 'Compris.', usage: { input_tokens: 10, output_tokens: 5 } });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

const vraiDemon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...envPropre,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: path.join(TMP, 'projets'),
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
    BELUGA_SANS_AMORCE: '1',
    BELUGA_TRADUCTION_IDENTITE: '1',
    BELUGA_CLAUDE_BIN: FAUX_MOTEUR,
    BELUGA_MEDIAS: path.join(TMP, 'medias'),
    HOME: MAISON,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
vraiDemon.stdout.on('data', (d) => journal.push(String(d)));
vraiDemon.stderr.on('data', (d) => journal.push(String(d)));
process.on('exit', () => {
  try {
    vraiDemon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
});

const base = (lecture = false) => new Database(path.join(DATA, 'beluga.db'), { readonly: lecture });
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(24).toString('hex');
const PROJET_ID = 'projet-services';
const AGENT_ID = 'agent-services';

async function attendre(condition, limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 40000);
    prise.on('open', () => prise.send(JSON.stringify({ id, cmd })));
    prise.on('message', (brut) => {
      const ev = JSON.parse(String(brut));
      if (ev.type !== 'ack' || ev.id !== id) return;
      clearTimeout(minuteur);
      prise.close();
      ev.ok === false ? reject(new Error(ev.error ?? 'refus')) : resolve(ev.data);
    });
    prise.on('error', reject);
  });
}

const lignesDuPont = () =>
  fs.existsSync(path.join(TMP, 'pont.log'))
    ? fs.readFileSync(path.join(TMP, 'pont.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

try {
  if (!(await attendrePort(60000))) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1500));
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), maintenant, maintenant + 3600_000, 'vérification services des agents');
  const projet = { id: PROJET_ID, name: 'Essai services', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'compte-essai',
    'claude',
    JSON.stringify({ id: 'compte-essai', engine: 'claude', label: 'Compte d’essai', priority: 1, configDir: COMPTE }),
    maintenant,
  );
  const agent = { id: AGENT_ID, projectId: PROJET_ID, role: 'task', title: 'Agent du projet', workdir: DEPOT, run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'idle', createdAt: maintenant, updatedAt: maintenant };
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)').run(
    agent.id,
    PROJET_ID,
    agent.role,
    agent.status,
    JSON.stringify(agent),
    maintenant,
    maintenant,
  );
  db.close();
  /* Le démon relit sa base : un redémarrage à froid n'est pas nécessaire, le magasin lit à la demande — on vérifie. */
  await commande({ type: 'agent.prompt', agentId: AGENT_ID, text: 'ESSAI-SERVICES : fais-moi une vidéo de présentation, une note et une publication.' });

  const vu = await attendre(() => lignesDuPont().filter((l) => l.name === 'services').length >= 3, 60000);
  noter('le faux moteur a appelé l’outil « services » trois fois', vu, `${lignesDuPont().length} appel(s)`);
  const outils = fs.existsSync(path.join(TMP, 'outils.json')) ? JSON.parse(fs.readFileSync(path.join(TMP, 'outils.json'), 'utf8')) : [];
  noter('l’outil « services » est servi à un agent de projet ordinaire', outils.includes('services'));
  const demandes = fs.readdirSync(DEMANDES).map((n) => fs.readFileSync(path.join(DEMANDES, n), 'utf8'));
  noter('le guide des services part avec la consigne de l’agent', demandes.some((d) => d.includes('ESSAI-SERVICES') && d.includes('LES SERVICES DE BELUGA')));

  const [video, note, publication] = lignesDuPont().filter((l) => l.name === 'services');
  noter('la vidéo est ouverte dans le Studio', !!video?.rendu?.ok, video?.rendu?.text?.slice(0, 120));
  const lecture = base(true);
  const creation = lecture.prepare("SELECT * FROM studio_creations WHERE titre = 'Présentation essai'").get();
  noter('une création du Studio est née', !!creation);
  noter('elle a son directeur artistique (agent et carte)', !!creation?.agent_id && !!creation?.card_id);
  const etiquette = creation?.card_id ? lecture.prepare("SELECT 1 AS ok FROM card_labels WHERE card_id = ? AND label = 'studio'").get(creation.card_id) : null;
  noter('la carte du directeur porte l’étiquette studio', !!etiquette);
  const meta = (cle) => lecture.prepare('SELECT value FROM meta WHERE key = ?').get(cle)?.value ?? null;
  noter('la création retient son demandeur', meta(`studio.demandeur.${creation?.id}`) === AGENT_ID);
  const blocId = meta(`studio.suivi.${creation?.id}`);
  const bloc = blocId ? lecture.prepare('SELECT * FROM messages WHERE id = ?').get(blocId) : null;
  const contenuDuBloc = bloc ? JSON.parse(bloc.data ?? '{}').content ?? bloc.content ?? '' : '';
  noter('un bloc de suivi est posé dans la conversation de l’agent', !!bloc && bloc.agent_id === AGENT_ID);
  noter('le bloc dit l’étape et ouvre le Studio sur la création', /Étape/.test(contenuDuBloc) && contenuDuBloc.includes(`#studio/${creation?.id}`), contenuDuBloc.slice(0, 160));
  noter('le directeur parle au même interlocuteur que l’agent', !!meta(`interlocuteur.agent.${creation?.agent_id}`) && meta(`interlocuteur.agent.${creation?.agent_id}`) === meta(`interlocuteur.agent.${AGENT_ID}`));
  noter('une note est créée dans le projet', !!note?.rendu?.ok, note?.rendu?.text);
  const contenu = lecture.prepare("SELECT etape FROM marketing_contenus WHERE project_id = ? AND texte = 'Nouveauté !'").get(PROJET_ID);
  noter('la publication proposée reste « à valider »', contenu?.etape === 'a_valider', `${contenu?.etape} — ${publication?.rendu?.text?.slice(0, 90)}`);
  lecture.close();
} catch (err) {
  noter('déroulé sans exception', false, String(err?.stack ?? err));
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passent.`);
if (echecs.length && process.env.BELUGA_SERVICES_JOURNAL) fs.writeFileSync(process.env.BELUGA_SERVICES_JOURNAL, journal.join(''));
process.exit(echecs.length ? 1 : 0);
