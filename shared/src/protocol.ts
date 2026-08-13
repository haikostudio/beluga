import { z } from 'zod';
import { ColumnKey } from './columns.js';
import { ConnexionCompte } from './connexion-compte.js';
import {
  Agent,
  AccountQuota,
  EngineId,
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
    devUrl: z.string().optional(),
  }),
  z.object({ type: z.literal('project.update'), id: z.string(), patch: z.record(z.any()) }),
  z.object({ type: z.literal('project.delete'), id: z.string() }),
  /** Met un projet de côté sans rien perdre : son tableau et son historique restent. */
  z.object({ type: z.literal('project.archive'), id: z.string(), archived: z.boolean() }),
  z.object({ type: z.literal('project.open'), id: z.string() }),
  /**
   * Les branches du dépôt GitHub de ce projet, pour les proposer au choix dans
   * ses réglages. Lecture seule : rien n'est créé ni changé sur le dépôt.
   */
  z.object({ type: z.literal('project.branches'), id: z.string() }),
  z.object({ type: z.literal('project.scan') }),
  /**
   * Relance à la main la récupération de l'icône de site (`server/src/favicon.ts`) :
   * bouton « réessayer » des réglages, pour un site dont le logo a changé ou
   * qui ne répondait pas encore à la dernière tentative.
   */
  z.object({ type: z.literal('project.faviconRetry'), id: z.string() }),
  /** Range les projets dans l'ordre voulu (le plus important en haut). */
  z.object({ type: z.literal('project.reorder'), ids: z.array(z.string()) }),
  /** Ranger un projet dans un groupe (ou l'en sortir avec un groupe vide). */
  z.object({ type: z.literal('project.group'), id: z.string(), groupId: z.string().optional() }),
  z.object({ type: z.literal('group.list') }),
  z.object({ type: z.literal('group.create'), name: z.string() }),
  z.object({
    type: z.literal('group.update'),
    id: z.string(),
    name: z.string().optional(),
    collapsed: z.boolean().optional(),
    color: z.string().optional(),
  }),
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
  /**
   * Monte un projet NEUF de bout en bout : dossier sur le serveur, dépôt git
   * sur « main », dépôt GitHub, fichiers d'instructions, mémoire et
   * documentation, l'adresse publique quand elle est demandée, puis
   * inscription dans la colonne de gauche.
   */
  z.object({
    type: z.literal('project.new'),
    name: z.string(),
    folder: z.string().optional(),
    description: z.string().optional(),
    git: z.boolean().optional(),
    gitRemote: z.string().optional(),
    github: z.boolean().optional(),
    githubPublic: z.boolean().optional(),
    /** Le nom court de l'adresse publique. Vide : le projet naît sans adresse. */
    sousDomaine: z.string().optional(),
    /** Le port sur lequel le projet écoute sur le serveur. */
    port: z.number().optional(),
  }),

  // Cartes
  z.object({
    type: z.literal('card.create'),
    projectId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    labels: z.array(z.string()).optional(),
    attachments: z.array(z.string()).optional(),
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
  /**
   * Valider une carte de « Planifié » : c'est le geste qui AUTORISE la dépense.
   * La carte ne change pas de colonne — elle naît dans « Planifié » et y attend
   * son lancement. Rien ne part au moteur : le chiffrage est rendu par l'agent
   * d'exécution, au lancement.
   */
  z.object({ type: z.literal('card.validate'), id: z.string() }),
  z.object({ type: z.literal('card.start'), id: z.string() }),
  z.object({ type: z.literal('card.finish'), id: z.string() }),
  z.object({ type: z.literal('card.asap'), id: z.string(), value: z.boolean() }),
  /**
   * Programme le départ d'une carte à une date (millisecondes), ou retire la
   * date avec `null`. La carte attend dans « Planifié » et part à l'heure dite.
   */
  z.object({ type: z.literal('card.schedule'), id: z.string(), at: z.number().nullable() }),

  // Agents & conversations
  /** `tout` rouvre aussi les échanges d'avant le dernier nouveau départ. */
  z.object({ type: z.literal('agent.open'), id: z.string(), tout: z.boolean().optional() }),
  /** Toute la conversation d'une carte : analyses, exécutions et relances. */
  z.object({ type: z.literal('card.conversation'), cardId: z.string() }),
  /** « J'ai lu » : éteint la pastille de réponse rendue sur cette carte. */
  z.object({ type: z.literal('card.read'), cardId: z.string() }),
  /** « J'ai tout lu sur ce projet » : le geste se fait depuis la liste. */
  z.object({ type: z.literal('project.read'), projectId: z.string() }),
  /**
   * « J'ai ouvert ce projet » : éteint le point bleu de travail terminé, sans
   * toucher au repère de lecture des cartes (`project.read` le fait déjà, pour
   * le clic explicite sur le point).
   */
  z.object({ type: z.literal('project.visit'), projectId: z.string() }),
  z.object({ type: z.literal('agent.orchestrator'), projectId: z.string(), tout: z.boolean().optional() }),
  /** Repartir de zéro : le fil d'avant est mis de côté, pas supprimé. */
  z.object({ type: z.literal('agent.reset'), agentId: z.string() }),
  z.object({
    type: z.literal('agent.prompt'),
    agentId: z.string(),
    text: z.string(),
    attachments: z.array(z.string()).optional(),
  }),
  /* `cardId` : l'arrêt part du tiroir de CETTE carte, et ne vaut que pour elle
     — le démon refuse un agent qui ne lui appartient pas. */
  z.object({ type: z.literal('agent.stop'), agentId: z.string(), cardId: z.string().optional() }),
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
  /** Répondre à une question posée par un agent : il reprend aussitôt. */
  z.object({
    type: z.literal('question.answer'),
    messageId: z.string(),
    questionId: z.string(),
    answer: z.string(),
    /** Les images jointes à la réponse : l'agent les reçoit comme celles du fil. */
    attachments: z.array(z.string()).default([]),
  }),
  /**
   * Fermer une question posée par l'agent SANS y répondre : elle cesse
   * d'attendre, mais l'agent n'est pas relancé.
   */
  z.object({
    type: z.literal('question.cancel'),
    messageId: z.string(),
    questionId: z.string(),
  }),
  /**
   * POURSUIVRE UN TRAVAIL COUPÉ PAR LA LIMITE D'UN COMPTE, sur le compte
   * choisi. Le serveur revérifie la disponibilité au moment du clic : un compte
   * tombé entre-temps ne lance rien et rafraîchit les choix.
   */
  z.object({
    type: z.literal('reprise.compte'),
    messageId: z.string(),
    accountId: z.string(),
  }),
  z.object({
    type: z.literal('proposal.decide'),
    messageId: z.string(),
    proposalId: z.string(),
    accept: z.boolean(),
    /** Corrections faites au moment de valider (facultatif). */
    title: z.string().optional(),
    description: z.string().optional(),
    labels: z.array(z.string()).optional(),
    /**
     * Moteur, modèle et niveau de réflexion choisis AVANT la création : ils
     * sont posés sur la carte et serviront à l'agent qui l'exécutera. Toujours
     * facultatif — une ancienne interface qui ne les envoie pas garde les
     * réglages par défaut du projet.
     */
    run: RunConfig.partial().optional(),
  }),
  /**
   * Réunir plusieurs propositions en attente. L'opération ne crée aucune
   * carte : elle remplace les sources par une nouvelle proposition éditable.
   */
  z.object({
    type: z.literal('proposal.merge'),
    items: z
      .array(z.object({ messageId: z.string(), proposalId: z.string() }))
      .min(2),
  }),

  // Publication
  /*
   * `cible` dit à QUELLE ÉTAPE du parcours on est : le déploiement sur
   * l'instance de dev, ou la mise en production. Absente, c'est la première
   * étape — le déploiement.
   */
  z.object({
    type: z.literal('deploy.start'),
    projectId: z.string(),
    cible: z.enum(['dev', 'production']).optional(),
    /**
     * LES TÂCHES RETENUES par l'écran de sélection, à la première étape
     * seulement (« À déployer ») : absent, tout le lot connu part, comme
     * avant cet écran. Présent, seules ces cartes sont fusionnées et
     * envoyées ; les autres restent dans « À déployer ».
     */
    selectedCardIds: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('deploy.stop'), runId: z.string() }),
  z.object({ type: z.literal('deploy.retry'), runId: z.string() }),
  /**
   * Ce qui coincerait si on publiait maintenant — sans rien publier.
   *
   * `source` est la COLONNE d'où le bloc de publication pose la question : un
   * bloc ne sait pas à quelle étape il sert, il sait seulement où il est. Le
   * serveur lui répond avec l'étape correspondante, ou rien du tout quand cette
   * colonne ne publie pas. Absente, c'est « À déployer ».
   */
  z.object({
    type: z.literal('deploy.check'),
    projectId: z.string(),
    source: ColumnKey.optional(),
  }),
  /**
   * Ce qui coincerait avec CETTE sélection de tâches : une carte retenue qui
   * touche les mêmes fichiers qu'une carte laissée de côté. Interrogé par
   * l'écran de sélection à chaque case cochée ou décochée, sans rien publier.
   */
  z.object({
    type: z.literal('deploy.selection'),
    projectId: z.string(),
    source: ColumnKey.optional(),
    selectedCardIds: z.array(z.string()),
  }),

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
    clientExplanation: z.string().optional(),
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
  /** Éprouve les accès au VPS réglés dans l'onglet Système. */
  z.object({ type: z.literal('vps.test') }),
  z.object({ type: z.literal('capacity.processes') }),
  z.object({ type: z.literal('capacity.history') }),
  z.object({ type: z.literal('process.stop'), id: z.string() }),
  z.object({ type: z.literal('process.start'), id: z.string() }),
  z.object({ type: z.literal('engines.list') }),
  z.object({ type: z.literal('quota.refresh') }),
  /**
   * Connecter ou RECONNECTER un compte de moteur sans ouvrir de terminal.
   * Sans `accountId`, c'est un compte neuf : il n'entre dans la liste qu'une
   * fois la connexion réussie.
   */
  z.object({
    type: z.literal('account.connect'),
    engine: EngineId,
    accountId: z.string().optional(),
    label: z.string().optional(),
  }),
  /** Le code recopié depuis la page d'authentification, renvoyé au moteur. */
  z.object({ type: z.literal('account.code'), id: z.string(), code: z.string() }),
  /** Abandonner une connexion en cours. */
  z.object({ type: z.literal('account.cancel'), id: z.string() }),
  /** Les connexions de comptes en cours, à l'ouverture des réglages. */
  z.object({ type: z.literal('account.connections') }),
  /**
   * Couper ou remettre en service un compte depuis le volet Quotas. Un compte
   * coupé reste dans la liste, éteint : l'ordonnanceur ne le choisit plus et sa
   * fenêtre de 5 h n'est plus amorcée.
   */
  z.object({ type: z.literal('account.disable'), id: z.string(), disabled: z.boolean() }),
  /**
   * Renommer un compte depuis l'onglet Comptes. On ne touche qu'au nom affiché ;
   * un nom vide est refusé et le compte garde son ancien nom.
   */
  z.object({ type: z.literal('account.rename'), id: z.string(), label: z.string() }),
  /** Consommation des comptes sur les derniers jours, pour la courbe. */
  z.object({ type: z.literal('quota.history'), days: z.number().optional() }),
  /** Le journal des amorces de fenêtre posées par le serveur. */
  z.object({ type: z.literal('amorce.history'), limit: z.number().optional() }),
  /** L'état de la liaison au cerveau : clé posée, dernier envoi, erreurs. */
  z.object({ type: z.literal('cerveau.etat') }),
  /** Envoyer tout de suite la mémoire et les instructions de chaque projet. */
  z.object({ type: z.literal('cerveau.envoyer') }),
  /** Poser la clé du cerveau depuis les réglages : elle vaut aussitôt. */
  z.object({ type: z.literal('cerveau.cle'), cle: z.string() }),
  /**
   * LES CLÉS D'API des services extérieurs (`shared/src/cles-api.ts`). Lister
   * ne rend jamais le secret : il n'existe qu'une fois, dans la réponse à
   * `cleApi.creer`. Révoquer date la clé sans effacer la ligne ; oublier ne
   * vaut que pour une clé DÉJÀ révoquée.
   */
  z.object({ type: z.literal('cleApi.lister') }),
  z.object({ type: z.literal('cleApi.creer'), nom: z.string() }),
  z.object({ type: z.literal('cleApi.revoquer'), id: z.string() }),
  z.object({ type: z.literal('cleApi.oublier'), id: z.string() }),
  /**
   * Les dernières erreurs remontées par l'interface, pour le bloc des réglages.
   * Elles arrivent par `POST /api/erreur` et vivent dans un fichier de journal.
   */
  z.object({ type: z.literal('erreurs.liste'), limite: z.number().optional() }),
  /** Vider ce journal : le fichier repart vide, il n'est pas supprimé. */
  z.object({ type: z.literal('erreurs.effacer') }),
  /** L'état du démon : depuis quand il tourne, et s'il tourne sur du code périmé. */
  z.object({ type: z.literal('daemon.status') }),
  /** Arrêter le démon pour que le service le relance avec le code construit. */
  z.object({ type: z.literal('daemon.restart') }),
  z.object({ type: z.literal('backup.now') }),
  z.object({ type: z.literal('backup.list') }),
  z.object({ type: z.literal('digest.speak'), projectId: z.string().optional() }),
  /** Les voix installées sur le serveur, pour en choisir une et l'écouter. */
  z.object({ type: z.literal('voice.list') }),
  /**
   * Une phrase DICTÉE, sans destinataire : l'assistant global lit la liste des
   * projets ouverts, dépose la demande dans le chef d'orchestre du bon projet
   * ou POSE LA QUESTION quand un doute demeure.
   */
  z.object({ type: z.literal('voix.demande'), texte: z.string() }),
  /**
   * Rédige le PROMPT DE MISE EN PRODUCTION du projet à partir de la BASE écrite
   * à la main, par un tour d'agent PAYANT. Ne persiste rien et ne déploie
   * rien : rend le texte généré, que l'interface montre et enregistre ensuite
   * par `project.update`.
   */
  z.object({
    type: z.literal('production.generer'),
    projectId: z.string(),
    base: z.string(),
  }),
  z.object({ type: z.literal('stats.usage'), projectId: z.string().optional() }),
  /** La part de quota (5 h et semaine) qu'une carte a consommée, pour son détail. */
  z.object({ type: z.literal('card.quota'), cardId: z.string() }),
  /** Les totaux ENVOYÉS / REÇUS cumulés, par agent, sur toute la vie d'une carte. */
  z.object({ type: z.literal('card.tokens'), cardId: z.string() }),
  /**
   * LE PARCOURS d'une tâche : une étape par moment réel, du tri par le chef
   * d'orchestre jusqu'à la mise en production, chacune avec ce qu'elle est allée
   * chercher et ce qu'elle a RÉELLEMENT consommé (`shared/src/parcours-carte.ts`).
   */
  z.object({ type: z.literal('card.parcours'), cardId: z.string() }),
  /** Tout ce que montre la page « Tableau de bord » : conso par projet, par jour, par carte. */
  z.object({ type: z.literal('stats.dashboard') }),
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
  /**
   * Projets qui attendent une réponse : le compte par projet, ET l'endroit où
   * chaque décision se prend — sans quoi la ligne du projet annoncerait un
   * chiffre que rien à l'écran ne confirme.
   */
  z.object({
    type: z.literal('attention'),
    byProject: z.record(z.number()),
    decisions: z
      .array(
        z.object({
          projectId: z.string(),
          /**
           * La conversation où la décision se prend. Absente quand elle ne
           * tient à aucun fil : l'accord avant envoi se prend dans le bloc de
           * publication du projet.
           */
          agentId: z.string().optional(),
          /** La carte concernée, quand la décision est née dans son travail. */
          cardId: z.string().optional(),
          genre: z.enum(['question', 'validation']),
          reglee: z.boolean().optional(),
          poseeA: z.number().optional(),
        }),
      )
      .default([]),
  }),
  /** Projets dont un agent a rendu son travail sans qu'on l'ait encore lu. */
  z.object({ type: z.literal('rendus'), byProject: z.record(z.number()) }),
  /**
   * Projets où un PLAN attend encore une décision (mode plan) : la colonne de
   * gauche y pose une bordure blanche et l'icône du plan, en plus des autres
   * repères — jamais à leur place.
   */
  z.object({ type: z.literal('plans'), byProject: z.record(z.boolean()) }),
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
    /** Combien d'échanges dorment derrière le dernier nouveau départ. */
    precedents: z.number().optional(),
  }),
  z.object({
    type: z.literal('card.conversation'),
    cardId: z.string(),
    messages: z.array(Message),
    /** L'agent qui reçoit les nouvelles demandes (le plus récent). */
    activeAgentId: z.string().optional(),
  }),
  z.object({ type: z.literal('message.upsert'), message: Message }),
  z.object({ type: z.literal('queue.snapshot'), agentId: z.string(), queue: z.array(QueuedPrompt) }),
  z.object({ type: z.literal('deploy.upsert'), run: DeployRun }),
  z.object({ type: z.literal('quotas'), quotas: z.array(AccountQuota) }),
  /**
   * Le catalogue des moteurs, rediffusé quand il a changé — après une
   * connexion de compte réussie, la liste des modèles doit redevenir complète
   * sans attendre le rechargement de la page.
   */
  z.object({ type: z.literal('engines'), engines: z.array(EngineInfo) }),
  /** Une connexion de compte qui avance : adresse, code, réussite ou échec. */
  z.object({ type: z.literal('connexion-compte'), connexion: ConnexionCompte }),
  z.object({ type: z.literal('capacity'), capacity: CapacitySnapshot }),
  z.object({ type: z.literal('processes'), processes: z.array(SystemProcess) }),
  z.object({
    type: z.literal('demon'),
    etat: z.object({
      demarreA: z.number(),
      construitA: z.number().optional(),
      agentsEnCours: z.number().optional(),
      publications: z.array(z.string()).optional(),
      redemarrageEnAttente: z.boolean().optional(),
      redemarrageNecessaire: z.boolean(),
    }),
  }),
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
    /** Le genre d'événement : c'est lui qui choisit l'image de l'alerte. */
    motif: z.string().optional(),
    /**
     * La phrase déjà rédigée à dire à voix haute, quand HaikoDev a pu la tirer
     * du vrai contenu de la réponse de l'agent. Absente, la voix la refabrique
     * depuis le titre. Voir `shared/src/voix-annonce.ts`.
     */
    voix: z.string().optional(),
    cardId: z.string().optional(),
    projectId: z.string().optional(),
  }),
  z.object({ type: z.literal('memory'), projectId: z.string(), content: z.string() }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;
