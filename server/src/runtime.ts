import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  Agent,
  AgentRole,
  Ampleur,
  Card,
  MEMORY_STEP_ID,
  Message,
  RunStep,
  TaskProposal,
  TemplateKind,
  TodoItem,
  ampleurParDefaut,
  checkTemplate,
  colonneAuDemarrage,
  colonneEnFinDeTour,
  templateForColumn,
  wrapPrompt,
} from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { CONFIG, PATHS } from './config.js';
import { adapterFor, EngineEvent, EngineHandle } from './engines/index.js';
import { agentLog, log } from './logger.js';
import { getInternalToken } from './auth.js';
import { briefing, memoryFacts, memorySummary, newFactsSince } from './memory.js';
import { allDone, mergeTodos } from './todos.js';
import { orchestratorAllowList, orchestratorDenyList, toolsFor, writeMcpConfig } from './tools.js';
import { pickAccount, noteAccountUse, applyAccountEnv } from './accounts.js';
import { notify } from './notify.js';
import { cartesDuTravailHorsTache, repereAvant } from './hors-tache.js';

export interface LiveRun {
  agentId: string;
  handle: EngineHandle;
  messageId: string;
  startedAt: number;
  steps: Map<string, RunStep>;
  todos: TodoItem[];
  /** La liste entièrement cochée n'est annoncée qu'une fois par tour. */
  todosNotified?: boolean;
  text: string;
  usage?: EngineEvent['usage'];
  account?: string;
  stopping?: boolean;
}

const live = new Map<string, LiveRun>();

export function isRunning(agentId: string): boolean {
  return live.has(agentId);
}

export function runningAgentIds(): string[] {
  return [...live.keys()];
}

export function liveRun(agentId: string): LiveRun | undefined {
  return live.get(agentId);
}

export function runningCount(): number {
  return live.size;
}

/** Les comptes sur lesquels un agent travaille EN CE MOMENT. */
export function comptesOccupes(): string[] {
  return [...live.values()].map((run) => run.account).filter((id): id is string => !!id);
}

export function pidFor(agentId: string): number | undefined {
  return live.get(agentId)?.handle.pid;
}

/* ------------------------------------------------------------------ */
/* Création d'agents                                                   */
/* ------------------------------------------------------------------ */

export function createAgent(input: {
  projectId: string;
  role: AgentRole;
  title: string;
  cardId?: string;
  run?: Partial<Agent['run']>;
}): Agent {
  const project = store.getProject(input.projectId);
  const agent = Agent.parse({
    id: store.newId(),
    projectId: input.projectId,
    cardId: input.cardId,
    role: input.role,
    title: input.title,
    run: {
      engine: input.run?.engine ?? project?.defaultEngine ?? 'claude',
      model: input.run?.model,
      thinking: input.run?.thinking ?? 'none',
      mode: input.run?.mode ?? 'direct',
    },
    status: 'idle',
    createdAt: store.now(),
    updatedAt: store.now(),
  });
  const saved = store.saveAgent(agent);
  bus.emit({ type: 'agent.upsert', agent: saved });
  return saved;
}

function setStatus(agent: Agent, status: Agent['status'], extra: Partial<Agent> = {}): Agent {
  const updated = store.saveAgent({ ...agent, ...extra, status });
  bus.emit({ type: 'agent.upsert', agent: updated });
  return updated;
}

/* ------------------------------------------------------------------ */
/* Envoi d'une demande à un agent                                      */
/* ------------------------------------------------------------------ */

export interface PromptOptions {
  /** Force le gabarit ; sinon il est déduit de la colonne de la carte. */
  template?: TemplateKind;
  /** Contexte supplémentaire (briefing, consignes de rôle). */
  context?: string;
  /**
   * Longueur de référence de la réponse. Une carte lancée est toujours une
   * vraie tâche : elle mérite le compte rendu entier. Ailleurs, elle se déduit
   * de la demande.
   */
  ampleur?: Ampleur;
  /** Ne pas enregistrer le message utilisateur (relances internes). */
  silent?: boolean;
  attachments?: string[];
  /** Appelé quand le tour est fini, avec le texte complet de la réponse. */
  onComplete?: (text: string, ok: boolean) => void | Promise<void>;
}

/**
 * LE POINT DE PASSAGE UNIQUE (PLAN §9). Toutes les demandes partent d'ici :
 * chat, lancement de tâche, analyse, publication. Le gabarit est appliqué là,
 * donc aucun chemin ne peut y échapper.
 */
export async function sendPrompt(agentId: string, text: string, options: PromptOptions = {}): Promise<void> {
  const agent = store.getAgent(agentId);
  if (!agent) throw new Error('agent introuvable');

  // Un agent occupé ? La demande s'empile (PLAN §14).
  if (live.has(agentId)) {
    const queued = store.enqueuePrompt(agentId, text, options.attachments ?? []);
    if (!queued) {
      bus.toast('warning', "Dix demandes en attente au maximum : celle-ci n'a pas été ajoutée.");
      return;
    }
    bus.emit({ type: 'queue.snapshot', agentId, queue: store.listQueue(agentId) });
    return;
  }

  const project = store.getProject(agent.projectId);
  if (!project) throw new Error('projet introuvable');

  if (!options.silent) {
    const userMessage = store.saveMessage(
      Message.parse({
        id: store.newId(),
        agentId,
        role: 'user',
        content: text,
        attachments: options.attachments ?? [],
        // Estimation courante : environ quatre caractères par jeton.
        tokens: Math.max(1, Math.round(text.length / 4)),
        createdAt: store.now(),
      }),
    );
    bus.emit({ type: 'message.upsert', message: userMessage });
  }

  /*
   * La carte suit son agent. Un tour qui redémarre la ramène en « En cours »,
   * d'où qu'elle vienne : une carte déjà terminée sur laquelle on relance une
   * action n'est plus terminée, et le tableau doit le dire tout de suite.
   */
  const carteAvant = agent.cardId ? store.getCard(agent.cardId) : null;
  if (carteAvant) {
    const cible = colonneAuDemarrage(carteAvant.column);
    if (cible) {
      const relancee = store.saveCard({
        ...carteAvant,
        column: cible,
        position: store.nextPosition(carteAvant.projectId, cible),
        // Elle repart : la date de clôture d'avant ne veut plus rien dire.
        doneAt: undefined,
      });
      bus.emit({ type: 'card.upsert', card: relancee });
    }
  }

  const card = agent.cardId ? store.getCard(agent.cardId) : null;
  const template: TemplateKind =
    options.template ??
    // Le chef d'orchestre rend le MÊME compte rendu que les agents de tâche :
    // il travaille pour de vrai, sa réponse doit se lire comme les autres.
    (agent.role === 'orchestrator' ? 'free' : templateForColumn(card?.column, !!card?.deployedAt));

  /*
   * La mémoire du projet part EN ENTIER au lancement d'une session — nouvelle
   * tâche, nouveau chef d'orchestre, changement de moteur. Ensuite l'agent l'a
   * déjà dans son contexte : lui renvoyer les cent lignes à chaque message ne
   * lui apprend rien et coûte des jetons à chaque tour. Sur les tours suivants,
   * on n'envoie donc que les faits AJOUTÉS depuis.
   */
  const nouvelleSession = !store.getSessionId(agent.id, agent.run.engine);
  const contextParts: string[] = [];

  if (nouvelleSession) {
    // Le briefing (chemin du projet, fichiers d'instructions, index de la
    // mémoire) n'a de sens qu'au premier tour : ensuite l'agent l'a en contexte.
    contextParts.push(briefing(project.path, project.name, true, agent.run.engine));
    store.setMemorySeen(agent.id, memoryFacts(project.path).length);
  } else {
    const nouveaux = newFactsSince(project.path, store.memorySeen(agent.id));
    if (nouveaux.length) {
      contextParts.push(
        `MÉMOIRE DU PROJET — faits ajoutés depuis :\n${nouveaux.map((f) => `- ${f}`).join('\n')}`,
      );
      store.setMemorySeen(agent.id, memoryFacts(project.path).length);
    }
  }

  if (options.context) contextParts.push(options.context);
  if (card) {
    const bloc = carteContexte(agent.id, card, nouvelleSession);
    if (bloc) contextParts.push(bloc);
  }
  if (options.attachments?.length) {
    const files = options.attachments
      .map((id) => store.getAttachment(id))
      .filter(Boolean)
      .map((a) => path.join(PATHS.attachments, `${a!.id}-${a!.name}`));
    if (files.length) {
      contextParts.push(`PIÈCES JOINTES fournies par l'utilisateur (lis-les) :\n${files.join('\n')}`);
    }
  }

  const ampleur = options.ampleur ?? ampleurParDefaut(template, text);
  const prompt = wrapPrompt(template, text, contextParts.join('\n\n'), {
    // Session déjà ouverte : le gabarit entier est dans le fil, un rappel suffit.
    rappel: !nouvelleSession,
    ampleur,
  });
  await startTurn(agent, prompt, template, options.onComplete, nouvelleSession, ampleur);
}

/**
 * Le bloc « carte en cours ». Entier au lancement de la session ; ensuite rien,
 * sauf si la carte a bougé — et dans ce cas une seule ligne quand seule la
 * colonne a changé.
 */
function carteContexte(agentId: string, card: Card, nouvelleSession: boolean): string | null {
  const entier = `CARTE EN COURS : « ${card.title} »\n${card.description || '(pas de description)'}\nColonne : ${card.column}.`;
  const fond = createHash('sha1').update(`${card.title}\n${card.description ?? ''}`).digest('hex').slice(0, 12);
  const empreinte = `${fond}:${card.column}`;

  if (nouvelleSession) {
    store.setCarteVue(agentId, empreinte);
    return entier;
  }

  const vue = store.carteVue(agentId);
  if (vue === empreinte) return null;
  store.setCarteVue(agentId, empreinte);
  // Seule la colonne a bougé : une ligne suffit, la description est déjà lue.
  if (vue.startsWith(`${fond}:`)) return `La carte « ${card.title} » est passée en colonne ${card.column}.`;
  return entier;
}

async function startTurn(
  agentBefore: Agent,
  prompt: string,
  template: TemplateKind,
  onComplete?: PromptOptions['onComplete'],
  /** Vrai au tout premier tour d'une session : c'est là qu'on lit la mémoire. */
  nouvelleSession = true,
  ampleur: Ampleur = 'complete',
): Promise<void> {
  // Le réglage retenu est celui enregistré à l'instant du départ : si le moteur
  // a été changé entre-temps, c'est le nouveau qui part, pas l'ancien.
  const agent = store.getAgent(agentBefore.id) ?? agentBefore;
  const project = store.getProject(agent.projectId)!;
  const adapter = adapterFor(agent.run.engine);

  // Choix du compte (x20 d'abord, Pro en relève) — décidé AU LANCEMENT,
  // jamais en plein vol (PLAN §13).
  const account = await pickAccount(agent.run.engine);
  if (!account) {
    const message = store.saveMessage(
      Message.parse({
        id: store.newId(),
        agentId: agent.id,
        role: 'assistant',
        content:
          "Aucun compte n'a de quota disponible pour le moment. La demande attend : elle repartira dès la remise à zéro.",
        error: 'quota',
        createdAt: store.now(),
      }),
    );
    bus.emit({ type: 'message.upsert', message });
    setStatus(agent, 'idle');
    return;
  }

  /*
   * PREMIER REPÈRE DE LA CONVERSATION : la mémoire du projet est relue avant
   * toute réponse — elle part avec la demande, dans le briefing. On l'affiche
   * donc comme une étape déjà faite, tout en haut. Seul le NOMBRE de faits est
   * enregistré : recopier la mémoire entière sous chaque message la stockerait
   * des centaines de fois pour rien, l'interface l'a déjà de son côté.
   */
  /*
   * Où en est le dépôt AVANT que l'agent ne touche à quoi que ce soit. C'est
   * ce repère qui, à la fin du tour, dira si du code a été enregistré sans
   * carte — et méritera donc une fiche.
   */
  const repere = agent.cardId ? null : await repereAvant(project.path).catch(() => null);

  const memory = memorySummary(project.path);
  const memoryStep: RunStep | null = nouvelleSession
    ? {
        id: MEMORY_STEP_ID,
        label: memory.facts
          ? `Lecture de la mémoire du projet — ${memory.facts} fait${memory.facts > 1 ? 's' : ''} retenu${memory.facts > 1 ? 's' : ''}`
          : 'Mémoire du projet encore vide',
        state: memory.facts ? 'done' : 'skipped',
        startedAt: Date.now(),
        endedAt: Date.now(),
      }
    : // Session déjà ouverte : la mémoire est dans le contexte de l'agent, on ne
      // la relit pas et on n'affiche donc pas l'étape.
      null;

  const assistantMessage = Message.parse({
    id: store.newId(),
    agentId: agent.id,
    role: 'assistant',
    content: '',
    steps: memoryStep ? [memoryStep] : [],
    streaming: true,
    createdAt: store.now(),
  });
  store.saveMessage(assistantMessage);
  bus.emit({ type: 'message.upsert', message: assistantMessage });

  const runState: LiveRun = {
    agentId: agent.id,
    handle: null as unknown as EngineHandle,
    messageId: assistantMessage.id,
    startedAt: Date.now(),
    steps: new Map(memoryStep ? [[memoryStep.id, memoryStep]] : []),
    todos: [],
    text: '',
    account: account.id,
  };

  // Outils du démon : le pont MCP, avec la liste d'outils de ce rôle.
  const mcpConfigPath = path.join(PATHS.logs, `mcp-${agent.id}.json`);
  const bridgePath = path.join(CONFIG.selfPath, 'server', 'mcp-bridge.mjs');
  const token = getInternalToken();
  const url = `http://127.0.0.1:${CONFIG.port}`;
  writeMcpConfig(mcpConfigPath, token, url, agent.id, bridgePath);

  const isOrchestrator = agent.role === 'orchestrator';
  // L'exception HaikoDev : sur son propre dépôt, le chef d'orchestre est un
  // agent complet (PLAN §5). Le basculement se décide sur le CHEMIN du projet.
  const fullAccess = !isOrchestrator || project.isSelf;

  const systemPrompt = rolePrompt(agent.role, project.isSelf);

  const env: Record<string, string> = {
    HAIKODEV_TOKEN: token,
    HAIKODEV_URL: url,
    HAIKODEV_AGENT: agent.id,
    ...applyAccountEnv(account),
  };

  const sessionId = store.getSessionId(agent.id, agent.run.engine);

  setStatus(agent, 'running', { startedAt: Date.now(), account: account.id });

  let sawError: string | undefined;

  const handle = adapter.run({
    cwd: project.path,
    prompt,
    model: agent.run.model ?? undefined,
    thinking: agent.run.thinking,
    sessionId,
    systemPrompt,
    mcpConfigPath,
    fullAccess,
    allowedTools: isOrchestrator && !project.isSelf ? orchestratorAllowList() : undefined,
    disallowedTools: isOrchestrator && !project.isSelf ? orchestratorDenyList() : undefined,
    env,
    onEvent: (event) => {
      agentLog(PATHS.logs, agent.id, JSON.stringify(event));
      switch (event.kind) {
        case 'session':
          if (event.sessionId) store.setSessionId(agent.id, event.sessionId, agent.run.engine);
          break;
        case 'text':
          if (event.text) {
            runState.text += (runState.text ? '\n\n' : '') + event.text;
            pushMessage(runState, { content: runState.text, streaming: true });
          }
          break;
        case 'step':
          if (event.step) {
            const existing = runState.steps.get(event.step.key);
            const step: RunStep = {
              id: event.step.key,
              label: event.step.label,
              state: event.step.state,
              detail: event.step.detail ?? existing?.detail,
              startedAt: existing?.startedAt ?? Date.now(),
              endedAt: event.step.state === 'running' ? undefined : Date.now(),
            };
            runState.steps.set(event.step.key, step);
            pushMessage(runState, { steps: [...runState.steps.values()], streaming: true });
          }
          break;
        case 'todo':
          // Le moteur renvoie sa liste ENTIÈRE à chaque mise à jour, sans
          // aucune heure : on la rapproche de la précédente pour retenir le
          // temps passé sur chaque ligne.
          if (event.todos?.length) {
            const avant = runState.todos;
            runState.todos = mergeTodos(avant, event.todos, runState.startedAt);
            pushMessage(runState, { todos: runState.todos, streaming: true });

            // Liste entièrement cochée : on prévient, une seule fois.
            if (!runState.todosNotified && allDone(runState.todos) && !allDone(avant)) {
              runState.todosNotified = true;
              notify({
                kind: 'done',
                title: 'Liste de tâches terminée',
                body: `${agent.title} — ${runState.todos.length} tâche${runState.todos.length > 1 ? 's' : ''} cochée${runState.todos.length > 1 ? 's' : ''}`,
                tag: `todos-${agent.id}`,
                projectId: agent.projectId,
                cardId: agent.cardId,
              });
            }
          }
          break;
        case 'usage':
          runState.usage = event.usage;
          break;
        case 'ratelimit':
          if (event.rateLimit) noteAccountUse(account.id, event.rateLimit);
          break;
        case 'error':
          sawError = event.error;
          break;
        default:
          break;
      }
    },
  });

  runState.handle = handle;
  live.set(agent.id, runState);
  bus.emit({ type: 'capacity', capacity: (await import('./capacity.js')).snapshot() });

  const result = await handle.finished;
  live.delete(agent.id);

  const elapsedSeconds = (Date.now() - runState.startedAt) / 1000;
  const tokens = (runState.usage?.inputTokens ?? 0) + (runState.usage?.outputTokens ?? 0);

  store.recordUsage({
    projectId: agent.projectId,
    cardId: agent.cardId,
    agentId: agent.id,
    account: account.id,
    engine: agent.run.engine,
    tokens,
    seconds: elapsedSeconds,
  });

  // Contrôle de forme : un moteur qui ignore le gabarit se fait rattraper.
  let finalText = runState.text.trim();
  const formCheck = checkTemplate(template, finalText, ampleur);
  if (!formCheck.ok && finalText && template !== 'none') {
    const griefs: string[] = [];
    if (formCheck.missing.length) griefs.push(`sections manquantes (${formCheck.missing.join(', ')})`);
    if (formCheck.dense.length) griefs.push(`texte tassé, sans paragraphes (${formCheck.dense.join(', ')})`);
    finalText += `\n\n> [!NOTE]\n> Réponse hors format : ${griefs.join(' ; ')}.`;
  }

  const failed = !result.ok || !!sawError;
  pushMessage(runState, {
    content: finalText || (failed ? '' : 'Terminé.'),
    steps: [...runState.steps.values()].map((s) => (s.state === 'running' ? { ...s, state: 'failed' as const } : s)),
    // Une ligne restée « en cours » alors que le tour est fini garderait un
    // temps qui court : on l'arrête ici.
    todos: runState.todos.map((todo) =>
      todo.state === 'running' && !todo.endedAt ? { ...todo, endedAt: Date.now() } : todo,
    ),
    streaming: false,
    tokens: tokens || undefined,
    durationMs: Math.round(elapsedSeconds * 1000),
    account: account.label,
    error: failed ? sawError ?? result.error ?? "Le moteur s'est arrêté avant la fin." : undefined,
  });

  const finalAgent = store.getAgent(agent.id)!;
  setStatus(finalAgent, failed ? 'failed' : 'done', { endedAt: Date.now() });

  /*
   * RIEN DE CE QUI SE FAIT NE RESTE INVISIBLE. Un agent sans carte qui a
   * enregistré du code reçoit sa fiche : sinon son travail ne se voyait que
   * comme un « changement sans carte » dans le bloc de publication, et pouvait
   * partir en ligne sans jamais avoir été décrit.
   */
  if (!agent.cardId && repere) {
    try {
      await cartesDuTravailHorsTache(finalAgent, repere);
    } catch (err) {
      log.error('fiche du travail hors tâche impossible', err);
    }
  }

  // La pastille « terminé, pas encore lu » se met à jour dès que l'agent se tait.
  bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });

  if (agent.cardId) {
    const card = store.getCard(agent.cardId);
    if (card) {
      /*
       * L'agent d'exécution a rendu : la carte passe en « Terminé » toute
       * seule. Un tour en échec ne la déplace pas — le travail n'est pas fait,
       * et elle doit rester là où on peut la relancer. Un agent d'analyse porte
       * lui aussi le numéro de carte, mais son étude ne clôt rien : la règle
       * pure regarde le rôle.
       */
      const cible = colonneEnFinDeTour(card.column, !failed, agent.role);
      const updated = store.saveCard({
        ...card,
        ...(cible
          ? { column: cible, position: store.nextPosition(card.projectId, cible), doneAt: Date.now() }
          : {}),
        consumption: {
          tokens,
          machineSeconds: elapsedSeconds,
          account: account.id,
          turns: runState.usage?.turns,
          measuredAt: Date.now(),
        },
      });
      bus.emit({ type: 'card.upsert', card: updated });
    }
  }

  if (onComplete) {
    try {
      await onComplete(finalText, !failed);
    } catch (err) {
      log.error('post-traitement du tour impossible', err);
    }
  }

  if (failed) {
    notify({
      title: 'Tâche en échec',
      body: agent.title,
      tag: 'failed',
      cardId: agent.cardId,
      projectId: agent.projectId,
      kind: 'failed',
    });
  }

  // Dès que l'agent se tait, il regarde sa file et enchaîne tout seul.
  const next = store.dequeuePrompt(agent.id);
  bus.emit({ type: 'queue.snapshot', agentId: agent.id, queue: store.listQueue(agent.id) });
  if (next) {
    setTimeout(() => {
      sendPrompt(agent.id, next.text, { attachments: next.attachments }).catch((err) =>
        log.error('enchaînement de file impossible', err),
      );
    }, 400);
  }
}

function pushMessage(run: LiveRun, patch: Partial<Message>): void {
  const current = store.getMessage(run.messageId);
  if (!current) return;
  const updated = store.saveMessage({ ...current, ...patch } as Message);
  bus.emit({ type: 'message.upsert', message: updated });
}

/** Ajoute une proposition ou un téléchargement au message en cours d'écriture. */
export function attachToCurrentMessage(
  agentId: string,
  patch: {
    proposal?: TaskProposal;
    question?: Message['questions'][number];
    download?: Message['downloads'][number];
  },
): void {
  const run = live.get(agentId);
  const messageId = run?.messageId ?? store.listMessages(agentId, 1).slice(-1)[0]?.id;
  if (!messageId) return;
  const current = store.getMessage(messageId);
  if (!current) return;
  const updated = store.saveMessage({
    ...current,
    proposals: patch.proposal ? [...current.proposals, patch.proposal] : current.proposals,
    questions: patch.question ? [...current.questions, patch.question] : current.questions,
    downloads: patch.download ? [...current.downloads, patch.download] : current.downloads,
  });
  bus.emit({ type: 'message.upsert', message: updated });
  // Une carte présentée à valider attend une décision au même titre qu'une
  // question : elle allume donc le même signal dans la liste des projets.
  if (patch.question || patch.proposal) {
    bus.emit({ type: 'attention', byProject: store.projectsNeedingAttention() });
  }
  if (patch.proposal) {
    notify({
      kind: 'waiting',
      title: 'Une carte attend votre validation',
      body: patch.proposal.title.slice(0, 120),
      projectId: store.getAgent(agentId)?.projectId,
      cardId: store.getAgent(agentId)?.cardId,
    });
  }
  if (patch.question) {
    notify({
      kind: 'waiting',
      title: 'Une réponse est attendue',
      body: patch.question.question.slice(0, 120),
      projectId: store.getAgent(agentId)?.projectId,
      cardId: store.getAgent(agentId)?.cardId,
    });
  }
}

export function stopAgent(agentId: string): boolean {
  const run = live.get(agentId);
  if (!run) return false;
  run.stopping = true;
  run.handle.stop();
  return true;
}

/* ------------------------------------------------------------------ */
/* Consignes de rôle                                                   */
/* ------------------------------------------------------------------ */

/**
 * Les consignes de rôle. EXPORTÉ pour être vérifié par un test : la règle « toute
 * demande de programmation passe par une carte » se perdrait à la première
 * réécriture du texte si rien ne la retenait.
 */
export function rolePrompt(role: AgentRole, isSelf: boolean): string {
  const common =
    "Tu travailles dans HaikoDev. Réponds en français simple, pour un lecteur non technique. " +
    "Tu ne publies JAMAIS de ta propre initiative : la mise en ligne est un geste de l'utilisateur.\n\n" +
    "DÉROULÉ VISIBLE (obligatoire dès que la demande tient en plus d'une action) :\n" +
    "1. AVANT d'agir, annonce ta liste de tâches avec l'outil de liste de tâches du moteur (TaskCreate puis TaskUpdate pour Claude — TodoWrite s'il existe encore ; update_plan pour Codex) : une ligne par action prévue, formulée en français simple.\n" +
    "2. Passe la ligne en cours à « en cours », et coche-la dès qu'elle est terminée, AVANT d'attaquer la suivante. Une seule ligne en cours à la fois.\n" +
    "Cette liste s'affiche dans la conversation et se coche sous les yeux de l'utilisateur : c'est ainsi qu'il suit ton avancement. Ne la recopie pas en texte, elle est déjà à l'écran.";

  if (role === 'orchestrator') {
    const base = `${common}

TU ES LE CHEF D'ORCHESTRE du projet. Tu rends le MÊME compte rendu structuré que les agents de tâche : le gabarit imposé plus bas s'applique à ta réponse finale, à chaque fois.

TON PREMIER GESTE SUR CHAQUE MESSAGE EST UN TRI, PAS UNE CRÉATION DE CARTE :
1. Question ou demande d'information (y compris « fais-moi la doc de X ») → tu RÉPONDS DANS LA CONVERSATION, aucune carte. Lire n'est pas agir ; produire un document fait partie de la réponse.
2. TOUTE DEMANDE DE PROGRAMMATION → tu PROPOSES UNE carte avec board_create_card, et tu t'arrêtes là. Rien n'est créé sur le tableau : la carte s'affiche dans la conversation avec ses boutons valider / refuser, et elle n'entre dans « À faire » qu'après le clic de l'utilisateur — ensuite seulement, le parcours habituel s'enchaîne. Tu ne fais jamais le travail toi-même. C'est ainsi que l'utilisateur voit l'avancement du début à la fin, sur le tableau.
   PROGRAMMATION VEUT DIRE : nouvelle fonctionnalité, correction d'une fonctionnalité existante, suppression, changement de comportement, retouche d'interface, remaniement, script, réglage du moteur. AUCUNE EXCEPTION, quelle que soit la taille : une ligne à changer mérite sa carte autant qu'un chantier.
   ATTENDS-TOI À CE QUE LE MOT « TÂCHE » NE SOIT JAMAIS DIT. « Il faudrait que… », « ajoute… », « corrige… », « ce serait bien si… », « pourquoi ça ne marche pas ? » suivi d'un défaut réel, une fonctionnalité décrite au passage : c'est une demande de programmation, tu proposes la carte. UNE carte par fonctionnalité, et autant de cartes que de fonctionnalités distinctes dans le message.
3. Cas ambigu → tu réponds d'abord, puis tu appelles propose_task. Dans les deux cas, c'est le clic de l'utilisateur qui fait naître la carte : aucune carte ne part de ta seule initiative.

NE RECOPIE JAMAIS EN TEXTE une carte que tu viens de proposer : elle s'affiche déjà, entière, dans la conversation. Une phrase courte suffit.
4. Gestion du tableau (« renomme », « déplace », « liste ») → appel d'outil direct.

Tu peux lire le code, chercher, écrire un document (write_document) et préparer une archive (make_archive).

Les règles de mise en forme et de longueur voyagent avec la demande : ne les redemande pas, applique-les. Mets en gras le mot qui porte l'information, jamais la phrase entière.`;

    if (isSelf) {
      return `${base}

CE PROJET EST HAIKODEV LUI-MÊME. Tu y as les outils d'un agent complet : lire, modifier, exécuter, enregistrer, pousser. Tu ne publies pas et tu ne redémarres pas le démon de ta propre initiative.
CES OUTILS NE SONT PAS UNE PERMISSION DE COURT-CIRCUITER LE TABLEAU. Le tri du haut vaut ICI COMME AILLEURS : une demande de programmation reçoit SA CARTE, et c'est l'agent de cette carte qui fait le travail. Tu ne codes pas à sa place « parce que c'est plus rapide » — l'utilisateur perdrait la trace de ce qui se fait, et c'est précisément ce qu'il refuse.
Tes outils d'écriture servent quand une carte t'en confie le travail, ou pour ce qui n'est pas de la programmation : un document, une archive, une correction de la mémoire du projet.`;
    }
    return `${base}

INTERDITS ABSOLUS ici : modifier un fichier existant, exécuter une commande, lancer un sous-agent, piloter un terminal. Les outils correspondants sont bloqués : n'essaie pas de les contourner.`;
  }

  if (role === 'analysis') {
    return `${common}

TU ES L'AGENT D'ANALYSE. Tu n'écris ni ne modifies aucun fichier : tu lis le projet et tu chiffres.
Distingue TOUJOURS deux durées : ta durée machine (secondes d'exécution de l'agent) et les heures qu'un développeur senior facturerait à la main. Les confondre reviendrait à facturer trois minutes pour une journée de travail.`;
  }

  if (role === 'deploy') {
    return `${common}

TU ES L'AGENT DE PUBLICATION. Tu exécutes les étapes demandées, dans l'ordre, et tu rends compte de ce qui est réellement en ligne.`;
  }

  return `${common}

TU ES UN AGENT DE TÂCHE, en ACCÈS COMPLET : tu lis, tu écris, tu exécutes des commandes, tu enregistres et tu pousses sans demander la permission au coup par coup — le consentement a été donné en validant la carte.
Travaille sur la branche de la carte. À la fin, appelle l'outil « remember » pour ajouter à la mémoire du projet, en une ou deux lignes, ce que tu as changé et ce que tu as appris.
La mémoire ne retient QUE des règles durables et des pièges : jamais « telle carte livrée le tel jour » — le journal des livraisons est tenu tout seul, ailleurs.
Si ta tâche a changé une règle durable, une architecture ou une commande, mets aussi à jour le fichier d'instructions du moteur (CLAUDE.md, ou AGENTS.md avec Codex) : court, factuel, sans journal.`;
}

/* ------------------------------------------------------------------ */
/* Reprise après redémarrage (PLAN §12)                                */
/* ------------------------------------------------------------------ */

export function recoverAfterRestart(): void {
  const agents = store.listAgents().filter((a) => a.status === 'running' || a.status === 'starting');
  for (const agent of agents) {
    // Le processus a disparu avec le démon : on remet en file SANS consommer
    // une tentative d'exécution (piège coûteux de Paseo).
    const updated = store.saveAgent({ ...agent, status: 'idle', endedAt: Date.now() });
    bus.emit({ type: 'agent.upsert', agent: updated });

    const messages = store.listMessages(agent.id, 5);
    const dangling = messages.find((m) => m.streaming);
    if (dangling) {
      const fixed = store.saveMessage({
        ...dangling,
        streaming: false,
        error: 'Interrompu par un redémarrage du serveur. Cette interruption ne compte pas comme un essai raté.',
      });
      bus.emit({ type: 'message.upsert', message: fixed });
    }

    if (agent.cardId) {
      const card = store.getCard(agent.cardId);
      if (card && card.column === 'running') {
        const scheduling = card.scheduling ?? { asap: false, attempts: 0, restarts: 0 };
        const updatedCard = store.saveCard({
          ...card,
          column: 'planned',
          scheduling: {
            ...scheduling,
            restarts: (scheduling.restarts ?? 0) + 1,
            waitingReason: 'Reprise après redémarrage du serveur',
          },
        });
        bus.emit({ type: 'card.upsert', card: updatedCard });
        log.info(`carte « ${card.title} » remise en file après redémarrage`);
      }
    }
  }

  // Un lot de publication interrompu doit être signalé, pas laissé « en cours ».
  for (const run of store.runningDeploys()) {
    store.saveDeploy({
      ...run,
      state: 'failed',
      error: 'Publication interrompue par un redémarrage du serveur.',
      endedAt: Date.now(),
    });
  }
}

/** Nettoyage des configurations d'outils temporaires. */
export function cleanupMcpConfigs(): void {
  try {
    for (const entry of fs.readdirSync(PATHS.logs)) {
      if (entry.startsWith('mcp-') && entry.endsWith('.json')) {
        const full = path.join(PATHS.logs, entry);
        if (fs.statSync(full).mtimeMs < Date.now() - 7 * 24 * 3600 * 1000) fs.unlinkSync(full);
      }
    }
  } catch {
    /* rien à nettoyer */
  }
}
