#!/usr/bin/env node
/**
 * Troisième lot : suivi GitHub sur une vraie demande de fusion, propositions de
 * tâche depuis le chat, notifications groupées, exception HaikoDev.
 */
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:7070';
const USER = process.env.HAIKODEV_USER;
const PASS = process.env.HAIKODEV_PASSWORD;
const SELF = RACINE;

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
      for (const event of this.events) if (predicate(event, this.events.indexOf(event))) return resolve(event);
      const watcher = (event) => {
        if (predicate(event, this.events.indexOf(event))) {
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

async function main() {
  const cookie = await login();
  const session = new Session(cookie);
  await session.connect();
  const ready = await session.waitFor((e) => e.type === 'ready', 20000, 'état initial');

  const self = (ready.projects ?? []).find((p) => p.path === SELF);
  record('Projet HaikoDev : inscrit et reconnu comme « lui-même »', !!self?.isSelf);

  /* ---------- 1. Suivi GitHub sur une vraie branche ---------- */
  const branch = `essai/suivi-github-${Date.now().toString(36)}`;
  execSync(`git checkout -qb ${branch}`, { cwd: SELF });
  const FICHIER_ESSAI = `${SELF}/docs/essais/suivi-github.txt`;
  fs.mkdirSync(`${SELF}/docs/essais`, { recursive: true });
  fs.writeFileSync(FICHIER_ESSAI, `essai de suivi GitHub — ${branch}\n`);
  execSync(
    `git add docs/essais/suivi-github.txt && git -c user.email=essai@haikodev.local -c user.name=haikostudio commit -qm "Essai : vérifier le suivi GitHub" && git push -q -u origin ${branch}`,
    { cwd: SELF },
  );
  const pr = execSync(
    `gh pr create --head ${branch} --title "Essai du suivi GitHub" --body "Demande de fusion créée pour vérifier l'onglet GitHub de HaikoDev." 2>&1 | tail -1`,
    { cwd: SELF, encoding: 'utf8' },
  ).trim();
  const prNumber = Number(pr.match(/\/pull\/(\d+)/)?.[1]);
  record('GitHub : une demande de fusion existe pour la branche', !!prNumber, pr);

  const { card } = await session.call({
    type: 'card.create',
    projectId: self.id,
    title: 'Carte témoin du suivi GitHub',
  });
  await session.call({ type: 'card.update', id: card.id, patch: { github: { branch, checks: [], commits: [], activity: [] } } });

  const tracking = (await session.call({ type: 'github.refresh', cardId: card.id }, 120000)).tracking;
  record('GitHub : la branche et ses commits remontent dans la carte', (tracking?.commits ?? []).length > 0,
    `${tracking?.commits?.length ?? 0} commit(s)`);
  record('GitHub : la demande de fusion est lue (numéro, état, adresse)',
    tracking?.prNumber === prNumber && !!tracking?.prUrl,
    `#${tracking?.prNumber} ${tracking?.prState}`);

  // Fusion réelle depuis l'interface.
  const merged = await session.call({ type: 'github.merge', cardId: card.id, method: 'squash' }, 180000);
  record('GitHub : la fusion se déclenche depuis la carte', merged?.ok === true);
  await new Promise((r) => setTimeout(r, 4000));
  const afterMerge = (await session.call({ type: 'github.refresh', cardId: card.id }, 120000)).tracking;
  record('GitHub : l\'état de la demande passe à « fusionnée »', afterMerge?.prState === 'merged', afterMerge?.prState);

  execSync('git checkout -q main && git pull -q --ff-only origin main 2>/dev/null || true', { cwd: SELF });
  await session.call({ type: 'card.delete', id: card.id });

  /* ---------- 2. Proposition de tâche depuis le chat ---------- */
  const { agent: orchestrator } = await session.call({ type: 'agent.orchestrator', projectId: self.id });
  const before = session.events.filter((e) => e.type === 'card.upsert').length;

  // Sujet réellement différent à chaque essai : la conversation du chef
  // d'orchestre est permanente et il refuse — à juste titre — de proposer deux
  // fois la même tâche, même reformulée.
  const sujets = [
    'un export du tableau au format tableur',
    'un mode plein écran pour la conversation',
    'un compteur de cartes archivées par mois',
    'un rappel automatique des cartes oubliées depuis un mois',
    'une recherche par mot-clé dans toutes les cartes',
    'un tri des cartes par estimation de durée',
    'un badge indiquant la dernière personne ayant modifié la carte',
    'un aperçu des étiquettes les plus utilisées',
  ];
  const sujet = sujets[Math.floor(Math.random() * sujets.length)];
  await session.call({
    type: 'agent.prompt',
    agentId: orchestrator.id,
    text: `Je me demande si le tableau ne gagnerait pas à proposer ${sujet}. Qu'en penses-tu ? Si tu juges que c'est une action possible, utilise propose_task.`,
  });
  const proposalMessage = await session.waitFor(
    (e) =>
      e.type === 'message.upsert' &&
      e.message.agentId === orchestrator.id &&
      e.message.proposals.length > 0,
    420000,
    'proposition de tâche',
  );
  const proposal = proposalMessage.message.proposals[0];
  record('Proposition : elle apparaît dans le fil sans créer de carte', proposal.decision === 'pending', proposal.title);

  const afterProposal = session.events.filter((e) => e.type === 'card.upsert').length;
  record('Proposition : rien n\'est créé tant qu\'on n\'a pas validé', afterProposal === before);

  const decided = await session.call({
    type: 'proposal.decide',
    messageId: proposalMessage.message.id,
    proposalId: proposal.id,
    accept: true,
  });
  record('Proposition : la valider crée la carte dans « Planifié »', !!decided?.cardId);

  // Cliquer deux fois ne crée pas deux cartes.
  const second = await session.call({
    type: 'proposal.decide',
    messageId: proposalMessage.message.id,
    proposalId: proposal.id,
    accept: true,
  });
  record('Proposition : cliquer deux fois ne crée pas deux cartes', second?.already === true);

  // La décision survit à un rechargement : on ignore les instantanés déjà reçus
  // avant la décision, sinon on relit un état périmé.
  const mark = session.events.length;
  await session.call({ type: 'agent.open', id: orchestrator.id });
  const reloaded = await session.waitFor(
    (e, index) => e.type === 'agent.snapshot' && e.agentId === orchestrator.id && session.events.indexOf(e) >= mark,
    30000,
    'rechargement de la conversation',
  );
  const storedProposal = reloaded.messages
    .flatMap((m) => m.proposals)
    .find((p) => p.id === proposal.id);
  record('Proposition : la décision est mémorisée sur le tableau', storedProposal?.decision === 'accepted');

  if (decided?.cardId) await session.call({ type: 'card.delete', id: decided.cardId });

  /* ---------- 3. Notifications groupées ---------- */
  // Trois clôtures de carte coup sur coup dans le démon : l'utilisateur ne doit
  // recevoir qu'une seule notification, pas trois.
  const notifications = [];
  session.watchers.add((e) => {
    if (e.type === 'notify') notifications.push(e);
  });
  const temporaires = [];
  for (let i = 0; i < 3; i++) {
    const { card: c } = await session.call({
      type: 'card.create',
      projectId: self.id,
      title: `Carte témoin de notification ${i + 1}`,
    });
    temporaires.push(c.id);
  }
  for (const id of temporaires) await session.call({ type: 'card.finish', id });
  await new Promise((r) => setTimeout(r, 7000));
  record(
    'Notifications : une rafale devient une seule notification',
    notifications.length === 1 && /3 tâches terminées/.test(notifications[0].title),
    notifications.map((n) => n.title).join(' | ') || 'aucune',
  );
  for (const id of temporaires) await session.call({ type: 'card.delete', id });

  session.close();

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
