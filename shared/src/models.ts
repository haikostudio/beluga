import { z } from 'zod';
import { ColumnKey } from './columns.js';
import { AgentContextUsage } from './contexte-agent.js';
import { MetriquesSessionLlm } from './metriques-session.js';
import { ReglageCreation, SuggestionCreation } from './mode-creation.js';
import { CompetenceProposee } from './proposition-competence.js';
import { aLaFormeDUnMoteur, type IdDeMoteur } from './registre-moteurs.js';

/* ------------------------------------------------------------------ */
/* Moteurs, modèles, niveaux de réflexion                              */
/* ------------------------------------------------------------------ */

/**
 * UN MOTEUR, tel que le déclare LE REGISTRE (`shared/src/registre-moteurs.ts`) : intégré, ou ajouté (`ext-…`). Le schéma ne juge que la FORME :
 * une carte qui porte un moteur ajouté puis retiré doit se relire sans
 * planter. C'est au lancement que le moteur doit être ACTIF
 * (`adapterFor`, qui refuse de partir sinon).
 */
export const EngineId = z.custom<IdDeMoteur>(aLaFormeDUnMoteur, { message: 'moteur inconnu' });
export type EngineId = IdDeMoteur;

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
  /**
   * L'OUTIL EN LIGNE DE COMMANDE RÉPOND-IL, indépendamment des comptes ?
   * `installed` ci-dessus veut dire « moteur utilisable » : sur Cursor il est
   * déjà faux quand aucune clé n'est déclarée, alors même que `cursor-agent`
   * est bien posé sur la machine. L'assistant de démarrage a besoin des deux
   * repères séparés pour ne pas demander d'installer ce qui l'est déjà.
   */
  cliInstalle: z.boolean().optional(),
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
  /**
   * Le PALIER choisi par le chef d'orchestre (`shared/src/niveau-agent.ts`) :
   * léger, standard ou approfondi. Le modèle et la réflexion ci-dessus en
   * découlent, mais restent modifiables à la main — c'est pourquoi le palier est
   * retenu à part, comme une intention, jamais comme un réglage de plus.
   */
  niveau: z.enum(['leger', 'standard', 'approfondi']).optional(),
  /**
   * Le COMPTE imposé pour ce moteur, choisi à la main dans les réglages de
   * l'agent. Vide = laisser la répartition de quota décider (`pickAccount`).
   * N'a de sens que si plusieurs comptes existent pour `engine`.
   */
  account: z.string().optional(),
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

/**
 * LE DÉPLOIEMENT d'un dépôt (principal ou annexe) : deux choix, rien d'autre
 * (`shared/src/publication-simple.ts`). Le déroulé est le MÊME pour tous les
 * projets — fusion, enregistrement, envoi — puis la commande de mise à jour et
 * le service à relancer, quand ils sont réglés. Aucun agent.
 */
/** Une étape du processus de mise en production, jouée sans agent. */
export const EtapeDuProcessusDeProduction = z.object({
  libelle: z.string(),
  commande: z.string(),
  delaiS: z.number(),
});

/**
 * LE PROCESSUS ÉCRIT PAR UN AGENT DE CONFIGURATION — celui de la mise en
 * production, ou celui du déploiement (29/09/2026) : une suite d'étapes jouée
 * telle quelle, sans agent, et lisible dans la rubrique de son étape.
 */
export const ProcessusEcrit = z.object({
  resume: z.string().optional(),
  /** Ce que l'agent a configuré, en mots courants : la rubrique le montre. */
  explication: z.string().optional(),
  /** L'ADRESSE VISÉE, déclarée par l'agent : la machine ou le site où le processus agit. */
  cible: z.string().optional(),
  /** L'adresse de contrôle déclarée par l'agent (URL seule). */
  adresse: z.string().optional(),
  etapes: z.array(EtapeDuProcessusDeProduction),
  ecritLe: z.number().optional(),
  /**
   * L'EMPREINTE DES RÉGLAGES au moment de l'écriture (`empreinteDesReglages`) :
   * un réglage changé depuis fait dire « à revérifier » au bloc du processus.
   * Absente sur un processus d'avant : rien n'est alors signalé.
   */
  empreinte: z.string().optional(),
  /** Le message de l'agent qui l'a rendu : un même message ne s'enregistre qu'une fois. */
  depuisMessage: z.string().optional(),
});

export const ProcedureDeDeploiement = z.object({
  /** La commande lancée dans le dossier après l'envoi (« npm run build », un script du projet…). */
  commande: z.string().optional(),
  /** Le service système relancé à la fin. */
  service: z.string().optional(),
  /**
   * LE PROCESSUS DE DÉPLOIEMENT écrit par son agent de configuration. Présent,
   * il REMPLACE la commande et les services ci-dessus pour le dépôt principal ;
   * absent, le déroulé commun reste en service (`publication-simple.ts`).
   */
  processus: ProcessusEcrit.optional(),
  /** L'agent de configuration du déploiement : sa conversation, reprenable. */
  agentId: z.string().optional(),
});
export type ProcedureDeDeploiement = z.infer<typeof ProcedureDeDeploiement>;

/**
 * LA MISE EN PRODUCTION d'un dépôt : le PROCESSUS écrit par l'agent
 * d'initialisation après avoir interrogé l'utilisateur. Absent = le projet n'a
 * pas encore été initialisé, et le bouton propose de le faire.
 */
export const ProcedureDeMiseEnProduction = z.object({
  processus: ProcessusEcrit.optional(),
  /**
   * L'AGENT DE CONFIGURATION de la mise en production : SA conversation, gardée
   * et reprenable depuis la rubrique « Mise en production » des réglages,
   * redémarrage compris. Aucune
   * branche « tache/… » : il travaille dans le dossier du projet.
   */
  agentId: z.string().optional(),
});
export type ProcedureDeMiseEnProduction = z.infer<typeof ProcedureDeMiseEnProduction>;

/**
 * UN DÉPÔT ANNEXE d'un projet à plusieurs dépôts (`shared/src/depots-du-projet.ts`).
 *
 * Le dépôt PRINCIPAL reste le dossier du projet (`Project.path`) avec tous ses
 * réglages d'aujourd'hui ; un annexe vit « à côté » : son propre dossier, son
 * propre dépôt git, ses branches et sa façon de se mettre en ligne. Chaque
 * carte ouvre la MÊME branche « tache/… » dans chacun, et la publication les
 * traite l'un après l'autre.
 */
export const DepotAnnexe = z.object({
  /** Le nom court, unique dans le projet (« admin ») : il nomme le dépôt partout. */
  nom: z.string(),
  /** Le dossier du dépôt sur ce serveur (son dépôt de travail, jamais un dossier publié). */
  path: z.string(),
  gitRemote: z.string().optional(),
  branchesDePublication: z
    .object({ dev: z.string().optional(), production: z.string().optional() })
    .default({}),
  deploiement: ProcedureDeDeploiement.default({}),
  miseEnProduction: ProcedureDeMiseEnProduction.default({}),
  /** L'adresse de l'instance de dev de ce dépôt, contrôlée après son déploiement. */
  devUrl: z.string().optional(),
  /** Le port où le serveur de ce dépôt écoute, s'il en a un. */
  port: z.number().int().min(1).max(65535).optional(),
  ajouteLe: z.number().optional(),
});
export type DepotAnnexe = z.infer<typeof DepotAnnexe>;

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  gitRemote: z.string().optional(),
  gitBranch: z.string().optional(),
  defaultEngine: EngineId.default('claude'),
  defaultModel: z.string().optional(),
  /**
   * LA RÉFLEXION ET LE COMPTE retenus la DERNIÈRE FOIS qu'un humain a réglé la
   * configuration d'une carte de ce projet (`choixDeLaCarte`, `chat.tsx`, via
   * `card.update`). Avec `defaultEngine`/`defaultModel` ci-dessus, une carte
   * neuve reprend tout ce qui a été choisi la fois précédente, sans qu'il
   * faille reconfigurer moteur, modèle, réflexion et compte à chaque carte.
   */
  defaultThinking: z.string().optional(),
  defaultAccount: z.string().optional(),
  /** Vrai uniquement pour le dépôt Beluga Build lui-même (PLAN §5, exception). */
  isSelf: z.boolean().default(false),
  /**
   * LA SOURCE DONT CE PROJET HÉRITE ses règles, quand il n'a rien écrit sur un
   * sujet (`cibleDHeritage`, `shared/src/arbre-memoire.ts`). Clé ABSENTE = la
   * plateforme Beluga Build, comme avant ce réglage ; `HERITAGE_AUCUN` = ce projet
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
   * LA PORTE D'ENTRÉE DU PROJET SUR CE SERVEUR : un port FIXE, enregistré avec
   * lui (`shared/src/port-projet.ts`), et non plus deviné à chaque mise en
   * ligne. Attribué à la création, rattrapé au démarrage du démon pour les
   * projets d'avant (le port réellement servi), modifiable dans les réglages.
   * Vraie colonne en base (`projects.port`, migration 70). `null` envoyé par
   * l'écran RETIRE le port : il se lit alors comme une clé absente.
   */
  port: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .nullish()
    .transform((port) => port ?? undefined),
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
   * `branche-de-publication.ts`. Clé absente = le SCHÉMA IMPOSÉ, valable sur
   * tous les projets : « dev » au déploiement, « main » à la mise en
   * production. Une clé remplie l'emporte quand même — c'est un ÉCART, dit en
   * toutes lettres à l'écran comme dans le déroulé de la publication.
   */
  branchesDePublication: z
    .object({ dev: z.string().optional(), production: z.string().optional() })
    .default({}),
  /**
   * LA MISE EN PRODUCTION de ce projet, réglée dans ses paramètres : la BASE
   * écrite à la main par l'utilisateur (le concept dans ses mots) et le PROMPT
   * que l'agent de mise en production reçoit. Les règles vivent dans
   * `mise-en-production.ts`. Une clé absente est un état NORMAL : la
   * publication retombe alors sur les moyens que Beluga Build sait deviner.
   */
  /**
   * LA PROCÉDURE DE DÉPLOIEMENT de ce projet, définie depuis la tête de la
   * colonne « À déployer » par un agent (`procedure-publication.ts`). Clé
   * absente = AUCUNE procédure : le projet est neuf, la colonne propose de
   * l'initier et rien ne part. `constate: true` est le marqueur des projets
   * déjà inscrits (migration 22) — ils gardent le déroulé constaté d'avant.
   */
  deploiement: ProcedureDeDeploiement.default({}),
  miseEnProduction: ProcedureDeMiseEnProduction.default({}),
  /**
   * L'ADRESSE PUBLIQUE DE LA VERSION EN PRODUCTION (« https://formations.haiko.studio »),
   * saisie dans la rubrique « Mise en production » des réglages. C'est elle que
   * l'espace de suivi des visites autorise (`server/src/suivi-par-defaut.ts`) :
   * jamais devinée, puisqu'une mauvaise adresse déclarerait un site étranger.
   */
  adresseProduction: z.string().optional(),
  /**
   * L'ADRESSE PUBLIQUE A ÉTÉ RATTRAPÉE, pas saisie (30/09/2026) : remplie par
   * le rattrapage des adresses de contrôle (`server/src/rattrapage-adresses.ts`),
   * elle n'ouvre AUCUN suivi des visites (`adresseDeProductionDuProjet` l'ignore).
   * La marque tombe dès que l'utilisateur saisit ou change l'adresse, ou que
   * l'agent de configuration l'écrit : le suivi part alors normalement.
   */
  adresseProductionRattrapee: z.boolean().optional(),
  /**
   * LE DÉPLOIEMENT AUTOMATIQUE, commandé par l'interrupteur posé en tête de la
   * colonne « Terminé ». ÉTEINT par défaut, et pour tous les projets déjà
   * inscrits : rien ne change tant que l'utilisateur ne l'allume pas lui-même.
   * Allumé, il vaut consentement permanent pour CE projet — les règles de
   * déclenchement vivent dans `deploiement-automatique.ts`.
   */
  deploiementAutomatique: z.boolean().default(false),
  /**
   * LA MISE EN PRODUCTION EST-ELLE PERMISE ? Commandée par l'interrupteur de
   * l'entête du tiroir « Mise en production ». ÉTEINTE par défaut, et pour
   * tous les projets déjà inscrits : le bouton du tiroir reste gris et le
   * serveur refuse le lancement tant que l'utilisateur ne l'allume pas. Ne
   * touche QUE la production, jamais le déploiement sur ce serveur. La règle
   * vit dans `raisonProductionDesactivee` (`publication-simple.ts`).
   */
  miseEnProductionActive: z.boolean().default(false),
  /**
   * LES DÉPÔTS ANNEXES (`DepotAnnexe`, `shared/src/depots-du-projet.ts`). Vide =
   * un projet à dépôt simple, exactement comme avant : rien à convertir.
   */
  depots: z.array(DepotAnnexe).default([]),
  /**
   * LE DÉPÔT DE CE PROJET NE REÇOIT AUCUNE DONNÉE SENSIBLE
   * (`shared/src/filtre-contenu.ts`). Allumé, chaque publication passe les
   * commits qui partiraient au filtre de contenu JUSTE AVANT l'envoi sur le
   * dépôt, et refuse d'envoyer au moindre reste — fichier, ligne et carte
   * nommés dans le tiroir. ÉTEINT par défaut : rien ne change ailleurs.
   */
  depotSansDonneesSensibles: z.boolean().default(false),
  /**
   * LA VITRINE LIÉE (`server/src/vitrine-liee.ts`) : le site dont la
   * démonstration montre CE projet. Réglée, chaque déploiement réussi
   * reconstruit la démo depuis la branche de déploiement et la pose sur
   * l'instance d'essai du site ; chaque mise en production la reconstruit depuis
   * la branche de production et met le site de production à jour. Toujours par
   * le filtre de contenu, jamais au prix de la publication elle-même. Absente
   * par défaut.
   */
  vitrineLiee: z
    .object({
      /** Le dossier du dépôt du site (sa branche « dev » est servie en essai). */
      site: z.string(),
      /** Le dossier du projet qui construit la démo (`scripts/construire-demo.mjs`). */
      constructeur: z.string(),
      /**
       * L'adresse de l'instance d'essai, pour lire la démo servie. ABSENTE, le
       * déploiement ne touche plus au site : seule la mise en production y pose
       * la démo, tirée de la branche de production.
       */
      adresseEssai: z.string().optional(),
      /**
       * L'adresse où le CONSTRUCTEUR sert lui-même la démo (vitrine Haiko).
       * Réglée, chaque mise en production y dépose la même démo filtrée et le
       * remet en ligne par son `scripts/mettre-en-ligne.sh`.
       */
      adresseConstructeur: z.string().optional(),
      /**
       * VRAI, chaque DÉPLOIEMENT (branche de développement) nourrit AUSSI la
       * vitrine du constructeur (`adresseConstructeur`), depuis le commit qui
       * vient d'être déployé. Le site officiel, lui, n'est touché au déploiement
       * que si `adresseEssai` existe.
       */
      constructeurSuitLeDeploiement: z.boolean().optional(),
      /** L'adresse de production, pour lire la démo servie. */
      adresseProduction: z.string().optional(),
      /** Le dossier servi en production, recopié depuis la branche de production du site. */
      dossierProduction: z.string().optional(),
      /** Le service à relancer quand le serveur du site de production change. */
      serviceProduction: z.string().optional(),
    })
    .optional(),
  billing: BillingLink.optional(),
  /**
   * HÉRITÉ : dernière visite du projet, quand elle éteignait le point bleu.
   * Plus rien ne l'écrit — seule la consultation des cartes éteint leur
   * compteur (`shared/src/travail-rendu.ts`). La migration 72 l'a reportée sur
   * les cartes ; le champ reste lisible pour les projets d'avant.
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
  /**
   * CE PROJET EST UN REGROUPEMENT (`shared/src/regroupements.ts`) : le TABLEAU
   * COMMUN de plusieurs projets réunis. Il n'a ni dépôt ni publication — son
   * dossier n'est qu'un dossier de rangement —, et ses cartes sont des cartes
   * MÈRES, qui en posent une par projet touché. Faux pour tout projet d'avant.
   */
  regroupement: z.boolean().default(false),
  /**
   * LE REGROUPEMENT DONT CE PROJET EST MEMBRE. La seule source de vérité de
   * l'appartenance : un projet n'est donc jamais dans deux regroupements.
   * Absent = projet autonome, comme avant.
   */
  regroupementId: z.string().optional(),
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
    belugaInstructions: ContextBreakdown,
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

/** Données internes du tour, produites par Beluga Build et jamais par le texte de l'agent. */
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
  /**
   * L'IDENTIFIANT COURT ET PERMANENT, calculé au dépôt à partir de `id` et
   * jamais recalculé (`shared/src/alias-piece-jointe.ts`). C'est lui qui nomme
   * le fichier sur le disque et qui est cité dans le prompt. Absent sur les
   * pièces déposées avant cette mécanique : leur `id` entier en tient lieu.
   */
  alias: z.string().optional(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  /** Empreinte du contenu : le même fichier envoyé dix fois n'apparaît qu'une fois. */
  sha: z.string(),
  cardId: z.string().optional(),
  agentId: z.string().optional(),
  createdAt: z.number(),
  /**
   * L'INSTANT DE LA VIDÉO QUI LUI SERT D'APERÇU, en secondes. Pas une image
   * fabriquée et rangée à part : un instant — aucun outil de découpe vidéo n'est
   * installé sur la machine (`shared/src/apercu-video.ts`).
   *
   * Posé par la recherche automatique du lecteur au premier affichage, ou par
   * un geste de l'équipe. Absent : le lecteur cherche, et retombe sur le tout
   * début si rien ne convient — le comportement d'avant.
   */
  apercuSeconde: z.number().optional(),
  /**
   * Cet instant a-t-il été DÉSIGNÉ À LA MAIN ? Un choix humain ne se laisse
   * jamais écraser par la recherche automatique, et c'est lui qui fait
   * apparaître le bouton « revenir à l'aperçu automatique ».
   */
  apercuManuel: z.boolean().optional(),
});
export type Attachment = z.infer<typeof Attachment>;

/**
 * Une NOTE écrite à la main sur une carte — un pense-bête, un bout de contexte,
 * une pièce jointe à garder sous la main. Rien à voir avec la conversation de
 * l'agent : elle vit tant que la carte existe, quelle que soit sa colonne.
 * Les fichiers joints sont des `Attachment` déjà déposés (mêmes routes
 * `/api/upload` et `/api/attachment`) — seuls leurs identifiants sont gardés
 * ici.
 */
export const CardComment = z.object({
  id: z.string(),
  cardId: z.string(),
  projectId: z.string(),
  text: z.string(),
  attachmentIds: z.array(z.string()).default([]),
  createdAt: z.number(),
});
export type CardComment = z.infer<typeof CardComment>;

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
  /**
   * LES DÉPÔTS ANNEXES touchés par la branche de la carte
   * (`shared/src/depots-du-projet.ts`), un bloc par dépôt : sa base, ses
   * enregistrements et ses fichiers. Un dépôt où la branche n'a rien changé n'y
   * figure pas. OPTIONNEL : absent sur tout projet à dépôt simple.
   */
  depots: z
    .array(
      z.object({
        nom: z.string(),
        baseSha: z.string().optional(),
        branchePrincipale: z.string().optional(),
        fusionnee: z.boolean().optional(),
        commits: z
          .array(z.object({ sha: z.string(), message: z.string(), date: z.string().optional() }))
          .default([]),
        fichiers: z
          .array(
            z.object({
              chemin: z.string(),
              etat: z.enum(['ajoute', 'modifie', 'supprime', 'renomme']),
              ajoutees: z.number().optional(),
              supprimees: z.number().optional(),
            }),
          )
          .default([]),
      }),
    )
    .optional(),
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
  /**
   * LES TOURS CONSÉCUTIFS PRIVÉS DES OUTILS DU PROJET.
   *
   * Un pont d'outils mort-né est presque toujours passager : le tour se rejoue
   * tout seul, en silence. Ce compteur borne ce rejeu — au-delà de
   * `ESSAIS_DE_PONT_MAX`, on pose la décision « Relancer / Ignorer / Arrêter »
   * au lieu de boucler en brûlant du quota (`shared/src/pont-outils.ts`).
   *
   * Il est CONSÉCUTIF : remis à zéro dès qu'un tour obtient ses outils. Sans
   * cela, une carte ancienne partirait avec un crédit déjà épuisé.
   */
  essaisSansOutils: z.number().optional(),
  lastError: z.string().optional(),
});
export type SchedulingState = z.infer<typeof SchedulingState>;

/* ------------------------------------------------------------------ */
/* Le parcours d'une carte, écrit sur elle                             */
/* ------------------------------------------------------------------ */

/**
 * CE QUE L'AGENT DE CADRAGE A COMPRIS, rendu par l'outil `rendre_comprehension`
 * à la fin de chaque tour de cadrage. C'est un miroir tendu à l'utilisateur —
 * la demande dans les mots de l'agent —, jamais une solution.
 */
/**
 * LA PART TECHNIQUE D'UNE COMPRÉHENSION — le second registre.
 *
 * La compréhension portait un seul texte, écrit pour l'utilisateur. Le PLAN
 * portait à part sa liste de tâches et ses notes techniques. Depuis que le
 * plan est devenu FACULTATIF (interrupteur « Plan » de la barre d'écriture),
 * ce que l'agent d'exécution recevait de sérieux disparaissait avec lui : la
 * compréhension porte donc désormais elle-même la découpe du travail, les
 * faits du projet à respecter et ce qui risque de casser.
 *
 * ELLE NE S'AFFICHE PAS D'EMBLÉE : l'écran la range sous une flèche « Détails
 * techniques » fermée, sous le texte clair. Elle est FACULTATIVE — une
 * compréhension rendue sur une simple question n'en a pas, et les
 * compréhensions écrites avant ce changement n'en ont pas non plus : la flèche
 * ne s'affiche alors pas du tout.
 */
export const PartieTechniqueDeComprehension = z.object({
  /** La découpe du travail en étapes concrètes. */
  taches: z.array(z.object({ titre: z.string(), description: z.string().default('') })).default([]),
  /**
   * LES FAITS DÉJÀ CONNUS DU PROJET À RESPECTER — décisions, pièges,
   * conventions, recopiés depuis la base de connaissances par l'agent de
   * cadrage. Deux tiers des travaux exécutés n'ouvraient JAMAIS cette base :
   * c'est à celui qui cadre de les servir à celui qui exécute.
   */
  faits: z.array(z.string()).default([]),
  /** Ce qui risque de casser. */
  risques: z.string().default(''),
});
export type PartieTechniqueDeComprehension = z.infer<typeof PartieTechniqueDeComprehension>;

/**
 * UNE QUESTION QU'UN CADRAGE SANS TÉMOIN LAISSE SUR LA CARTE — la forme de
 * `ask_user`, plus la réponse que l'agent conseille, et la réponse donnée.
 */
export const QuestionEnAttenteDeCarte = z.object({
  id: z.string(),
  question: z.string(),
  description: z.string().optional(),
  kind: z.enum(['single', 'multiple', 'text']).default('single'),
  options: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().optional() })).default([]),
  /** Le libellé de l'option que l'agent recommande, ou sa réponse conseillée en texte. */
  recommandee: z.string().optional(),
  reponse: z.string().optional(),
  reponduA: z.number().optional(),
});
export type QuestionEnAttenteDeCarte = z.infer<typeof QuestionEnAttenteDeCarte>;

export const ComprehensionDeCarte = z.object({
  texte: z.string(),
  /** Le second registre, replié à l'écran et servi à l'agent d'exécution. */
  partieTechnique: PartieTechniqueDeComprehension.optional(),
  /**
   * CE QUE L'AGENT ASSUME faute de réponse, une ligne chacune. Le champ
   * portait « ce qui reste flou » : une rubrique où déposer un doute sans le
   * poser. Un point qui change le travail passe par `ask_user`, le reste se
   * tranche et s'écrit « Je suppose que… » (`estUneQuestionEnSuspens`).
   */
  hypotheses: z.array(z.string()).default([]),
  /** L'ancien champ « ce qui reste flou », gardé pour relire les cartes déjà écrites. */
  questionsOuvertes: z.array(z.string()).optional(),
  /**
   * LES SUPPOSITIONS VALIDÉES D'UN CLIC par l'utilisateur (« Valider » sous
   * « Ce que l'agent suppose »), par leur texte exact. Aucun tour d'agent : le
   * cadrage suivant et l'agent d'exécution les reçoivent comme des DÉCISIONS
   * de l'utilisateur (`suppositionsValidees`). Une compréhension rendue
   * ensuite repart d'une liste neuve. Absent sur les cartes d'avant.
   */
  hypothesesValidees: z.array(z.string()).optional(),
  /**
   * LES QUESTIONS PRÉPARÉES PAR UN CADRAGE SANS TÉMOIN (nuit, carte posée par
   * un agent, site tombé), GARDÉES SUR LA CARTE. `ask_user` attend dans un
   * registre en mémoire et plafonné (`attente-question.ts`) : il ne survit ni
   * à une nuit ni à un redémarrage. Ces questions-ci attendent dans la carte
   * elle-même ; l'écran les pose une par une, la carte ne se lance pas tant
   * qu'une reste sans réponse (`questionsSansReponse`), et la dernière réponse
   * relance le cadrage, qui réécrit la compréhension.
   */
  questionsEnAttente: z.array(QuestionEnAttenteDeCarte).optional(),
  /** Les sujets de mémoire ouverts pour comprendre. */
  sujets: z.array(z.string()).default([]),
  /**
   * LES DEUX RÉSUMÉS AFFICHÉS DANS LE FIL, sous les points « Demande » et
   * « Compréhension », à la place des phrases fixes : deux ou trois phrases
   * simples chacun, écrites par l'agent. Absents sur les cartes d'avant.
   */
  resumeDemande: z.string().optional(),
  resumeComprehension: z.string().optional(),
  /**
   * LES PROJETS TOUCHÉS, sur une carte d'un projet RÉUNI seulement (noms ou
   * identifiants des membres). Au lancement, la carte mère pose une carte
   * fille dans chacun, et dans aucun autre (`shared/src/regroupements.ts`).
   */
  projetsTouches: z.array(z.string()).optional(),
  at: z.number(),
  /** Le tour (message porteur) qui l'a rendue. */
  tourId: z.string().optional(),
});
export type ComprehensionDeCarte = z.infer<typeof ComprehensionDeCarte>;

/**
 * UN PLAN RENDU PAR L'OUTIL `rendre_plan`, ENTIER ET VERSIONNÉ. Le texte est
 * le markdown que le démon a écrit lui-même (`rendrePlan`) : un seul moteur de
 * rendu, donc le même plan à l'écran, sur la carte et dans le contexte de
 * l'agent d'exécution.
 */
export const PlanDeCarte = z.object({
  numero: z.number().int().positive(),
  titre: z.string(),
  resume: z.string().default(''),
  /**
   * LA SYNTHÈSE AFFICHÉE SOUS LE POINT « PLAN » DU FIL : ce qui va être fait,
   * en deux ou trois phrases simples. Distincte de `resume`, qui compose la
   * description de la carte en une phrase. Absente sur les plans d'avant.
   */
  synthese: z.string().optional(),
  texte: z.string(),
  /** Le détail technique du plan, jamais affiché : il part à l'agent d'exécution (`contexteDeDepart`). */
  notesTechniques: z.string().optional(),
  at: z.number(),
  tourId: z.string().optional(),
});
export type PlanDeCarte = z.infer<typeof PlanDeCarte>;

/**
 * LE PARCOURS D'UNE CARTE EST UN ÉTAT ÉCRIT SUR ELLE, jamais une déduction du
 * texte de ses messages (`shared/src/parcours-carte.ts`). Il vit dans le JSON
 * libre de la carte : aucune colonne à migrer, une carte d'avant n'en a
 * simplement pas.
 */
export const ParcoursDeCarte = z.object({
  comprehension: ComprehensionDeCarte.optional(),
  plans: z.array(PlanDeCarte).default([]),
  /** Un clic « Générer le plan » (ou un message d'affinage) est parti : le tour tourne. */
  planDemandeA: z.number().optional(),
  /**
   * LE CADRAGE A ÉTÉ ROUVERT PAR UN MESSAGE sur une carte en « Rapport »
   * (`shared/src/relance-apres-rapport.ts`). La carte reste dans sa colonne,
   * mais se lit en cadrage jusqu'au lancement, qui efface ce repère.
   */
  cadrageRouvertA: z.number().optional(),
  /**
   * Un tour n'a pas tenu sa promesse : l'incident se lit, et se referme d'un
   * clic. `etape` dit LEQUEL des deux rendez-vous a été manqué — la
   * compréhension ou le plan — pour que le point rouge tombe au bon endroit de
   * la ligne de temps. Absent sur les cartes d'avant : c'est alors le plan.
   */
  incident: z
    .object({ texte: z.string(), at: z.number(), etape: z.enum(['comprehension', 'plan']).optional() })
    .optional(),
  /**
   * L'ISSUE DU DERNIER TOUR DE CADRAGE, ÉCRITE PAR LE DÉMON À SA FERMETURE.
   * Un tour de cadrage CADRE (il rend sa compréhension) ou RÉPOND (il traite
   * une question dans le fil, sans rien poser sur la carte). L'écran LISAIT
   * cette seconde issue dans les traces du journal, une déduction qui échoue
   * dès qu'une trace manque : elle est désormais ÉCRITE
   * (`shared/src/tour-de-cadrage.ts`).
   */
  issueDuTour: z
    .object({ issue: z.enum(['cadrage', 'reponse']), at: z.number(), tourId: z.string().optional() })
    .optional(),
  /**
   * LE PLAN A ÉTÉ VALIDÉ, pour cette VERSION. « Valider » n'envoie plus un
   * message à l'agent : c'est un changement d'état de la carte, écrit une fois
   * par la commande `card.plan.validate`, et c'est lui que lit le bouton
   * « Lancer la tâche » (`gesteDuParcours`, `shared/src/parcours-carte.ts`).
   * Une version suivante du plan le périme : elle se revalide.
   */
  planValide: z
    .object({
      version: z.number().int().positive(),
      at: z.number(),
      niveau: z.enum(['leger', 'standard', 'approfondi']).optional(),
    })
    .optional(),
  /**
   * LA COMPRÉHENSION A ÉTÉ VALIDÉE — c'est le NOUVEAU PIVOT du parcours.
   *
   * Le plan n'est plus un passage obligé : il ne pouvait donc plus porter le
   * droit de lancer, le figement des réglages ni le palier d'effort. Ces trois
   * dépendances s'appuient maintenant sur cet état, écrit une fois par la
   * commande `card.comprehension.validate` (le bouton unique « Valider et
   * lancer »). Une compréhension RENDUE APRÈS coup le périme : elle se
   * revalide.
   *
   * `planValide` reste lu pour les cartes de l'ancienne séquence : une carte
   * dont le plan avait été validé garde ses réglages figés.
   */
  comprehensionValidee: z
    .object({
      at: z.number(),
      /** L'instant de la compréhension validée (`ComprehensionDeCarte.at`) : une compréhension suivante périme la décision. */
      comprehensionAt: z.number().optional(),
      niveau: z.enum(['leger', 'standard', 'approfondi']).optional(),
    })
    .optional(),
  /**
   * L'INTERRUPTEUR « PLAN » DE LA BARRE D'ÉCRITURE, mémorisé SUR LA CARTE (ni
   * par utilisateur ni par projet) et ÉTEINT à la naissance. Allumé, chaque
   * tour de cadrage rend aussi un plan complet à la fin de son tour, sans
   * second clic.
   */
  planSouhaite: z.boolean().optional(),
  /**
   * L'INTERRUPTEUR « CRÉATION » DE LA BARRE D'ÉCRITURE, voisin de « Plan » et
   * rangé de la même façon : sur la carte, éteint à la naissance. Allumé,
   * chaque demande du tour emporte la consigne du chef d'orchestre et l'agent
   * reçoit les outils de délégation (`shared/src/mode-creation.ts`).
   */
  creationSouhaitee: z.boolean().optional(),
  /**
   * LES SUGGESTIONS DE MODÈLE POSÉES PAR L'AGENT, avec la question qui les
   * porte. Seules celles dont la réponse est « Accepter » font foi, et pour
   * cette carte seulement (`surchargesAcceptees`).
   */
  creationSuggestions: z.array(SuggestionCreation).optional(),
  /**
   * LES COMPÉTENCES QUE BELUGA BUILD A PROPOSÉES AU CADRAGE, avec ce que
   * l'utilisateur en a décidé (`shared/src/proposition-competence.ts`). Seules
   * celles à l'état « utilisee » partent avec l'agent d'exécution — en entier.
   * Une fiche déjà proposée ici n'est jamais reproposée sur cette carte.
   */
  competencesProposees: z.array(CompetenceProposee).optional(),
});
export type ParcoursDeCarte = z.infer<typeof ParcoursDeCarte>;

/**
 * UN VERDICT DU JUGE RAPIDE, RANGÉ SUR LA CARTE. Toujours CONSULTATIF : il
 * allume un signal, il ne supprime, ne refuse et ne lance rien. Les règles
 * (questions, seuils, lecture des verdicts) vivent dans
 * `shared/src/jugement-rapide.ts` ; ici, seule la forme rangée.
 */
export const JugementPose = z.object({
  /** La probabilité rendue par le service, de 0 à 1. */
  valeur: z.number(),
  /** Le signal doit-il s'allumer sur l'écran ? */
  signal: z.boolean(),
  /** L'empreinte de ce qui a été jugé : inchangé, on ne rejuge pas. */
  empreinte: z.string().optional(),
  at: z.number(),
});
export type JugementPose = z.infer<typeof JugementPose>;

/**
 * LES JUGEMENTS RANGÉS SUR UNE CARTE. Tous facultatifs : sans Laya installé,
 * aucun n'existe jamais, et la carte se comporte exactement comme avant. Ils
 * vivent dans le blob `data` — aucune migration, et une carte d'avant ne les a
 * simplement pas.
 */
/**
 * LA NOTE DE COMPRÉHENSION, RANGÉE SUR LA CARTE — le seul verdict que l'écran
 * montre encore, et il ne montre qu'un NOMBRE DE BARRES : une rouge, deux
 * jaune, trois vert, avec une phrase courte au survol. Aucun message écrit.
 */
export const JugementDeComprehension = z.object({
  /** 1, 2 ou 3 barres. Jamais zéro : sans verdict, la jauge montre ses trois barres éteintes. */
  barres: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** La confiance du service, de 0 à 1. */
  confiance: z.number(),
  /** Le motif du manque, choisi dans une liste fermée (`MOTIFS_DE_COMPREHENSION`). */
  motif: z.string().optional(),
  /** La signature du dossier jugé : inchangé, on ne rejuge pas. */
  empreinte: z.string().optional(),
  at: z.number(),
});
export type JugementDeComprehension = z.infer<typeof JugementDeComprehension>;

/*
 * LES CHAMPS DISPARUS — `description`, `plan`, `rapport`, `niveauPropose` —
 * portaient les quatre avis ÉCRITS, retirés au profit du seul indicateur. Les
 * cartes déjà en base les portent encore dans leur JSON libre : Zod les ignore
 * silencieusement à la lecture, et ils s'effacent à la prochaine écriture.
 * Aucune migration, rien de destructif.
 */
export const JugementsDeCarte = z.object({
  /** Ce qui a été compris suffit-il à lancer le travail ? 1, 2 ou 3 barres. */
  comprehension: JugementDeComprehension.optional(),
  /** La demande entrante presse-t-elle ? Signal = elle passe devant. */
  urgence: JugementPose.optional(),
  /** Les notes de tri d'une proposition de la nuit : gain, ampleur, rang. */
  interet: z
    .object({ gain: z.number(), ampleur: z.number(), rang: z.number(), at: z.number() })
    .optional(),
});
export type JugementsDeCarte = z.infer<typeof JugementsDeCarte>;

/**
 * UNE FILLE, TELLE QUE SA MÈRE LA SUIT (`etatDeLaFille`,
 * `shared/src/regroupements.ts`). Des champs COURTS : le résumé est réécrit
 * sur la mère à chaque mouvement de la fille, et diffusé avec elle.
 */
export const SuiviDUneFille = z.object({
  projectId: z.string(),
  cardId: z.string(),
  /** Le nom du projet de la fille, au moment du relevé. */
  projet: z.string(),
  colonne: z.string(),
  etat: z.enum(['attente', 'travail', 'question', 'panne', 'fait']),
  /** Ce que l'agent fait en ce moment (sa ligne de tâche en cours), ou pourquoi la fille attend. */
  geste: z.string().optional(),
  /** Lignes de la liste de tâches cochées / annoncées. */
  faites: z.number().int().optional(),
  total: z.number().int().optional(),
  /** Le compte rendu court d'une fille terminée : son explication simple, ou la phrase de sa carte. */
  compteRendu: z.string().optional(),
  /** La fille s'est close sans modifier son dépôt. */
  sansCode: z.boolean().optional(),
  doneAt: z.number().optional(),
});
export type SuiviDUneFille = z.infer<typeof SuiviDUneFille>;

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
   * LA SYNTHÈSE ENTIÈRE DU BESOIN, écrite avec l'utilisateur avant que la carte
   * existe. Elle est déposée comme PREMIER MESSAGE de la conversation de la
   * carte — visible avant même le lancement — et reprise en toutes lettres dans
   * le prompt de l'agent. Un titre court et trois phrases de description ne
   * disaient pas la moitié de ce qui s'était échangé ; ce champ porte le reste
   * (`shared/src/synthese-du-besoin.ts`).
   */
  briefing: z.string().optional(),
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
  /** Photographie du dernier tour LLM, figée avant le passage en déploiement. */
  llmSessionMetrics: MetriquesSessionLlm.optional(),
  scheduling: SchedulingState.optional(),
  agentId: z.string().optional(),
  billing: BillingLine.optional(),
  github: GithubTracking.optional(),
  excludedFromDeploy: z.boolean().default(false),
  /**
   * L'ÉTAT DE LA RÉDACTION AUTOMATIQUE, pour une carte née d'une demande de la
   * messagerie. Absent partout ailleurs : une carte écrite à la main n'a rien à
   * faire rédiger.
   *
   * La carte porte d'abord le titre et le texte du CLIENT, puis un agent de
   * cadrage les réécrit. Ce champ garde ce qu'il est advenu de cette seconde
   * étape — en cours, en attente d'un nouvel essai, faite, ou échouée avec sa
   * raison — pour que l'écran puisse le DIRE au lieu de laisser la carte muette
   * (`shared/src/redaction-de-demande.ts`). Il vit dans le blob `data`, comme
   * `renduA` : aucune migration.
   *
   * IL NE SORT JAMAIS DE L'ESPACE DE TRAVAIL : c'est une affaire interne, et le
   * client continue de voir sa demande prise en charge.
   */
  redaction: z
    .object({
      etat: z.enum(['en-cours', 'en-attente', 'faite', 'echouee']),
      raison: z.string().optional(),
      essais: z.number().int().nonnegative().default(0),
      a: z.number().optional(),
      prochainEssaiA: z.number().optional(),
    })
    .optional(),
  /**
   * Quand la conversation de cette carte a été ouverte pour la dernière fois.
   * C'est ce repère qui éteint la pastille « terminé, pas encore lu » — le
   * simple passage sur le projet ne suffit pas.
   */
  lastReadAt: z.number().optional(),
  /**
   * L'INSTANT DU DERNIER TOUR D'AGENT RÉUSSI sur cette carte — cadrage, plan ou
   * travail. Posé par le démon quand un agent de la carte passe à « done »
   * (`runtime.ts`, `store.marquerRendu`). Comparé à `lastReadAt`, il allume la
   * pastille « rendu non consulté » (`shared/src/travail-rendu.ts`). Il vit
   * dans le bloc `data`, indexé par une colonne générée (`rendu_a`).
   */
  renduA: z.number().optional(),
  /**
   * L'agent dont la conversation est rattachée à cette carte alors qu'il ne
   * lui appartient pas : le chef d'orchestre qui a codé hors tâche, par
   * exemple. Sa conversation continue de vivre ailleurs.
   */
  conversationAgentId: z.string().optional(),
  /** Carte fabriquée pour du travail enregistré sans tâche. */
  horsTache: z.boolean().default(false),
  /**
   * LA CARTE MÈRE dont celle-ci est la part pour SON projet, quand elle est née
   * du lancement d'une carte d'un projet réuni (`shared/src/regroupements.ts`).
   */
  carteMereId: z.string().optional(),
  /**
   * LES CARTES FILLES posées par cette carte mère à son lancement, une par
   * projet touché. La mère ne lance aucun agent : elle suit ses filles, et se
   * range quand aucune ne travaille plus.
   */
  cartesFilles: z.array(z.object({ projectId: z.string(), cardId: z.string() })).optional(),
  /**
   * CE QUE LA MÈRE SAIT DE CHAQUE FILLE, recalculé par le démon à chaque
   * mouvement d'une fille ou de son agent (`suivreLaMere`,
   * `server/src/regroupements.ts`). Les filles vivent dans d'AUTRES projets,
   * souvent déchargés de l'écran : c'est ce résumé, et lui seul, que la mère
   * affiche dans son fil (`avecLeSuiviDesFilles`, `shared/src/regroupements.ts`).
   */
  suiviDesFilles: z.array(SuiviDUneFille).optional(),
  /**
   * LA DEMANDE CLIENT DONT CETTE CARTE EST NÉE, quand elle vient de la
   * messagerie (`espace.demande.enCarte`). Absent partout ailleurs.
   *
   * La base fait foi — `demandes.carte_id` est le vrai lien, et c'est lui que
   * le serveur interroge. Ce champ n'existe que pour que l'ÉCRAN sache, sans
   * requête, qu'une telle carte ne peut pas changer de projet : sa demande
   * appartient au client et à l'espace de son projet
   * (`shared/src/deplacement-de-projet.ts`). Il vit dans le blob `data` :
   * aucune migration, et les cartes d'avant ne l'ont simplement pas — le
   * serveur les refuse quand même.
   */
  demandeClientId: z.string().optional(),
  /**
   * LE TITRE A ÉTÉ POSÉ SANS MOTEUR, À L'ARRIVÉE DE LA DEMANDE. Il tient la
   * place — la colonne ne montre plus « Nouvelle tâche » pendant tout le
   * premier tour — mais il n'a rien lu : l'agent de cadrage doit toujours
   * écrire le sien au temps 2, et celui-là REMPLACE le provisoire
   * (`titreDeCarteADonner`, `shared/src/cadrage.ts`). Le drapeau tombe dès
   * qu'un titre est écrit par l'agent ou à la main.
   */
  titreProvisoire: z.boolean().optional(),
  /**
   * LE PARCOURS DE LA CARTE — compréhension rendue, plans versionnés, demande
   * de plan en cours, incident. Écrit par les outils du cadrage et par le
   * démon, lu par l'écran (`shared/src/parcours-carte.ts`).
   */
  parcours: ParcoursDeCarte.optional(),
  /**
   * CE QUE LE JUGE RAPIDE A DIT DE CETTE CARTE — et rien de plus : aucun de ces
   * verdicts ne supprime, ne refuse ni ne lance quoi que ce soit. Absent tant
   * qu'aucune clé n'est rangée au coffre (`shared/src/jugement-rapide.ts`).
   */
  jugements: JugementsDeCarte.optional(),
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

/**
 * Le rôle « cadrage » est l'agent LÉGER d'une carte qui vient de naître : il
 * discute le besoin dans le fil de la carte, écrit son titre, sa description et
 * son niveau, et ne touche à aucun fichier (`shared/src/cadrage.ts`). Il
 * s'efface au lancement, où un agent « task » prend la suite avec toute la
 * discussion en contexte de départ.
 */
export const AgentRole = z.enum(['task', 'analysis', 'deploy', 'cadrage']);
export type AgentRole = z.infer<typeof AgentRole>;

export const AgentStatus = z.enum(['idle', 'starting', 'running', 'stopped', 'failed', 'done']);
export type AgentStatus = z.infer<typeof AgentStatus>;

/**
 * UNE COMPRESSION DU CONTEXTE, gardée dans l'agent pour la fenêtre « Contexte du
 * modèle ». Le niveau d'après est absent tant qu'il n'a pas été mesuré.
 */
/** Pourquoi la compression native n'a pas abouti et le résumé a pris le relais. */
export type RaisonDeRepli = 'delai' | 'quota' | 'refus' | 'mesure' | 'indisponible';

export const EntreeCompression = z.object({
  at: z.number(),
  method: z.enum(['native', 'summary']),
  tokensAvant: z.number().nonnegative(),
  pourcentageAvant: z.number().int().min(0).max(100),
  tokensApres: z.number().nonnegative().optional(),
  pourcentageApres: z.number().int().min(0).max(100).optional(),
  window: z.number().positive(),
  raison: z.enum(['delai', 'quota', 'refus', 'mesure', 'indisponible']).optional(),
});
export type EntreeCompression = z.infer<typeof EntreeCompression>;

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
  /** Un agent enregistré avant cette liste n'en a pas : absent = aucune compression tracée. */
  historiqueCompressions: z.array(EntreeCompression).max(50).optional(),
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
  /**
   * L'AGENT DE CADRAGE VIENT DE DEVENIR L'AGENT D'EXÉCUTION de sa carte
   * (`shared/src/agent-unique-de-carte.ts`) : il reprend son propre fil, donc
   * aucune session neuve ne lui servira le briefing d'exécution (fichiers
   * d'instructions, dossier de travail, compétences). Ce drapeau le lui fait
   * servir au PREMIER tour d'exécution, puis tombe. Porté par l'agent, et non
   * par la demande, pour survivre à une demande remise en file faute de quota.
   */
  briefingDExecutionAttendu: z.boolean().optional(),
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
  /**
   * L'AGENT APPELÉ PAR LE BOUTON « RÉSOUDRE LE PROBLÈME » d'une publication
   * tombée (`shared/src/depannage-publication.ts`) : la publication qu'il
   * dépanne et son étape. C'est ce qui lui donne sa vignette dédiée dans
   * « Tableaux de bord », et le seul droit de relancer cette publication.
   */
  depannagePublication: z.object({ runId: z.string(), cible: z.enum(['dev', 'production']) }).optional(),
  /**
   * L'AGENT « AJOUTER UN MOTEUR » des réglages des comptes : lui seul reçoit
   * l'outil `moteurs` (déclarer, éprouver, activer un fournisseur).
   */
  ajoutDeMoteur: z.boolean().optional(),
  /**
   * L'ASSISTANT GLOBAL, ouvert par le robot en bas à droite de l'application
   * (`shared/src/assistant-global.ts`) : il reçoit SES outils, sans commande ni
   * édition de fichier, et chacun de ses gestes passe par la porte d'accord.
   */
  assistantGlobal: z.boolean().optional(),
  /** Le dernier niveau servi à l'assistant global (léger, standard, approfondi) — pour l'affichage. */
  niveauServi: z.enum(['leger', 'standard', 'approfondi']).optional(),
  /** Mesure courante du contexte ; absente tant que le moteur n'en a pas donné une vraie. */
  contextUsage: AgentContextUsage.optional(),
  /** Remplissage du contexte du modèle, distinct des quotas du compte. */
  context: AgentContext.optional(),
  pid: z.number().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  /**
   * QUAND CET AGENT SANS CARTE A ÉTÉ CONSULTÉ POUR LA DERNIÈRE FOIS. Comparé à
   * `endedAt`, il allume le point bleu de sa carte Système et la garde
   * affichée tant qu'elle n'a pas été lue (`shared/src/cartes-systeme.ts`).
   * OPTIONNEL : un agent porté par une carte n'en a pas — sa carte porte
   * `lastReadAt`.
   */
  luA: z.number().optional(),
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
  /**
   * L'IMAGE QUE L'AGENT A REGARDÉE, À SON CHEMIN SUR LE DISQUE. Une capture
   * d'écran prise pendant un essai ne se lit pas : elle se REGARDE. L'étape la
   * porte donc telle quelle, et le déroulé l'affiche sous son point
   * (`/api/capture`, `web/src/components/steps.tsx`). Optionnel : les étapes
   * déjà en base n'en ont pas.
   */
  capture: z.string().optional(),
  /**
   * LA PIÈCE JOINTE OÙ CETTE CAPTURE A ÉTÉ RANGÉE. Le démon recopie l'image
   * regardée dans les pièces jointes du projet (`server/src/captures-auto.ts`)
   * — souvent sous un autre nom (« image.png » reçoit le titre de la carte, un
   * doublon reçoit « (2) ») : ce lien permet à la bande « Ce que l'agent a vu »
   * de montrer la pièce À LA PLACE de l'étape, sans doublon
   * (`shared/src/captures-du-flux.ts`).
   */
  capturePiece: z.string().optional(),
  /**
   * L'OUTIL BRUT ET SON ENTRÉE, pour que le déroulé en direct montre le MÊME
   * encadré que le parcours de la carte.
   *
   * L'étape n'avait que son étiquette et un `detail` : dépliée, elle rendait ce
   * détail dans un pavé à chasse fixe — du JSON tronqué dès qu'il s'agissait
   * d'un outil du démon. Le nom d'appel et les paramètres voyagent donc avec
   * elle, exactement comme le journal les garde (`EntreeJournal`), et l'écran
   * relit les deux par la même règle pure (`vueDeLEntree`).
   */
  outil: z.string().optional(),
  /** Les paramètres de l'appel, en JSON, bornés comme ceux du journal. */
  entree: z.string().optional(),
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
   * La synthèse entière du besoin, telle qu'elle sera déposée dans le fil de
   * l'agent une fois la carte validée (`shared/src/synthese-du-besoin.ts`).
   */
  briefing: z.string().optional(),
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
  /**
   * LE PROJET OÙ NAÎTRA LA CARTE, quand ce n'est pas celui de la conversation :
   * la proposition de l'agent d'un site surveillé naît dans le projet du site
   * (`shared/src/projet-de-proposition-de-site.ts`). Absent : le projet de
   * l'agent qui propose.
   */
  projectId: z.string().optional(),
  /**
   * LES NOTES DU JUGE RAPIDE : le gain attendu, l'ampleur du travail, et le rang
   * qui en découle. Elles ne servent qu'à ORDONNER — aucune proposition n'est
   * jamais retirée, refusée ni fusionnée pour une note basse. Absentes tant
   * qu'aucune clé n'est rangée au coffre (`shared/src/jugement-rapide.ts`).
   */
  interet: z
    .object({ gain: z.number(), ampleur: z.number(), rang: z.number(), at: z.number() })
    .optional(),
});
export type TaskProposal = z.infer<typeof TaskProposal>;

/**
 * Une question posée par l'agent (PLAN §10, esprit) : il attend votre réponse
 * avant de continuer. Choix unique, choix multiple, ou texte libre.
 */
export const AgentQuestion = z.object({
  id: z.string(),
  question: z.string(),
  /**
   * CE QU'IL FAUT SAVOIR POUR RÉPONDRE. La question tient en une phrase, mais
   * ce qui la motive — le constat, les deux chemins possibles, ce que l'agent
   * a déjà vu — ne tenait nulle part : l'agent le noyait dans l'intitulé, qui
   * devenait un pavé, ou le laissait dehors, et l'on répondait à l'aveugle.
   * Ce texte se lit SOUS la question, avant les choix.
   */
  description: z.string().optional(),
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
  /**
   * CETTE QUESTION EST UNE COMPÉTENCE PROPOSÉE PAR BELUGA BUILD, pas une
   * question de l'agent (`shared/src/proposition-competence.ts`). Elle
   * s'affiche dans son propre encadré violet — un par compétence, tous
   * visibles ensemble — et sa réponse (« Utiliser » / « Pas utile ») s'écrit
   * aussi sur la carte.
   */
  competence: z.object({ nom: z.string(), titre: z.string() }).optional(),
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
  /** La relève a été choisie par la répartition automatique, sans clic. */
  automatique: z.boolean().optional(),
  /**
   * LA DÉCISION A ÉTÉ FERMÉE SANS CHOIX — bouton d'annulation de la bulle, ou
   * carte rangée dans une colonne close. Ce n'est pas une réponse : rien ne
   * repart, le bloc se referme et la décision cesse d'être comptée. Sans ce
   * drapeau, une reprise de compte oubliée restait ouverte À VIE — c'est elle
   * qui rallumait « Répondre / Annuler » sur des cartes « En production ».
   */
  abandonnee: z.boolean().optional(),
  abandonneeA: z.number().optional(),
  choisiLabel: z.string().optional(),
  choisiA: z.number().optional(),
  /**
   * LE MOTEUR ET LE MODÈLE RETENUS AU CLIC, quand la reprise en change. Absents,
   * le travail est reparti sur le moteur et le modèle du tour coupé.
   */
  choisiMoteur: EngineId.optional(),
  choisiModele: z.string().optional(),
  /**
   * LA CHAÎNE DES RELÈVES (`chaineDeReprise`, `shared/src/reprise-compte.ts`) :
   * tous les comptes tombés d'affilée sur ce même travail, le dernier compris,
   * et combien de relèves automatiques se sont déjà enchaînées. Sans eux, la
   * relève automatique ne connaissait que le compte tombé au tour d'AVANT et
   * pouvait rebondir de A à B puis de B à A sans fin, dès que le relevé de
   * quota disait « disponible » un compte que le moteur refusait.
   */
  comptesEssayes: z.array(z.string()).optional(),
  relevesEnChaine: z.number().int().nonnegative().optional(),
  /**
   * LA REPRISE A ÉTÉ CONSOMMÉE : le tour de reprise a RÉELLEMENT été lancé sur
   * le compte choisi (`startTurn`, `server/src/runtime.ts`). Une reprise a
   * trois issues — choisie, consommée, abandonnée — et jamais deux tours : la
   * demande de reprise qui attendait en file est jetée dès que ce champ est
   * posé, y compris après un redémarrage du démon. Sans lui, la consigne
   * « REPRISE APRÈS ÉPUISEMENT DU QUOTA » repartait vers un tour déjà terminé.
   */
  consommeeA: z.number().optional(),
  at: z.number(),
});
export type RepriseDeCompte = z.infer<typeof RepriseDeCompte>;

/**
 * UN TOUR COUPÉ NET PAR UNE ERREUR — ni une panne passagère du fournisseur
 * (elle se retente toute seule), ni une limite de compte (sa propre route).
 * Le message porte cette décision : relancer le même agent, ignorer l'échec
 * et ranger la carte telle quelle, ou l'arrêter et la remettre en file.
 */
export const ErreurDeTour = z.object({
  /** La cause telle qu'elle a été vue — dernière ligne du moteur, ou du protocole. */
  cause: z.string(),
  at: z.number(),
  /** Posé une fois, il ferme la décision pour de bon. */
  choix: z.enum(['relancer', 'ignorer', 'arreter']).optional(),
  choisiA: z.number().optional(),
  /**
   * LA DEMANDE QUE CE TOUR N'A JAMAIS PORTÉE. Un tour tombé APRÈS le moteur a
   * un travail commencé : « Relancer » lui dit de continuer où il s'était
   * arrêté. Un tour mort AVANT le moteur, lui, n'a rien commencé du tout —
   * la phrase de l'utilisateur est restée seule au fil, sans réponse et sans
   * reprise. On garde donc l'identifiant de ce message : « Relancer » le
   * RENVOIE, tel quel, au lieu de demander de poursuivre un travail qui
   * n'existe pas.
   */
  demandeARejouer: z.string().optional(),
  /**
   * LA PHRASE SIMPLE, quand la cause est un message de machine qu'aucun motif
   * ne reconnaît et que Laya l'a rangée dans une famille
   * (`server/src/explication-d-erreur.ts`). Absente, l'écran calcule lui-même
   * la phrase de famille (`phraseDeLErreurDeTour`). `cause` reste le brut.
   */
  phrase: z.string().optional(),
  famille: z.string().optional(),
});
export type ErreurDeTour = z.infer<typeof ErreurDeTour>;

export const DownloadOffer = z.object({
  id: z.string(),
  label: z.string(),
  size: z.number().optional(),
  expiresAt: z.number(),
});
export type DownloadOffer = z.infer<typeof DownloadOffer>;

/** Une part du contenu assemblé par Beluga Build pour ce tour. */
export const SentContextBlock = z.object({
  kind: z.enum(['request', 'briefing', 'memory', 'card', 'attachment', 'extra', 'format', 'system']),
  label: z.string(),
  characters: z.number().int().nonnegative(),
  /**
   * Le texte réel de ce bloc, tel qu'envoyé au moteur — c'est ce que lit le
   * lecteur de prompts. Absent quand un texte purgé pour borner le disque
   * (`purgerContexteEnvoyeAncien`), ou quand le bloc n'est pas isolable en
   * clair (gabarit Beluga Build réparti dans le prompt).
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
 * Une recherche de contexte faite par l'agent pendant un tour.
 *
 * La mémoire initiale fait partie du prompt. Les recherches suivantes arrivent
 * par `project_memory` ou par le catalogue des compétences, APRÈS cet envoi :
 * il faut donc les garder à part, dans l'ordre, avec le texte exact rendu.
 */
export const ConsultationMemoire = z.object({
  id: z.string(),
  /** Les anciens tours n'ont pas ce champ : ils venaient tous de la mémoire. */
  source: z.enum(['memoire', 'competence']).optional(),
  /** Le sujet ou le mot de branche demandé ; vide signifie l'index. */
  requete: z.string().default(''),
  /** Le texte exact rendu par l'outil, avant toute reformulation. */
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
export const SentContextEtat = z.object({
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
   * exactement ce qui a duré des jours sur Beluga Build, dont la couverture était
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
export type SentContextEtat = z.infer<typeof SentContextEtat>;

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
  /**
   * CE TOUR EN POURSUIT UN AUTRE : l'identifiant du message du tour coupé par
   * une limite. Le parcours de la carte rattache un tour de poursuite au point
   * de celui qu'il poursuit — ni nouvelle « Demande », ni nouvelle
   * « Compréhension » (`shared/src/parcours-en-points.ts`).
   */
  poursuiteDe: z.string().optional(),
  /** Ce tour a été coupé net par une erreur : relancer, ignorer, ou arrêter ? */
  erreurDeTour: ErreurDeTour.optional(),
  /**
   * Ce message finit sur une question écrite en TEXTE ORDINAIRE (pas par
   * l'outil `ask_user`) et le bouton « Annuler » du repère l'a fermée : elle ne
   * compte plus comme décision attendue (`questionEnTexteLibre` la retire).
   */
  texteLibreAnnulee: z.boolean().default(false),
  downloads: z.array(DownloadOffer).default([]),
  attachments: z.array(z.string()).default([]),
  /** Vrai tant que l'agent écrit encore ce message. */
  streaming: z.boolean().default(false),
  /**
   * Jetons associés au message : le poids ESTIMÉ de ce message précis sur une
   * demande (`jetonsMessageEnvoye`, jamais le cumul du tour agentique qui a
   * suivi), le total RÉEL du tour sur la réponse.
   */
  tokens: z.number().optional(),
  /** Ce que Beluga Build a réellement transmis pour cette demande utilisateur. */
  sentContext: SentContextEtat.optional(),
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
  /*
   * LA BULLE EST DÉJÀ ÉCRITE : VOICI LAQUELLE.
   *
   * Une demande enregistrée et affichée dès son arrivée peut malgré tout
   * retomber en file — c'est le cas quand plus aucun compte n'a de quota. Son
   * message existe alors déjà dans la conversation : le tour qui la dépilera
   * doit le REPRENDRE, jamais en écrire un second. Sans ce repère, la même
   * phrase s'affichait deux fois dès qu'un quota manquait.
   *
   * Vide pour une demande empilée sans bulle (agent occupé) : celle-là écrira
   * la sienne à son départ.
   */
  messageId: z.string().optional(),
  /*
   * UNE DEMANDE MISE EN FILE GARDE L'IDENTITÉ DE SON TOUR.
   *
   * La file ne transportait qu'un texte et ses pièces jointes. Tout ce qui
   * distinguait une demande INTERNE d'un message tapé par l'utilisateur y
   * restait : son silence et son compte imposé. Or c'est par cette file que
   * passe la reprise après épuisement — l'agent est encore marqué occupé quand
   * elle part, puisque la fin de tour se joue DANS sa préparation. La reprise
   * repartait donc sans son compte (le choix automatique reprenait le compte à
   * sec) et sans son silence (sa consigne s'affichait comme un message de
   * l'utilisateur). Le tour retombait aussitôt sur la même limite, qui reposait
   * la même question : « Sur quel compte poursuivre ? », indéfiniment.
   *
   * Constaté le 06.09.2026 : dix questions de compte sur le même agent, chacune
   * répondue « Claude Max x20 », chacune repartie sur « Claude Pro ».
   */
  /** Cette demande ne s'affiche pas comme un message de l'utilisateur. */
  silencieuse: z.boolean().optional(),
  /** Le compte IMPOSÉ à ce tour, choisi à la main ou par la relève. */
  compteImpose: z.string().optional(),
  /**
   * Cette demande POURSUIT un travail coupé : le tour qui la dépilera reprend
   * la liste de tâches du tour d'avant au lieu de repartir sur une liste vide.
   * Même raison que le silence et le compte : ce qui distingue une reprise d'un
   * départ ne doit pas se perdre en file.
   */
  poursuite: z.boolean().optional(),
  /**
   * LA REPRISE QUE CETTE DEMANDE PORTE : l'identifiant du message du tour coupé
   * par une limite. La file la jette si cette reprise est déjà consommée ou
   * abandonnée — une reprise ne se rejoue jamais vers un tour déjà terminé.
   */
  repriseDe: z.string().optional(),
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

/**
 * LE FORFAIT MENSUEL D'UN COMPTE MIMO, saisi à la main : Xiaomi ne le publie
 * pas. Tout est optionnel — un compte sans plafond n'a pas de barre.
 * `consommeAuReleve` est ce que la console Xiaomi affichait à `releveAt`.
 */
export const ForfaitMensuel = z.object({
  /** Le plafond du mois, en jetons. */
  plafond: z.number().positive().optional(),
  /** Une date de renouvellement (ms) : passée ou à venir, le cycle est mensuel. */
  renouvellement: z.number().optional(),
  /** Le consommé lu dans la console Xiaomi, en jetons. */
  consommeAuReleve: z.number().nonnegative().optional(),
  /** Quand ce consommé a été relevé (ms). */
  releveAt: z.number().optional(),
});
export type ForfaitMensuel = z.infer<typeof ForfaitMensuel>;

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
  /**
   * LA LIMITE CONNUE DE CE COMPTE : un tour est tombé dessus, et son échéance
   * n'est pas passée (`server/src/limites-connues.ts`). Distinct d'`available`,
   * qui vient du RELEVÉ — un manque de crédits ne s'y voit pas. Tant qu'elle est
   * posée, le choix de compte écarte ce compte et le bloc « Avec quel compte
   * poursuivre ? » ne le propose pas.
   */
  limiteConnue: z
    .object({
      motif: z.enum(['limite-structuree', 'texte-de-limite']),
      resetsAt: z.number().optional(),
      echeance: z.number(),
    })
    .optional(),
  session: QuotaWindow.optional(),
  weekly: QuotaWindow.optional(),
  /**
   * USAGE CURSOR, lu sur son tableau de bord (`shared/src/credit-cursor.ts`) :
   * forfait, part consommée des deux paniers, cycle, dépense à la demande.
   * Absent sur Claude et Codex. Illisible, `indisponible` porte la raison —
   * jamais un zéro.
   */
  credit: z
    .object({
      forfait: z.string().optional(),
      prix: z.string().optional(),
      cursorPct: z.number().optional(),
      autresPct: z.number().optional(),
      totalPct: z.number().optional(),
      debutDuCycle: z.number().optional(),
      finDuCycle: z.number().optional(),
      demandeCentimes: z.number().optional(),
      demandeLimiteCentimes: z.number().optional(),
      indisponible: z.string().optional(),
      /**
       * UNE LIGNE D'ÉTAT, pour un moteur payé à l'usage qui ne publie aucun
       * chiffre (Xiaomi MiMo) : « clé active », « solde épuisé ».
       */
      resume: z.string().optional(),
      /** Le fournisseur a refusé faute de solde : le compte est à recharger. */
      soldeEpuise: z.boolean().optional(),
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
  /**
   * LA BARRE DU MOIS d'un abonnement Xiaomi MiMo, calculée ici
   * (`shared/src/usage-mesure.ts`) : le forfait saisi dans les réglages du
   * compte, plus ce que Beluga a envoyé depuis. Une ESTIMATION — la même clé
   * peut servir ailleurs —, volontairement À PART de `session` et `weekly` :
   * rien — choix de compte, alertes, prévision — ne doit la lire comme un
   * solde. Objet présent sans `mois` : aucun plafond saisi, donc aucune barre.
   */
  usageMesuree: z.object({ mois: QuotaWindow.optional() }).optional(),
  /** Le forfait mensuel tel que l'utilisateur l'a saisi, pour préremplir son formulaire. */
  forfaitMensuel: ForfaitMensuel.optional(),
  /**
   * LIGNE DE SUIVI SEULEMENT : un fournisseur dont on regarde l'état sans jamais
   * lui confier un travail (Google Gemini). Aucun compte derrière — ni
   * interrupteur, ni choix, ni secours.
   */
  suivi: z.boolean().optional(),
  /**
   * LES AUTRES COMPTES QUI RENDENT EXACTEMENT LE MÊME RELEVÉ (mêmes
   * pourcentages ET même échéance de fenêtre). Deux comptes réellement
   * distincts ne le peuvent pas : leurs coffres aboutissent au même abonnement
   * chez le fournisseur. Absent dans le cas normal — un seul compte par
   * abonnement (`shared/src/comptes-jumeaux.ts`).
   */
  jumeaux: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  /**
   * SUR QUOI REPOSE LE JUMELAGE : `true` quand les deux coffres ont rendu le
   * MÊME identifiant de compte chez le fournisseur (c'est lu, pas déduit),
   * `false` quand seule la coïncidence des chiffres le laisse supposer.
   */
  jumeauxCertains: z.boolean().optional(),
  /**
   * QUI EST DERRIÈRE CE COFFRE, lu sur le profil du fournisseur avec le jeton
   * du compte — jamais deviné. Absent quand le profil n'a pas répondu : l'écran
   * dit alors « identité non lue », et le relevé reste servi tel quel.
   */
  identite: z
    .object({
      compteFournisseur: z.string().optional(),
      adresse: z.string().optional(),
      nom: z.string().optional(),
      organisation: z.string().optional(),
      palier: z.string().optional(),
      luA: z.number().optional(),
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

export const CapacityEtat = z.object({
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
  /**
   * Chacune des TROIS limites qui composent `slotsFree`, à part, pour que le
   * message de refus désigne la vraie cause au lieu d'accuser systématiquement
   * le plafond d'agents. Absent quand la machine n'a pas ce mur (pas de cgroup,
   * plafond de tâches illimité).
   */
  placesParMemoire: z.number().optional(),
  placesParTaches: z.number().optional(),
  /** Départs réellement possibles tout de suite : les places, moins le frein de charge. */
  startableNow: z.number().optional(),
  paused: z.boolean().default(false),
  pauseReason: z.string().optional(),
  /** La charge processeur ralentit les départs : la cause, écrite en clair. */
  loadHoldReason: z.string().optional(),
  avgAgentMemMb: z.number().optional(),
  /**
   * LA TABLE DES PROCESSUS : fils d'exécution en cours, et le plafond du noyau.
   *
   * La mémoire vive n'est pas la seule chose qui manque quand une machine
   * refuse de lancer un programme (« Cannot fork ») : le noyau borne aussi le
   * nombre de fils. C'est ce mur-là qui tuait un pont d'outils avant qu'il ait
   * dit un mot (`pressionDeProcessus`).
   */
  filsUtilises: z.number().optional(),
  filsMax: z.number().optional(),
  /** Sa part occupée, en %. */
  filsPct: z.number().optional(),
  /** Le fichier d'échange, en Mo — absent quand la machine n'en a pas. */
  swapUsedMb: z.number().optional(),
  swapTotalMb: z.number().optional(),
  /** Sa part occupée, en %. Un remplissage seul ne veut rien dire. */
  swapPct: z.number().optional(),
  /**
   * Son DÉBIT, en kilo-octets par seconde : les pages qui font l'aller-retour
   * entre le disque et la mémoire vive. C'est CELA qui dit qu'une machine rame,
   * pas son remplissage. Absent à la toute première lecture, faute d'écart.
   */
  swapDebitKoS: z.number().optional(),
  /**
   * LE PLAFOND DE TÂCHES DU SERVICE, et ce qu'il en reste.
   *
   * `TasksMax` du cgroup : tout ce que le démon lance y vit — agents, moteurs,
   * compilateurs, navigateurs de contrôle. Plein, il refuse tout `fork` de
   * plus, à mémoire large, et rien ne le disait : la jauge annonçait de la
   * place pendant que « Cannot fork » tombait déjà (08.09.2026). Absent sur
   * une machine sans cgroup ou dont le plafond est illimité.
   */
  tasksCurrent: z.number().optional(),
  tasksMax: z.number().optional(),
  /** Sa part occupée, en %. */
  tasksPct: z.number().optional(),
  /**
   * Combien de fois le plafond a REFUSÉ un `fork` depuis le démarrage du
   * service (`pids.events`, compteur `max`). Zéro tant qu'il n'a jamais mordu :
   * c'est la seule preuve après coup qu'une saturation venait bien de là.
   */
  tasksRefus: z.number().optional(),
  at: z.number(),
});
export type CapacityEtat = z.infer<typeof CapacityEtat>;

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
  /* Plus posée par aucune publication neuve (23/09/2026) : gardée pour que les
     publications d'avant, qui la portent en base, se relisent sans erreur. */
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
              genre: z.enum(['debut', 'progression', 'commande', 'depannage', 'sous-etape', 'issue']),
              texte: z.string(),
              /* L'état d'un moment qui DURE : une sous-étape de construction
                 part « en cours », puis se referme en « fait » ou « échec ».
                 Optionnel : un moment ordinaire n'en a pas, et tout fil écrit
                 avant cette règle se relit à l'identique. */
              etat: z.enum(['encours', 'fait', 'echec', 'saute', 'rattrape']).optional(),
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
   * PUBLICATION D'UN SEUL DÉPÔT : le dépôt dont le bouton a été cliqué. Les
   * cartes retenues sont celles qui le modifient, chacune avec tous ses dépôts ;
   * une relance refait la même demande. Absent : tout le lot.
   */
  depot: z.string().optional(),
  /**
   * LE SORT DE CHAQUE DÉPÔT ANNEXE dans cette publication
   * (`shared/src/depots-du-projet.ts`) : l'enregistrement poussé, l'état et ce
   * qui s'est passé. Le dépôt principal garde `targetCommit` et les étapes.
   * OPTIONNEL : absent sur tout projet à dépôt simple.
   */
  depots: z
    .array(
      z.object({
        nom: z.string(),
        etat: z.enum(['attente', 'en-cours', 'reussi', 'echec', 'rien']),
        targetCommit: z.string().optional(),
        recit: z.string().optional(),
      }),
    )
    .optional(),
  /**
   * OÙ EN EST CHAQUE TÂCHE DU LOT, une ligne par carte embarquée.
   *
   * `cardIds` ne dit qu'un NOMBRE, et les six étapes racontent le PARCOURS :
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
        /** Une tâche ÉCARTÉE : ses fichiers en heurt et les cartes du lot
         *  contre qui (`mentionDeLEcartement`, MEM-1064). */
        ecart: z
          .object({
            fichiers: z.array(z.string()).default([]),
            brancheDAccueil: z.string().optional(),
            contre: z
              .array(
                z.object({
                  cardId: z.string(),
                  titre: z.string().default(''),
                  branche: z.string().optional(),
                  commit: z.string().optional(),
                  fichiers: z.array(z.string()).default([]),
                }),
              )
              .default([]),
          })
          .optional(),
        /** Le rattrapage de la carte écartée : UNE tentative par publication
         *  et par carte (`shared/src/rattrapage-ecartee.ts`). */
        rattrapage: z
          .object({
            etat: z.enum(['prevu', 'attente-quota', 'lance', 'revenu', 'echec', 'sans-objet']),
            at: z.number(),
            par: z.enum(['automatique', 'humain']).optional(),
            apresRedemarrage: z.boolean().optional(),
            detail: z.string().optional(),
          })
          .optional(),
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
  /**
   * LE DÉPANNAGE DEMANDÉ À LA MAIN sur cette publication tombée : l'agent
   * ouvert par « Résoudre le problème », écrit ICI pour que le même bouton le
   * rouvre — volet refermé, projet quitté, démon redémarré. `relanceDemandee`
   * est l'instant où l'agent a demandé la relance de la publication.
   */
  depannage: z
    .object({
      agentId: z.string(),
      at: z.number(),
      relanceDemandee: z.number().optional(),
      /** Vrai quand le démon l'a ouvert seul, à la chute de la publication (sans clic). */
      automatique: z.boolean().optional(),
    })
    .optional(),
  /**
   * Combien de dépanneurs AUTOMATIQUES ont déjà travaillé sur les publications
   * précédentes de cette même chaîne de relances. Une relance crée une NOUVELLE
   * publication : le plafond ne peut pas se compter sur une seule. Une réussite
   * ou une relance à la main repart de 0 (`MAX_DEPANNAGES_AUTOMATIQUES`).
   */
  depannagesAuto: z.number().default(0),
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
  /**
   * QUAND CETTE PUBLICATION A ÉTÉ CONSULTÉE POUR LA DERNIÈRE FOIS. Une mise en
   * production terminée garde sa carte Système, point bleu allumé, tant que
   * cet instant ne dépasse pas sa fin (`shared/src/cartes-systeme.ts`).
   * OPTIONNEL, jamais `default` : toute publication déjà en base se relit.
   */
  luA: z.number().optional(),
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
  dailyDigestHour: z.number().optional(),
  backupHour: z.number().default(3),
  /**
   * LES BACKUPS DES SITES EN PRODUCTION (`shared/src/backups.ts`). Le
   * DOSSIER est celui du disque de stockage monté sur la machine (Hetzner ou
   * autre) : vide, aucun backup ne part et l'écran le DIT — on ne devine pas
   * un point de montage. L'heure suit celle de la sauvegarde du démon, pour ne
   * pas charger le disque deux fois en même temps.
   */
  backupDossier: z.string().default(''),
  backupHeure: z.number().default(4),
  backupAuto: z.boolean().default(true),
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
  cadrageEngine: z.string().optional(),
  cadrageModel: z.string().optional(),
  cadrageThinking: z.string().optional(),
  /**
   * LES USAGES DU JUGE RAPIDE ÉTEINTS À LA MAIN. Un usage absent de cette
   * liste suit sa fiche (`parDefaut`) — mais il ne s'exerce que si Laya, le
   * modèle local, est installé sur cette machine : sans lui, aucun jugement
   * n'est rendu, quelle que soit cette liste (`shared/src/jugement-rapide.ts`).
   */
  jugeEteints: z.array(z.string()).default([]),
  /** Le pendant : les usages éteints par défaut, rallumés à la main. */
  jugeAllumes: z.array(z.string()).default([]),
  /**
   * LA RÉPARTITION DU MODE « CRÉATION » : quel moteur écrit le texte, lequel
   * programme, lesquels donnent un avis, et combien d'avis par tour. Un réglage
   * GLOBAL ; l'agent peut suggérer autre chose, pour une carte seulement.
   */
  creation: ReglageCreation.default({}),
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
