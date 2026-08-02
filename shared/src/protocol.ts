import { z } from 'zod';
import { ColumnKey } from './columns.js';
import {
  Agent,
  AccountQuota,
  ProjectGroup,
  Attachment,
  Card,
  CapacitySnapshot,
  DeployRun,
  EngineInfo,
  FileNode,
  Message,
  Project,
  QueuedPrompt,
  RunConfig,
  Settings,
  SystemProcess,
} from './models.js';

/**
 * Version du protocole. RÈGLE (PLAN §30) : on n'ajoute JAMAIS un champ
 * obligatoire — uniquement des champs optionnels, pour qu'un navigateur ouvert
 * depuis trois jours continue de fonctionner.
 */
export const PROTOCOL_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Client → serveur                                                    */
/* ------------------------------------------------------------------ */

export const ClientCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), protocol: z.number().optional() }),
  z.object({ type: z.literal('ping') }),

  // Projets
  z.object({ type: z.literal('project.list'), includeArchived: z.boolean().optional() }),
  z.object({
    type: z.literal('project.create'),
    name: z.string(),
    path: z.string(),
    gitRemote: z.string().optional(),
    defaultEngine: z.string().optional(),
    deployCommand: z.string().optional(),
    deployUrl: z.string().optional(),
  }),
  z.object({ type: z.literal('project.update'), id: z.string(), patch: z.record(z.any()) }),
  z.object({ type: z.literal('project.delete'), id: z.string() }),
  /** Met un projet de côté sans rien perdre : son tableau et son historique restent. */
  z.object({ type: z.literal('project.archive'), id: z.string(), archived: z.boolean() }),
  z.object({ type: z.literal('project.open'), id: z.string() }),
  z.object({ type: z.literal('project.scan') }),
  /** Crée l'adresse publique d'un projet (nom + reverse-proxy) en une fois. */
  z.object({ type: z.literal('project.publishDomain'), id: z.string(), subdomain: z.string(), port: z.number() }),
  /** Range les projets dans l'ordre voulu (le plus important en haut). */
  z.object({ type: z.literal('project.reorder'), ids: z.array(z.string()) }),
  /** Ranger un projet dans un groupe (ou l'en sortir avec un groupe vide). */
  z.object({ type: z.literal('project.group'), id: z.string(), groupId: z.string().optional() }),
  z.object({ type: z.literal('group.list') }),
  z.object({ type: z.literal('group.create'), name: z.string() }),
  z.object({ type: z.literal('group.update'), id: z.string(), name: z.string().optional(), collapsed: z.boolean().optional() }),
  z.object({ type: z.literal('group.delete'), id: z.string() }),
  z.object({ type: z.literal('group.reorder'), ids: z.array(z.string()) }),
  /**
   * Range la colonne de gauche d'un bloc : projets hors groupe et groupes
   * partagent le même classement, un projet peut donc passer au-dessus d'un
   * groupe et inversement.
   */
  z.object({
    type: z.literal('sidebar.reorder'),
    items: z.array(z.object({ kind: z.enum(['project', 'group']), id: z.string(), groupId: z.string().optional() })),
  }),
  /** Crée un dossier neuf sur le serveur, puis l'inscrit. */
  z.object({
    type: z.literal('project.new'),
    name: z.string(),
    folder: z.string().optional(),
    git: z.boolean().optional(),
    gitRemote: z.string().optional(),
  }),

  // Cartes
  z.object({
    type: z.literal('card.create'),
    projectId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    labels: z.array(z.string()).optional(),
    run: RunConfig.partial().optional(),
    polish: z.boolean().optional(),
  }),
  z.object({ type: z.literal('card.update'), id: z.string(), patch: z.record(z.any()) }),
  z.object({
    type: z.literal('card.move'),
    id: z.string(),
    column: ColumnKey,
    position: z.number().optional(),
  }),
  z.object({ type: z.literal('card.delete'), id: z.string() }),
  z.object({ type: z.literal('card.start'), id: z.string() }),
  z.object({ type: z.literal('card.finish'), id: z.string() }),
  z.object({ type: z.literal('card.reanalyze'), id: z.string() }),
  z.object({ type: z.literal('card.asap'), id: z.string(), value: z.boolean() }),

  // Agents & conversations
  z.object({ type: z.literal('agent.open'), id: z.string() }),
  z.object({ type: z.literal('agent.orchestrator'), projectId: z.string() }),
  z.object({
    type: z.literal('agent.prompt'),
    agentId: z.string(),
    text: z.string(),
    attachments: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('agent.stop'), agentId: z.string() }),
  z.object({
    type: z.literal('agent.config'),
    agentId: z.string(),
    run: z.object({
      engine: z.string().optional(),
      model: z.string().optional(),
      thinking: z.string().optional(),
      mode: z.enum(['direct', 'plan']).optional(),
    }),
  }),
  z.object({ type: z.literal('agent.dismiss'), agentId: z.string() }),
  z.object({ type: z.literal('queue.update'), id: z.string(), text: z.string() }),
  z.object({ type: z.literal('queue.remove'), id: z.string() }),
  z.object({ type: z.literal('queue.reorder'), agentId: z.string(), ids: z.array(z.string()) }),

  // Propositions de tâche
  z.object({
    type: z.literal('proposal.decide'),
    messageId: z.string(),
    proposalId: z.string(),
    accept: z.boolean(),
  }),

  // Publication
  z.object({ type: z.literal('deploy.start'), projectId: z.string() }),
  z.object({ type: z.literal('deploy.stop'), runId: z.string() }),
  z.object({ type: z.literal('deploy.retry'), runId: z.string() }),

  // Fichiers
  z.object({ type: z.literal('files.list'), projectId: z.string(), path: z.string().optional() }),
  z.object({ type: z.literal('files.read'), projectId: z.string(), path: z.string() }),
  z.object({
    type: z.literal('files.archive'),
    projectId: z.string(),
    paths: z.array(z.string()),
  }),
  z.object({ type: z.literal('attachments.list'), projectId: z.string() }),

  // Facturation
  z.object({ type: z.literal('billing.clients') }),
  z.object({ type: z.literal('billing.documents'), clientId: z.string().optional() }),
  z.object({
    type: z.literal('billing.push'),
    cardId: z.string(),
    documentType: z.enum(['offer', 'invoice']),
    documentId: z.string().optional(),
    title: z.string(),
    description: z.string().optional(),
    hours: z.number(),
  }),
  z.object({ type: z.literal('billing.summary') }),

  // GitHub
  z.object({ type: z.literal('github.refresh'), cardId: z.string() }),
  z.object({
    type: z.literal('github.merge'),
    cardId: z.string(),
    method: z.enum(['merge', 'squash', 'rebase']).default('squash'),
    auto: z.boolean().optional(),
  }),

  // Système
  z.object({ type: z.literal('settings.get') }),
  /** Réglages d'affichage (largeurs, thème, replis) : conservés en base. */
  z.object({ type: z.literal('prefs.set'), key: z.string(), value: z.any() }),
  z.object({ type: z.literal('settings.update'), patch: z.record(z.any()) }),
  z.object({ type: z.literal('capacity.processes') }),
  z.object({ type: z.literal('capacity.history') }),
  z.object({ type: z.literal('process.stop'), id: z.string() }),
  z.object({ type: z.literal('process.start'), id: z.string() }),
  z.object({ type: z.literal('engines.list') }),
  z.object({ type: z.literal('quota.refresh') }),
  z.object({ type: z.literal('backup.now') }),
  z.object({ type: z.literal('backup.list') }),
  z.object({ type: z.literal('digest.speak'), projectId: z.string().optional() }),
  z.object({ type: z.literal('stats.usage'), projectId: z.string().optional() }),
  z.object({ type: z.literal('memory.get'), projectId: z.string() }),
]);
export type ClientCommand = z.infer<typeof ClientCommand>;

export const ClientEnvelope = z.object({
  id: z.string().optional(),
  cmd: ClientCommand,
});
export type ClientEnvelope = z.infer<typeof ClientEnvelope>;

/* ------------------------------------------------------------------ */
/* Serveur → client                                                    */
/* ------------------------------------------------------------------ */

export const ServerEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    protocol: z.number(),
    version: z.string(),
    settings: Settings,
    prefs: z.record(z.any()).default({}),
    projects: z.array(Project),
    groups: z.array(ProjectGroup).default([]),
    engines: z.array(EngineInfo),
    quotas: z.array(AccountQuota),
    capacity: CapacitySnapshot,
    agents: z.array(Agent),
  }),
  z.object({ type: z.literal('pong'), at: z.number() }),
  z.object({ type: z.literal('ack'), id: z.string(), ok: z.boolean(), data: z.any().optional(), error: z.string().optional() }),
  z.object({ type: z.literal('project.upsert'), project: Project }),
  z.object({ type: z.literal('project.delete'), id: z.string() }),
  /** Met un projet de côté sans rien perdre : son tableau et son historique restent. */
  z.object({ type: z.literal('project.archive'), id: z.string(), archived: z.boolean() }),
  z.object({ type: z.literal('groups'), groups: z.array(ProjectGroup) }),
  z.object({
    type: z.literal('project.snapshot'),
    projectId: z.string(),
    cards: z.array(Card),
    agents: z.array(Agent),
    deploy: DeployRun.optional(),
    memory: z.string().optional(),
  }),
  z.object({ type: z.literal('card.upsert'), card: Card }),
  z.object({ type: z.literal('card.delete'), id: z.string(), projectId: z.string() }),
  z.object({ type: z.literal('agent.upsert'), agent: Agent }),
  z.object({ type: z.literal('agent.delete'), id: z.string() }),
  z.object({
    type: z.literal('agent.snapshot'),
    agentId: z.string(),
    messages: z.array(Message),
    queue: z.array(QueuedPrompt),
  }),
  z.object({ type: z.literal('message.upsert'), message: Message }),
  z.object({ type: z.literal('queue.snapshot'), agentId: z.string(), queue: z.array(QueuedPrompt) }),
  z.object({ type: z.literal('deploy.upsert'), run: DeployRun }),
  z.object({ type: z.literal('quotas'), quotas: z.array(AccountQuota) }),
  z.object({ type: z.literal('capacity'), capacity: CapacitySnapshot }),
  z.object({ type: z.literal('processes'), processes: z.array(SystemProcess) }),
  z.object({ type: z.literal('settings'), settings: Settings }),
  z.object({ type: z.literal('prefs'), prefs: z.record(z.any()) }),
  z.object({ type: z.literal('attachments'), projectId: z.string(), items: z.array(Attachment) }),
  z.object({ type: z.literal('files'), projectId: z.string(), path: z.string(), nodes: z.array(FileNode) }),
  z.object({
    type: z.literal('toast'),
    level: z.enum(['info', 'success', 'warning', 'error']),
    text: z.string(),
    cardId: z.string().optional(),
  }),
  z.object({
    type: z.literal('notify'),
    title: z.string(),
    body: z.string(),
    tag: z.string().optional(),
    cardId: z.string().optional(),
    projectId: z.string().optional(),
  }),
  z.object({ type: z.literal('memory'), projectId: z.string(), content: z.string() }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;
