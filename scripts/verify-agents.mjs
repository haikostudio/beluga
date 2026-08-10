#!/usr/bin/env node
/**
 * Essais fonctionnels RÉELS : de vrais agents, sur un vrai projet.
 * Pilote le démon par son protocole, exactement comme le fait l'interface.
 */
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKODEV_AGENTS_URL || 'http://127.0.0.1:7070';
const USER = process.env.HAIKODEV_USER;
const PASS = process.env.HAIKODEV_PASSWORD;
const SANDBOX = process.env.HAIKODEV_AGENTS_SANDBOX || path.join(RACINE, 'data', 'bac-a-sable');
const ENGINE = process.env.HAIKODEV_AGENTS_ENGINE || 'claude';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function terminer() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} essais réussis`);
  if (failed.length) {
    console.log('Échecs :');
    for (const failure of failed) console.log(` - ${failure.name} ${failure.detail}`);
    process.exitCode = 1;
  }
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
      this.ws.on('open', () => resolve());
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

  /** Attend qu'une condition soit vraie sur les événements reçus. */
  waitFor(predicate, timeoutMs = 240000, label = 'événement') {
    return new Promise((resolve, reject) => {
      for (const event of this.events) {
        if (predicate(event)) return resolve(event);
      }
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

async function main() {
  // Un projet bac à sable, vrai dossier git, pour ne rien casser ailleurs.
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(SANDBOX, { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, 'README.md'), '# Bac à sable\n\nProjet d\'essai HaikoDev.\n');
  fs.writeFileSync(path.join(SANDBOX, 'calcul.js'), 'export function somme(a, b) {\n  return a - b;\n}\n');
  const { execSync } = await import('node:child_process');
  execSync('git init -q && git add -A && git -c user.email=a@b -c user.name=haikodev commit -qm "depart"', {
    cwd: SANDBOX,
  });

  const cookie = await login();
  const session = new Session(cookie);
  await session.connect();
  const ready = await session.waitFor((e) => e.type === 'ready', 20000, 'état initial');
  record('Protocole : le démon envoie l\'état complet à la connexion', true);

  // Un essai repart toujours d'un état propre : on retire le projet d'essai
  // précédent (et ses cartes) avant de le réinscrire.
  for (const previous of ready.projects ?? []) {
    if (previous.path === SANDBOX) await session.call({ type: 'project.delete', id: previous.id });
  }

  /* ---------- Projet ---------- */
  const { project } = await session.call({
    type: 'project.create',
    name: 'Bac à sable',
    path: SANDBOX,
    defaultEngine: ENGINE,
  });
  record('Projet : inscription d\'un dossier du serveur', !!project?.id, project?.name);

  /* ---------- Invariant : une carte naît dans « Planifié » ---------- */
  const { card: carteManuelle } = await session.call({
    type: 'card.create',
    projectId: project.id,
    title: 'Corriger la fonction somme qui soustrait au lieu d\'additionner',
    description: 'Le fichier calcul.js contient une fonction somme qui fait une soustraction. Corrige-la.',
  });
  record('Carte : elle naît toujours dans « Planifié »', carteManuelle.column === 'planned', `colonne ${carteManuelle.column}`);

  /* ---------- Refus des colonnes interdites aux agents ---------- */
  let refused = false;
  try {
    await session.call({ type: 'card.move', id: carteManuelle.id, column: 'done' });
  } catch {
    refused = true;
  }
  record('Règle : l\'utilisateur peut déplacer librement (aucun blocage abusif)', !refused);
  await session.call({ type: 'card.move', id: carteManuelle.id, column: 'planned' });
  await session.call({ type: 'card.delete', id: carteManuelle.id });

  /* ---------- Chef d'orchestre : le tri en familles ---------- */
  const { agent: orchestrator } = await session.call({ type: 'agent.orchestrator', projectId: project.id });
  record('Chef d\'orchestre : agent permanent créé', !!orchestrator?.id);
  /*
   * Le chef ne fait plus qu'un tri : son modèle par défaut est ÉCONOME sous
   * Claude (Haiku 4.5). Un choix manuel enregistré dans les réglages l'emporte,
   * et le contrôle le DIT au lieu de tomber en erreur.
   */
  const choixManuel = !!(await session.call({ type: 'settings.get' }))?.settings?.orchestratorModel;
  record(
    'Chef d\'orchestre : son modèle et sa réflexion ont les bons défauts',
    choixManuel ||
      (ENGINE === 'codex'
        ? orchestrator.run.engine === 'codex' && orchestrator.run.model?.includes('gpt-5.4')
        : orchestrator.run.engine === 'claude' && /haiku/i.test(orchestrator.run.model ?? '')),
    choixManuel
      ? `choix manuel enregistré : ${orchestrator.run.model}`
      : `modèle ${orchestrator.run.model}, réflexion ${orchestrator.run.thinking}`,
  );

  const cardsBefore = (await session.call({ type: 'project.open', id: project.id }), 0);
  const countCards = () =>
    session.events.filter((e) => e.type === 'card.upsert' && e.card.projectId === project.id).length;

  // 1) Une QUESTION ne doit créer aucune carte.
  const beforeQuestion = countCards();
  const anciensMessages = new Set(
    session.events.filter((e) => e.type === 'message.upsert').map((e) => e.message.id),
  );
  await session.call({ type: 'agent.prompt', agentId: orchestrator.id, text: 'À quoi sert le fichier calcul.js ?' });
  const questionRendue = await session.waitFor(
    (e) =>
      e.type === 'message.upsert' &&
      !anciensMessages.has(e.message.id) &&
      e.message.agentId === orchestrator.id &&
      !e.message.streaming &&
      e.message.role === 'assistant' &&
      e.message.content.length > 20,
    300000,
    'réponse du chef d\'orchestre',
  );
  await new Promise((r) => setTimeout(r, 1500));
  const afterQuestion = countCards();
  const answer = questionRendue.message;
  record(
    'Chef d\'orchestre : une question reçoit une réponse, sans créer de carte',
    afterQuestion === beforeQuestion && !!answer?.content,
    (answer?.content ?? '').slice(0, 70).replace(/\n/g, ' '),
  );

  /* ---------- Proposition : le chef analyse UNE fois et transmet ---------- */
  await session.call({
    type: 'agent.prompt',
    agentId: orchestrator.id,
    text: 'Corrige la fonction somme de calcul.js : elle soustrait au lieu d’additionner.',
  });
  const propositionRendue = await session.waitFor(
    (e) =>
      e.type === 'message.upsert' &&
      e.message.agentId === orchestrator.id &&
      e.message.role === 'assistant' &&
      !e.message.streaming &&
      e.message.proposals?.some((p) => p.decision === 'pending' && p.estimate?.analysisMeasurement),
    600000,
    'proposition chiffrée du chef',
  );
  const proposal = propositionRendue.message.proposals.find((p) => p.decision === 'pending');
  record('Chef : la proposition porte déjà le chiffrage', !!proposal?.estimate && !!proposal?.analysisContext);
  record('Chef : la mesure réelle de son tour accompagne le chiffrage', !!proposal?.estimate?.analysisMeasurement);

  const { cardId } = await session.call({
    type: 'proposal.decide',
    messageId: propositionRendue.message.id,
    proposalId: proposal.id,
    accept: true,
  });
  const creee = await session.waitFor(
    (e) => e.type === 'card.upsert' && e.card.id === cardId,
    120000,
    'création de la carte proposée',
  );
  let card = creee.card;
  record(
    'Validation : la carte hérite des chiffres et du relais',
    !!card.estimate?.analysisMeasurement && !!card.analysisContext,
  );

  await session.call({ type: 'card.validate', id: card.id });
  record(
    'Analyse : durée machine et heures humaines sont distinctes',
    !card.estimate.failed && typeof card.estimate.machineSeconds === 'number' && typeof card.estimate.seniorHours === 'number',
    `machine ${card.estimate.machineSeconds}s · senior ${card.estimate.seniorHours}h`,
  );

  const planned = await session.waitFor(
    (e) => e.type === 'card.upsert' && e.card.id === card.id && e.card.column === 'planned',
    120000,
    'promotion en planifié',
  );
  card = planned.card;
  record('Ordonnancement : la carte déjà analysée va directement en « Planifié »', card.column === 'planned');
  await new Promise((r) => setTimeout(r, 1500));
  const analysesRedondantes = session.events.filter(
    (e) => e.type === 'agent.upsert' && e.agent.cardId === card.id && e.agent.role === 'analysis',
  );
  record('Analyse : aucun second agent de chiffrage n’est créé', analysesRedondantes.length === 0);

  if (process.env.HAIKODEV_AGENTS_PLAN_ONLY === '1') {
    session.close();
    terminer();
    return;
  }

  /* ---------- Agent de tâche : exécution réelle ---------- */
  await session.call({ type: 'card.start', id: card.id });
  const running = await session.waitFor(
    (e) => e.type === 'card.upsert' && e.card.id === card.id && e.card.column === 'running',
    120000,
    'démarrage de la tâche',
  );
  record('Exécution : la carte passe « En cours » et l\'agent démarre', !!running.card.agentId);
  record('Exécution : une branche dédiée est créée', !!running.card.github?.branch, running.card.github?.branch);

  const taskAgentId = running.card.agentId;
  const finalMessage = await session.waitFor(
    (e) =>
      e.type === 'message.upsert' &&
      e.message.agentId === taskAgentId &&
      e.message.role === 'assistant' &&
      !e.message.streaming &&
      (e.message.content.length > 40 || !!e.message.error),
    900000,
    'fin de la tâche',
  );

  const fixed = fs.readFileSync(path.join(SANDBOX, 'calcul.js'), 'utf8');
  record('Exécution : l\'agent a réellement modifié le code', fixed.includes('a + b'), fixed.trim().replace(/\n/g, ' '));

  const steps = finalMessage.message.steps ?? [];
  record('Liste d\'exécution : les étapes sont annoncées et cochées', steps.length > 0, `${steps.length} étapes`);

  const content = finalMessage.message.content ?? '';
  const hasTemplate = ['Analyse', 'Ce qui est fait', 'Conséquences', 'Impact', 'Coûts'].every((section) => content.includes(section));
  record('Gabarit : la réponse suit la forme imposée par la colonne', hasTemplate);

  /* ---------- Mémoire du projet ---------- */
  await new Promise((r) => setTimeout(r, 2000));
  const memoryFile = path.join(SANDBOX, 'MEMOIRE.md');
  record('Mémoire : l\'agent a nourri la mémoire du projet', fs.existsSync(memoryFile),
    fs.existsSync(memoryFile) ? fs.readFileSync(memoryFile, 'utf8').split('\n').filter((l) => l.startsWith('- ')).length + ' ligne(s)' : 'absente');

  /* ---------- Consommation réelle ---------- */
  const consumed = session.events
    .filter((e) => e.type === 'card.upsert' && e.card.id === card.id && e.card.consumption)
    .slice(-1)[0]?.card.consumption;
  record('Consommation : jetons, durée et compte relevés', !!consumed?.tokens && !!consumed?.machineSeconds,
    consumed ? `${consumed.tokens} jetons · ${Math.round(consumed.machineSeconds)}s · ${consumed.account}` : '');

  if (process.env.HAIKODEV_AGENTS_CARTES_ONLY === '1') {
    session.close();
    terminer();
    return;
  }

  /* ---------- Clôture, publication, archivage ---------- */
  await session.call({ type: 'card.finish', id: card.id });
  await session.call({ type: 'card.move', id: card.id, column: 'to_deploy' });
  const deployResult = await session.call({ type: 'deploy.start', projectId: project.id }, 300000);
  record('Publication : le lot démarre', !!deployResult?.run?.id);

  const deployed = await session.waitFor(
    (e) => e.type === 'deploy.upsert' && e.run.projectId === project.id && e.run.state !== 'running',
    300000,
    'fin de la publication',
  );
  record('Publication : le lot va au bout', deployed.run.state === 'success', `état ${deployed.run.state}`);

  const archived = await session.waitFor(
    (e) => e.type === 'card.upsert' && e.card.id === card.id && e.card.column === 'archived',
    120000,
    'archivage automatique',
  );
  record('Archivage : la carte est archivée avec sa date de publication', !!archived.card.deployedAt);
  record('Archivage : le document de clôture est écrit', !!archived.card.closureDoc && fs.existsSync(archived.card.closureDoc));

  /* ---------- Sauvegarde et restauration ---------- */
  const backup = await session.call({ type: 'backup.now' }, 300000);
  record('Sauvegarde : copie à chaud effectuée', backup?.ok === true);
  record('Restauration : la sauvegarde est relue et vérifiée', backup?.verification?.ok === true, backup?.verification?.detail);

  /* ---------- Résumé vocal ---------- */
  const digest = await session.call({ type: 'digest.speak', projectId: project.id });
  record('Résumé vocal : le texte du point est produit', (digest?.text ?? '').length > 40, (digest?.text ?? '').slice(0, 70));

  const audio = await fetch(`${BASE}/api/digest?audio=1&project=${project.id}`, { headers: { cookie } });
  const audioBuffer = Buffer.from(await audio.arrayBuffer());
  record('Résumé vocal : le fichier audio est fabriqué sur le serveur',
    audio.ok && audioBuffer.length > 20000 && audioBuffer.subarray(0, 4).toString() === 'RIFF',
    `${Math.round(audioBuffer.length / 1024)} ko`);

  /* ---------- Fichiers et archives ---------- */
  const files = await session.call({ type: 'files.list', projectId: project.id });
  record('Fichiers : l\'arborescence du projet est lisible', (files?.nodes ?? []).length > 0, `${files.nodes.length} éléments`);

  const zip = await session.call({ type: 'files.archive', projectId: project.id, paths: ['README.md', 'calcul.js'] });
  const download = await fetch(`${BASE}/api/download?token=${encodeURIComponent(zip.token)}`, { headers: { cookie } });
  const zipBuffer = Buffer.from(await download.arrayBuffer());
  record('Archives : le téléchargement produit une vraie archive',
    zipBuffer.subarray(0, 2).toString() === 'PK' && zipBuffer.length > 200, `${zipBuffer.length} octets`);

  /* ---------- Garde-fou : on ne sort jamais du projet ---------- */
  const escape = await fetch(`${BASE}/api/file?project=${project.id}&path=../../etc/passwd`, { headers: { cookie } });
  const escapeData = await escape.json();
  record('Sécurité : impossible de lire hors du dossier du projet', escapeData.kind === 'binary' && escapeData.size === 0);

  /* ---------- Statistiques ---------- */
  const stats = await session.call({ type: 'stats.usage', projectId: project.id });
  record('Consommation : les cumuls par projet sont calculés', (stats?.byProject ?? []).length > 0);

  session.close();

  terminer();
}

main().catch((err) => {
  console.error('essais interrompus :', err.message);
  process.exit(2);
});
