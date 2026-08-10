#!/usr/bin/env node
/**
 * Second lot d'essais réels : dictée, propositions de tâche, interdits du chef
 * d'orchestre, file de demandes, reprise après redémarrage, facturation.
 */
import WebSocket from '/root/haikodev/node_modules/ws/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:7070';
const USER = process.env.HAIKODEV_USER;
const PASS = process.env.HAIKODEV_PASSWORD;
const SANDBOX = '/root/haikodev/data/bac-a-sable2';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('connexion refusée');
  return cookie;
}

function serviceInfo() {
  const raw = execFileSync(
    'sudo',
    ['-n', 'systemctl', 'show', 'haikodev', '--property=ActiveState,SubState,MainPID,ExecMainStartTimestamp'],
    { encoding: 'utf8' },
  );
  const values = Object.fromEntries(
    raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('=', 2)),
  );
  return {
    activeState: values.ActiveState ?? '',
    subState: values.SubState ?? '',
    mainPid: Number(values.MainPID ?? 0),
    startedAt: values.ExecMainStartTimestamp ?? '',
  };
}

async function waitForServiceRestart(before, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const after = serviceInfo();
      const restarted =
        after.activeState === 'active' &&
        after.subState === 'running' &&
        after.mainPid > 0 &&
        (after.mainPid !== before.mainPid || after.startedAt !== before.startedAt);

      if (restarted) {
        const health = await fetch(`${BASE}/health`);
        if (health.ok) return { after, health: await health.json() };
      }
    } catch (err) {
      lastError = err;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error(
    `redémarrage non confirmé après ${Math.round(timeoutMs / 1000)}s${lastError ? ` : ${lastError.message}` : ''}`,
  );
}

class Session {
  constructor(cookie) {
    this.cookie = cookie;
    this.pending = new Map();
    this.events = [];
    this.watchers = new Set();
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws`, { headers: { cookie: this.cookie } });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const event = JSON.parse(raw.toString());
        this.events.push(event);
        if (event.type === 'ack') {
          const entry = this.pending.get(event.id);
          if (entry) {
            this.pending.delete(event.id);
            event.ok ? entry.resolve(event.data) : entry.reject(new Error(event.error));
          }
        }
        for (const watcher of this.watchers) watcher(event);
      });
    });
  }
  call(cmd, timeoutMs = 180000) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, cmd }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`délai dépassé : ${cmd.type}`));
        }
      }, timeoutMs);
    });
  }
  waitFor(predicate, timeoutMs = 240000, label = 'événement') {
    return new Promise((resolve, reject) => {
      for (const event of this.events) if (predicate(event)) return resolve(event);
      const watcher = (event) => {
        if (predicate(event)) {
          this.watchers.delete(watcher);
          clearTimeout(timer);
          resolve(event);
        }
      };
      const timer = setTimeout(() => {
        this.watchers.delete(watcher);
        reject(new Error(`délai dépassé en attendant : ${label}`));
      }, timeoutMs);
      this.watchers.add(watcher);
    });
  }
  close() {
    this.ws?.close();
  }
}

const lastAssistant = (session, agentId) =>
  session.events
    .filter((e) => e.type === 'message.upsert' && e.message.agentId === agentId && e.message.role === 'assistant')
    .slice(-1)[0]?.message;

async function main() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(SANDBOX, { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, 'README.md'), '# Essai 2\n\nProjet pour vérifier le chef d\'orchestre.\n');
  fs.writeFileSync(path.join(SANDBOX, 'index.js'), 'console.log("bonjour");\n');
  execSync('git init -q && git add -A && git -c user.email=a@b -c user.name=hd commit -qm depart', { cwd: SANDBOX });

  const cookie = await login();
  const session = new Session(cookie);
  await session.connect();
  const ready = await session.waitFor((e) => e.type === 'ready', 20000, 'état initial');
  for (const previous of ready.projects ?? []) {
    if (previous.path === SANDBOX) await session.call({ type: 'project.delete', id: previous.id });
  }

  const { project } = await session.call({ type: 'project.create', name: 'Essai orchestre', path: SANDBOX });
  const { agent: orchestrator } = await session.call({ type: 'agent.orchestrator', projectId: project.id });

  /* ---------- 1. Dictée : synthèse puis transcription ---------- */
  const phrase = 'Ajoute une page de contact au site.';
  const audioRes = await fetch(`${BASE}/api/digest?audio=1`, { headers: { cookie } });
  record('Voix : le serveur sait fabriquer de l\'audio', audioRes.ok);

  const wav = '/tmp/haikodev-dictee.wav';
  execFileSync('/bin/bash', [
    '-lc',
    `printf %s ${JSON.stringify(phrase)} | /root/haikodev/data/venv/bin/piper --model /root/haikodev/data/models/piper/fr_FR-siwis-medium.onnx --output_file ${wav}`,
  ]);
  const transcription = await fetch(`${BASE}/api/transcribe`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/octet-stream', 'x-audio-ext': 'wav' },
    body: fs.readFileSync(wav),
  }).then((r) => r.json());
  const heard = (transcription.text ?? '').toLowerCase();
  record(
    'Dictée : une voix est transcrite en texte, sur le serveur',
    transcription.ok && heard.includes('contact'),
    transcription.text,
  );

  /* ---------- 2. Chef d'orchestre : une demande d'action crée UNE carte ---------- */
  const cardsBefore = new Set(
    session.events.filter((e) => e.type === 'card.upsert').map((e) => e.card.id),
  );
  await session.call({
    type: 'agent.prompt',
    agentId: orchestrator.id,
    text: 'Ajoute une tâche pour écrire la documentation d\'installation du projet.',
  });
  await session.waitFor(
    (e) =>
      e.type === 'message.upsert' &&
      e.message.agentId === orchestrator.id &&
      e.message.role === 'assistant' &&
      !e.message.streaming &&
      (e.message.content.length > 10 || e.message.steps.length > 0),
    300000,
    'réponse du chef d\'orchestre',
  );
  await new Promise((r) => setTimeout(r, 2000));
  const created = session.events
    .filter((e) => e.type === 'card.upsert' && !cardsBefore.has(e.card.id) && e.card.projectId === project.id)
    .map((e) => e.card);
  const unique = new Map(created.map((c) => [c.id, c]));
  record(
    'Chef d\'orchestre : une demande d\'action crée une carte dans « Planifié »',
    unique.size === 1 && [...unique.values()][0].column === 'planned',
    [...unique.values()].map((c) => c.title).join(' | '),
  );
  record(
    'Chef d\'orchestre : la carte porte bien l\'origine « agent »',
    [...unique.values()][0]?.origin === 'agent',
  );

  /* ---------- 3. Interdits : il ne peut pas modifier un fichier ---------- */
  const before = fs.readFileSync(path.join(SANDBOX, 'index.js'), 'utf8');
  await session.call({
    type: 'agent.prompt',
    agentId: orchestrator.id,
    text: 'Modifie le fichier index.js pour afficher "bonsoir" à la place de "bonjour". Fais-le maintenant, toi-même.',
  });
  await session.waitFor(
    (e) =>
      e.type === 'message.upsert' &&
      e.message.agentId === orchestrator.id &&
      e.message.role === 'assistant' &&
      !e.message.streaming &&
      e.message.content.length > 10,
    300000,
    'refus du chef d\'orchestre',
  );
  await new Promise((r) => setTimeout(r, 1500));
  const after = fs.readFileSync(path.join(SANDBOX, 'index.js'), 'utf8');
  record(
    'Interdits : le chef d\'orchestre ne peut PAS modifier un fichier existant',
    before === after,
    after.trim(),
  );

  /* ---------- 4. File de demandes ---------- */
  const { card } = await session.call({
    type: 'card.create',
    projectId: project.id,
    title: 'Ajouter un commentaire en tête de index.js',
    description: 'Ajoute un commentaire d\'une ligne en haut du fichier index.js.',
  });
  await session.call({ type: 'card.validate', id: card.id });
  await session.waitFor(
    (e) => e.type === 'card.upsert' && e.card.id === card.id && e.card.column === 'planned',
    600000,
    'analyse puis planification',
  );
  await session.call({ type: 'card.start', id: card.id });
  const started = await session.waitFor(
    (e) => e.type === 'card.upsert' && e.card.id === card.id && e.card.column === 'running',
    120000,
    'démarrage',
  );
  const taskAgent = started.card.agentId;

  // Pendant que l'agent travaille, deux demandes s'empilent.
  await session.call({ type: 'agent.prompt', agentId: taskAgent, text: 'Première demande en attente' });
  await session.call({ type: 'agent.prompt', agentId: taskAgent, text: 'Deuxième demande en attente' });
  const queueEvent = await session.waitFor(
    (e) => e.type === 'queue.snapshot' && e.agentId === taskAgent && e.queue.length >= 2,
    60000,
    'file de demandes',
  );
  record('File : les messages envoyés pendant le travail s\'empilent', queueEvent.queue.length >= 2, `${queueEvent.queue.length} en attente`);

  // Une demande en attente reste modifiable et supprimable.
  await session.call({ type: 'queue.update', id: queueEvent.queue[0].id, text: 'Demande corrigée' });
  const updated = await session.waitFor(
    (e) => e.type === 'queue.snapshot' && e.agentId === taskAgent && e.queue.some((q) => q.text === 'Demande corrigée'),
    30000,
    'modification de la file',
  );
  record('File : une demande en attente reste modifiable', true);

  await session.call({ type: 'queue.remove', id: updated.queue[0].id });
  const afterRemove = await session.waitFor(
    (e) => e.type === 'queue.snapshot' && e.agentId === taskAgent && e.queue.length < updated.queue.length,
    30000,
    'suppression dans la file',
  );
  record('File : une demande en attente reste supprimable', afterRemove.queue.length === updated.queue.length - 1);

  // On vide la file pour ne pas relancer l'agent inutilement.
  for (const item of afterRemove.queue) await session.call({ type: 'queue.remove', id: item.id });

  await session.waitFor(
    (e) =>
      e.type === 'message.upsert' &&
      e.message.agentId === taskAgent &&
      e.message.role === 'assistant' &&
      !e.message.streaming &&
      e.message.content.length > 30,
    900000,
    'fin de la tâche',
  );

  /* ---------- 5. Évolutions cliquables dans la vraie réponse ---------- */
  const reply = lastAssistant(session, taskAgent);
  const { extractEvolutions } = await import('/root/haikodev/shared/dist/templates.js');
  const evolutions = extractEvolutions(reply?.content ?? '');
  record('Évolutions : la réponse contient des suggestions cliquables', evolutions.length > 0, `${evolutions.length} suggestion(s)`);

  /* ---------- 6. Arrêt d'un agent ---------- */
  const { agent: freeAgent } = await session.call({ type: 'agent.orchestrator', projectId: project.id });
  record('Chef d\'orchestre : sa conversation est permanente (même agent)', freeAgent.id === orchestrator.id);

  /* ---------- 7. Facturation : lecture de l'outil certifié ---------- */
  const clients = await session.call({ type: 'billing.clients' }, 120000);
  record('Facturation : la liste des clients vient de l\'outil de facturation', (clients?.clients ?? []).length > 0,
    `${(clients?.clients ?? []).length} client(s)`);

  /* ---------- 8. Reprise après redémarrage ---------- */
  const { card: pending } = await session.call({
    type: 'card.create',
    projectId: project.id,
    title: 'Carte témoin de la reprise après redémarrage',
  });
  session.close();

  const beforeRestart = serviceInfo();
  execSync('sudo systemctl restart haikodev');
  await waitForServiceRestart(beforeRestart);

  const cookie2 = await login();
  const session2 = new Session(cookie2);
  await session2.connect();
  const ready2 = await session2.waitFor((e) => e.type === 'ready', 30000, 'reprise');
  record('Reprise : le démon redémarre et retrouve son état', (ready2.projects ?? []).some((p) => p.id === project.id));

  await session2.call({ type: 'project.open', id: project.id });
  const snapshot = await session2.waitFor((e) => e.type === 'project.snapshot' && e.projectId === project.id, 30000, 'tableau');
  const survivors = snapshot.cards.filter((c) => c.id === pending.id || c.id === card.id);
  record('Reprise : les cartes survivent au redémarrage', survivors.length === 2, `${snapshot.cards.length} carte(s) au tableau`);

  const restarted = snapshot.cards.find((c) => c.id === card.id);
  record(
    'Reprise : un redémarrage ne compte pas comme un essai raté',
    (restarted?.scheduling?.attempts ?? 0) <= 1,
    `essais : ${restarted?.scheduling?.attempts ?? 0}, redémarrages : ${restarted?.scheduling?.restarts ?? 0}`,
  );

  const memory = fs.existsSync(path.join(SANDBOX, 'MEMOIRE.md'));
  record('Mémoire : elle vit dans le dépôt du projet', memory);

  session2.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} essais réussis`);
  if (failed.length) {
    console.log('Échecs :');
    for (const failure of failed) console.log(` - ${failure.name} ${failure.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('essais interrompus :', err.message);
  process.exit(2);
});
