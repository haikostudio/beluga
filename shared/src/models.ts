import { z } from 'zod';
import { ColumnKey } from './columns.js';

/* ------------------------------------------------------------------ */
/* Moteurs, modèles, niveaux de réflexion                              */
/* ------------------------------------------------------------------ */

export const EngineId = z.enum(['claude', 'codex']);
export type EngineId = z.infer<typeof EngineId>;

/**
 * Le niveau de réflexion est une chaîne LIBRE : chaque moteur a son propre
 * vocabulaire (low, medium, high, xhigh, max, minimal…) et il change avec les
 * mises à jour. Le serveur envoie la liste réelle, l'interface l'affiche telle
 * quelle — jamais de liste écrite en dur côté client (PLAN §14, §30).
 */
export const ThinkingLevel = z.string();
export type ThinkingLevel = z.infer<typeof ThinkingLevel>;

export const ThinkingOption = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type ThinkingOption = z.infer<typeof ThinkingOption>;

export const ModelInfo = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  /** Niveaux de réflexion réellement proposés par CE modèle. */
  thinking: z.array(ThinkingOption).default([]),
  defaultThinking: z.string().optional(),
  contextWindow: z.number().optional(),
  /** Date de sortie annoncée par le moteur : sert à classer du plus récent au plus ancien. */
  releasedAt: z.number().optional(),
  /** Appétit en quota : « léger », « moyen » ou « gourmand ». Pas de prix, juste un repère. */
  appetite: z.enum(['light', 'medium', 'heavy']).optional(),
  note: z.string().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

export const EngineInfo = z.object({
  id: EngineId,
  label: z.string(),
  installed: z.boolean(),
  version: z.string().optional(),
  models: z.array(ModelInfo).default([]),
  defaultModel: z.string().optional(),
  /** Vrai quand la liste vient du moteur lui-même, faux si c'est le repli local. */
  live: z.boolean().default(false),
  fetchedAt: z.number().optional(),
});
export type EngineInfo = z.infer<typeof EngineInfo>;

export const RunConfig = z.object({
  engine: EngineId.default('claude'),
  model: z.string().optional(),
  thinking: ThinkingLevel.default('none'),
  mode: z.enum(['direct', 'plan']).default('direct'),
});
export type RunConfig = z.infer<typeof RunConfig>;

/* ------------------------------------------------------------------ */
/* Projet                                                              */
/* ------------------------------------------------------------------ */

export const BillingLink = z.object({
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  companyId: z.string().optional(),
  companyName: z.string().optional(),
  hourlyRate: z.number().default(130),
  currency: z.string().default('CHF'),
  defaultDocumentId: z.string().optional(),
  defaultDocumentType: z.enum(['offer', 'invoice']).optional(),
});
export type BillingLink = z.infer<typeof BillingLink>;

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  gitRemote: z.string().optional(),
  gitBranch: z.string().optional(),
  defaultEngine: EngineId.default('claude'),
  defaultModel: z.string().optional(),
  /** Vrai uniquement pour le dépôt HaikoDev lui-même (PLAN §5, exception). */
  isSelf: z.boolean().default(false),
  /** Commande de publication, exécutée par l'agent de publication. */
  deployCommand: z.string().optional(),
  deployUrl: z.string().optional(),
  billing: BillingLink.optional(),
  /** Rang choisi à la main dans la colonne de gauche : petit = en haut. */
  rank: z.number().default(1000),
  /** Groupe de rangement choisi par l'utilisateur (« Clients », « Perso »…). */
  groupId: z.string().optional(),
  archived: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Project = z.infer<typeof Project>;

/* ------------------------------------------------------------------ */
/* Estimation & consommation                                           */
/* ------------------------------------------------------------------ */

export const Estimate = z.object({
  /** Durée machine prévue, en secondes. Sert à l'ordonnanceur, JAMAIS à la facture. */
  machineSeconds: z.number().optional(),
  tokens: z.number().optional(),
  quotaShare: z.number().optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  summary: z.string().optional(),
  /** Heures qu'un développeur senior facturerait à la main. Sert à la facture. */
  seniorHours: z.number().optional(),
  billingTitle: z.string().optional(),
  billingDescription: z.string().optional(),
  failed: z.boolean().default(false),
  failureReason: z.string().optional(),
  producedAt: z.number().optional(),
});
export type Estimate = z.infer<typeof Estimate>;

export const Consumption = z.object({
  tokens: z.number().optional(),
  quotaShare: z.number().optional(),
  /** Durée machine réelle, en secondes. */
  machineSeconds: z.number().optional(),
  account: z.string().optional(),
  turns: z.number().optional(),
  measuredAt: z.number().optional(),
});
export type Consumption = z.infer<typeof Consumption>;

/* ------------------------------------------------------------------ */
/* Carte                                                               */
/* ------------------------------------------------------------------ */

export const Attachment = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  /** Empreinte du contenu : le même fichier envoyé dix fois n'apparaît qu'une fois. */
  sha: z.string(),
  cardId: z.string().optional(),
  agentId: z.string().optional(),
  createdAt: z.number(),
});
export type Attachment = z.infer<typeof Attachment>;

export const BillingLine = z.object({
  documentType: z.enum(['offer', 'invoice']),
  documentId: z.string(),
  documentNumber: z.string().optional(),
  title: z.string().optional(),
  hours: z.number().optional(),
  amount: z.number().optional(),
  addedAt: z.number(),
});
export type BillingLine = z.infer<typeof BillingLine>;

export const GithubTracking = z.object({
  branch: z.string().optional(),
  prNumber: z.number().optional(),
  prTitle: z.string().optional(),
  prState: z.enum(['open', 'merged', 'closed']).optional(),
  prUrl: z.string().optional(),
  checks: z
    .array(z.object({ name: z.string(), status: z.string(), conclusion: z.string().optional() }))
    .default([]),
  reviewDecision: z.string().optional(),
  mergeable: z.string().optional(),
  commits: z
    .array(z.object({ sha: z.string(), message: z.string(), date: z.string().optional() }))
    .default([]),
  activity: z
    .array(z.object({ kind: z.string(), author: z.string(), body: z.string(), date: z.string() }))
    .default([]),
  fetchedAt: z.number().optional(),
});
export type GithubTracking = z.infer<typeof GithubTracking>;

export const SchedulingState = z.object({
  waitingReason: z.string().optional(),
  asap: z.boolean().default(false),
  attempts: z.number().default(0),
  /** Compteur séparé : un redémarrage du démon ne compte JAMAIS comme un essai raté (PLAN §30). */
  restarts: z.number().default(0),
  lastError: z.string().optional(),
});
export type SchedulingState = z.infer<typeof SchedulingState>;

export const Card = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string().default(''),
  labels: z.array(z.string()).default([]),
  column: ColumnKey,
  position: z.number(),
  origin: z.enum(['user', 'agent']).default('user'),
  run: RunConfig,
  estimate: Estimate.optional(),
  consumption: Consumption.optional(),
  scheduling: SchedulingState.optional(),
  agentId: z.string().optional(),
  billing: BillingLine.optional(),
  github: GithubTracking.optional(),
  /** Chemin du document de clôture, écrit à l'archivage. */
  closureDoc: z.string().optional(),
  excludedFromDeploy: z.boolean().default(false),
  /**
   * Quand la conversation de cette carte a été ouverte pour la dernière fois.
   * C'est ce repère qui éteint la pastille « terminé, pas encore lu » — le
   * simple passage sur le projet ne suffit pas.
   */
  lastReadAt: z.number().optional(),
  /**
   * L'agent dont la conversation est rattachée à cette carte alors qu'il ne
   * lui appartient pas : le chef d'orchestre qui a codé hors tâche, par
   * exemple. Sa conversation continue de vivre ailleurs.
   */
  conversationAgentId: z.string().optional(),
  /** Carte fabriquée pour du travail enregistré sans tâche. */
  horsTache: z.boolean().default(false),
  /**
   * Pourquoi la carte n'est PAS passée en « Terminé » alors que l'agent a rendu
   * sa réponse : le dépôt n'a pas bougé. La phrase s'affiche telle quelle sur la
   * carte, et disparaît dès qu'un tour modifie enfin du code.
   */
  sansModification: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  doneAt: z.number().optional(),
  /** Ce qui dit qu'une carte est publiée, c'est cette date — jamais sa colonne (PLAN §4). */
  deployedAt: z.number().optional(),
});
export type Card = z.infer<typeof Card>;

/* ------------------------------------------------------------------ */
/* Agents & conversations                                              */
/* ------------------------------------------------------------------ */

export const AgentRole = z.enum(['task', 'orchestrator', 'analysis', 'deploy']);
export type AgentRole = z.infer<typeof AgentRole>;

export const AgentStatus = z.enum(['idle', 'starting', 'running', 'stopped', 'failed', 'done']);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const Agent = z.object({
  id: z.string(),
  projectId: z.string(),
  cardId: z.string().optional(),
  role: AgentRole,
  title: z.string(),
  run: RunConfig,
  status: AgentStatus,
  account: z.string().optional(),
  pid: z.number().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Agent = z.infer<typeof Agent>;

/** Une étape de la liste d'exécution en direct (PLAN §26). */
export const RunStep = z.object({
  id: z.string(),
  label: z.string(),
  state: z.enum(['todo', 'running', 'done', 'failed', 'skipped']),
  detail: z.string().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
});
export type RunStep = z.infer<typeof RunStep>;

/**
 * Une ligne de la liste de tâches que l'agent s'annonce à lui-même AVANT
 * d'agir (PLAN §26). Elle se coche au fur et à mesure : c'est la promesse
 * affichée, là où les étapes sont le journal de ce qui s'est réellement passé.
 */
export const TodoItem = z.object({
  label: z.string(),
  state: z.enum(['todo', 'running', 'done']).default('todo'),
  /** Début et fin de la ligne : elle affiche son temps, comme une étape. */
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
});
export type TodoItem = z.infer<typeof TodoItem>;

/** L'identifiant réservé à l'étape « lecture de la mémoire du projet ». */
export const MEMORY_STEP_ID = 'memoire';

export const TaskProposal = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(''),
  labels: z.array(z.string()).default([]),
  run: RunConfig.optional(),
  /** Décision mémorisée : une proposition refusée ne revient jamais (PLAN §30). */
  decision: z.enum(['pending', 'accepted', 'refused']).default('pending'),
  cardId: z.string().optional(),
  decidedAt: z.number().optional(),
});
export type TaskProposal = z.infer<typeof TaskProposal>;

/**
 * Une question posée par l'agent (PLAN §10, esprit) : il attend votre réponse
 * avant de continuer. Choix unique, choix multiple, ou texte libre.
 */
export const AgentQuestion = z.object({
  id: z.string(),
  question: z.string(),
  kind: z.enum(['single', 'multiple', 'text']).default('single'),
  options: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().optional() })).default([]),
  /** Un complément libre est toujours possible, en plus des choix. */
  allowFreeText: z.boolean().default(true),
  answer: z.string().optional(),
  answeredAt: z.number().optional(),
});
export type AgentQuestion = z.infer<typeof AgentQuestion>;

export const DownloadOffer = z.object({
  id: z.string(),
  label: z.string(),
  size: z.number().optional(),
  expiresAt: z.number(),
});
export type DownloadOffer = z.infer<typeof DownloadOffer>;

export const Message = z.object({
  id: z.string(),
  agentId: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().default(''),
  /** Liste d'exécution attachée à ce tour (PLAN §26). */
  steps: z.array(RunStep).default([]),
  /** La liste de tâches annoncée par l'agent, cochée en direct (PLAN §26). */
  todos: z.array(TodoItem).default([]),
  proposals: z.array(TaskProposal).default([]),
  questions: z.array(AgentQuestion).default([]),
  downloads: z.array(DownloadOffer).default([]),
  attachments: z.array(z.string()).default([]),
  /** Vrai tant que l'agent écrit encore ce message. */
  streaming: z.boolean().default(false),
  /** Jetons de ce tour, durée d'exécution et compte utilisé : affichés sous le message. */
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  account: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.number(),
});
export type Message = z.infer<typeof Message>;

/** Un message écrit pendant que l'agent travaille : il attend son tour (PLAN §14). */
export const QueuedPrompt = z.object({
  id: z.string(),
  agentId: z.string(),
  text: z.string(),
  attachments: z.array(z.string()).default([]),
  position: z.number(),
  createdAt: z.number(),
});
export type QueuedPrompt = z.infer<typeof QueuedPrompt>;

/* ------------------------------------------------------------------ */
/* Quotas, capacité, publication                                       */
/* ------------------------------------------------------------------ */

export const QuotaWindow = z.object({
  usedPct: z.number().optional(),
  resetsAt: z.number().optional(),
});
export type QuotaWindow = z.infer<typeof QuotaWindow>;

export const AccountQuota = z.object({
  id: z.string(),
  engine: EngineId,
  label: z.string(),
  plan: z.string().optional(),
  priority: z.number().default(100),
  active: z.boolean().default(false),
  available: z.boolean().default(true),
  session: QuotaWindow.optional(),
  weekly: QuotaWindow.optional(),
  error: z.string().optional(),
  fetchedAt: z.number().optional(),
  /**
   * La dernière amorce de fenêtre posée par le serveur sur ce compte. Elle
   * prouve, depuis l'écran, que le décompte a été lancé en arrière-plan et non
   * par l'ouverture de l'application.
   */
  derniereAmorce: z.object({ at: z.number(), ok: z.boolean(), error: z.string().optional() }).optional(),
});
export type AccountQuota = z.infer<typeof AccountQuota>;

export const CapacitySnapshot = z.object({
  loadPct: z.number(),
  /**
   * La charge processeur BRUTE, en % des cœurs : elle peut dépasser cent sans
   * que la machine soit saturée (le serveur héberge déjà Paseo et une dizaine
   * de serveurs de projets). À lire comme une information, jamais comme une
   * jauge de remplissage.
   */
  cpuLoadPct: z.number().optional(),
  memUsedMb: z.number(),
  memTotalMb: z.number(),
  cpuCount: z.number(),
  runningAgents: z.number(),
  maxAgents: z.number(),
  /** Calculé sur la consommation mesurée, pas deviné (PLAN §27). */
  slotsFree: z.number(),
  paused: z.boolean().default(false),
  pauseReason: z.string().optional(),
  avgAgentMemMb: z.number().optional(),
  at: z.number(),
});
export type CapacitySnapshot = z.infer<typeof CapacitySnapshot>;

export const SystemProcess = z.object({
  id: z.string(),
  kind: z.enum(['agent', 'service']),
  label: z.string(),
  detail: z.string().optional(),
  memMb: z.number(),
  cpuPct: z.number(),
  since: z.number().optional(),
  canStop: z.boolean().default(false),
  running: z.boolean().default(true),
  projectId: z.string().optional(),
  cardId: z.string().optional(),
});
export type SystemProcess = z.infer<typeof SystemProcess>;

export const DeployStepKey = z.enum([
  'merge',
  'commit',
  'push',
  'verify',
  'build',
  'publish',
  'restart',
]);
export type DeployStepKey = z.infer<typeof DeployStepKey>;

export const DeployRun = z.object({
  id: z.string(),
  projectId: z.string(),
  state: z.enum(['running', 'success', 'failed', 'stopped']),
  currentStep: DeployStepKey.optional(),
  steps: z
    .array(
      z.object({
        key: DeployStepKey,
        state: z.enum(['todo', 'running', 'done', 'failed', 'skipped']),
        log: z.string().default(''),
        startedAt: z.number().optional(),
        endedAt: z.number().optional(),
      }),
    )
    .default([]),
  cardIds: z.array(z.string()).default([]),
  url: z.string().optional(),
  targetCommit: z.string().optional(),
  agentId: z.string().optional(),
  error: z.string().optional(),
  queued: z.boolean().default(false),
  startedAt: z.number(),
  endedAt: z.number().optional(),
});
export type DeployRun = z.infer<typeof DeployRun>;

/* ------------------------------------------------------------------ */
/* Réglages                                                            */
/* ------------------------------------------------------------------ */

export const Settings = z.object({
  maxAgents: z.number().default(15),
  quietHoursStart: z.number().optional(),
  quietHoursEnd: z.number().optional(),
  offPeakStart: z.number().default(22),
  offPeakEnd: z.number().default(7),
  heavyTaskSeconds: z.number().default(900),
  theme: z.enum(['dark', 'light']).default('dark'),
  notifyOnDone: z.boolean().default(true),
  notifyOnFailed: z.boolean().default(true),
  notifyOnProposal: z.boolean().default(true),
  notifyOnDeploy: z.boolean().default(true),
  alertThresholdPct: z.number().default(90),
  alertMinutes: z.number().default(10),
  dailyDigestHour: z.number().optional(),
  backupHour: z.number().default(3),
  ttsVoice: z.string().default('fr_FR-siwis-medium'),
  /**
   * Amorcer la fenêtre de cinq heures des comptes Claude dès qu'elle repart à
   * zéro. Se coupe d'un geste si le mécanisme faisait plus de mal que de bien.
   */
  primeClaudeWindow: z.boolean().default(true),
  /**
   * Le dernier réglage choisi pour un chef d'orchestre : les chefs d'orchestre
   * créés ensuite le reprennent, au lieu de retomber sur le modèle épinglé.
   */
  orchestratorEngine: z.string().optional(),
  orchestratorModel: z.string().optional(),
  orchestratorThinking: z.string().optional(),
});
export type Settings = z.infer<typeof Settings>;

/** Un rangement libre pour la colonne de gauche : purement organisationnel. */
export const ProjectGroup = z.object({
  id: z.string(),
  name: z.string(),
  rank: z.number().default(100),
  collapsed: z.boolean().default(false),
  /** Pastille de couleur, pour repérer le groupe d'un coup d'œil. */
  color: z.string().optional(),
});
export type ProjectGroup = z.infer<typeof ProjectGroup>;

export const FileNode = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(['file', 'dir']),
  size: z.number().optional(),
  mtime: z.number().optional(),
});
export type FileNode = z.infer<typeof FileNode>;
