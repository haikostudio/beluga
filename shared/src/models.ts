import { z } from 'zod';
import { ColumnKey } from './columns.js';
import { MOYENS_VPS } from './acces-vps.js';
import { AgentContextUsage } from './contexte-agent.js';

/* ------------------------------------------------------------------ */
/* Moteurs, modèles, niveaux de réflexion                              */
/* ------------------------------------------------------------------ */

/**
 * Les moteurs branchés. « claude » et « codex » sont des OUTILS EN LIGNE DE
 * COMMANDE déjà authentifiés sur le serveur ; « cursor » est une API distante
 * (agents cloud, clé d'accès) — voir `shared/src/moteur-cursor.ts`. Un moteur
 * ajouté ici doit l'être partout où cette liste est parcourue : catalogue des
 * modèles, comptes et quotas, nom court affiché.
 */
export const EngineId = z.enum(['claude', 'codex', 'cursor']);
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
  /** Pourquoi le catalogue n'a pas pu être lu : dit à l'écran, jamais tu. */
  catalogError: z.string().optional(),
  fetchedAt: z.number().optional(),
});
export type EngineInfo = z.infer<typeof EngineInfo>;

export const RunConfig = z.object({
  engine: EngineId.default('claude'),
  model: z.string().optional(),
  thinking: ThinkingLevel.default('none'),
  mode: z.enum(['direct', 'plan']).default('direct'),
  /**
   * Le PALIER choisi par le chef d'orchestre (`shared/src/niveau-agent.ts`) :
   * léger, standard ou approfondi. Le modèle et la réflexion ci-dessus en
   * découlent, mais restent modifiables à la main — c'est pourquoi le palier est
   * retenu à part, comme une intention, jamais comme un réglage de plus.
   */
  niveau: z.enum(['leger', 'standard', 'approfondi']).optional(),
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
  /**
   * LA SOURCE DONT CE PROJET HÉRITE ses règles, quand il n'a rien écrit sur un
   * sujet (`cibleDHeritage`, `shared/src/arbre-memoire.ts`). Clé ABSENTE = la
   * plateforme HaikoDev, comme avant ce réglage ; `HERITAGE_AUCUN` = ce projet
   * n'hérite de rien ; sinon, l'identifiant du projet qui fait foi.
   */
  heriteDe: z.string().optional(),
  /**
   * L'adresse de l'INSTANCE DE DEV de ce projet sur ce serveur : la seule chose
   * que le déploiement demande encore de régler. Elle est contrôlée à la fin du
   * déploiement — une adresse qui ne répond pas fait échouer le run. Vide :
   * aucun contrôle d'adresse, le reste du déroulé ne change pas.
   */
  devUrl: z.string().optional(),
  /**
   * L'ICÔNE DE SITE trouvée sur `devUrl`, récupérée par le SERVEUR (le
   * navigateur n'y arrive pas — trop souvent bloqué). Chemin d'une route
   * servie par le démon (`/api/favicon?project=<id>`), jamais une adresse
   * externe : absent = pas encore essayé, ou aucune icône trouvée — l'écran
   * retombe alors sur les initiales du projet.
   */
  favicon: z.string().optional(),
  /**
   * LES BRANCHES DE MISE EN LIGNE de ce projet, une par étape : celle où le
   * DÉPLOIEMENT vers l'instance de dev fusionne son lot, celle où la MISE EN
   * PRODUCTION fusionne le sien. Les règles vivent dans
   * `branche-de-publication.ts`. Clé absente = rien de réglé : le déploiement
   * retombe sur la branche « dev » du dépôt quand elle existe, sinon sur la
   * branche principale constatée — et la mise en production sur la principale,
   * exactement comme avant ce réglage.
   */
  branchesDePublication: z
    .object({ dev: z.string().optional(), production: z.string().optional() })
    .default({}),
  /**
   * LA MISE EN PRODUCTION de ce projet, réglée dans ses paramètres : la BASE
   * écrite à la main par l'utilisateur (le concept dans ses mots) et le PROMPT
   * que l'agent de mise en production reçoit. Les règles vivent dans
   * `mise-en-production.ts`. Une clé absente est un état NORMAL : la
   * publication retombe alors sur les moyens que HaikoDev sait deviner.
   */
  /**
   * LA PROCÉDURE DE DÉPLOIEMENT de ce projet, définie depuis la tête de la
   * colonne « À déployer » par un agent (`procedure-publication.ts`). Clé
   * absente = AUCUNE procédure : le projet est neuf, la colonne propose de
   * l'initier et rien ne part. `constate: true` est le marqueur des projets
   * déjà inscrits (migration 22) — ils gardent le déroulé constaté d'avant.
   */
  deploiement: z
    .object({
      base: z.string().optional(),
      prompt: z.string().optional(),
      constate: z.boolean().optional(),
    })
    .default({}),
  miseEnProduction: z
    .object({
      base: z.string().optional(),
      prompt: z.string().optional(),
      /**
       * LE TYPE DE CIBLE de la mise en production (`cible-mise-en-production.ts`) :
       * absent = `consigne`, le fonctionnement d'avant ce réglage, intact.
       */
      type: z.enum(['aucune', 'ssh', 'ftp', 'consigne']).optional(),
      ssh: z
        .object({
          hote: z.string().optional(),
          port: z.number().optional(),
          utilisateur: z.string().optional(),
          motDePasse: z.string().optional(),
          cle: z.string().optional(),
          dossierDistant: z.string().optional(),
          dossierConstruit: z.string().optional(),
          commandeFin: z.string().optional(),
        })
        .optional(),
      ftp: z
        .object({
          hote: z.string().optional(),
          port: z.number().optional(),
          utilisateur: z.string().optional(),
          motDePasse: z.string().optional(),
          dossierDistant: z.string().optional(),
          dossierConstruit: z.string().optional(),
          securise: z.boolean().optional(),
        })
        .optional(),
      /** L'adresse publique à contrôler après un transfert SSH ou FTP. */
      prodUrl: z.string().optional(),
    })
    .default({}),
  /**
   * LE DÉPLOIEMENT AUTOMATIQUE, commandé par l'interrupteur posé en tête de la
   * colonne « Terminé ». ÉTEINT par défaut, et pour tous les projets déjà
   * inscrits : rien ne change tant que l'utilisateur ne l'allume pas lui-même.
   * Allumé, il vaut consentement permanent pour CE projet — les règles de
   * déclenchement vivent dans `deploiement-automatique.ts`.
   */
  deploiementAutomatique: z.boolean().default(false),
  billing: BillingLink.optional(),
  /**
   * Dernière fois que ce projet a été OUVERT depuis la colonne de gauche —
   * sert uniquement à éteindre le point bleu de travail terminé
   * (`shared/src/signal-projet.ts`) sans toucher au repère de lecture des
   * cartes, qui reste un geste à part (`project.read`).
   */
  lastVisitedAt: z.number().optional(),
  /**
   * LE THÈME PROPRE À CE PROJET (`shared/src/themes.ts`). Réglé, il IMPOSE son
   * apparence à TOUTE l'application dès que le projet est ouvert : on reconnaît
   * d'un coup d'œil où l'on travaille. ABSENT ou `null`, le projet suit le
   * réglage général — d'où le `nullish` et non un simple `optional` : c'est
   * `null` qui permet de RETIRER un thème déjà posé, `undefined` disparaissant
   * du bloc envoyé au serveur.
   */
  theme: z.string().nullish(),
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

export const ContextBreakdown = z.object({
  status: z.enum(['measured', 'unavailable']),
  /** Grandeur exacte disponible avant l'appel moteur : des signes, pas des jetons estimés. */
  characters: z.number().int().nonnegative().optional(),
  note: z.string(),
});
export type ContextBreakdown = z.infer<typeof ContextBreakdown>;

export const AnalysisMeasurement = z.object({
  /** Entrée hors partie déjà en cache. */
  inputTokens: z.number().nonnegative(),
  cachedInputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative(),
  /** Absent si le moteur n'a pas communiqué le cache : aucun faux total exact. */
  totalTokens: z.number().nonnegative().optional(),
  /** Points de pourcentage réellement consommés dans chaque fenêtre. */
  quota5h: z.number().nonnegative().optional(),
  quotaWeekly: z.number().nonnegative().optional(),
  breakdown: z.object({
    haikoDevInstructions: ContextBreakdown,
    cardDescription: ContextBreakdown,
    memoryAndInstructions: ContextBreakdown,
    agentReads: ContextBreakdown,
  }),
  measuredAt: z.number(),
});
export type AnalysisMeasurement = z.infer<typeof AnalysisMeasurement>;

export const ExecutionProjection = z.object({
  tokens: z.number().nonnegative().optional(),
  quotaShare: z.number().nonnegative().optional(),
  formula: z.string().optional(),
  assumptions: z.array(z.string()).default([]),
});
export type ExecutionProjection = z.infer<typeof ExecutionProjection>;

/** Données internes du tour, produites par HaikoDev et jamais par le texte de l'agent. */
export interface TurnMeasurement {
  usage: { inputTokens: number; cachedInputTokens?: number; outputTokens: number };
  quota: { quota5h?: number; quotaWeekly?: number };
  composition: {
    promptCharacters: number;
    systemPromptCharacters: number;
    cardDescriptionCharacters: number;
    memoryAndInstructionsCharacters: number;
  };
}

export const Estimate = z.object({
  /** Durée machine prévue, en secondes. Sert à l'ordonnanceur, JAMAIS à la facture. */
  machineSeconds: z.number().optional(),
  tokens: z.number().optional(),
  quotaShare: z.number().optional(),
  /** Projection future rédigée par l'analyse, avec sa formule et ses hypothèses. */
  projection: ExecutionProjection.optional(),
  /** Coût déjà consommé par le chiffrage, mesuré indépendamment du JSON de l'agent. */
  analysisMeasurement: AnalysisMeasurement.optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  summary: z.string().optional(),
  /** Heures qu'un développeur senior facturerait à la main. Sert à la facture. */
  seniorHours: z.number().optional(),
  billingTitle: z.string().optional(),
  billingDescription: z.string().optional(),
  /** Texte simple et ludique pour le CLIENT, sans jargon ni nom de fichier. Voyage jusqu'au devis/facture. */
  clientExplanation: z.string().optional(),
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
  clientExplanation: z.string().optional(),
  hours: z.number().optional(),
  amount: z.number().optional(),
  addedAt: z.number(),
});
export type BillingLine = z.infer<typeof BillingLine>;

export const GithubTracking = z.object({
  branch: z.string().optional(),
  /**
   * LE POINT DE DÉPART DE LA BRANCHE, retenu à sa création. C'est lui qui rend
   * l'onglet « GitHub » honnête : tout ce qui vient AVANT appartient au dépôt,
   * pas à la carte. Sans lui — cartes d'avant cette règle —, il est retrouvé au
   * relevé (`baseDeLaBranche`, `server/src/github.ts`), y compris après la
   * fusion, où la principale contient déjà la branche.
   */
  baseSha: z.string().optional(),
  /** La branche dans laquelle celle de la carte doit rejoindre. */
  branchePrincipale: z.string().optional(),
  /** Le premier enregistrement de la branche : sa date de naissance réelle. */
  creeLe: z.string().optional(),
  /** Vrai quand la branche a déjà rejoint la principale. */
  fusionnee: z.boolean().optional(),
  /** Les fichiers touchés par la branche, depuis son point de départ. */
  fichiers: z
    .array(
      z.object({
        chemin: z.string(),
        etat: z.enum(['ajoute', 'modifie', 'supprime', 'renomme']),
        /** Lignes ajoutées / supprimées, comme git. Absentes sur un binaire. */
        ajoutees: z.number().optional(),
        supprimees: z.number().optional(),
      }),
    )
    .default([]),
  prNumber: z.number().optional(),
  prTitle: z.string().optional(),
  prState: z.enum(['open', 'merged', 'closed']).optional(),
  prUrl: z.string().optional(),
  checks: z
    .array(z.object({ name: z.string(), status: z.string(), conclusion: z.string().optional() }))
    .default([]),
  reviewDecision: z.string().optional(),
  mergeable: z.string().optional(),
  /**
   * Les enregistrements DE LA BRANCHE — ceux faits depuis `baseSha`, jamais
   * l'historique général du dépôt.
   */
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
  /**
   * La carte a été SUSPENDUE à la main (sortie de « En cours » vers
   * « Planifié »). Elle reste en file et visible, mais l'ordonnanceur ne la
   * reprend pas tout seul : suspendre puis voir repartir quinze secondes plus
   * tard ne serait pas suspendre. Le prochain départ est un geste, et ce geste
   * efface la marque.
   */
  suspendu: z.boolean().optional(),
  /**
   * LE LANCEMENT A ÉTÉ DEMANDÉ, MAIS UNE PORTE QUI SE ROUVRE SEULE L'A REFUSÉ —
   * plus un compte avec du quota, plus de place sur la machine
   * (`portesDures`). Le geste a bien eu lieu : il ne doit pas être perdu parce
   * que l'obstacle était passager.
   *
   * Sans cette marque, une carte lancée pour la PREMIÈRE fois et refusée pour
   * cause de quota restait dans « Planifié » avec sa phrase d'attente, et rien
   * ne la reprenait jamais : `demarrageAutomatiqueAutorise` ne rend « oui »
   * qu'à une carte « Dès que possible », datée, ou DÉJÀ partie une fois
   * (`attempts > 0`) — or ce départ-là n'a pas eu lieu. Elle attendait donc un
   * second clic que personne ne savait devoir donner.
   *
   * La marque autorise la reprise automatique, et rien d'autre : elle
   * s'efface au vrai départ, comme au premier geste d'arrêt.
   */
  reprendreDesQuePossible: z.boolean().optional(),
  /**
   * La DATE de départ souhaitée, en millisecondes. Tant qu'elle n'est pas
   * venue, la carte attend dans « Planifié » ; à l'heure dite, l'ordonnanceur
   * la lance par le même chemin que le bouton. Le départ EFFACE la date : une
   * date, une fois, jamais une récurrence (`shared/src/depart-programme.ts`).
   */
  departPrevu: z.number().optional(),
  /**
   * LE CRÉNEAU CONSEILLÉ, calculé par le démon à la création de la carte et
   * sans le moindre appel de moteur (`shared/src/heure-de-lancement.ts`). Il ne
   * décide de rien : il DIT quand il serait opportun de partir, pour qu'un
   * tableau de cinq cartes en attente n'oblige plus à deviner.
   *
   * On garde une PLAGE et ses raisons, jamais une date ni une phrase : rien de
   * ce qui est écrit ici ne dépend de l'heure du calcul, sinon une carte créée
   * en pleine nuit répéterait « c'est le bon moment » tout le lendemain. Le
   * moment réel se recalcule à l'affichage. Il reste sur la carte même une
   * fois `creneauAutomatique` posé : c'est lui qui explique la date retenue.
   */
  creneauConseille: z
    .object({
      source: z.enum(['creux-mesure', 'heures-creuses']),
      heureDebut: z.number(),
      heureFin: z.number(),
      lourde: z.boolean().optional(),
      pasAvant: z.number().optional(),
    })
    .optional(),
  /**
   * `departPrevu` vient-il du créneau conseillé, posé tout seul à la
   * naissance de la carte — plutôt que d'une date choisie à la main ? Ce
   * drapeau ne change rien à l'ordonnancement (une date reste une date, quelle
   * que soit son origine) : il ne sert qu'à l'écran, pour expliquer d'où vient
   * l'heure affichée. Tout geste de l'utilisateur sur `card.schedule` —
   * changer la date ou la retirer — l'efface : la carte a alors sa propre
   * réponse, qui n'a plus besoin d'être expliquée.
   */
  creneauAutomatique: z.boolean().optional(),
  /**
   * L'instant où un tour d'EXÉCUTION a pris cette carte en main, retiré quand
   * ce tour a fini de tout ranger (dépôt constaté, branche fusionnée, colonne
   * posée). Une marque encore là au démarrage du démon désigne une tâche coupée
   * en vol : aucun moteur ne survit à un arrêt du serveur
   * (`shared/src/carte-interrompue.ts`).
   */
  tourEnVolDepuis: z.number().optional(),
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
  /**
   * Les images jointes au message d'où vient la carte (par le chef d'orchestre).
   * Conservées ici pour être listées dans le bloc « PIÈCES JOINTES » du prompt
   * au lancement de la tâche, sans que l'utilisateur ait à les redéposer.
   */
  attachments: z.array(z.string()).default([]),
  run: RunConfig,
  estimate: Estimate.optional(),
  /**
   * L'utilisateur a VALIDÉ la carte : la dépense est autorisée. La carte ne
   * bouge pas — elle naît et reste dans « Planifié » (il n'y a plus de colonne
   * « Validé » ni de colonne « À faire ») et porte ce drapeau. Il ne déclenche
   * plus aucun tour de moteur : le chiffrage est rendu par l'agent d'exécution,
   * au lancement. Le drapeau garde la trace du geste — c'est lui qui retire le
   * bouton « Valider » d'une carte déjà autorisée — et il est une VRAIE colonne
   * SQL (`analyse_demandee`).
   */
  analyseDemandee: z.boolean().default(false),
  /**
   * Relais court préparé par le chef d'orchestre pendant la proposition.
   * L'agent d'exécution le reçoit à son premier tour : il repart des constats
   * déjà faits sans ouvrir un second tour de chiffrage identique.
   */
  analysisContext: z.string().optional(),
  /**
   * L'agent qui a PROPOSÉ cette carte (le chef d'orchestre), et le moment de sa
   * proposition. Sans ce lien, la première étape du parcours d'une tâche — le
   * tri — ne pouvait porter aucune mesure : le tour du chef vit dans SA
   * conversation, sans `cardId`. Le couple permet de retrouver, dans la table
   * `usage`, le tour de CET agent qui a produit CETTE carte
   * (`shared/src/parcours-carte.ts`). Il ne sert qu'à lire, jamais à décider.
   */
  origineAgentId: z.string().optional(),
  origineAt: z.number().optional(),
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
  /**
   * La carte a-t-elle DÉJÀ produit et enregistré du code au cours de sa vie ?
   * Posé dès qu'un tour d'exécution modifie le dépôt (ou qu'on relance une carte
   * déjà passée par « Terminé »/« À déployer »), il ne s'efface jamais. C'est lui
   * qui distingue une carte neuve stérile d'une carte aboutie à qui l'on donne une
   * simple suite : la note « aucun fichier n'a changé » ne concerne que la
   * première. À la différence de `doneAt`, il SURVIT à un relancement.
   */
  codeDejaEnregistre: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number(),
  doneAt: z.number().optional(),
  /** Ce qui dit qu'une carte est publiée, c'est cette date — jamais sa colonne (PLAN §4). */
  deployedAt: z.number().optional(),
  /**
   * Quand la carte a été archivée. La date RESTE quand on l'en ressort : c'est
   * elle qui permet de lire, plus tard, qu'elle était passée par « Archivé » et
   * quand. Elle ne dit donc pas la colonne actuelle, seulement le passage.
   */
  archivedAt: z.number().optional(),
});
export type Card = z.infer<typeof Card>;

/* ------------------------------------------------------------------ */
/* Agents & conversations                                              */
/* ------------------------------------------------------------------ */

export const AgentRole = z.enum(['task', 'orchestrator', 'analysis', 'deploy']);
export type AgentRole = z.infer<typeof AgentRole>;

export const AgentStatus = z.enum(['idle', 'starting', 'running', 'stopped', 'failed', 'done']);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentContext = z.object({
  /** Jetons réellement présents dans le dernier appel au modèle. */
  tokens: z.number().nonnegative(),
  /** Capacité du modèle qui porte cette session. */
  window: z.number().positive(),
  ratio: z.number().nonnegative(),
  armed: z.boolean().default(true),
  pending: z.boolean().default(false),
  lastCompressionAt: z.number().optional(),
  lastCompressionTokens: z.number().nonnegative().optional(),
  lastCompressionMethod: z.enum(['native', 'summary']).optional(),
  compressionCount: z.number().int().nonnegative().optional(),
  continuitySummary: z.string().optional(),
});
export type AgentContext = z.infer<typeof AgentContext>;

export const Agent = z.object({
  id: z.string(),
  projectId: z.string(),
  cardId: z.string().optional(),
  role: AgentRole,
  title: z.string(),
  run: RunConfig,
  /**
   * Le dossier où cet agent travaille, quand ce n'est pas celui du projet : une
   * carte lancée reçoit une copie de travail à elle (`git worktree`), pour que
   * plusieurs cartes du même projet puissent tourner en même temps.
   */
  workdir: z.string().optional(),
  status: AgentStatus,
  account: z.string().optional(),
  /**
   * L'avancement de la liste de tâches de l'agent, tel qu'il voyage avec lui
   * jusqu'au tableau : combien d'étapes cochées sur le total. Les étapes
   * elles-mêmes vivent sur les messages (souvent chargés seulement à
   * l'ouverture d'une carte) ; ce résumé, lui, suit l'agent partout et permet
   * d'afficher « n/N faites » dans le décroché d'une carte sans l'ouvrir.
   *
   * Refait à la CLÔTURE du tour depuis la liste refermée (`progressionDesTaches`),
   * et non plus seulement à chaque liste renvoyée par le moteur : sinon la carte
   * gardait l'avant-dernier décompte à vie. `unfinished` compte les étapes qui
   * n'ont pas été menées à bout, pour que la carte le dise.
   */
  todos: z
    .object({
      done: z.number().int(),
      total: z.number().int(),
      unfinished: z.number().int().optional(),
    })
    .optional(),
  /**
   * Le libellé de la todo ou de l'étape « en cours » au moment présent, posé
   * en MÊME TEMPS que `todos` — pour que le tableau puisse afficher « quoi »
   * sans charger les messages de la conversation. Vide dès que plus aucune
   * étape n'est active (tour clos, ou aucune liste encore annoncée).
   */
  etapeEnCours: z.string().optional(),
  /**
   * L'agent est ARRÊTÉ SUR UNE QUESTION : son appel d'outil `ask_user` n'a pas
   * encore répondu, donc le moteur ne fait rien d'autre en attendant
   * (`shared/src/attente-question.ts`). Le drapeau ne sert qu'à l'affichage —
   * la barre d'écriture dit « l'agent attend votre réponse » au lieu de
   * « l'agent travaille — votre message attendra son tour ». Posé et retiré
   * par le seul registre des attentes, jamais deviné ailleurs ; aucun moteur
   * ne survivant à un redémarrage, il est effacé au démarrage.
   */
  attendReponse: z.boolean().optional(),
  /**
   * L'INSTANT OÙ LE TOUR EN COURS A ÉTÉ LANCÉ — présent tant que ce tour vit,
   * effacé dès qu'il se referme, quelle qu'en soit la façon.
   *
   * C'est le signal le plus DIRECT du travail : un agent travaille aussi quand
   * il enchaîne des commandes sans écrire une ligne, et ni le statut enregistré
   * ni la marque d'écriture d'un message ne le disent alors (le message est
   * figé dès la réponse rendue, et le statut retombe à « terminé » avant que le
   * démon n'ait fini de ranger le tour). Le témoin de travail le lit en premier
   * (`shared/src/travail-en-cours.ts`). Aucun moteur ne survivant à un
   * redémarrage, il est effacé au démarrage comme `attendReponse`.
   */
  tourVivantDepuis: z.number().optional(),
  /** Mesure courante du contexte ; absente tant que le moteur n'en a pas donné une vraie. */
  contextUsage: AgentContextUsage.optional(),
  /** Remplissage du contexte du modèle, distinct des quotas du compte. */
  context: AgentContext.optional(),
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
  /**
   * QUATRE ÉTATS, dont un qui n'existe qu'À LA FIN D'UN TOUR. Les moteurs n'en
   * annoncent que trois — à faire, en cours, cochée. Le quatrième, `unfinished`
   * (« non faite »), n'est jamais posé par un moteur : c'est le démon qui le
   * pose en refermant le tour, sur les lignes que personne n'a menées à bout
   * (`cloturerLesTaches`, `taches-fin-de-tour.ts`). Sans lui, une ligne restait
   * « en cours » pour toujours sur une carte pourtant terminée.
   */
  state: z.enum(['todo', 'running', 'done', 'unfinished']).default('todo'),
  /** Début et fin de la ligne : elle affiche son temps, comme une étape. */
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  /**
   * Cochée par le DÉMON en refermant le tour, faute d'un dernier mot du moteur
   * — et non par le moteur lui-même. L'interface le dit au survol : la ligne
   * est comptée faite, mais on ne prétend pas que l'agent l'a confirmée.
   */
  closedByTurnEnd: z.boolean().optional(),
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
  /**
   * Les images jointes au message qui a fait naître cette proposition. Elles
   * suivent la carte jusqu'à l'agent d'exécution, listées dans son bloc
   * « PIÈCES JOINTES ». On ne prend QUE le message déclencheur, jamais tout le
   * fil de la conversation.
   */
  attachments: z.array(z.string()).default([]),
  /** Chiffrage futur préparé pendant le tour qui propose la carte. */
  estimate: Estimate.optional(),
  /**
   * La date de départ souhaitée, en millisecondes, quand le chef en propose une
   * (« cette carte partira mardi à 6 h »). Recopiée sur la carte à la
   * validation ; sans elle, la carte attend le geste de lancement, comme avant.
   */
  departPrevu: z.number().optional(),
  /** Faits, choix et contrôles déjà établis, transmis à l'agent d'exécution. */
  analysisContext: z.string().optional(),
  /**
   * Ce qui cloche dans les réglages proposés — moteur absent, aucun compte
   * disponible — écrit en toutes lettres sur la proposition. On ne bascule
   * jamais de moteur en silence.
   */
  avertissement: z.string().optional(),
  /**
   * Décision mémorisée. « merged » distingue une proposition réunie dans une
   * autre d'un refus : elle reste dans l'historique, mais ne réclame plus de
   * clic et n'a créé aucune carte.
   */
  decision: z.enum(['pending', 'accepted', 'refused', 'merged']).default('pending'),
  /** Proposition nouvelle dans laquelle cette source a été réunie. */
  mergedInto: z.string().optional(),
  /** Sources directes d'une proposition composée, pour garder toute la trace. */
  sourceProposalIds: z.array(z.string()).default([]),
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
  /** Les images jointes à la réponse, affichées à côté d'elle une fois donnée. */
  answerAttachments: z.array(z.string()).default([]),
  answeredAt: z.number().optional(),
  /** Fermée sans réponse (bouton « Annuler ») : n'attend plus, ne relance pas l'agent. */
  cancelled: z.boolean().default(false),
});
export type AgentQuestion = z.infer<typeof AgentQuestion>;

/**
 * UN TOUR COUPÉ PAR LA LIMITE D'UN COMPTE. Le travail n'est pas cassé : il lui
 * manque du quota. Le message porte alors cette décision — « Avec quel compte
 * poursuivre ? » — au lieu d'un échec ordinaire, et le travail reprend au clic,
 * avec le même agent, le même fil et la même branche.
 *
 * Les comptes proposés ne sont PAS recopiés ici : l'interface les lit dans le
 * relevé de quota qu'elle reçoit déjà, si bien que la liste se rafraîchit toute
 * seule quand un compte se libère. Ne vit ici que ce qui ne peut pas se
 * recalculer : ce qui est tombé, et ce qui a été choisi.
 */
export const RepriseDeCompte = z.object({
  /** Le moteur du tour arrêté : on ne propose jamais les comptes d'un autre. */
  engine: EngineId,
  /** Le compte qui a atteint sa limite. */
  compteEpuise: z.string(),
  compteEpuiseLabel: z.string(),
  /** Quand ce compte se remet à zéro, quand on le sait. */
  resetsAt: z.number().optional(),
  /** Comment l'arrêt a été reconnu : événement du moteur, ou texte de limite. */
  motif: z.enum(['limite-structuree', 'texte-de-limite']),
  /** Le compte retenu au clic. Posé une fois, il ferme la décision pour de bon. */
  choisi: z.string().optional(),
  choisiLabel: z.string().optional(),
  choisiA: z.number().optional(),
  at: z.number(),
});
export type RepriseDeCompte = z.infer<typeof RepriseDeCompte>;

export const DownloadOffer = z.object({
  id: z.string(),
  label: z.string(),
  size: z.number().optional(),
  expiresAt: z.number(),
});
export type DownloadOffer = z.infer<typeof DownloadOffer>;

/** Une part du contenu assemblé par HaikoDev pour ce tour. */
export const SentContextBlock = z.object({
  kind: z.enum(['request', 'briefing', 'memory', 'card', 'attachment', 'extra', 'format', 'system']),
  label: z.string(),
  characters: z.number().int().nonnegative(),
  /**
   * Le texte réel de ce bloc, tel qu'envoyé au moteur — c'est ce que lit le
   * lecteur de prompts. Absent quand un texte purgé pour borner le disque
   * (`purgerContexteEnvoyeAncien`), ou quand le bloc n'est pas isolable en
   * clair (gabarit HaikoDev réparti dans le prompt).
   */
  text: z.string().optional(),
  /**
   * Vrai quand ce bloc est repris IDENTIQUE du tour précédent — le préfixe
   * stable du moteur (`enteteDuTour`), relu au cache plutôt que renvoyé neuf.
   * Faux par défaut : un bloc de contenu propre à ce tour n'est jamais en cache.
   */
  cached: z.boolean().optional(),
  /**
   * D'OÙ VIENT CE BLOC — la question que le tiroir « Contexte envoyé » doit
   * savoir répondre : ce qu'on paie vient-il de ce PROJET, ou du socle de la
   * PLATEFORME qui serait le même partout ?
   *
   * Absent sur les tours enregistrés AVANT ce partage : `origineDuBloc` retombe
   * alors sur le genre du bloc, ce qui reste juste pour l'essentiel et n'invente
   * rien. On ne réécrit pas l'histoire d'une conversation.
   */
  origine: z.enum(['plateforme', 'projet', 'demande']).optional(),
});
export type SentContextBlock = z.infer<typeof SentContextBlock>;

/**
 * Un passage de documentation remonté par la recherche (`passages-doc.ts`) :
 * son fichier, son titre, sa pertinence et son coût en jetons. C'est ce qui
 * rend le RETROUVÉ visible — dans le tiroir du contexte envoyé comme dans le
 * détail de la carte.
 */
export const PassageRetrouve = z.object({
  source: z.string(),
  titre: z.string().default(''),
  /** Le score mixte (sens + mots exacts), entre 0 et 1 environ. */
  score: z.number(),
  tokens: z.number().int().nonnegative(),
  /** Le texte du passage tel qu'il a été envoyé au moteur, en clair. */
  texte: z.string().default(''),
});
export type PassageRetrouve = z.infer<typeof PassageRetrouve>;

/**
 * Une ouverture de l'arbre de mémoire faite par l'agent pendant un tour.
 *
 * La carte de l'arbre fait partie du prompt initial (`blocks`, genre
 * `memory`). Les ouvertures suivantes arrivent par l'outil `project_memory`,
 * APRÈS cet envoi : il faut donc les garder à part, dans l'ordre, avec le
 * texte exact rendu. Sans cette trace, l'écran ne connaît que les noms de
 * sujets demandés et ne peut pas montrer ce qui a réellement circulé.
 */
export const ConsultationMemoire = z.object({
  id: z.string(),
  /** Le sujet ou le mot de branche demandé ; vide signifie l'index. */
  requete: z.string().default(''),
  /** Le texte exact rendu par `project_memory`, avant toute reformulation. */
  resultat: z.string().default(''),
  /** Un refus reste une étape du parcours, avec son explication en clair. */
  reussie: z.boolean().default(true),
  at: z.number(),
});
export type ConsultationMemoire = z.infer<typeof ConsultationMemoire>;

/**
 * Photographie du SEUL contenu transmis pendant ce tour. L'historique d'une
 * session reprise reste chez le moteur : on le nomme, sans le recopier ni
 * prétendre pouvoir le relire.
 */
export const SentContextSnapshot = z.object({
  engine: EngineId,
  model: z.string().optional(),
  session: z.enum(['new', 'resumed']),
  prompt: z.string(),
  systemInstruction: z.object({
    kind: z.enum(['full', 'reminder']),
    content: z.string(),
    transport: z.enum(['separate', 'prefixed']),
  }),
  blocks: z.array(SentContextBlock),
  /**
   * Les PASSAGES de documentation retrouvés par recherche pour ce tour, quand
   * ils ont remplacé l'index de la mémoire. Chacun dit d'où il vient, à quel
   * point il répondait à la demande, et ce qu'il a coûté — un contexte remonté
   * automatiquement doit rester vérifiable. Vide quand l'index a servi tel quel.
   */
  passages: z.array(PassageRetrouve).default([]),
  /**
   * Pourquoi `passages` est vide — dit en clair plutôt que laissé à zéro sans
   * explication : reprise de session, accueil sans mémoire, ou recherche
   * retombée sur l'index complet (rien au-dessus du seuil, ou trop cher).
   * Absent quand `passages` n'est pas vide.
   */
  passagesRaison: z.string().optional(),
  /**
   * COMMENT la recherche a classé : par le SENS (vrais vecteurs) ou par les
   * MOTS (l'empreinte de repli), et quelle part de la documentation du projet
   * était prête au moment du tour.
   *
   * Sans cette information, un repli sur les mots était INVISIBLE : la bulle
   * montrait des passages médiocres sans dire qu'ils avaient été choisis à
   * l'ancienne, et rien à l'écran ne permettait de s'en apercevoir. C'est
   * exactement ce qui a duré des jours sur HaikoDev, dont la couverture était
   * retombée à 53 % sans que personne ne le voie.
   */
  passagesMode: z
    .object({
      /** Vrai quand le classement s'est fait sur de vrais vecteurs de sens. */
      sens: z.boolean(),
      /** La part de la documentation du projet réellement préparée, de 0 à 1. */
      couverture: z.number().min(0).max(1),
      /** Dit en clair pourquoi on est resté sur les mots. */
      raison: z.string().optional(),
      /**
       * Vrai quand les mots sont le RÉGLAGE VOULU de ce terrain, faux quand ils
       * sont un repli. Sans cette nuance, un lancement de carte afficherait
       * « par les MOTS · 99 % de la documentation préparée » — la phrase même de
       * la panne de couverture, sur un tour parfaitement sain.
       */
      choisi: z.boolean().optional(),
    })
    .optional(),
  /**
   * LA RECHERCHE A-T-ELLE TROUVÉ QUELQUE CHOSE DE CONVAINCANT ?
   *
   * La bulle « Mémoire transmise » disait le NOMBRE de passages, le MODE et la
   * COUVERTURE — jamais la QUALITÉ du résultat. Mesuré sur 120 cartes réelles
   * (`docs/audit-memoire-rag.md`) : 34 % des demandes reçoivent le même volume
   * de passages sans qu'aucun ne se détache vraiment du reste — rien à
   * l'écran ne le distinguait des 66 % qui tombaient juste. Ce champ compare
   * le score du mieux placé à la moyenne du reste du corpus classé pour cette
   * question (`rechercheConvaincante`, shared/src/passages-doc.ts) — jamais un
   * changement de classement, de seuil ou de plafond. `undefined` quand la
   * comparaison n'a pas été faite (pas de recherche, ou contexte écrit avant
   * cette règle).
   */
  passagesPertinents: z.boolean().optional(),
  /**
   * Les ouvertures de mémoire faites APRÈS le prompt initial, pendant ce tour.
   * Vide sur les anciens messages et sur un tour qui s'est contenté de la
   * carte reçue au départ.
   */
  consultationsMemoire: z.array(ConsultationMemoire).optional(),
  history: z.enum(['none', 'retained_by_engine']),
  usage: z
    .object({
      /** Entrée nouvelle, hors cache relu. */
      inputTokens: z.number().nonnegative(),
      /** Absent si le moteur ne communique pas ce détail. */
      cachedInputTokens: z.number().nonnegative().optional(),
    })
    .optional(),
  sentAt: z.number(),
});
export type SentContextSnapshot = z.infer<typeof SentContextSnapshot>;

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
  /** Ce tour a été coupé par la limite d'un compte : sur lequel poursuivre ? */
  repriseCompte: RepriseDeCompte.optional(),
  downloads: z.array(DownloadOffer).default([]),
  attachments: z.array(z.string()).default([]),
  /** Vrai tant que l'agent écrit encore ce message. */
  streaming: z.boolean().default(false),
  /** Vrai quand ce message a été écrit en mode plan (RunConfig.mode) : l'interface le montre dans un cadre dédié. */
  plan: z.boolean().default(false),
  /**
   * Jetons associés au message : le poids ESTIMÉ de ce message précis sur une
   * demande (`jetonsMessageEnvoye`, jamais le cumul du tour agentique qui a
   * suivi), le total RÉEL du tour sur la réponse.
   */
  tokens: z.number().optional(),
  /** Ce que HaikoDev a réellement transmis pour cette demande utilisateur. */
  sentContext: SentContextSnapshot.optional(),
  durationMs: z.number().optional(),
  /**
   * LE RANGEMENT D'APRÈS-RÉPONSE, en millisecondes : le temps passé entre la
   * réponse figée et la fermeture réelle du tour — compression du fil, constat
   * du dépôt, dossier de carte refermé et branche fusionnée. Ce travail-là ne
   * se voyait nulle part : la conversation semblait finie, et l'agent tenait
   * pourtant encore son tour. Écrit une seule fois, à la fermeture ; absent sur
   * un tour d'avant cette règle, ou refermé d'autorité.
   */
  rangementMs: z.number().optional(),
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
  /** Durée annoncée par le moteur, pour éviter d'inventer un libellé. */
  durationSeconds: z.number().positive().optional(),
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
  /**
   * Compte COUPÉ à la main depuis le volet Quotas : il reste dans la liste,
   * éteint, mais l'ordonnanceur ne le choisit plus et sa fenêtre de 5 h n'est
   * plus amorcée. Distinct d'`available`, qui dit un quota épuisé.
   */
  disabled: z.boolean().optional(),
  session: QuotaWindow.optional(),
  weekly: QuotaWindow.optional(),
  /**
   * CRÉDIT CURSOR : un montant demandé à Cursor, jamais un pourcentage de
   * fenêtre. Absent sur Claude et Codex. Sans droit de lecture, `indisponible`
   * porte la raison — jamais un zéro.
   */
  credit: z
    .object({
      centimes: z.number().optional(),
      debutDuCycle: z.number().optional(),
      membres: z.number().optional(),
      indisponible: z.string().optional(),
    })
    .optional(),
  /**
   * USAGE MESURÉ ICI pour ce compte (tours et durée), distinct du montant
   * Cursor. Sert à dire ce qui a été consommé même quand le crédit d'équipe
   * n'est pas lisible.
   */
  usageLocal: z
    .object({
      seconds: z.number(),
      tours: z.number(),
    })
    .optional(),
  error: z.string().optional(),
  fetchedAt: z.number().optional(),
  /**
   * La dernière amorce de fenêtre posée par le serveur sur ce compte. Elle
   * prouve, depuis l'écran, que le décompte a été lancé en arrière-plan et non
   * par l'ouverture de l'application.
   */
  derniereAmorce: z.object({ at: z.number(), ok: z.boolean(), error: z.string().optional() }).optional(),
  /**
   * L'état RÉEL de la connexion du compte (règle pure `etatDeConnexion`) : un
   * quota intact ne prouve pas qu'un jeton tient encore.
   */
  connexion: z
    .object({
      etat: z.enum(['valide', 'absente', 'expiree', 'refusee', 'inconnue']),
      libelle: z.string(),
      doitReconnecter: z.boolean(),
    })
    .optional(),
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
  /**
   * La charge moyenne des QUINZE dernières minutes. C'est elle qui dit si la
   * machine est vraiment prise : une pointe d'une minute passe 200 % dès qu'une
   * construction démarre, sans rien saturer.
   */
  cpuLoadSustainedPct: z.number().optional(),
  memUsedMb: z.number(),
  memTotalMb: z.number(),
  cpuCount: z.number(),
  runningAgents: z.number(),
  /**
   * Ceux qui portent une CARTE du tableau. Le compte total mélange le chef
   * d'orchestre, l'analyse de nuit et la publication, qui ne s'affichent sur
   * aucune carte : « 3 en cours » là où l'utilisateur ne voit que 2 tâches.
   */
  runningTasks: z.number().optional(),
  maxAgents: z.number(),
  /** Places libres selon la MÉMOIRE et le plafond, jamais selon la charge (PLAN §27). */
  slotsFree: z.number(),
  /** Départs réellement possibles tout de suite : les places, moins le frein de charge. */
  startableNow: z.number().optional(),
  paused: z.boolean().default(false),
  pauseReason: z.string().optional(),
  /** La charge processeur ralentit les départs : la cause, écrite en clair. */
  loadHoldReason: z.string().optional(),
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
        /**
         * Ce que l'étape est en train de faire, PENDANT qu'elle tourne : la
         * branche en cours de fusion (« branche 3 sur 6 »), le contrôle lancé, la
         * commande de construction. Transitoire — effacé dès que l'étape se
         * termine, où c'est la durée qui prend le relais.
         */
        progress: z.string().optional(),
        /**
         * Combien de fois cette étape a été REJOUÉE après le passage d'un agent
         * de dépannage. Absent — ou 0 — pour une étape passée du premier coup :
         * elle n'a rien à raconter.
         */
        reprises: z.number().optional(),
        /**
         * Ce qui a été tenté pour la relever, dans l'ordre : la panne reconnue,
         * le passage de l'agent, l'issue de la reprise. Ou le REFUS de réparer,
         * quand la panne n'est pas reconnue — auquel cas on le DIT, au lieu de
         * bricoler. C'est ce que lit le déroulé de la colonne.
         *
         * OPTIONNEL, jamais `default([])` : une valeur par défaut le rendrait
         * OBLIGATOIRE dans le type rendu, et toute étape écrite ailleurs — un
         * contrôle, une publication d'avant cette règle — cesserait de compiler
         * ou de se relire.
         */
        reparations: z.array(z.string()).optional(),
        /**
         * Cette étape a DÉPASSÉ sa durée attendue et n'a pas encore rendu la
         * main (`shared/src/duree-des-etapes.ts`). Vrai seulement PENDANT
         * l'étape : une étape terminée affiche sa durée, qui dit déjà tout.
         *
         * Le drapeau existe parce que la phrase ne suffit pas — une ligne de
         * progression en retard se lit exactement comme une ligne de
         * progression ordinaire, et c'est précisément ce qui obligeait à venir
         * constater soi-même qu'une publication était bloquée.
         */
        enRetard: z.boolean().optional(),
        /**
         * LE FIL HISTORIQUE DE L'ÉTAPE : chaque moment, horodaté, dans l'ordre
         * où il est arrivé — le début, chaque branche fusionnée, chaque commande
         * lancée, le passage d'un agent de dépannage, l'issue.
         *
         * C'est ce que `progress` ne pouvait pas garder : la progression est
         * TRANSITOIRE (« Branche 10 sur 10 » efface les neuf précédentes, et
         * disparaît quand l'étape se termine). Le fil, lui, reste avec la
         * publication : il se lit en direct comme des semaines plus tard, sans
         * ouvrir le journal du serveur.
         *
         * OPTIONNEL, jamais `default([])` — même raison que `reparations` : une
         * valeur par défaut le rendrait obligatoire dans le type rendu, et toute
         * publication d'avant cette règle cesserait de se relire. Les règles
         * pures vivent dans `shared/src/journal-publication.ts`.
         */
        journal: z
          .array(
            z.object({
              at: z.number(),
              genre: z.enum(['debut', 'progression', 'commande', 'depannage', 'issue']),
              texte: z.string(),
              agentId: z.string().optional(),
            }),
          )
          .optional(),
        startedAt: z.number().optional(),
        endedAt: z.number().optional(),
      }),
    )
    .default([]),
  cardIds: z.array(z.string()).default([]),
  /**
   * OÙ EN EST CHAQUE TÂCHE DU LOT, une ligne par carte embarquée.
   *
   * `cardIds` ne dit qu'un NOMBRE, et les sept étapes racontent le PARCOURS :
   * ni l'un ni l'autre ne répond à la question qu'on se pose devant un lot de
   * dix cartes — laquelle est passée, laquelle se fait recoller, laquelle vient
   * d'être écartée. Il fallait déplier l'étape de fusion et lire son fil ligne
   * à ligne pour le reconstituer.
   *
   * Les états et leurs libellés sont des règles PURES
   * (`shared/src/fusion-du-lot.ts`) : l'écran ne fabrique aucun texte.
   *
   * OPTIONNEL, jamais `default([])` — même raison que `journal` : une valeur
   * par défaut le rendrait obligatoire dans le type rendu, et toute
   * publication d'avant cette règle cesserait de se relire.
   */
  taches: z
    .array(
      z.object({
        cardId: z.string(),
        titre: z.string().default(''),
        branche: z.string().optional(),
        etat: z.enum([
          'attente',
          'fusion',
          'conflit',
          'recollee',
          'fusionnee',
          'ecartee',
          'absente',
          'en-ligne',
        ]),
        /** Ce qui est arrivé à CETTE tâche, quand ce n'est pas évident : les
         *  fichiers recollés, la raison de l'écart. */
        detail: z.string().optional(),
      }),
    )
    .optional(),
  /**
   * L'ÉTAPE du parcours d'où part cette publication : le déploiement sur
   * l'instance de dev, ou la mise en production. Absente, c'est une publication
   * d'avant les deux étapes — donc celle du lot de « À déployer », le seul qui
   * existait. Elle est retenue pour que la relance et la file d'attente
   * repartent de la MÊME étape, et pour que le déroulé s'affiche dans le bloc
   * qui l'a lancée, pas dans l'autre.
   */
  cible: z.enum(['dev', 'production']).optional(),
  /**
   * Combien de fois cette publication a déjà été REPRISE après une coupure par
   * un redémarrage du serveur. 0 pour une publication lancée normalement ; au
   * démarrage suivant, une publication coupée repart avec ce compte incrémenté.
   * Au-delà du plafond (voir `REPRISES_PUBLICATION_MAX`), on n'en refait plus.
   */
  reprises: z.number().default(0),
  /**
   * Vrai quand cette publication est elle-même la reprise d'une publication
   * coupée par un redémarrage : le compte rendu le DIT.
   */
  repriseApresCoupure: z.boolean().default(false),
  /** L'adresse contrôlée à la fin, quand le projet en déclare une. */
  url: z.string().optional(),
  targetCommit: z.string().optional(),
  agentId: z.string().optional(),
  error: z.string().optional(),
  /**
   * Ce qui a bronché SANS empêcher la mise en ligne : une carte qu'on n'a pas
   * pu ranger après coup, par exemple. Une publication réussie qui porte un
   * avertissement reste RÉUSSIE — le code est en ligne —, mais l'incident se
   * dit, au lieu de la faire passer en rouge ou de disparaître.
   */
  avertissement: z.string().optional(),
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
   * Le PRÉNOM auquel la voix de l'assistant s'adresse (mémoire n°141). « Chris »
   * par défaut ; réglable pour nommer un autre utilisateur. Voir
   * `shared/src/voix-annonce.ts`.
   */
  voixNom: z.string().default('Chris'),
  /**
   * Le MOT DE RÉVEIL de l'écoute permanente (« Dis Haiko » par défaut). Réglable
   * pour parler à l'assistant autrement ; un champ vide revient au mot par
   * défaut plutôt que de couper le réveil. Voir `shared/src/reveil-vocal.ts`.
   */
  voixReveil: z.string().default('Dis Haiko'),
  /**
   * La VITESSE de la voix de l'assistant, par crans clairs (`voix-vitesse.ts`).
   * « normale » = le débit d'origine ; s'applique à toutes les paroles, auto
   * comme réécoutes manuelles.
   */
  voixVitesse: z.enum(['lente', 'normale', 'rapide']).default('normale'),
  /**
   * Le RACCOURCI CLAVIER qui allume et éteint l'écoute permanente, sous sa forme
   * canonique (« Alt+KeyE », « Ctrl+Shift+KeyL »). Vide par défaut : aucun
   * raccourci tant qu'on n'en règle pas un. Voir `shared/src/raccourci-clavier.ts`.
   */
  voixRaccourci: z.string().default(''),
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
  /**
   * Les ACCÈS À LA MACHINE (le VPS), réglés dans l'onglet Système. Laissés vides
   * (l'état par défaut), rien ne change : la création d'une adresse publique
   * garde son fonctionnement LOCAL. Renseignés, elle passe par la machine
   * distante en SSH. Voir `shared/src/acces-vps.ts`.
   */
  vpsHote: z.string().default(''),
  vpsPort: z.number().default(22),
  vpsUtilisateur: z.string().default(''),
  vpsMoyen: z.enum(MOYENS_VPS).default('agent'),
  vpsCle: z.string().default(''),
  vpsMotDePasse: z.string().default(''),
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
