import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  Agent,
  AgentRole,
  Ampleur,
  CONSIGNE_CREATION_PROJET,
  CONSIGNE_CARTE_COURTE,
  CONSIGNE_NIVEAU_AGENT,
  DOSSIER_PLANS,
  EXTENSIONS_DOCUMENT,
  Card,
  DeployRun,
  ETAPE_CARTE,
  ETAPE_CARTE_ID,
  ETAPE_FOND,
  ETAPE_FOND_ID,
  ETAPE_PLAN,
  ETAPE_PLAN_ID,
  ETAPE_PONT,
  ETAPE_PONT_ID,
  EngineId,
  MEMORY_STEP_ID,
  Message,
  Project,
  RunStep,
  PassageRetrouve,
  ConsultationMemoire,
  SentContextBlock,
  SentContextSnapshot,
  decisionRepriseCoupure,
  TaskProposal,
  TemplateKind,
  TodoItem,
  TurnMeasurement,
  ampleurDuTour,
  checkTemplate,
  motifDArretQuota,
  arretDuAuQuota,
  ETAPE_PANNE_ID,
  causeEnClair,
  demandeDeRepriseApresPanne,
  libelleDeLEtape,
  libelleDeLaReprise,
  messageDePanneDefinitive,
  MotifDeContinuite,
  filARappeler,
  messagesDepuis,
  tachesAPoursuivre,
  cloturerLesTaches,
  progressionDesTaches,
  cleDeSession,
  partMoteurDeLaCle,
  colonneAuDemarrage,
  etatApresCoupure,
  TraceDuTravail,
  RAISON_COUPE_EN_VOL,
  cumulerPartsQuota,
  contexteApresCompression,
  decisionEnTexteLibre,
  enteteDuTour,
  etatDuPont,
  noteDePontEnEchec,
  finaliserAnalyseDeProposition,
  libelleSujet,
  texteDuSommaire,
  MemoireDeReprise,
  type MotifDAppel,
  type NiveauDAccueil,
  niveauDAccueil,
  partsDAccueil,
  planEnAttente,
  consigneDeRepriseDuPlan,
  dernierPlanRedige,
  jugerLePlan,
  jugerLeFond,
  AVERTISSEMENT_SANS_CARTE,
  carteAnnonceeSansOutil,
  carteDecriteEnTexte,
  consigneDeCarteReelle,
  consigneDeDernierRappel,
  MIN_SIGNES_CARTE_COURTE,
  NIVEAU_PAR_DEFAUT,
  type CarteRelue,
  consigneDePlanEntier,
  consigneDePlanPlusFouille,
  nomDeBranche,
  observerContexte,
  plafondDeContexte,
  poidsDeTour,
  RAISON_ARBRE,
  type OrigineDeBloc,
  consigneEspaceDuChef,
  detailDuRefus,
  resumeContinuite,
  ROLES_QUI_DEPLACENT,
  SUJETS_MEMOIRE,
  sujetsUtiles,
  templateForColumn,
  wrapPrompt,
  mesurerContexte,
  jetonsMessageEnvoye,
  PLAFOND_APPEL_APRES_REPONSE_MS,
  delaiOutilMoteurMs,
  statutDeFermetureForcee,
  tourBloque,
  ecritureOrpheline,
  decisionDArret,
  seDitAuTravail,
  RAISON_ARRET_DE_SECOURS,
  RAISON_ARRET_SANS_REPONSE,
  MESSAGE_ARRET_ACHEVE,
  DELAI_CONFIRMATION_ARRET_MS,
  arretAAchever,
} from '@haikodev/shared';
import type { DecisionDArret } from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { CONFIG, PATHS } from './config.js';
import { adapterFor, contextWindowFor, EngineAdapter, EngineEvent, EngineHandle } from './engines/index.js';
import { acheverLArbre } from './engines/fin-de-processus.js';
import { agentLog, log } from './logger.js';
import { getInternalToken } from './auth.js';
import {
  blocMemoire,
  briefingSepare,
  empreintesDesFaits,
  faitsDuSujet,
  memoryFacts,
  memorySummary,
  newFactsSince,
} from './memory.js';
import { allDone, mergeTodos } from './todos.js';
import { callTool, orchestratorAllowList, orchestratorDenyList, toolsFor, writeMcpConfig } from './tools.js';
import {
  AccountRecord,
  pickAccount,
  noteAccountUse,
  applyAccountEnv,
  limiteBloquante,
  listAccountRecords,
  partsQuotaEnCache,
  relireQuotaDuCompte,
} from './accounts.js';
import { poserDecisionDeReprise, repriseDeCompte } from './reprise-compte.js';
import { notify } from './notify.js';
import {
  cartesDuTravailHorsTache,
  fichiersRemues,
  traceDuTravailDuTour,
  repereAvant,
} from './hors-tache.js';
import { carteApresFinDeTour } from './deplacement-carte.js';
import { envGithub } from './github.js';
import { oublierLePont, passageDuPont } from './pont.js';
import { agentEnAttente, libererLesAttentes, oublierToutesLesAttentes } from './attente-question.js';
import { ouvrirDossierDeCarte, refermerDossierDeCarte } from './dossier-de-carte.js';
import { lancerAvecRelances } from './relance-moteur.js';

export interface LiveRun {
  agentId: string;
  /**
   * L'identifiant de CE tour. Le pont d'outils le recopie depuis sa
   * configuration et le renvoie à chaque appel : c'est la preuve que l'appel
   * vient bien du tour qui tourne, et non d'un fichier resté sur le disque ou
   * lu dans le dépôt d'un voisin (`shared/src/pont-outils.ts`).
   */
  tourId: string;
  handle: EngineHandle;
  messageId: string;
  /** Le message qui porte la bulle « Mémoire transmise » de ce tour. */
  contexteMessageId: string;
  /** Ouvertures de mémoire déjà revenues pendant ce tour, dans leur ordre. */
  consultationsMemoire: ConsultationMemoire[];
  startedAt: number;
  steps: Map<string, RunStep>;
  todos: TodoItem[];
  /** La liste entièrement cochée n'est annoncée qu'une fois par tour. */
  todosNotified?: boolean;
  text: string;
  usage?: EngineEvent['usage'];
  context?: { tokens: number; window?: number };
  account?: string;
  quota5h: number;
  quotaSemaine: number;
  /** Le tour reste occupé pendant la compression, mais ne pèse plus dans le quota partagé. */
  quotaTermine?: boolean;
  /**
   * Le moteur a annoncé une limite BLOQUANTE par un événement structuré pendant
   * ce tour : c'est la preuve la plus sûre qu'un arrêt vient du quota.
   */
  limiteSignalee?: boolean;
  stopping?: boolean;
  /**
   * L'instant où la réponse a été FIGÉE à l'écran. Après lui, plus rien de ce
   * que fait le tour n'est visible : c'est la fenêtre où un agent pouvait rester
   * « au travail » des heures pour une compression qui ne rendait pas la main.
   * La veille des tours bloqués s'appuie sur ce repère.
   */
  reponseFigeeA?: number;
  /**
   * Le dernier signe de vie du moteur : l'instant du dernier événement reçu.
   * Posé au lancement, rafraîchi à chaque événement. C'est le seul repère qui
   * distingue un moteur QUI TRAVAILLE d'un moteur vivant mais muet pour
   * toujours — la veille des tours bloqués s'en sert en dernier recours.
   */
  dernierSigneDeVie: number;
}

const live = new Map<string, LiveRun>();

/** Dernier relevé dont la hausse a déjà été répartie, compte par compte. */
const dernierQuotaReparti = new Map<string, { session?: number; weekly?: number }>();

/*
 * L'ALERTE DE PANNE NE SE DIT QU'UNE FOIS PAR SESSION VIVANTE DU MOTEUR.
 *
 * Chaque nouvel envoi qui tombe sur une panne encore en cours relance sa
 * propre boucle d'essais (`lancerAvecRelances`) : sans mémoire d'un tour à
 * l'autre, la bannière « Panne passagère du moteur » réapparaissait à CHAQUE
 * message tant que le fournisseur restait perturbé — bruyant, et redondant
 * dès le second envoi. Un tour qui a déjà montré la bannière et fini par
 * réussir marque l'agent ici : les prochains hoquets du même fil se retentent
 * en silence, jusqu'à ce qu'une session NEUVE (`nouvelleSession`) remette le
 * compteur à zéro.
 */
const panneDejaSignalee = new Map<string, boolean>();

/** Deux fins très proches passent dans cette file pour partager les relevés dans l'ordre. */
const filesRepartitionQuota = new Map<string, Promise<void>>();

async function enSerieSurCompte<T>(accountId: string, travail: () => Promise<T>): Promise<T> {
  const precedente = filesRepartitionQuota.get(accountId) ?? Promise.resolve();
  let liberer!: () => void;
  const verrou = new Promise<void>((resolve) => {
    liberer = resolve;
  });
  const file = precedente.then(() => verrou);
  filesRepartitionQuota.set(accountId, file);
  await precedente;
  try {
    return await travail();
  } finally {
    liberer();
    if (filesRepartitionQuota.get(accountId) === file) filesRepartitionQuota.delete(accountId);
  }
}

export function isRunning(agentId: string): boolean {
  return live.has(agentId);
}

export function runningAgentIds(): string[] {
  return [...live.keys()];
}

/**
 * Les agents dont le tour est PARTI mais dont le processus n'est pas encore né.
 *
 * Entre le moment où l'on décide de lancer une carte et celui où le moteur
 * tourne vraiment, il se passe plusieurs secondes : copie de travail à ouvrir
 * (`git worktree`), compte à choisir, contexte à composer. Pendant toute cette
 * fenêtre, `live` est encore vide — un redémarrage automatique de fin de
 * publication ne voyait donc personne travailler et coupait un agent qui venait
 * juste de partir. On tient donc à part la liste de ceux qui démarrent.
 *
 * Chaque préparation porte l'INSTANT de son départ — sans lui, rien ne
 * permettait de dire qu'elle durait depuis trop longtemps — et un JETON qui ne
 * sert qu'une fois. Le jeton est le garde-fou : une préparation abandonnée
 * (retirée d'ici par la veille ou par un arrêt à la main) peut très bien se
 * réveiller plus tard, alors qu'un tour tout neuf est reparti de la file. Elle
 * constate alors que le jeton n'est plus le sien et se retire sans rien toucher,
 * au lieu de poser son moteur sur l'agent d'un autre ou de refermer son tour.
 */
const demarrant = new Map<string, { depuis: number; jeton: number }>();

/** Un numéro de préparation qui ne se répète jamais dans la vie du démon. */
let prochainePreparation = 1;

/**
 * Tous les agents qu'un redémarrage COUPERAIT : ceux dont le moteur écrit, et
 * ceux dont le tour est en train de partir. C'est cette liste-là que doivent
 * regarder le bouton de redémarrage et la fin d'une publication — jamais le
 * seul compte des processus déjà nés.
 */
export function agentsActifs(): string[] {
  // `live` d'abord (le moteur écrit), puis ceux qui démarrent : un même agent
  // peut être dans les deux, on ne le compte qu'une fois.
  return [...new Set([...live.keys(), ...demarrant.keys()])];
}

/**
 * Ce que fait chaque agent actif, en une phrase courte — pour que « un agent
 * travaille » nomme le projet (et la carte, s'il en a une) au lieu de rester
 * anonyme. Un agent de rôle « task », le seul que le tableau affiche, dit sa
 * carte ; les autres rôles (chef d'orchestre, analyse, déploiement) restent
 * invisibles du tableau et des projets — sans cette phrase, rien ne permet de
 * les retrouver.
 */
export function agentsActifsDetail(): string[] {
  const details: string[] = [];
  for (const id of agentsActifs()) {
    const agent = store.getAgent(id);
    if (!agent) continue;
    const projet = store.getProject(agent.projectId)?.name ?? 'un projet inconnu';
    if (agent.role === 'task' && agent.cardId) {
      const carte = store.getCard(agent.cardId);
      details.push(carte ? `la carte « ${carte.title} » (${projet})` : `une carte du projet « ${projet} »`);
    } else if (agent.role === 'orchestrator') {
      details.push(`le chef d’orchestre du projet « ${projet} »`);
    } else if (agent.role === 'analysis') {
      details.push(`une analyse du projet « ${projet} »`);
    } else if (agent.role === 'deploy') {
      details.push(`une mise en production du projet « ${projet} »`);
    } else {
      details.push(`un agent du projet « ${projet} »`);
    }
  }
  return details;
}

export function liveRun(agentId: string): LiveRun | undefined {
  return live.get(agentId);
}

/**
 * Ajoute au BON tour ce qu'une recherche de mémoire ou de compétence vient
 * réellement de rendre.
 *
 * L'appel d'outil arrive après l'envoi du prompt. Sa réponse ne peut donc pas
 * faire partie de la photographie initiale : on enrichit la même bulle au fil
 * du tour et on la rediffuse immédiatement. La liste du tour sert aussi de
 * tampon si l'appel revient dans les quelques millisecondes qui précèdent
 * l'enregistrement de `sentContext`.
 */
export function ajouterConsultationMemoireAuTour(
  agentId: string,
  entree: { source?: 'memoire' | 'competence'; requete?: string; resultat: string; reussie: boolean },
): void {
  const run = live.get(agentId);
  if (!run) return;
  const consultation = ConsultationMemoire.parse({
    id: store.newId(),
    source: entree.source ?? 'memoire',
    requete: entree.requete?.trim() ?? '',
    resultat: entree.resultat,
    reussie: entree.reussie,
    at: Date.now(),
  });
  run.consultationsMemoire.push(consultation);

  const message = store.getMessage(run.contexteMessageId);
  if (!message?.sentContext) return;
  const updated = store.saveMessage({
    ...message,
    sentContext: {
      ...message.sentContext,
      consultationsMemoire: [...run.consultationsMemoire],
    },
  });
  bus.emit({ type: 'message.upsert', message: updated });
}

/**
 * LE TOUR VIVANT SE DIT À L'ÉCRAN, IL NE SE DEVINE PLUS.
 *
 * Le témoin de travail se lisait sur deux indices INDIRECTS — le statut
 * enregistré et la marque d'écriture d'un message — et chacun a sa fenêtre
 * aveugle : le message est figé dès la réponse rendue, le statut retombe à
 * « terminé » alors que le démon range encore le tour (compression, constat du
 * dépôt, fusion de la branche). Un agent qui enchaîne des commandes en silence
 * passait donc pour au repos, et l'on croyait pouvoir écrire.
 *
 * Ces deux fonctions publient le FAIT lui-même sur l'agent : un tour est là, ou
 * il n'y est plus. Elles encadrent chaque `live.set` / `live.delete`, et
 * n'écrivent que sur un vrai changement (aucune diffusion inutile).
 */
function marquerLeTourVivant(agentId: string, depuis: number): void {
  const frais = store.getAgent(agentId);
  if (!frais || frais.tourVivantDepuis === depuis) return;
  const maj = store.saveAgent({ ...frais, tourVivantDepuis: depuis });
  bus.emit({ type: 'agent.upsert', agent: maj });
}

/** Le tour est refermé : le témoin s'éteint, quel que soit le chemin pris. */
function retirerLeTourVivant(agentId: string): void {
  live.delete(agentId);
  const frais = store.getAgent(agentId);
  if (!frais || frais.tourVivantDepuis === undefined) return;
  const maj = store.saveAgent({ ...frais, tourVivantDepuis: undefined });
  bus.emit({ type: 'agent.upsert', agent: maj });
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

/**
 * LES MOTEURS DE SERVICE D'UN AGENT — ceux que l'arrêt ne voyait pas.
 *
 * Autour du tour, le démon lance d'autres moteurs : la compression du fil, la
 * relance d'un plan incomplet, le résumé de continuité. Ce ne sont pas des
 * tours — ils n'écrivent rien à l'écran — mais ce sont de vrais processus, et
 * `run.handle` ne désigne pas les leurs. Un agent arrêté pendant sa compression
 * gardait donc un moteur en marche, invisible et sans personne pour l'attendre.
 *
 * Ils s'inscrivent ici le temps de leur vie, et le bouton d'arrêt les coupe avec
 * le reste.
 */
const moteursDeService = new Map<string, Set<EngineHandle>>();

/**
 * Suivre un moteur de service pour la durée de son appel. Rendu à passer en
 * `surLancement` ; le retrait se fait tout seul quand le moteur a fini.
 */
function suivreLeService(agentId: string): (handle: EngineHandle) => void {
  return (handle) => {
    const ouverts = moteursDeService.get(agentId) ?? new Set<EngineHandle>();
    ouverts.add(handle);
    moteursDeService.set(agentId, ouverts);
    const oublier = () => {
      const encore = moteursDeService.get(agentId);
      if (!encore) return;
      encore.delete(handle);
      if (!encore.size) moteursDeService.delete(agentId);
    };
    handle.finished.then(oublier, oublier);
  };
}

/** Couper tous les moteurs de service d'un agent. Rendu : combien ont été visés. */
function couperLesServices(agentId: string): number {
  const ouverts = moteursDeService.get(agentId);
  if (!ouverts?.size) return 0;
  let vises = 0;
  for (const handle of ouverts) {
    try {
      handle.stop();
      vises += 1;
    } catch {
      /* déjà parti */
    }
  }
  moteursDeService.delete(agentId);
  return vises;
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
  workdir?: string;
}): Agent {
  const project = store.getProject(input.projectId);
  const agent = Agent.parse({
    id: store.newId(),
    projectId: input.projectId,
    cardId: input.cardId,
    role: input.role,
    title: input.title,
    workdir: input.workdir,
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
  /**
   * Ce tour doit AUSSI rendre le chiffrage de la tâche, dans son bloc json. Le
   * lancement d'une carte encore sans chiffres le demande : un seul agent
   * étudie, chiffre, puis exécute.
   */
  chiffrage?: boolean;
  /** Ne pas enregistrer le message utilisateur (relances internes). */
  silent?: boolean;
  /**
   * Pourquoi cet agent est appelé, quand ce n'est pas pour une carte. Un motif
   * de DÉPANNAGE (conflit de fusion, contrôles tombés, construction cassée)
   * réduit l'accueil au strict nécessaire : la demande nomme déjà les fichiers
   * et les commandes, l'index de la mémoire n'y sert à rien
   * (`shared/src/accueil-agent.ts`).
   */
  motif?: MotifDAppel;
  /**
   * LE COMPTE IMPOSÉ À CE TOUR. Sert à la reprise après épuisement : le compte
   * a été CHOISI par l'utilisateur et revérifié à l'instant du clic, on ne
   * repasse donc pas par le choix automatique — qui rendrait le compte à sec.
   * Un compte introuvable est ignoré : le tour repart sur le choix habituel
   * plutôt que d'être perdu.
   */
  compteImpose?: string;
  attachments?: string[];
  /** Appelé quand le tour est fini, avec le texte et les mesures indépendantes du moteur. */
  onComplete?: (text: string, ok: boolean, measurement: TurnMeasurement) => void | Promise<void>;
}

interface ContexteUtilisateurDuTour {
  /**
   * Le message qui PORTE le prompt envoyé. C'est la bulle de la demande quand
   * l'utilisateur a écrit quelque chose. Un tour lancé par un BOUTON — carte
   * démarrée, reprise, dépannage de publication — n'écrit aucune bulle
   * (`options.silent`) : le prompt est alors porté par le message de RÉPONSE du
   * tour, sans quoi le texte réellement envoyé et les passages retrouvés dans la
   * mémoire n'étaient conservés NULLE PART, et le tiroir de la carte s'ouvrait
   * directement sur « Exécution de la tâche ».
   */
  messageId?: string;
  blocks: SentContextBlock[];
  /** Les passages retrouvés par recherche pour CE tour, quand il y en a. */
  passages?: PassageRetrouve[];
  /** Pourquoi `passages` est vide, quand c'est le cas. */
  passagesRaison?: string;
  /** Par le SENS ou par les MOTS, et la part de documentation préparée. */
  passagesMode?: SentContextSnapshot['passagesMode'];
  /** La recherche a-t-elle trouvé quelque chose de nettement pertinent ? */
  passagesPertinents?: boolean;
}

/** Fabrique la photographie persistée sur la demande, sans lire l'ancien fil. */
export function instantaneContexteEnvoye(input: {
  engine: EngineId;
  model?: string;
  nouvelleSession: boolean;
  prompt: string;
  systemPrompt: string;
  /**
   * Vrai quand le texte ci-dessus est la consigne ENTIÈRE. Une reprise ne veut
   * plus dire « rappel court » : sous Claude, la consigne entière repart à
   * chaque tour pour que le préfixe de la session ne bouge pas (`enteteDuTour`,
   * `shared/src/prefixe-cache.ts`). Absent, on retombe sur le rang du tour.
   */
  enteteEntier?: boolean;
  blocks: SentContextBlock[];
  passages?: PassageRetrouve[];
  passagesRaison?: string;
  passagesMode?: SentContextSnapshot['passagesMode'];
  passagesPertinents?: boolean;
  sentAt?: number;
}): SentContextSnapshot {
  const entier = input.enteteEntier ?? input.nouvelleSession;
  return SentContextSnapshot.parse({
    engine: input.engine,
    model: input.model,
    session: input.nouvelleSession ? 'new' : 'resumed',
    prompt: input.prompt,
    systemInstruction: {
      kind: entier ? 'full' : 'reminder',
      content: input.systemPrompt,
      // Claude porte cette consigne dans une option séparée ; Codex la place
      // devant le prompt. Le tiroir peut ainsi décrire le transport exact.
      transport: input.engine === 'claude' ? 'separate' : 'prefixed',
    },
    blocks: [
      ...input.blocks,
      {
        kind: 'system',
        label: entier ? 'Consigne système complète' : 'Rappel de méthode',
        characters: input.systemPrompt.length,
        text: input.systemPrompt,
        // Sous Claude, la consigne entière est le PRÉFIXE de la session : à
        // partir du deuxième tour, c'est le même texte relu au cache — pas
        // renvoyé neuf. Codex, qui la colle derrière l'historique, n'a pas ce
        // repère de cache moteur (`enteteDuTour`, shared/src/prefixe-cache.ts).
        cached: input.engine === 'claude' && !input.nouvelleSession,
      },
    ],
    passages: input.passages ?? [],
    passagesRaison: input.passages?.length ? undefined : input.passagesRaison,
    // Le MODE se dit même sans passage : « rien trouvé par les mots » et
    // « rien trouvé par le sens » ne racontent pas la même histoire.
    passagesMode: input.passagesMode,
    passagesPertinents: input.passagesPertinents,
    history: input.nouvelleSession ? 'none' : 'retained_by_engine',
    sentAt: input.sentAt ?? Date.now(),
  });
}

/**
 * La mesure d'entrée RÉELLE, rendue par le moteur pour tout le tour — celle du
 * tiroir « Contexte envoyé » (`sentContext.usage`), pas celle du compteur sous
 * la bulle : ce total-là cumule chaque aller-retour d'outil interne du tour,
 * pas seulement ce que CETTE demande a fait partir de neuf. Le compteur sous
 * la bulle s'estime à part, depuis ce qui a été assemblé pour ce message
 * (`jetonsMessageEnvoye`). `cachedInputTokens` reste rendu séparément, pour le
 * lecteur qui veut le détail.
 */
export function mesureEntreeMoteur(usage: NonNullable<EngineEvent['usage']>): {
  inputTokens: number;
  cachedInputTokens?: number;
  totalInputTokens: number;
} {
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedTokens,
    totalInputTokens: usage.inputTokens,
  };
}

/**
 * LE CHIFFRE POSÉ SOUS LA BULLE DE RÉPONSE. Le moteur ne rend qu'une seule
 * mesure d'usage par tour, déjà cumulée par lui sur tous les allers-retours
 * d'outils internes (un tour à cent appels d'outil compte cent fois son entrée
 * fraîche). Ce qui est REJOUÉ depuis le cache — le même contexte relu à chaque
 * aller-retour — est écarté ici : c'est ce qui faisait grimper une réponse de
 * trois phrases à plusieurs centaines de milliers de jetons. Ce qui RESTE
 * (entrée fraîche + sortie) grossit avec le nombre d'outils réellement
 * consultés pour produire la réponse — c'est un TRAVAIL fait, pas une fuite.
 */
export function tokensSousLaBulleDeReponse(usage: EngineEvent['usage'] | undefined): number {
  return (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
}

function mesurerContexteUtilisateur(messageId: string, usage: NonNullable<EngineEvent['usage']>): void {
  const message = store.getMessage(messageId);
  if (!message?.sentContext) return;
  const mesure = mesureEntreeMoteur(usage);
  const updated = store.saveMessage({
    ...message,
    // Le compteur SOUS LA BULLE reste le poids de CE message (estimé depuis ce
    // qui a été assemblé pour lui) — jamais `mesure.totalInputTokens`, qui
    // cumule tout le tour agentique déclenché ensuite. La mesure réelle du
    // moteur continue d'aller dans `sentContext.usage`, pour le tiroir qui,
    // lui, décrit bien le tour entier.
    tokens: jetonsMessageEnvoye(message.sentContext),
    sentContext: {
      ...message.sentContext,
      usage: {
        inputTokens: mesure.inputTokens,
        cachedInputTokens: mesure.cachedInputTokens,
      },
    },
  });
  bus.emit({ type: 'message.upsert', message: updated });
}

/**
 * LA CARTE QUITTE « TERMINÉ » DÈS QUE SON TRAVAIL REPART — quel que soit le
 * chemin qui l'a relancé : bouton « Lancer maintenant », dépôt dans « En
 * cours », message écrit dans la conversation, message qui attendait en file,
 * réponse à une question, reprise d'un travail mis en pause.
 *
 * La règle elle-même ne bouge pas : c'est `colonneAuDemarrage` qui décide, et
 * elle seule (un tour d'analyse ne déplace rien, « À déployer » et « Archivé »
 * restent fermés aux chemins automatiques). Ce qui change, c'est l'ENDROIT :
 * la règle vit désormais dans une fonction unique, appelée aux deux seuls
 * points par lesquels un tour peut naître — l'écriture de la demande
 * (`sendPrompt`, qui doit annoncer la bonne colonne à l'agent) et le départ
 * réel du moteur (`startTurn`, par lequel passe TOUT tour, sans exception). Un
 * futur chemin de relance est donc couvert sans qu'on ait à y penser.
 *
 * Appelée deux fois, elle ne fait le travail qu'une : une carte déjà en
 * « En cours » n'a rien à changer.
 */
export function replacerCarteAuDemarrage(agent: Agent): void {
  if (!agent.cardId) return;
  const carte = store.getCard(agent.cardId);
  if (!carte) return;
  const cible = colonneAuDemarrage(carte.column, agent.role);
  /*
   * LA MARQUE DE VOL, posée AVANT tout le reste et même quand il n'y a aucune
   * colonne à changer : c'est elle qui, après un arrêt du serveur, distingue une
   * carte coupée en plein travail d'une carte simplement rendue et laissée
   * ouverte. Sans elle, on ne pouvait rattraper que les agents encore marqués
   * « au travail » — ceux dont le rangement de fin de tour avait déjà commencé
   * passaient au travers (`shared/src/carte-interrompue.ts`).
   */
  const enVol = ROLES_QUI_DEPLACENT.includes(agent.role);
  if (!cible) {
    // Rien à déplacer : on pose seulement la marque, sans toucher au reste de
    // la carte — une carte rangée dans une fin de parcours n'a pas à voir sa
    // date de clôture ni sa suspension effacées par un simple tour de suite.
    if (!enVol || carte.scheduling?.tourEnVolDepuis) return;
    const marquee = store.saveCard({
      ...carte,
      scheduling: {
        ...(carte.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
        tourEnVolDepuis: Date.now(),
      },
    });
    bus.emit({ type: 'card.upsert', card: marquee });
    return;
  }
  const relancee = store.saveCard({
    ...carte,
    column: cible,
    position: store.nextPosition(carte.projectId, cible),
    // Elle repart : la date de clôture d'avant ne veut plus rien dire.
    doneAt: undefined,
    // …et la phrase « rien n'a changé » du tour précédent non plus.
    sansModification: undefined,
    // Une carte qu'on relance depuis une fin de travail (« Terminé »,
    // « À déployer », « En production ») a DÉJÀ produit du code : on grave le
    // drapeau qui empêchera un tour de suite muet de rallumer « aucun fichier
    // n'a changé ». C'est aussi ce qui rattrape les cartes abouties avant
    // l'existence du drapeau.
    codeDejaEnregistre:
      carte.codeDejaEnregistre ||
      carte.column === 'done' ||
      carte.column === 'to_deploy' ||
      carte.column === 'in_production',
    /*
     * Un tour qui démarre est EXACTEMENT le geste qu'attendait une carte
     * suspendue — répondre à sa question en est un. Sans cet oubli, la carte
     * repartait pour ce tour-là puis retombait en file avec sa marque, et
     * l'ordonnanceur ne la reprenait plus jamais tout seul : on croyait avoir
     * relancé, et rien ne suivait. `startCard` efface déjà la marque de son
     * côté ; les deux seuls départs possibles la traitent donc pareil.
     */
    scheduling: {
      ...(carte.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
      suspendu: false,
      waitingReason: undefined,
      ...(enVol ? { tourEnVolDepuis: carte.scheduling?.tourEnVolDepuis ?? Date.now() } : {}),
    },
  });
  bus.emit({ type: 'card.upsert', card: relancee });
}

/**
 * LA FILE REPREND SON COURS — UN SEUL ENDROIT DÉCIDE.
 *
 * Elle était dépilée en deux endroits, et il en manquait un troisième : une
 * préparation qui n'a JAMAIS lancé de moteur (aucun compte disponible, panne
 * interne du démon) ne referme aucun tour, donc ne dépilait rien — la demande
 * écrite pendant ce temps attendait alors indéfiniment. Le filet de `sendPrompt`
 * appelle donc cette fonction à chaque fin de tour, quel que soit le chemin.
 *
 * Sans effet tant que quelqu'un travaille : le tour en cours dépilera à sa fin.
 * Et si deux fins de tour se croisaient, la demande partie en second se remet
 * d'elle-même en file — l'agent est alors occupé — sans perdre son rang.
 */
function enchainerLaFile(agentId: string): void {
  if (live.has(agentId) || demarrant.has(agentId)) return;
  const next = store.dequeuePrompt(agentId);
  bus.emit({ type: 'queue.snapshot', agentId, queue: store.listQueue(agentId) });
  if (!next) return;
  setTimeout(() => {
    sendPrompt(agentId, next.text, { attachments: next.attachments }).catch((err) =>
      log.error('enchaînement de file impossible', err),
    );
  }, 400);
}

/**
 * LES FILES QUE PLUS AUCUNE FIN DE TOUR NE VIENDRA DÉPILER.
 *
 * `enchainerLaFile` est appelée à chaque fin de tour : elle suffit tant qu'un
 * tour a bel et bien tourné. Mais une demande peut entrer en file SANS qu'aucun
 * tour ne parte — c'est le cas quand plus un seul compte n'a de quota
 * (`preparerLeTour`). L'agent reste alors au repos, sa file pleine, et plus
 * rien au monde ne la dépile : la demande attendait pour toujours.
 *
 * Ce filet la reprend, et RIEN D'AUTRE. Il ne réveille un agent que si un
 * compte de son moteur est de nouveau disponible : sans quota, on ne relance
 * pas un tour qui ne ferait qu'échouer et réécrire le même message toutes les
 * quinze secondes. Un agent qui travaille ou qui prépare est laissé tranquille —
 * son propre tour dépilera à sa fin.
 */
export async function reprendreLesFilesEnAttente(): Promise<void> {
  for (const agent of store.listAgents()) {
    if (live.has(agent.id) || demarrant.has(agent.id)) continue;
    if (!store.listQueue(agent.id).length) continue;
    const compte = await pickAccount(agent.run.engine).catch(() => null);
    if (!compte) continue;
    log.info(`file reprise : une demande attendait un quota (agent ${agent.id})`);
    enchainerLaFile(agent.id);
  }
}

/**
 * LE POINT DE PASSAGE UNIQUE (PLAN §9). Toutes les demandes partent d'ici :
 * chat, lancement de tâche, analyse, publication. Le gabarit est appliqué là,
 * donc aucun chemin ne peut y échapper.
 */
export async function sendPrompt(agentId: string, text: string, options: PromptOptions = {}): Promise<void> {
  const agent = store.getAgent(agentId);
  if (!agent) throw new Error('agent introuvable');

  /*
   * Un agent occupé ? La demande s'empile (PLAN §14).
   *
   * « OCCUPÉ » COMMENCE À LA PRÉPARATION, PLUS AU LANCEMENT DU MOTEUR. Seul
   * `live` était consulté : entre l'entrée dans `sendPrompt` et le départ du
   * moteur, il se passe pourtant plusieurs secondes (choix du compte, recherche
   * dans la documentation, copie de travail). Une seconde demande écrite dans
   * cette fenêtre ne s'empilait donc pas — elle ouvrait un tour PAR-DESSUS, et
   * le jeton de préparation faisait abandonner le premier : sa bulle restait à
   * l'écran, sans réponse, et personne ne savait qu'elle avait été jetée
   * (constaté dans le journal du 18/08/2026). Les deux demandes se suivent
   * désormais, dans leur ordre d'arrivée.
   */
  if (live.has(agentId) || demarrant.has(agentId)) {
    const queued = store.enqueuePrompt(agentId, text, options.attachments ?? []);
    if (!queued) {
      bus.toast('warning', "Dix demandes en attente au maximum : celle-ci n'a pas été ajoutée.");
      return;
    }
    bus.emit({ type: 'queue.snapshot', agentId, queue: store.listQueue(agentId) });
    return;
  }

  /*
   * À partir d'ici, le tour est PARTI, même si aucun processus n'existe encore :
   * l'agent compte comme occupé jusqu'au bout, pour qu'un redémarrage
   * automatique ne le coupe pas dans la fenêtre de préparation. Le statut passe
   * à « starting » ET part aussitôt aux clients : sans cet envoi immédiat, la
   * pile d'agents de la colonne de gauche ne savait rien de ce tour tant que la
   * préparation durait (lecture du projet, recherche de mémoire…) — un agent
   * pouvait donc retenir un redémarrage sans apparaître nulle part à l'écran.
   */
  /*
   * L'HEURE DE DÉPART EST CELLE DE CE TOUR-CI. Le statut passait à « starting »
   * sans toucher `startedAt` : un agent réutilisé gardait l'heure de son tour
   * précédent, et la pile d'agents affichait « 3 214 h » sur un tour parti à
   * l'instant. La durée montrée est désormais toujours celle du travail réel.
   */
  setStatus(agent, 'starting', { startedAt: Date.now(), endedAt: undefined });
  const preparation = prochainePreparation++;
  demarrant.set(agentId, { depuis: Date.now(), jeton: preparation });
  let attendUnQuota = false;
  try {
    attendUnQuota = await preparerLeTour(agent, text, options, preparation);
  } finally {
    /*
     * CE TOUR EST-IL ENCORE LE MIEN ?
     *
     * Une préparation peut être ABANDONNÉE en cours de route — par la veille des
     * tours bloqués, quand elle dure trop, ou par un arrêt à la main. L'agent est
     * alors libéré et sa file repart : un tour tout neuf peut déjà tourner quand
     * celle-ci se réveille enfin. Refermer « son » tour reviendrait à couper
     * celui du remplaçant, et effacer la préparation reviendrait à effacer la
     * sienne. On ne range donc que ce qui porte encore NOTRE jeton.
     */
    if (demarrant.get(agentId)?.jeton !== preparation) {
      log.warn(`préparation abandonnée revenue trop tard (agent ${agentId}) : rien n'a été refermé`);
    } else {
      demarrant.delete(agentId);
      /*
       * PLUS PERSONNE N'ATTEND. Un tour arrêté sur une question (`ask_user`) tient
       * une attente ouverte : le tour fini — normalement, en panne ou coupé à la
       * main —, elle doit tomber, sinon le pont d'un moteur déjà mort continuerait
       * de sonder et l'agent porterait « en attente » pour toujours.
       */
      libererLesAttentes(agentId);
      /*
       * LE TOUR SE REFERME, QUOI QU'IL ARRIVE. Le chemin normal a déjà tout rangé,
       * et cet appel ne fait alors rien. Mais une panne interne survenue APRÈS le
       * lancement du moteur — un fichier disparu, une base qui refuse — sautait
       * par-dessus la fermeture : l'agent restait marqué « au travail » pour
       * toujours, compteur en marche et barre d'écriture bloquée, alors que plus
       * personne ne l'attendait.
       */
      refermerLeTour(agentId, "Le tour s'est arrêté sur une panne interne du serveur.");
      /*
       * ET LA FILE REPART, MÊME QUAND IL N'Y AVAIT AUCUN TOUR À REFERMER — sauf
       * quand CETTE préparation vient précisément d'y remettre la demande faute
       * de quota. La dépiler aussitôt recréerait le même refus et sa même bulle
       * toutes les 400 ms. Celle-là attend le filet de veille, qui ne la reprend
       * qu'après avoir trouvé un compte de nouveau disponible.
       */
      if (!attendUnQuota) enchainerLaFile(agentId);
      // Un redémarrage retenu tant qu'un agent travaillait peut désormais
      // repartir — importé au moment de l'appel pour éviter le cycle avec
      // demon.ts, qui lit lui-même `agentsActifs` d'ici.
      void import('./demon.js').then((demon) => demon.appliquerRedemarrageEnAttente());
    }
  }
}

async function preparerLeTour(
  agent: Agent,
  text: string,
  options: PromptOptions,
  /** Le jeton de CETTE préparation : il dit jusqu'au bout si elle a toujours cours. */
  preparation: number,
): Promise<boolean> {
  const agentId = agent.id;
  const project = store.getProject(agent.projectId);
  if (!project) throw new Error('projet introuvable');

  /*
   * LE COMPTE SE CHOISIT AVANT TOUT LE RESTE — avant la demande écrite, avant
   * la carte déplacée, avant le contexte.
   *
   * Le fil du moteur vit dans le COFFRE du compte : changer de compte, c'est
   * repartir d'une conversation vide, que ce soit sur bascule automatique ou
   * après une reprise pour limite atteinte. Or c'est plus bas que se décide ce
   * qu'on envoie — briefing entier ou simple message de suite. Choisir le
   * compte après, comme autrefois, revenait à préparer un message de suite pour
   * un fil qui n'existait pas : le moteur refusait le `--resume`, et le travail
   * en cours était perdu au lieu d'être poursuivi.
   *
   * ET IL SE CHOISIT MAINTENANT DEVANT LA CARTE, pas seulement devant le
   * contexte. Sans quota, le tour ne partait JAMAIS — mais la bulle de la
   * demande était déjà écrite, la carte déjà remontée en « En cours » avec sa
   * marque de vol, et la demande, elle, purement PERDUE. Cinq minutes plus
   * tard, le balayage des cartes oubliées la fermait en annonçant « Terminé »
   * un travail que personne n'avait fait. Rien n'est donc touché tant qu'on ne
   * sait pas qu'un moteur peut partir.
   *
   * Un compte IMPOSÉ passe devant : il vient d'un choix humain, revérifié à
   * l'instant du clic. Le choix automatique retomberait sur le compte à sec,
   * puisqu'il classe par priorité.
   */
  const compteImpose = options.compteImpose
    ? listAccountRecords().find((a) => a.id === options.compteImpose && a.engine === agent.run.engine)
    : undefined;
  // Un compte choisi À LA MAIN dans les réglages de l'agent (`agent.run.account`)
  // passe devant la répartition automatique, tout comme une reprise sur limite —
  // sauf s'il a depuis disparu ou été coupé, auquel cas on retombe sur le choix
  // automatique plutôt que de bloquer la carte sur un compte fantôme.
  const compteChoisi =
    !compteImpose && agent.run.account
      ? listAccountRecords().find((a) => a.id === agent.run.account && a.engine === agent.run.engine && !a.disabled)
      : undefined;
  const account = compteImpose ?? compteChoisi ?? (await pickAccount(agent.run.engine));
  if (!account) {
    /*
     * LA DEMANDE N'EST PAS PERDUE : ELLE ATTEND EN FILE. C'est la file ordinaire
     * de l'agent, celle qui repart d'elle-même dès qu'il se tait — ici, dès
     * qu'un compte redevient disponible (`reprendreLesFilesEnAttente`, rejouée
     * par le filet de veille toutes les quinze secondes). La bulle de la demande
     * s'écrira au VRAI départ, une seule fois : elle n'a pas encore été écrite.
     *
     * SEULE UNE DEMANDE ORDINAIRE Y ENTRE. La file ne transporte qu'un texte et
     * ses pièces jointes : un appel INTERNE (`silent`, ou porteur d'un
     * `onComplete` — le lancement d'une carte, une relance du démon) y perdrait
     * son gabarit, son chiffrage et son post-traitement, et sa consigne
     * s'afficherait en clair comme un message écrit par l'utilisateur. Ces
     * appels-là ont leur propre reprise (l'ordonnanceur relance une carte dont
     * les portes dures ont refusé le quota) : on les laisse repartir par leur
     * chemin, et on le DIT.
     */
    const parLaFile = !options.silent && !options.onComplete;
    const enFile = parLaFile && store.enqueuePrompt(agentId, text, options.attachments ?? []);
    if (enFile) bus.emit({ type: 'queue.snapshot', agentId, queue: store.listQueue(agentId) });
    const message = store.saveMessage(
      Message.parse({
        id: store.newId(),
        agentId,
        role: 'assistant',
        content: enFile
          ? "Aucun compte n'a de quota disponible pour le moment. La demande attend en file : elle repartira toute seule dès la remise à zéro."
          : "Aucun compte n'a de quota disponible : ce tour n'est jamais parti. Rien n'a été fait, et il faudra le relancer une fois le quota revenu.",
        error: 'quota',
        createdAt: store.now(),
      }),
    );
    bus.emit({ type: 'message.upsert', message });
    setStatus(agent, 'idle');
    return true;
  }

  let userMessageId: string | undefined;
  if (!options.silent) {
    const userMessage = store.saveMessage(
      Message.parse({
        id: store.newId(),
        agentId,
        role: 'user',
        content: text,
        attachments: options.attachments ?? [],
        createdAt: store.now(),
      }),
    );
    userMessageId = userMessage.id;
    bus.emit({ type: 'message.upsert', message: userMessage });
  }

  // La carte quitte « Terminé » AVANT qu'on écrive la demande : le bloc de
  // contexte qui suit doit annoncer à l'agent la colonne où il repart.
  replacerCarteAuDemarrage(agent);

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
  const cleSession = cleDeSession(agent.run.engine, agent.run.model, account.id);
  const nouvelleSession = !store.getSessionId(agent.id, cleSession);
  // Une session neuve repart sans passé : la prochaine panne, s'il y en a une,
  // a de nouveau le droit de se dire.
  if (nouvelleSession) panneDejaSignalee.delete(agent.id);
  /*
   * FIL NEUF PARCE QU'ON A CHANGÉ DE COMPTE. Il existait bien une conversation
   * pour ce moteur et ce modèle : elle appartient simplement au coffre d'un
   * autre compte, donc elle n'est pas reprenable. Ce n'est pas un premier tour,
   * c'est la SUITE d'un travail — l'agent doit repartir avec ce qu'il savait.
   */
  const filDuCompteDavant = nouvelleSession
    ? store.filSurUnAutreCompte(agent.id, partMoteurDeLaCle(agent.run.engine, agent.run.model), cleSession)
    : null;
  /*
   * Le NIVEAU d'accueil ne dit pas QUAND on accueille (ça, c'est
   * `nouvelleSession`), mais AVEC QUOI. Un dépannage de publication n'emporte
   * ni index de mémoire, ni compétences, ni fichiers d'instructions.
   */
  const niveau = niveauDAccueil({ role: agent.role, motif: options.motif });
  /*
   * CHAQUE BLOC DIT D'OÙ IL VIENT. Le tiroir « Contexte envoyé » sépare ce qui
   * décrit CE projet de ce qui vient du socle de la plateforme — un socle qui
   * serait identique sur n'importe quel projet. Sans cette étiquette posée à
   * l'envoi, le tiroir devrait le deviner après coup, et se tromperait.
   */
  const contextParts: {
    label: string;
    kind: SentContextBlock['kind'];
    origine: OrigineDeBloc;
    content: string;
  }[] = [];
  let memoryAndInstructionsCharacters = 0;

  /*
   * PLUS AUCUNE RECHERCHE ICI — LA MÉMOIRE EST UN ARBRE, ET IL SE NAVIGUE.
   *
   * Jusqu'au 20 août 2026, chaque tour payait une recherche : la demande servait
   * de question, quelques passages étaient notés puis envoyés d'office, environ
   * 1 300 jetons. L'audit chiffré disait le reste — un tour sur trois n'en
   * recevait aucun qui parle du travail à faire, et les payait quand même.
   *
   * Ce qui part désormais, c'est la CARTE de l'arbre (`blocMemoire`) : les
   * sujets, les mots de leurs branches, et rien d'autre. Quelques dizaines de
   * jetons. L'agent OUVRE ensuite ce qui le concerne avec `project_memory`, par
   * un nom — jamais par une note de ressemblance. On ne devine plus ce dont il a
   * besoin : on lui donne de quoi le demander.
   */
  const memoireALAccueil = partsDAccueil(niveau).memoire;

  if (nouvelleSession) {
    // Le briefing (chemin du projet, fichiers d'instructions, compétences)
    // n'a de sens qu'au premier tour : ensuite l'agent l'a en contexte. L'index
    // de la mémoire voyage à part (`kind: 'memory'`) : c'est ce qui permet au
    // tiroir « Contexte envoyé » de distinguer mémoire et reste du briefing.
    const { sansMemoire, socle, memoire } = briefingSepare(
      project.path,
      project.name,
      true,
      agent.run.engine,
      agent.workdir,
      niveau,
      undefined,
      // Le POOL DE COMPÉTENCES est servi au poids du travail de la carte, comme
      // les règles : les fiches qui en parlent sont nommées, les autres comptées.
      card ? `${card.title}\n${card.description}` : '',
    );
    contextParts.push({
      label:
        niveau === 'minimal'
          ? 'Briefing réduit (dépannage)'
          : niveau === 'tri'
            ? 'Briefing réduit (tri du chef)'
            : 'Briefing du projet',
      kind: 'briefing',
      origine: 'projet',
      content: sansMemoire,
    });
    memoryAndInstructionsCharacters += sansMemoire.length;
    if (socle) {
      // Le SOCLE : compétences partagées, accès GitHub, façon d'écrire une règle
      // durable. Le même sur tous les projets — c'est la part « plateforme ».
      contextParts.push({
        label: 'Socle de la plateforme',
        kind: 'briefing',
        origine: 'plateforme',
        content: socle,
      });
      memoryAndInstructionsCharacters += socle.length;
    }
    if (memoire) {
      contextParts.push({
        label: 'Carte de la mémoire du projet',
        kind: 'memory',
        origine: 'projet',
        content: memoire,
      });
      memoryAndInstructionsCharacters += memoire.length;
    }
    // Session neuve : l'agent repart d'un contexte vide — plus rien de ce qui
    // lui a été servi avant n'y est. On oublie les sujets déjà donnés, sinon
    // une reprise se retrouverait privée de la mémoire qu'elle n'a plus.
    store.oublierMemoireServie(agent.id);
    store.setMemorySeen(agent.id, empreintesDesFaits(project.path));
    if (agent.context?.continuitySummary) {
      contextParts.push({
        label: 'Résumé de continuité après compression',
        kind: 'extra',
        origine: 'projet',
        content: agent.context.continuitySummary,
      });
    } else if (filDuCompteDavant) {
      /*
       * LE TRAVAIL NE SE REDÉCOUVRE PAS. Le fil précédent est resté dans le
       * coffre de l'autre compte : on ne peut pas le reprendre, mais on peut le
       * RÉSUMER — carte, décisions déjà prises, liste de tâches là où elle en
       * était, échanges récents, sujets de mémoire utiles. L'agent poursuit donc
       * au lieu de tout rouvrir et de reposer des questions déjà tranchées.
       */
      const resume = resumePourAgent(agent, 'changement-de-compte');
      contextParts.push({
        label: 'Résumé de continuité — reprise sur un autre compte',
        kind: 'extra',
        origine: 'projet',
        content: resume,
      });
      log.info(
        `agent ${agent.id} : fil neuf sur le compte ${account.label} (le précédent appartient à un autre coffre) — résumé de continuité de ${resume.length} signes`,
      );
    } else if (
      /*
       * LE FIL DU MOTEUR MEURT, LA CONVERSATION NON.
       *
       * Le chef d'orchestre garde une conversation qui ne s'arrête jamais, mais
       * son fil côté moteur repart à neuf pour trois fois rien : une session
       * expirée chez le fournisseur (« No conversation found »), un modèle ou
       * un moteur changé dans les réglages. Le tour suivant partait alors avec
       * le SEUL message qu'on venait d'écrire — et « fais-en une carte » ne
       * désigne plus rien. Le chef redemandait de quoi on parlait, ou pire,
       * proposait une carte au hasard, alors que le sujet s'affichait deux
       * lignes plus haut à l'écran.
       *
       * On lui rend donc ce que l'utilisateur voit : les échanges VISIBLES de
       * la conversation, résumés comme après une compression. La compression et
       * le changement de compte passent avant (ils ont déjà leur résumé), et
       * une conversation réellement neuve n'en reçoit aucun.
       */
      filARappeler({
        nouvelleSession,
        resumeDeCompression: agent.context?.continuitySummary,
        filSurUnAutreCompte: Boolean(filDuCompteDavant),
        echangesVisibles: messagesDepuis(store.listMessages(agent.id), store.nouveauDepart(agent.id)).filter(
          (message) => message.id !== userMessageId && message.content.trim(),
        ).length,
      })
    ) {
      const resume = resumePourAgent(agent, 'fil-neuf', userMessageId);
      contextParts.push({
        label: 'Ce qui a déjà été dit dans cette conversation',
        kind: 'extra',
        origine: 'projet',
        content: resume,
      });
      log.info(
        `agent ${agent.id} : fil du moteur reparti à neuf — rappel de la conversation visible (${resume.length} signes)`,
      );
    }
  } else {
    const nouveaux = newFactsSince(project.path, store.memorySeen(agent.id));
    if (nouveaux.length) {
      const ajout = `MÉMOIRE DU PROJET — faits ajoutés depuis :\n${nouveaux.map((f) => `- ${f}`).join('\n')}`;
      contextParts.push({ label: 'Nouveaux faits de la mémoire', kind: 'memory', origine: 'projet', content: ajout });
      memoryAndInstructionsCharacters += ajout.length;
      store.setMemorySeen(agent.id, empreintesDesFaits(project.path));
    }
    /*
     * UN TOUR DE SUITE N'EMPORTE PLUS DE MÉMOIRE D'OFFICE. La carte de l'arbre
     * est déjà dans le contexte depuis le premier tour, et l'agent sait
     * l'ouvrir : lui renvoyer des extraits à chaque message était le péage que
     * ce changement supprime.
     */
  }

  /*
   * LA CONSIGNE D'ESPACE DU CHEF PART À CHAQUE TOUR, JAMAIS AU SEUL PREMIER.
   *
   * Elle était posée dans le bloc « session neuve » : une conversation ouverte
   * il y a des jours ne l'avait donc JAMAIS reçue, et gardait les croyances de
   * son premier tour — celles du temps du bac à sable. Constaté le 11/08/2026 :
   * un chef d'une session vieille de neuf jours expliquait à l'utilisateur que
   * « le projet et le dossier servi sont en lecture seule pour moi », alors que
   * l'accès complet était en place depuis le matin. Le code d'un moteur change,
   * pas le souvenir d'une session : ce qui dit à l'agent ce qu'il PEUT faire
   * doit donc repartir à chaque tour. Elle tient en 1 570 signes, moins de 400
   * jetons — le prix d'un chef qui refuse un geste qu'on lui a ouvert est plus
   * élevé.
   */
  if (agent.role === 'orchestrator' && !project.isSelf) {
    const scratch = path.join(PATHS.chefScratch, project.id);
    const espace = consigneEspaceDuChef(scratch, project.path);
    // L'espace du chef est une mécanique de la plateforme, la même partout.
    contextParts.push({ label: 'Espace de travail du chef', kind: 'extra', origine: 'plateforme', content: espace });
  }

  /*
   * LE PLAN PRÉCÉDENT EST REFUSÉ D'OFFICE PAR CE MESSAGE. En mode plan, un
   * nouveau message ne s'ajoute pas à côté du plan affiché : il le remplace.
   * L'interface le savait déjà (le plan perd ses boutons dès qu'un message
   * rédigé le suit) ; le chef, lui, ne le savait pas et commentait au lieu de
   * refaire. On lui redonne donc le plan qui attendait, TEXTE COMPRIS — la
   * consigne seule ne survivrait pas à une compression du contexte.
   */
  if (agent.run.mode === 'plan') {
    // La demande de CE tour est déjà enregistrée au-dessus : la compter
    // périmerait le plan qu'on cherche justement à faire reprendre.
    const plan = planEnAttente(store.listMessages(agent.id).filter((m) => m.id !== userMessageId));
    if (plan) {
      contextParts.push({
        label: `Plan à reprendre (version ${plan.numero})`,
        kind: 'extra',
        origine: 'projet',
        content: consigneDeRepriseDuPlan(plan),
      });
    }
  }

  if (options.context) {
    contextParts.push({ label: 'Contexte ajouté par HaikoDev', kind: 'extra', origine: 'plateforme', content: options.context });
  }
  if (card) {
    const bloc = carteContexte(agent.id, card, nouvelleSession);
    if (bloc) contextParts.push({ label: 'Carte en cours', kind: 'card', origine: 'projet', content: bloc });
  }
  if (options.attachments?.length) {
    const files = options.attachments
      .map((id) => store.getAttachment(id))
      .filter(Boolean)
      .map((a) => path.join(PATHS.attachments, `${a!.id}-${a!.name}`));
    if (files.length) {
      contextParts.push({
        label: 'Pièces jointes',
        kind: 'attachment',
        origine: 'demande',
        content: `PIÈCES JOINTES fournies par l'utilisateur (lis-les) :\n${files.join('\n')}`,
      });
    }
  }

  // La règle vit dans `shared/src/templates.ts` (`ampleurDuTour`) : le cran de
  // suivi ne s'applique qu'à une ampleur DÉDUITE de la demande, jamais à celle
  // qu'un lancement de carte a EXIGÉE.
  const ampleur = ampleurDuTour({ imposee: options.ampleur, kind: template, texte: text, nouvelleSession });
  const contexteAssemble = contextParts.map((part) => part.content).join('\n\n');
  const prompt = wrapPrompt(template, text, contexteAssemble, {
    // Session déjà ouverte : le gabarit entier est dans le fil, un rappel suffit.
    rappel: !nouvelleSession,
    ampleur,
    chiffrage: options.chiffrage,
  });
  const description = card?.description ?? '';
  const occurrencesDescription = description ? prompt.split(description).length - 1 : 0;
  const blocks: SentContextBlock[] = [
    {
      kind: 'request',
      label: 'Demande utilisateur',
      characters: text.length,
      text,
      cached: false,
      origine: 'demande',
    },
    ...contextParts.map((part) => ({
      kind: part.kind,
      label: part.label,
      characters: part.content.length,
      text: part.content,
      cached: false,
      origine: part.origine,
    })),
    {
      kind: 'format',
      label: 'Gabarit et séparateurs HaikoDev',
      characters: Math.max(0, prompt.length - text.length - contexteAssemble.length),
      cached: false,
      origine: 'plateforme',
    },
  ];
  await startTurn(
    agent,
    prompt,
    template,
    options.onComplete,
    nouvelleSession,
    ampleur,
    {
      promptCharacters: prompt.length,
      systemPromptCharacters: 0,
      cardDescriptionCharacters: description.length * occurrencesDescription,
      memoryAndInstructionsCharacters,
    },
    /*
     * LE PROMPT ENVOYÉ EST GARDÉ MÊME SANS BULLE DE DEMANDE. Il ne l'était que
     * lorsqu'un message utilisateur existait : un tour lancé par un bouton
     * n'en écrit pas, donc le texte parti au moteur et les passages retrouvés
     * dans la mémoire du projet étaient perdus. Sans `messageId`, `startTurn`
     * les pose sur le message de RÉPONSE du tour.
     */
    {
      messageId: userMessageId,
      blocks,
      /*
       * PLUS AUCUN PASSAGE À MONTRER : rien n'est plus retrouvé d'office. Le
       * champ reste dans la trace pour les tours DÉJÀ enregistrés — un mois de
       * conversations continue de s'afficher tel qu'il a été vécu.
       */
      passagesRaison: RAISON_ARBRE,
    },
    niveau,
    {
      account,
      cleSession,
      // POURSUITE : ce tour ne commence rien, il reprend un travail coupé. Le
      // compte imposé ne vient que de là (le clic « Avec quel compte
      // poursuivre ? »), et c'est ce qui autorise le tour à garder l'avancement
      // et la liste de tâches du tour d'avant.
      poursuite: Boolean(compteImpose),
      preparation,
    },
  );
  return false;
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

/**
 * Le dossier de travail de ce tour. Sans `workdir`, c'est celui du projet. Avec,
 * c'est la copie de la carte : présente, on la garde ; refermée par le tour
 * précédent, on la rouvre sur la même branche. Impossible à rouvrir, on le DIT
 * dans le journal et on retombe sur le dossier du projet plutôt que de perdre
 * le tour.
 */
async function dossierDuTour(agent: Agent, project: Project): Promise<string> {
  if (!agent.workdir) return project.path;
  if (fs.existsSync(agent.workdir)) return agent.workdir;
  const card = agent.cardId ? store.getCard(agent.cardId) : null;
  if (!card) return project.path;
  const ouvert = await ouvrirDossierDeCarte(project.path, card).catch(() => null);
  if (!ouvert || ouvert.kind === 'echec') {
    log.warn(
      `dossier de la carte impossible à rouvrir (${agent.workdir})`,
      ouvert && ouvert.kind === 'echec' ? ouvert.raison : '',
    );
    return project.path;
  }
  if (ouvert.dossier !== agent.workdir) store.saveAgent({ ...agent, workdir: ouvert.dossier });
  return ouvert.dossier;
}

/**
 * L'usage de DEUX essais d'un même tour, additionné. Un tour relancé après une
 * panne du fournisseur a coûté la somme de ses essais : garder le dernier seul
 * effacerait de la facture tout ce qui avait été consommé avant la coupure.
 * Les mesures de CONTEXTE (taille de la fenêtre, remplissage) ne s'additionnent
 * pas : c'est la dernière qui décrit la session vivante.
 */
function additionnerUsage(
  avant: EngineEvent['usage'] | undefined,
  dernier: EngineEvent['usage'] | undefined,
): EngineEvent['usage'] | undefined {
  if (!avant) return dernier;
  if (!dernier) return avant;
  const somme = (a?: number, b?: number) =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  return {
    ...dernier,
    inputTokens: (avant.inputTokens ?? 0) + (dernier.inputTokens ?? 0),
    outputTokens: (avant.outputTokens ?? 0) + (dernier.outputTokens ?? 0),
    cachedTokens: somme(avant.cachedTokens, dernier.cachedTokens),
    costUsd: somme(avant.costUsd, dernier.costUsd),
    durationMs: somme(avant.durationMs, dernier.durationMs),
    turns: somme(avant.turns, dernier.turns),
  };
}

async function startTurn(
  agentBefore: Agent,
  prompt: string,
  template: TemplateKind,
  onComplete: PromptOptions['onComplete'] | undefined,
  /** Vrai au tout premier tour d'une session : c'est là qu'on lit la mémoire. */
  nouvelleSession = true,
  ampleur: Ampleur = 'complete',
  composition: TurnMeasurement['composition'] = {
    promptCharacters: 0,
    systemPromptCharacters: 0,
    cardDescriptionCharacters: 0,
    memoryAndInstructionsCharacters: 0,
  },
  contexteUtilisateur: ContexteUtilisateurDuTour | undefined,
  /** L'accueil que mérite cet agent : « minimal » pour un dépannage de publication. */
  niveau: NiveauDAccueil,
  /**
   * Ce que `preparerLeTour` a déjà tranché et que ce tour ne redécide pas : le
   * COMPTE porteur (le contexte a été bâti pour lui) et la clé sous laquelle son
   * fil est rangé. `poursuite` dit que ce tour reprend un travail coupé.
   */
  tour: { account: AccountRecord; cleSession: string; poursuite: boolean; preparation: number },
): Promise<void> {
  // Le réglage retenu est celui enregistré à l'instant du départ : si le moteur
  // a été changé entre-temps, c'est le nouveau qui part, pas l'ancien.
  const agent = store.getAgent(agentBefore.id) ?? agentBefore;
  const project = store.getProject(agent.projectId)!;
  const adapter = adapterFor(agent.run.engine);
  const catalogContextWindow = await contextWindowFor(agent.run.engine, agent.run.model).catch(() => undefined);

  /*
   * OÙ CET AGENT TRAVAILLE. Une carte lancée a sa propre copie de travail
   * (`git worktree`) : c'est elle qu'on ouvre au moteur, elle qu'on observe avant
   * et après le tour. Les autres agents restent dans le dossier du projet.
   *
   * Le dossier est refermé à la fin de CHAQUE tour : un second tour (message
   * écrit, file d'attente, réponse à une question) le rouvre sur la même branche,
   * avec le travail déjà enregistré — jamais un repli silencieux sur la branche
   * principale du dossier partagé.
   */
  const dossier = await dossierDuTour(agent, project);

  /*
   * LE VRAI DÉPART D'UN TOUR, et le dernier filet. `sendPrompt` a déjà replacé
   * la carte, mais c'est ICI que tout tour commence : un chemin de relance qui
   * arriverait par une autre porte ne pourrait pas laisser sa carte affichée
   * « Terminé » pendant que le moteur écrit. Sans effet quand c'est déjà fait.
   */
  replacerCarteAuDemarrage(agent);

  /*
   * Le compte (x20 d'abord, Pro en relève) est décidé AU LANCEMENT, jamais en
   * plein vol (PLAN §13) — et depuis `preparerLeTour`, AVANT le contexte : le
   * fil du moteur vit dans le coffre du compte, donc le compte décide de ce
   * qu'on envoie. On ne le rechoisit pas ici, sinon deux tours de la même
   * demande pourraient partir sur deux comptes différents.
   */
  const account = tour.account;

  /*
   * PREMIER REPÈRE DE LA CONVERSATION : la mémoire du projet est relue avant
   * toute réponse — elle part avec la demande, dans le briefing. On l'affiche
   * donc comme une étape déjà faite, tout en haut. Seul le NOMBRE de faits est
   * enregistré : recopier la mémoire entière sous chaque message la stockerait
   * des centaines de fois pour rien, l'interface l'a déjà de son côté.
   */
  /*
   * Où en est le dépôt AVANT que l'agent ne touche à quoi que ce soit. UN SEUL
   * repère, pris pour TOUS les agents, qui sert deux fois à la fin du tour :
   * dire si du code a été enregistré sans carte — et mérite donc une fiche —,
   * et dire si la carte a le droit de passer en « Terminé ».
   */
  const repere = await repereAvant(dossier).catch(() => null);

  /*
   * SECOND REPÈRE : LE DOSSIER PARTAGÉ DU PROJET. L'agent est censé rester dans
   * sa copie, mais rien ne l'y oblige — un `cd` vers la racine du projet, un
   * chemin relatif, et son travail atterrit à côté. Le constat de fin de tour ne
   * voyait alors RIEN et accusait la carte de n'avoir rien changé. On note donc
   * ce qui remue déjà dans le dossier partagé AVANT le tour : ce qui s'y ajoute
   * pendant est du travail, même s'il n'est pas récoltable sur la branche.
   * Inutile quand la carte travaille à même le dossier du projet : il n'y a
   * alors qu'un seul dossier, déjà observé.
   */
  const remuesAvant =
    dossier === project.path ? undefined : await fichiersRemues(project.path).catch(() => null);

  /*
   * QUOTA CONSOMMÉ PAR CETTE TÂCHE : on relève sur le compte porteur les deux
   * pourcentages AVANT le tour (dans le dernier relevé, `pickAccount` vient de
   * le rafraîchir), pour les comparer à une lecture FRAÎCHE après le tour. On
   * n'attribue ainsi que ce que la tâche a réellement dépensé.
   */
  const quotaAvant = partsQuotaEnCache(account.id);

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

  /*
   * LA LISTE DE TÂCHES TRAVERSE LA COUPURE. Elle vit sur le MESSAGE du tour :
   * un tour coupé par une limite de compte l'emportait donc avec lui, et la
   * reprise repartait avec une liste vide — plus rien à l'écran, plus rien dans
   * le décroché de la carte. On recopie ici celle du dernier tour qui en avait
   * une (`tachesAPoursuivre`) : elle est visible dès la première seconde, et la
   * liste que l'agent renverra viendra s'y rapprocher ligne par ligne.
   */
  const todosRepris = tour.poursuite ? tachesReprises(agent.id) : [];

  const assistantMessage = Message.parse({
    id: store.newId(),
    agentId: agent.id,
    role: 'assistant',
    content: '',
    steps: memoryStep ? [memoryStep] : [],
    todos: todosRepris,
    streaming: true,
    /*
     * LE DRAPEAU `plan` NE SE POSE PLUS AU LANCEMENT DU TOUR. Il l'était, et le
     * cadre « Plan proposé » s'ouvrait donc sur la première bribe de texte : une
     * phrase d'intention (« Je vais parcourir le site avant toute analyse »)
     * portait déjà son sélecteur de niveau et ses boutons « Valider » /
     * « Refuser », pendant qu'en dessous l'agent lançait une nouvelle recherche.
     * On pouvait valider un plan VIDE — et lancer un travail sur une phrase.
     *
     * Il se pose à la FIN du tour, une fois le texte jugé entier (`planRendu`,
     * plus bas) : un plan ne se décide que fini.
     */
    plan: false,
    createdAt: store.now(),
  });
  store.saveMessage(assistantMessage);
  bus.emit({ type: 'message.upsert', message: assistantMessage });

  /*
   * QUI PORTE LE PROMPT ENVOYÉ. La bulle de la demande quand il y en a une ;
   * sinon la réponse de ce tour — un lancement de carte, une reprise ou un
   * dépannage n'écrit aucune bulle, et son prompt ne se rattacherait à rien.
   */
  const messageDuContexte = contexteUtilisateur?.messageId ?? assistantMessage.id;

  /*
   * L'IDENTIFIANT DE CE TOUR-CI. Il part dans la configuration d'outils et
   * revient avec chaque appel du pont : le démon refuse alors ce qui vient
   * d'une configuration périmée ou lue chez un voisin, au lieu d'écrire dans la
   * conversation de quelqu'un d'autre (`appelDuPontRecevable`).
   */
  const tourId = store.newId();

  const runState: LiveRun = {
    agentId: agent.id,
    tourId,
    handle: null as unknown as EngineHandle,
    messageId: assistantMessage.id,
    contexteMessageId: messageDuContexte,
    consultationsMemoire: [],
    startedAt: Date.now(),
    // Le moteur n'a encore rien dit : son lancement vaut premier signe de vie.
    dernierSigneDeVie: Date.now(),
    steps: new Map(memoryStep ? [[memoryStep.id, memoryStep]] : []),
    todos: todosRepris,
    text: '',
    account: account.id,
    quota5h: 0,
    quotaSemaine: 0,
  };

  // Le premier tour du groupe pose le repère commun. Les suivants le gardent
  // jusqu'à ce que le dernier tour du compte soit rangé.
  if (!dernierQuotaReparti.has(account.id)) dernierQuotaReparti.set(account.id, quotaAvant);

  // Outils du démon : le pont MCP, avec la liste d'outils de ce rôle.
  const mcpConfigPath = path.join(PATHS.logs, `mcp-${agent.id}.json`);
  const bridgePath = path.join(CONFIG.selfPath, 'server', 'mcp-bridge.mjs');
  /*
   * Le garde posé devant chaque commande de l'agent : il refuse ce qui pourrait
   * couper le démon ou un moteur au travail (`shared/src/garde-demon.ts`).
   */
  const gardePath = path.join(CONFIG.selfPath, 'server', 'garde-demon.mjs');
  const token = getInternalToken();
  const url = `http://127.0.0.1:${CONFIG.port}`;
  writeMcpConfig(mcpConfigPath, token, url, agent.id, bridgePath, tourId);

  const isOrchestrator = agent.role === 'orchestrator';
  // L'exception HaikoDev : sur son propre dépôt, le chef d'orchestre est un
  // agent complet (PLAN §5). Le basculement se décide sur le CHEMIN du projet.
  const fullAccess = !isOrchestrator || project.isSelf;

  /*
   * LA FRONTIÈRE DU CHEF BRIDÉ. Il a tous les droits sauf modifier le code du
   * projet : on lui donne un DOSSIER DE TRAVAIL à part comme `cwd` — le seul
   * écrivable — et on garde le projet en LECTURE SEULE (monté par `projectRoot`,
   * jamais dans l'espace écrivable du bac à sable). Un dossier par projet, hors
   * des dépôts, gardé d'un tour à l'autre pour que le chef y retrouve ses notes.
   * L'agent de tâche et le chef d'HaikoDev lui-même, eux, travaillent dans le
   * dossier du projet (`dossier`).
   */
  const bride = isOrchestrator && !project.isSelf;
  let cwd = dossier;
  let projectRoot: string | undefined;
  if (bride) {
    const scratch = path.join(PATHS.chefScratch, project.id);
    fs.mkdirSync(scratch, { recursive: true });
    cwd = scratch;
    projectRoot = project.path;
  }

  /*
   * LE CHIFFRAGE ET L'EXÉCUTION PARTAGENT UN SEUL FIL. Le tour d'analyse ouvre
   * la session (rôle « analysis »), puis le même agent devient agent de tâche
   * pour exécuter. La consigne système est GRAVÉE dans le fil au premier tour et
   * Codex ne la renvoie pas en reprise : elle doit donc être celle de l'agent de
   * TÂCHE dès le chiffrage, sinon l'exécution hériterait d'un « tu ne modifies
   * aucun fichier ». Le rôle « analysis » ne sert plus qu'au suivi de colonne (il
   * ne déplace pas la carte, ne referme pas son dossier) ; côté moteur, un agent
   * d'analyse porteur d'une carte reçoit la consigne de tâche. Le tour lui-même
   * reste un chiffrage : la demande dit de ne rien modifier, et le gabarit
   * « pre_run » interdit d'écrire au passé.
   */
  const roleMoteur = agent.role === 'analysis' && agent.cardId ? 'task' : agent.role;
  const systemPrompt = rolePrompt(roleMoteur, project.isSelf, agent.run.engine, niveau, agent.run.mode);
  composition = { ...composition, systemPromptCharacters: systemPrompt.length };

  const env: Record<string, string> = {
    HAIKODEV_TOKEN: token,
    HAIKODEV_URL: url,
    HAIKODEV_AGENT: agent.id,
    // Le tour, pas seulement l'agent : c'est lui qui rend un appel d'outil
    // rattachable au travail en cours (`appelDuPontRecevable`).
    HAIKODEV_TOUR: tourId,
    /*
     * Le numéro du démon voyage avec l'agent : le garde posé devant ses
     * commandes (`shared/src/garde-demon.ts`) doit pouvoir reconnaître un
     * « kill -9 <numéro> » qui viserait le serveur lui-même.
     */
    HAIKODEV_DEMON_PID: String(process.pid),
    HAIKODEV_DEMON_RACINE: CONFIG.selfPath,
    /*
     * UN OUTIL A LE DROIT D'ATTENDRE UNE PERSONNE. Une question posée par
     * `ask_user` arrête le moteur jusqu'à la réponse : sans ce délai, Claude
     * abandonnerait l'appel au bout de cinq minutes et repartirait travailler
     * sans elle. Le plafond réel est tenu par le démon
     * (`shared/src/attente-question.ts`) ; ici on laisse simplement la place.
     */
    MCP_TOOL_TIMEOUT: String(delaiOutilMoteurMs()),
    // GITHUB POUR TOUS, PARTOUT : le jeton du serveur voyage dans
    // l'environnement (`shared/src/acces-github.ts`), donc `gh` marche dans une
    // copie de travail comme dans le bac à sable du chef, sans lire le dossier
    // personnel du serveur ni rien configurer projet par projet. Serveur non
    // identifié : aucune variable posée, `gh` le dira lui-même.
    ...(await envGithub()),
    ...applyAccountEnv(account),
  };

  /*
   * Le fil à reprendre appartient au moteur, au COMPTE dont le coffre le porte
   * et, sous Codex, au modèle qui l'a ouvert : `codex exec resume` refuse un fil
   * enregistré avec un autre modèle, et aucun moteur ne retrouve dans un coffre
   * un fil ouvert dans un autre (voir `cleDeSession`). Un changement de réglage
   * ou de compte ouvre donc un fil neuf au lieu d'afficher une erreur — la clé
   * est celle calculée en amont, avec le compte de ce tour.
   */
  const cleSession = tour.cleSession;
  const sessionId = store.getSessionId(agent.id, cleSession);
  const systemPromptRappel = rappelDeMethode(agent.run.engine);
  /*
   * L'ENTÊTE RÉELLEMENT ENVOYÉ CE TOUR-CI, décidé par la même règle que les
   * adaptateurs (`enteteDuTour`) : sous Claude la consigne entière repart à
   * chaque tour — elle est le PRÉFIXE de la session, et un préfixe qui bouge
   * fait réécrire la conversation entière dans le cache. Le tiroir « Contexte
   * envoyé » doit montrer ce texte-là, pas celui qu'on aurait envoyé avant.
   */
  const enteteEnvoye =
    enteteDuTour({
      engine: agent.run.engine,
      reprise: Boolean(sessionId),
      systemPrompt,
      systemPromptRappel,
    }) ?? systemPrompt;
  const instantane = contexteUtilisateur
    ? instantaneContexteEnvoye({
        engine: agent.run.engine,
        model: agent.run.model ?? adapter.defaultModel,
        nouvelleSession: !sessionId,
        prompt,
        systemPrompt: enteteEnvoye,
        enteteEntier: enteteEnvoye === systemPrompt,
        blocks: contexteUtilisateur.blocks,
        passages: contexteUtilisateur.passages,
        passagesRaison: contexteUtilisateur.passagesRaison,
        passagesMode: contexteUtilisateur.passagesMode,
        passagesPertinents: contexteUtilisateur.passagesPertinents,
      })
    : undefined;

  // Le pont d'outils du tour précédent ne prouve rien pour celui-ci.
  oublierLePont(agent.id);

  // L'avancement d'un tour précédent ne vaut rien pour celui-ci : on repart
  // sans liste, sinon le décroché de la carte montrerait un vieux « 3/3 ».
  // SAUF une POURSUITE : là, l'avancement d'avant est justement celui du travail
  // qui reprend — l'effacer ferait clignoter la carte à « aucune étape » alors
  // que sept sur dix sont faites.
  setStatus(agent, 'running', {
    startedAt: Date.now(),
    account: account.id,
    todos: todosRepris.length
      ? { done: todosRepris.filter((todo) => todo.state === 'done').length, total: todosRepris.length }
      : undefined,
    // Un fil neuf ne réutilise jamais la mesure du fil précédent. Tant que le
    // moteur ne parle pas, l'interface montre explicitement « indisponible ».
    contextUsage: nouvelleSession ? undefined : agent.contextUsage,
  });

  let sawError: string | undefined;
  /*
   * L'USAGE DES ESSAIS PRÉCÉDENTS. Un tour coupé par une panne du fournisseur
   * est relancé (plus bas) : chaque essai rend son propre événement d'usage, et
   * le dernier écraserait les précédents. On garde donc ce qui a déjà été
   * consommé et on l'additionne — la facture d'un tour, c'est TOUT ce qu'il a
   * coûté, essais compris.
   */
  let usageDesEssaisPrecedents: EngineEvent['usage'] | undefined;

  const lancerLeMoteur = (promptDuTour: string, sessionDuTour: string | null) =>
    adapter.run({
      cwd,
      projectRoot,
      prompt: promptDuTour,
      model: agent.run.model ?? undefined,
      thinking: agent.run.thinking,
      sessionId: sessionDuTour,
      systemPrompt,
      systemPromptRappel,
      mcpConfigPath,
      mcpBridgePath: bridgePath,
      gardeDuDemonPath: gardePath,
      fullAccess,
      mode: agent.run.mode,
      // Le RÔLE décide de l'effet du mode plan : un agent de tâche prépare sans
      // écrire, le chef garde ses outils (`modePlanFermeLEcriture`).
      role: agent.role,
      allowedTools: isOrchestrator && !project.isSelf ? orchestratorAllowList() : undefined,
      disallowedTools: isOrchestrator && !project.isSelf ? orchestratorDenyList() : undefined,
      env,
      onEvent: (event) => {
        agentLog(PATHS.logs, agent.id, JSON.stringify(event));
        // Le moteur parle : il est vivant. C'est ce repère, et lui seul, qui
        // distingue un tour qui travaille d'un tour muet pour toujours.
        runState.dernierSigneDeVie = Date.now();
        switch (event.kind) {
          case 'session':
            if (event.sessionId) {
              store.setSessionId(agent.id, event.sessionId, cleSession);
            }
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
              /*
               * UN REFUS DU BAC À SABLE SE DIT EN FRANÇAIS. Le projet est monté en
               * lecture seule pour un chef bridé et l'élévation de privilèges y
               * est coupée : une commande qui l'oublie rendait « EROFS », « sudo:
               * no new privileges » ou « Read-only file system », que le chef
               * reprenait en « je n'ai pas les droits » — alors que rien ne manque.
               * On ajoute la cause réelle et la route à prendre AU-DESSUS de la
               * sortie d'origine, qui reste lisible. Étape en cours exclue : son
               * détail est la commande, pas encore son résultat.
               */
              const brut = event.step.detail ?? existing?.detail;
              const explique =
                bride && event.step.state !== 'running' ? detailDuRefus(brut, project.path) : null;
              const step: RunStep = {
                id: event.step.key,
                label: event.step.label,
                state: event.step.state,
                detail: explique ?? brut,
                startedAt: existing?.startedAt ?? Date.now(),
                endedAt: event.step.state === 'running' ? undefined : Date.now(),
              };
              runState.steps.set(event.step.key, step);
              pushMessage(runState, { steps: [...runState.steps.values()], streaming: true });
              poserLetapeDesSteps(agent.id, [...runState.steps.values()]);
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

              /*
               * L'avancement voyage AUSSI avec l'agent : les étapes vivent sur les
               * messages (chargés seulement à l'ouverture d'une carte), mais le
               * décroché du tableau doit montrer « n/N faites » sans ouvrir la
               * carte. On pose donc le décompte sur l'agent lui-même, en relisant
               * son état frais pour ne pas écraser un statut posé ailleurs.
               */
              poserLaProgression(agent.id, runState.todos);

              /*
               * Liste entièrement cochée : cela se voit dans l'application, mais
               * n'interrompt plus personne. Une liste cochée n'est PAS une tâche
               * finie — le travail se clôt sur le constat du dépôt, et c'est
               * cette clôture-là qui prévient. Les deux annonçaient le même
               * événement : c'était le doublon d'origine.
               */
              if (!runState.todosNotified && allDone(runState.todos) && !allDone(avant)) {
                runState.todosNotified = true;
                notify({
                  motif: 'liste-taches',
                  title: 'Liste de tâches terminée',
                  body: `${agent.title} — ${runState.todos.length} tâche${runState.todos.length > 1 ? 's' : ''} cochée${runState.todos.length > 1 ? 's' : ''}`,
                  reference: agent.cardId ?? agent.id,
                  projectId: agent.projectId,
                  cardId: agent.cardId,
                });
              }
            }
            break;
          case 'usage':
            // Cumulé avec les essais précédents : un tour relancé après une panne
            // du fournisseur a coûté la somme de ses essais, pas seulement le
            // dernier.
            runState.usage = additionnerUsage(usageDesEssaisPrecedents, event.usage);
            if (contexteUtilisateur && runState.usage) {
              mesurerContexteUtilisateur(messageDuContexte, runState.usage);
            }
            break;
          case 'context':
            if (event.context) {
              const window = event.context.window ?? catalogContextWindow;
              runState.context = {
                tokens: event.context.tokens,
                window,
              };
              const contextUsage = mesurerContexte(event.context.tokens, window);
              const frais = store.getAgent(agent.id);
              if (frais && contextUsage) {
                const maj = store.saveAgent({ ...frais, contextUsage });
                bus.emit({ type: 'agent.upsert', agent: maj });
              }
            }
            break;
          case 'ratelimit':
            if (event.rateLimit) {
              // Le compte est mis de côté, ET le tour retient qu'il a été coupé
              // par une limite : sans cette marque, l'arrêt qui suit ne se
              // distinguerait plus d'une panne ordinaire.
              if (limiteBloquante(event.rateLimit.status)) runState.limiteSignalee = true;
              noteAccountUse(account.id, event.rateLimit);
            }
            break;
          case 'error':
            sawError = event.error;
            break;
          default:
            break;
        }
      },
    });

  /*
   * LE TOUR EST SUIVI DÈS QUE LE MOTEUR TOURNE — avant tout autre travail.
   *
   * L'inscription dans `live` venait après l'enregistrement du contexte envoyé :
   * entre les deux, le moteur écrivait déjà sa réponse alors que le démon ne le
   * suivait pas encore. La moindre panne dans cette fenêtre (une vieille ligne
   * de base relue par la purge, par exemple) remontait au filet de `sendPrompt`,
   * qui refermait un tour BIEN VIVANT : bulle rouge « panne interne du serveur »
   * posée sur un message vide, agent marqué en échec — pendant que le moteur
   * continuait, sans personne pour l'arrêter ni pour ranger sa fin de tour.
   * Suivi d'abord : une panne survenue ensuite arrête vraiment le moteur.
   */
  /*
   * …MAIS SEULEMENT SI CE TOUR A ENCORE COURS. La préparation qui mène ici peut
   * avoir été ABANDONNÉE entre-temps — trop longue, donc refermée par la veille,
   * ou coupée par un arrêt à la main — et l'agent porte alors peut-être déjà un
   * tour tout neuf, reparti de sa file. Lancer un second moteur par-dessus lui
   * volerait sa place dans les tours vivants : le premier à finir refermerait le
   * tour de l'autre, et la réponse attendue n'arriverait jamais. On s'arrête donc
   * là, sans rien toucher.
   */
  if (demarrant.get(agent.id)?.jeton !== tour.preparation) {
    log.warn(`tour abandonné avant le lancement du moteur (agent ${agent.id}) : la préparation a été refermée`);
    return;
  }

  const handle = lancerLeMoteur(prompt, sessionId);

  runState.handle = handle;
  live.set(agent.id, runState);
  // …et l'écran l'apprend tout de suite : le témoin de travail suit ce tour, pas
  // ce qui s'écrit (`shared/src/travail-en-cours.ts`).
  marquerLeTourVivant(agent.id, runState.startedAt);

  /*
   * Seulement après que l'adaptateur a accepté et lancé le tour : une demande
   * restée en file ou refusée avant ce point n'affiche aucun faux envoi.
   *
   * Et jamais au prix du tour : le contexte envoyé est un CONFORT de lecture,
   * le tour est parti. Ce qui rate ici se dit dans le journal et le travail
   * continue.
   */
  if (contexteUtilisateur && instantane) {
    try {
      const message = store.getMessage(messageDuContexte);
      if (message) {
        let updated = store.saveMessage({
          ...message,
          sentContext: instantane,
        });
        // Un outil extrêmement rapide peut répondre avant que cette
        // photographie initiale ne soit posée. Le tampon du tour empêche alors
        // sa première ouverture de disparaître. La photographie nue reste
        // toutefois enregistrée en premier : ce repère garantit que rien n'est
        // rattaché à une demande encore en file ou à un moteur non suivi.
        if (runState.consultationsMemoire.length) {
          updated = store.saveMessage({
            ...updated,
            sentContext: {
              ...instantane,
              consultationsMemoire: [...runState.consultationsMemoire],
            },
          });
        }
        bus.emit({ type: 'message.upsert', message: updated });
        store.purgerContexteEnvoyeAncien(agent.id);
        // Un adaptateur d'essai peut rendre l'usage dès son appel ; dans ce cas
        // on applique aussitôt la mesure qui serait sinon arrivée trop tôt.
        if (runState.usage) mesurerContexteUtilisateur(messageDuContexte, runState.usage);
      }
    } catch (err) {
      log.warn(`contexte envoyé non enregistré (agent ${agent.id}) : ${(err as Error).message}`);
    }
  }

  bus.emit({ type: 'capacity', capacity: (await import('./capacity.js')).snapshot() });

  /*
   * LA PANNE DU FOURNISSEUR NE TUE PLUS LA TÂCHE.
   *
   * « API Error: 500 Internal server error », « Server error mid-response » : le
   * moteur s'arrête en code 1 au milieu du travail, après plusieurs dizaines
   * d'étapes réussies. Ces pannes viennent du FOURNISSEUR et sont passagères —
   * l'agent retente donc tout seul, avec une attente croissante et un nombre
   * d'essais borné (`shared/src/panne-passagere.ts`), sur le MÊME fil : il
   * reprend là où il s'était arrêté au lieu de repartir de zéro.
   *
   * Le fil se retrouve par l'identifiant de session relu à l'instant du nouvel
   * essai — le moteur l'a annoncé au premier. S'il manque (moteur coupé avant
   * d'avoir parlé), le nouvel essai repart sur un fil neuf, avec la consigne de
   * reprise : moins bien qu'une reprise de fil, infiniment mieux qu'un abandon.
   */
  const relance = await lancerAvecRelances({
    lancer: (essai, motif) => {
      if (essai === 0 || !motif) return handle;
      // Ce que les essais précédents ont coûté est mis de côté AVANT que le
      // nouvel essai ne rende son propre usage : le tour les additionne.
      usageDesEssaisPrecedents = runState.usage;
      sawError = undefined;
      if (motif === 'session-morte') {
        // Le fil que le moteur connaissait a expiré de son côté : le garder
        // ferait retomber sur le même refus (« No conversation found »). On
        // l'oublie ICI pour que l'essai suivant reparte sur un fil neuf, sans
        // attendre d'intervention humaine.
        store.clearSession(agent.id, cleSession);
      }
      /*
       * UN NOUVEL ESSAI EMPORTE LA DEMANDE DE SON TOUR (`demandeDeRepriseApresPanne`).
       * Il ne partait qu'avec « continue où tu t'es arrêté » : le moteur allait
       * alors chercher tout seul ce qu'il faisait, c'est-à-dire la demande
       * PRÉCÉDENTE de la conversation — d'où des cartes proposées pour l'avant-
       * dernier message. Le prompt du tour repart donc en entier, à chaque essai.
       *
       * Deux constats l'accompagnent : le moteur avait-il COMMENCÉ (du texte
       * écrit, une étape franchie — les étapes posées par le démon lui-même ne
       * comptent pas), et son fil repart-il à NEUF (session oubliée juste
       * au-dessus, ou jamais annoncée par un moteur coupé trop tôt).
       */
      const filDuNouvelEssai = store.getSessionId(agent.id, cleSession);
      const etapesDuMoteurAvant = [...runState.steps.keys()].filter(
        (cle) => cle !== MEMORY_STEP_ID && cle !== ETAPE_PANNE_ID,
      );
      const suivant = lancerLeMoteur(
        demandeDeRepriseApresPanne({
          motif,
          essai,
          promptDuTour: prompt,
          travailCommence: runState.text.trim().length > 0 || etapesDuMoteurAvant.length > 0,
          filNeuf: !filDuNouvelEssai,
        }),
        filDuNouvelEssai,
      );
      // L'arrêt manuel doit porter sur le moteur qui tourne VRAIMENT.
      runState.handle = suivant;
      return suivant;
    },
    etat: () => ({
      erreur: sawError,
      texte: runState.text,
      arretDemande: runState.stopping,
      // Un arrêt de quota garde sa propre route : « avec quel compte poursuivre ? ».
      limiteQuota: arretDuAuQuota({
        ok: false,
        arretDemande: runState.stopping,
        limiteSignalee: runState.limiteSignalee,
        erreur: sawError,
        texte: runState.text,
      }),
    }),
    avantNouvelEssai: ({ essai, motif, attenteMs }) => {
      log.warn(`panne passagère du moteur (${motif}) sur l'agent ${agent.id} : nouvel essai ${essai} dans ${attenteMs} ms`);
      // Déjà signalée sur cette session : on retente en silence, sans rouvrir
      // la bannière que l'utilisateur a déjà vue.
      if (panneDejaSignalee.get(agent.id)) return;
      runState.steps.set(ETAPE_PANNE_ID, {
        id: ETAPE_PANNE_ID,
        label: libelleDeLEtape(motif, essai, attenteMs),
        state: 'running',
        startedAt: Date.now(),
      });
      pushMessage(runState, { steps: [...runState.steps.values()], streaming: true });
    },
    apresNouvelEssai: ({ essai, ok }) => {
      // La bannière déjà signalée reste tue ; l'essai marque tout de même la
      // panne comme dite, pour que le prochain envoi retente sans un mot.
      panneDejaSignalee.set(agent.id, true);
      if (!runState.steps.has(ETAPE_PANNE_ID)) return;
      runState.steps.set(ETAPE_PANNE_ID, {
        id: ETAPE_PANNE_ID,
        label: libelleDeLaReprise(essai),
        state: ok ? 'done' : 'running',
        startedAt: runState.steps.get(ETAPE_PANNE_ID)?.startedAt ?? Date.now(),
        endedAt: ok ? Date.now() : undefined,
      });
      pushMessage(runState, { steps: [...runState.steps.values()], streaming: true });
    },
  });
  const result = relance.result;
  /*
   * Tous les essais ont échoué : la tâche est INTERROMPUE par le fournisseur,
   * elle n'a pas raté. La cause réelle est dite en clair, l'agent se met au
   * repos plutôt qu'en échec, et le travail déjà fait reste sur sa branche.
   */
  const panneDefinitive = relance.panne;
  const elapsedSeconds = (Date.now() - runState.startedAt) / 1000;
  // `tokens` reste le total COMPLET (cache compris) : c'est lui qui sert la
  // facturation et l'historique de consommation (`recordUsage`), où le cache
  // doit rester compté.
  const tokens =
    (runState.usage?.inputTokens ?? 0) +
    (runState.usage?.cachedTokens ?? 0) +
    (runState.usage?.outputTokens ?? 0);
  // Compteur affiché sous la bulle, cache écarté : voir `tokensSousLaBulleDeReponse`.
  const tokensAffiches = tokensSousLaBulleDeReponse(runState.usage);


  // Contrôle de forme : un moteur qui ignore le gabarit se fait rattraper.
  let finalText = runState.text.trim();
  const formCheck = checkTemplate(template, finalText, ampleur);
  if (!formCheck.ok && finalText && template !== 'none') {
    const griefs: string[] = [];
    if (formCheck.missing.length) griefs.push(`sections manquantes (${formCheck.missing.join(', ')})`);
    if (formCheck.dense.length) griefs.push(`texte tassé, sans paragraphes (${formCheck.dense.join(', ')})`);
    finalText += `\n\n> [!NOTE]\n> Réponse hors format : ${griefs.join(' ; ')}.`;
  }

  /*
   * LES OUTILS DU PROJET ÉTAIENT-ILS LÀ ? Un tour pouvait se dérouler entier
   * sans que le pont ne démarre : aucun outil, aucune mémoire lue, et une
   * réponse qui affirmait quand même l'avoir consultée. La panne se DIT
   * maintenant, en étape rouge dans la conversation, au lieu de se taire.
   */
  const pont = etatDuPont(passageDuPont(agent.id));
  // Un moteur qui n'a jamais démarré (compte refusé, binaire absent) n'a rien
  // fait du tout : sa panne est déjà dite, celle du pont serait un faux motif.
  const etapesDuMoteur = [...runState.steps.keys()].filter((cle) => cle !== MEMORY_STEP_ID);
  /*
   * « MUET » VEUT DIRE : LE LANCEMENT N'A JAMAIS JOINT LE MOTEUR — binaire
   * introuvable, réseau coupé au démarrage du processus. C'est à ce titre, et à
   * ce titre seul, que la carte repart en « Planifié » pour se relancer toute
   * seule (`colonneApresMoteurMuet`).
   *
   * ET C'EST LE MOTEUR QUI LE DIT, PLUS LE DÉMON QUI LE DEVINE. L'adaptateur est
   * le seul à savoir : il a lu, ou n'a pas lu, une ligne du protocole
   * (`ResultatDuMoteur.jamaisDemarre`). On en déduisait la même chose par un
   * faisceau d'ABSENCES — pas d'étape, pas de texte, pas de liste de tâches —
   * et ce faisceau se trompait dès qu'un moteur parlait sans rien produire de
   * visible : un tour qui annonçait sa liste de tâches puis tombait passait pour
   * « jamais joint », sa carte retournait en « Planifié » et l'ordonnanceur la
   * relançait de zéro, avec la demande D'ORIGINE, alors qu'il y avait eu un
   * vrai échec de TÂCHE à relire. Constaté par
   * `scripts/verif-cycle-de-vie-carte.mjs`.
   *
   * Le faisceau reste en REPLI, et rien de plus : il ne sert qu'à un adaptateur
   * qui ne dirait rien du tout.
   */
  const jamaisDemarre =
    result.jamaisDemarre ??
    (!etapesDuMoteur.length && !runState.text.trim() && !runState.todos.length);
  const moteurMuet = !result.ok && jamaisDemarre;
  if (!pont.ok && !moteurMuet) {
    runState.steps.set(ETAPE_PONT_ID, {
      id: ETAPE_PONT_ID,
      label: ETAPE_PONT,
      state: 'failed',
      detail: pont.raison,
      startedAt: runState.startedAt,
      endedAt: Date.now(),
    });
    log.warn(`pont d'outils indisponible pour l'agent ${agent.id} : ${pont.raison}`);
    // L'étape rouge se replie dans un tiroir qu'on peut ne jamais ouvrir : sans
    // ce mot dans le TEXTE, une phrase inventée par le moteur (« refusé »,
    // « aucune carte créée ») restait la seule chose lue.
    finalText += noteDePontEnEchec(pont.raison);
  }

  const failed = !result.ok || !!sawError;

  /*
   * CET ARRÊT VIENT-IL DU QUOTA ? La question ne se pose que sur un tour tombé.
   * Deux preuves possibles : l'événement structuré du moteur (retenu pendant le
   * tour) ou son texte d'annonce (« You've hit your session limit »). La règle
   * vit dans `shared` — elle écarte l'arrêt manuel et refuse les à-peu-près.
   *
   * Reconnu, le tour n'est plus un échec : le travail n'a rien de cassé, il lui
   * manque du quota. Le message porte alors la décision « Avec quel compte
   * poursuivre ? » au lieu du bandeau rouge, et l'agent se met en pause.
   */
  const motifQuota = failed
    ? motifDArretQuota({
        ok: false,
        arretDemande: runState.stopping,
        limiteSignalee: runState.limiteSignalee,
        erreur: sawError ?? result.error,
        texte: runState.text,
      })
    : null;
  const reprise = motifQuota
    ? repriseDeCompte({ engine: agent.run.engine, compte: account, motif: motifQuota })
    : undefined;

  /*
   * LE PLAN RENDU EST-IL ENTIER ? La consigne le demandait déjà en toutes
   * lettres ; rien ne la faisait respecter. Une relance formulée en QUESTION
   * recevait une réponse ordinaire — trois pistes et « dites-moi laquelle
   * intégrer au plan » — habillée quand même en « Plan proposé · version 3 »,
   * avec ses boutons de décision : l'utilisateur perdait son plan, et
   * « Valider » portait sur un fragment.
   *
   * On regarde donc le texte rendu (`jugerLePlan`, `shared/src/plan-complet.ts`) :
   *   — un fil qui portait DÉJÀ un plan exige son successeur entier, donc le
   *     chef est RELANCÉ une fois, dans la même session, avec les parties
   *     manquantes nommées ;
   *   — si la relance ne suffit pas — ou si aucun plan n'avait encore été écrit,
   *     cas d'une simple question —, le message n'est pas un plan : ni cadre,
   *     ni « Valider » sur un texte incomplet.
   */
  let planRendu = agent.run.mode === 'plan' && !failed;
  if (planRendu) {
    const jugement = jugerLePlan(finalText);
    const precedent = jugement.complet
      ? null
      : dernierPlanRedige(store.listMessages(agent.id).filter((m) => m.id !== runState.messageId));
    if (!jugement.complet && precedent) {
      runState.steps.set(ETAPE_PLAN_ID, {
        id: ETAPE_PLAN_ID,
        label: `${ETAPE_PLAN} — il manque ${jugement.manquantes.join(', ')}`,
        state: 'running',
        startedAt: Date.now(),
      });
      pushMessage(runState, { steps: [...runState.steps.values()] });
      const entier = await rendreLePlanEntier({
        adapter,
        cwd,
        projectRoot,
        agent,
        sessionId: store.getSessionId(agent.id, cleSession),
        mcpBridgePath: bridgePath,
        fullAccess,
        env,
        consigne: consigneDePlanEntier(precedent.numero + 1, jugement.manquantes),
      }).catch(() => '');
      const refait = entier ? jugerLePlan(entier) : { complet: false, manquantes: jugement.manquantes };
      if (refait.complet) {
        finalText = entier;
        runState.steps.set(ETAPE_PLAN_ID, {
          id: ETAPE_PLAN_ID,
          label: `${ETAPE_PLAN} — version ${precedent.numero + 1} rendue en entier`,
          state: 'done',
          startedAt: Date.now(),
          endedAt: Date.now(),
        });
      } else {
        planRendu = false;
        runState.steps.set(ETAPE_PLAN_ID, {
          id: ETAPE_PLAN_ID,
          label: `${ETAPE_PLAN} — refusé : il manque toujours ${refait.manquantes.join(', ')}`,
          state: 'failed',
          startedAt: Date.now(),
          endedAt: Date.now(),
        });
        finalText += `\n\n> [!WARNING]\n> Cette réponse n'est pas un plan entier (${refait.manquantes.join(', ')} manque). Elle ne porte donc pas de bouton « Valider » : redemandez le plan complet.`;
      }
    } else if (!jugement.complet) {
      planRendu = false;
    }

    /*
     * LE FOND, une fois la forme acquise. Les quatre titres étaient tenus, mais
     * remplis d'une phrase chacun : un plan qui « a l'air d'un plan » sans rien
     * avoir étudié. On relance donc UNE FOIS de plus, ici SANS exiger qu'un plan
     * précédent existe — c'est le premier plan d'une conversation qui est le
     * plus souvent bâclé, et c'est lui qu'on lit le plus.
     *
     * Cette exigence-là ne retire JAMAIS le drapeau `plan` : un plan mince mais
     * entier reste décidable. Au pire, la relance ne donne rien et l'on garde
     * le texte d'origine — jamais un plan perdu pour une exigence de style.
     */
    if (planRendu) {
      const fond = jugerLeFond(finalText);
      if (!fond.assezFouille) {
        const dernier = dernierPlanRedige(store.listMessages(agent.id).filter((m) => m.id !== runState.messageId));
        runState.steps.set(ETAPE_FOND_ID, {
          id: ETAPE_FOND_ID,
          label: `${ETAPE_FOND} — ${fond.reproches.map((r) => r.id).join(', ')}`,
          state: 'running',
          startedAt: Date.now(),
        });
        /*
         * LE CADRE S'OUVRE AVANT LA REPRISE, PAS APRÈS. La forme est acquise :
         * les quatre parties sont là, le texte est fini d'écrire, le plan est
         * donc DÉCIDABLE — et cette exigence-ci ne retire jamais le drapeau
         * `plan`. Attendre la reprise pour poser le cadre laissait pourtant le
         * plan en TEXTE BRUT pendant tout un tour de moteur (soixante à cent
         * vingt secondes mesurées) : on croyait la réponse incomplète, on
         * relançait, on attendait pour rien. On pose donc le plan rendu tout de
         * suite ; si la reprise l'améliore, le texte se remplace DANS le cadre,
         * qui ne disparaît à aucun moment.
         */
        pushMessage(runState, {
          content: finalText,
          steps: [...runState.steps.values()],
          streaming: false,
          plan: true,
        });
        // La colonne de gauche pose son icône « un plan attend » en même temps
        // que le cadre : les deux disent la même chose, ils ne se décalent pas.
        bus.emit({ type: 'plans', ...store.signalPlans() });
        const fouille = await rendreLePlanEntier({
          adapter,
          cwd,
          projectRoot,
          agent,
          sessionId: store.getSessionId(agent.id, cleSession),
          mcpBridgePath: bridgePath,
          fullAccess,
          env,
          consigne: consigneDePlanPlusFouille((dernier?.numero ?? 0) + 1, fond.reproches),
        }).catch(() => '');
        const garde = fouille && jugerLePlan(fouille).complet;
        if (garde) finalText = fouille;
        runState.steps.set(ETAPE_FOND_ID, {
          id: ETAPE_FOND_ID,
          label: garde ? `${ETAPE_FOND} — plan repris en profondeur` : `${ETAPE_FOND} — repris tel quel`,
          state: garde ? 'done' : 'failed',
          startedAt: Date.now(),
          endedAt: Date.now(),
        });
      }
    }
  }

  /*
   * LA CARTE A-T-ELLE ÉTÉ APPELÉE, OU SEULEMENT RACONTÉE ?
   *
   * Le tri du chef dit en toutes lettres qu'une demande de programmation passe
   * par `board_create_card`. Un petit modèle (Haiku) préfère pourtant RACONTER
   * l'action : « J'ai créé la tâche… », tour rendu, aucune proposition née,
   * aucun bouton « Valider » — l'utilisateur attend une carte qui n'arrivera
   * jamais. Sonnet, lui, appelle l'outil : le défaut tient au modèle, donc rien
   * dans la consigne ne le règlera à coup sûr.
   *
   * On regarde donc le RÉSULTAT (`carteAnnonceeSansOutil`,
   * `shared/src/carte-en-texte.ts`) : une annonce de carte sans proposition
   * attachée au message vaut relance. Un seul tour court, dans la MÊME session,
   * outils ouverts — la proposition qui en naît se rattache toute seule au
   * message de ce tour (`attachToCurrentMessage`). Si elle ne vient toujours
   * pas, la réponse le DIT plutôt que de laisser la phrase du moteur faire
   * croire le contraire.
   */
  const phraseDeCarte = carteAnnonceeSansOutil({
    role: agent.role,
    mode: agent.run.mode,
    echec: failed || Boolean(reprise) || Boolean(panneDefinitive),
    propositions: store.getMessage(runState.messageId)?.proposals.length ?? 0,
    texte: finalText,
  });
  if (phraseDeCarte) {
    const debutRattrapage = Date.now();
    const carteNee = () => (store.getMessage(runState.messageId)?.proposals.length ?? 0) > 0;
    const poserLetape = (label: string, state: 'running' | 'done' | 'failed') => {
      runState.steps.set(ETAPE_CARTE_ID, {
        id: ETAPE_CARTE_ID,
        label: `${ETAPE_CARTE} — ${label}`,
        state,
        startedAt: debutRattrapage,
        ...(state === 'running' ? {} : { endedAt: Date.now() }),
      });
    };
    const relancer = (consigne: string) =>
      exigerLappelDeLoutil({
        adapter,
        cwd,
        projectRoot,
        agent,
        sessionId: store.getSessionId(agent.id, cleSession),
        mcpConfigPath,
        mcpBridgePath: bridgePath,
        fullAccess,
        env,
        allowedTools: isOrchestrator && !project.isSelf ? orchestratorAllowList() : undefined,
        disallowedTools: isOrchestrator && !project.isSelf ? orchestratorDenyList() : undefined,
        consigne,
      }).catch(() => '');

    poserLetape("annoncée en texte, sans appel d'outil", 'running');
    pushMessage(runState, { steps: [...runState.steps.values()] });
    log.warn(`carte annoncée sans outil par l'agent ${agent.id} : relance`);

    /* 1. LA RELANCE. Le modèle garde la main : c'est lui qui écrit le mieux
     *    les arguments de sa propre carte. */
    let dernierTexte = await relancer(consigneDeCarteReelle(phraseDeCarte));
    let issue = carteNee() ? 'carte posée après reprise' : '';

    /* 2. LE FILET DU DÉMON, tout de suite après — il est INSTANTANÉ et ne
     *    dépend d'aucun modèle. Quand la réponse (ou la relance) DÉCRIT une
     *    carte, HaikoDev la relit et appelle l'outil lui-même. La proposition
     *    garde ses boutons : rien n'entre sur le tableau sans le clic. */
    if (!issue) {
      const relue = carteDecriteEnTexte(dernierTexte) ?? carteDecriteEnTexte(finalText);
      if (relue && (await poserLaCarteRelue(agent, project.id, relue))) {
        issue = 'carte posée par HaikoDev, relue dans le texte';
      }
    }

    /* 3. LE DERNIER RAPPEL, réservé au cas où la réponse ne décrivait AUCUNE
     *    carte relisible : on n'invente pas, on redemande — en disant cette
     *    fois ce que l'outil exige d'une description. */
    if (!issue) {
      dernierTexte = await relancer(consigneDeDernierRappel(MIN_SIGNES_CARTE_COURTE));
      if (carteNee()) issue = 'carte posée au dernier rappel';
      else {
        const relue = carteDecriteEnTexte(dernierTexte);
        if (relue && (await poserLaCarteRelue(agent, project.id, relue))) {
          issue = 'carte posée par HaikoDev, relue dans le texte';
        }
      }
    }

    poserLetape(issue || 'aucune carte, même après deux reprises', issue ? 'done' : 'failed');
    if (!issue) finalText += AVERTISSEMENT_SANS_CARTE;
    else log.info(`rattrapage de carte pour l'agent ${agent.id} : ${issue}`);
  }

  // Le résumé de repli n'est oublié qu'une fois le premier tour de la nouvelle
  // session RÉUSSI. Une session créée puis refusée doit pouvoir le renvoyer.
  if (nouvelleSession) {
    const frais = store.getAgent(agent.id);
    if (!failed && frais?.context?.continuitySummary) {
      const context = { ...frais.context };
      delete context.continuitySummary;
      const maj = store.saveAgent({ ...frais, context });
      bus.emit({ type: 'agent.upsert', agent: maj });
    } else if (failed && frais?.context?.continuitySummary) {
      // Le moteur a pu annoncer un identifiant avant de refuser le tour. On
      // l'oublie pour que le prochain essai reparte bien AVEC le résumé.
      store.clearSession(agent.id, cleSession);
    }
  }
  /*
   * LA LISTE DE TÂCHES SE REFERME AVEC LE TOUR (`cloturerLesTaches`). Arrêter
   * le chronomètre de la dernière ligne ne suffisait pas : son ÉTAT restait
   * « en cours », et le rond orange brillait pour toujours sur une carte
   * pourtant close. Un tour rendu coche cette ligne ; un tour tombé, coupé par
   * un quota ou par une panne, dit « non faite » — jamais « en attente ».
   */
  runState.todos = cloturerLesTaches(runState.todos, {
    issue: failed || reprise || panneDefinitive ? 'interrompu' : 'reussi',
    maintenant: Date.now(),
  });
  // Le résumé porté par l'agent — celui que lit le tableau — se refait avec la
  // liste : sans cela, la conversation dit « 5/5 faites » et la carte « 4/5 ».
  poserLaProgression(agent.id, runState.todos);
  const stepsRefermees = [...runState.steps.values()].map((s) =>
    s.state === 'running' ? { ...s, state: 'failed' as const } : s,
  );
  // Un tour clos sans todos (uniquement des `steps`) doit lui aussi éteindre
  // le libellé posé sur l'agent : sinon le tableau garde à vie l'étape d'un
  // tour pourtant terminé.
  poserLetapeDesSteps(agent.id, stepsRefermees);
  pushMessage(runState, {
    content: finalText || (failed ? '' : 'Terminé.'),
    steps: stepsRefermees,
    todos: runState.todos,
    streaming: false,
    tokens: tokensAffiches || undefined,
    durationMs: Math.round(elapsedSeconds * 1000),
    account: account.label,
    // Un arrêt dû au quota n'affiche pas de panne : le bloc de reprise dit ce
    // qui s'est passé et propose la suite, ce que « code 1 » ne faisait pas.
    // Une panne du fournisseur, elle, s'affiche en rouge SEULEMENT quand tous
    // les essais ont échoué — et avec sa cause réelle, jamais un « code 1 ».
    error: reprise
      ? undefined
      : panneDefinitive
        ? messageDePanneDefinitive(panneDefinitive, relance.essais)
        : failed
          ? sawError ?? result.error ?? "Le moteur s'est arrêté avant la fin."
          : undefined,
    repriseCompte: reprise,
    /*
     * C'EST ICI, ET NULLE PART AVANT, QUE LE MESSAGE DEVIENT UN PLAN. Le
     * drapeau était posé au LANCEMENT du tour, avant de savoir ce qui serait
     * écrit : le cadre s'ouvrait sur la première phrase, et il fallait ensuite
     * le retirer aux tours tombés. On le pose maintenant à la FIN, et
     * seulement quand les trois conditions sont réunies :
     *   — la conversation est bien en mode plan ;
     *   — le tour est allé au bout (un tour TOMBÉ, quota ou panne, ne laisse au
     *     mieux qu'une bannière du moteur, jamais un plan rédigé) ;
     *   — le texte rendu est un plan ENTIER (`planRendu`, plus haut) : le cadre
     *     et ses boutons ne s'ouvrent que sur les quatre parties.
     * `planRendu` porte déjà les deux premières.
     */
    plan: planRendu,
  });
  /*
   * LA RÉPONSE EST RENDUE. Tout ce qui suit est du service — compression du fil,
   * constat du dépôt, dossier de carte refermé — et l'utilisateur, lui, voit
   * déjà sa réponse. On date ce moment : passé le plafond, la veille des tours
   * bloqués referme d'autorité plutôt que de laisser tourner un compteur vide.
   */
  runState.reponseFigeeA = Date.now();
  /*
   * Le message qui vient de se figer peut avoir posé un plan, ou en avoir
   * refusé un d'office (tout message rédigé qui suit un plan le remplace,
   * `indexDuPlanCourant`). Dans les deux cas, la colonne de gauche doit le
   * savoir : c'est ici, à la fin RÉELLE du tour, qu'on recalcule — jamais à
   * chaque bribe de texte qui s'écrit (`pushMessage` plus haut est appelé en
   * continu pendant le streaming).
   */
  bus.emit({ type: 'plans', ...store.signalPlans() });

  /*
   * LA COMPTABILITÉ DU TOUR VIENT APRÈS L'AFFICHAGE, JAMAIS AVANT.
   *
   * Relire le quota du compte est un appel RÉSEAU au fournisseur, mis en file
   * derrière les autres tours du même compte (`enSerieSurCompte`) : quelques
   * secondes, douze au plus par lecture. Il était fait AVANT le dernier
   * `pushMessage`, donc le message restait « en écriture » — et un plan restait
   * du TEXTE — pendant une opération qui ne regarde que les chiffres. La
   * réponse est désormais rendue d'abord ; la mesure suit, dans la même
   * frontière sûre (l'agent est encore dans `live`).
   */
  /*
   * Le repère appartient au COMPTE, pas à chaque tour. Une fin ne répartit que
   * la hausse depuis le relevé précédent et la cumule sur les tours présents.
   * Le tour fini est ensuite écarté du quota partagé, mais reste dans `live`
   * jusqu'à la fin de la compression : une nouvelle demande doit encore
   * s'empiler pendant cette frontière sûre.
   */
  const parts = await enSerieSurCompte(account.id, async () => {
    const quotaApres = await relireQuotaDuCompte(account.id).catch(() => null);
    if (quotaApres) {
      const maintenant = Date.now();
      const tours = [...live.values()]
        .filter((run) => run.account === account.id && !run.quotaTermine)
        .map((run) => ({
          id: run.agentId,
          poids: poidsDeTour(
            (run.usage?.inputTokens ?? 0) + (run.usage?.outputTokens ?? 0),
            (maintenant - run.startedAt) / 1000,
          ),
          quota5h: run.quota5h,
          quotaSemaine: run.quotaSemaine,
        }));
      const cumuls = cumulerPartsQuota(dernierQuotaReparti.get(account.id) ?? quotaAvant, quotaApres, tours);
      for (const cumul of cumuls) {
        const run = live.get(cumul.id);
        if (!run) continue;
        run.quota5h = cumul.quota5h;
        run.quotaSemaine = cumul.quotaSemaine;
      }
      dernierQuotaReparti.set(account.id, quotaApres);
    }

    const resultat = {
      quota5h: runState.quota5h,
      quotaSemaine: runState.quotaSemaine,
      quota5hMesurable: quotaApres?.session !== undefined,
      quotaSemaineMesurable: quotaApres?.weekly !== undefined,
    };
    runState.quotaTermine = true;
    if (![...live.values()].some((run) => run.account === account.id && !run.quotaTermine)) {
      dernierQuotaReparti.delete(account.id);
    }
    return resultat;
  });

  store.recordUsage({
    projectId: agent.projectId,
    cardId: agent.cardId,
    agentId: agent.id,
    account: account.id,
    engine: agent.run.engine,
    // Le DÉTAIL du tour, pour que l'historique puisse dire ce qui est parti et
    // ce qui est revenu — et le chiffrer quand le tarif du modèle est connu.
    model: agent.run.model ?? adapter.defaultModel,
    inputTokens: runState.usage?.inputTokens,
    cachedTokens: runState.usage?.cachedTokens,
    outputTokens: runState.usage?.outputTokens,
    tokens,
    tokensIn: runState.usage ? (runState.usage.inputTokens ?? 0) + (runState.usage.cachedTokens ?? 0) : undefined,
    tokensOut: runState.usage ? (runState.usage.outputTokens ?? 0) : undefined,
    quota5h: parts.quota5h,
    quotaSemaine: parts.quotaSemaine,
    seconds: elapsedSeconds,
  });

  const measurement: TurnMeasurement = {
    usage: {
      inputTokens: runState.usage?.inputTokens ?? 0,
      cachedInputTokens: runState.usage?.cachedTokens,
      outputTokens: runState.usage?.outputTokens ?? 0,
    },
    quota: {
      quota5h: quotaAvant.session !== undefined && parts.quota5hMesurable ? parts.quota5h : undefined,
      quotaWeekly:
        quotaAvant.weekly !== undefined && parts.quotaSemaineMesurable ? parts.quotaSemaine : undefined,
    },
    composition,
  };

  if (!failed && agent.role === 'orchestrator') {
    finaliserPropositionsDuChef(runState.messageId, agent.projectId, measurement);
  }

  /*
   * FRONTIÈRE SÛRE : la réponse visible est finie, mais l'agent reste dans
   * `live`, donc toute nouvelle demande s'empile encore. C'est ici seulement
   * que le remplissage est gravé et qu'une éventuelle compression peut partir.
   */
  const contextWindow = runState.context?.window ?? catalogContextWindow;
  if (runState.context && contextWindow) {
    const frais = store.getAgent(agent.id)!;
    const observation = observerContexte(
      frais.context,
      runState.context.tokens,
      contextWindow,
      plafondDeContexte(agent.role),
    );
    if (observation) {
      const mesure = store.saveAgent({
        ...frais,
        context: observation.state,
        contextUsage: mesurerContexte(runState.context.tokens, contextWindow),
      });
      bus.emit({ type: 'agent.upsert', agent: mesure });
      if (observation.shouldCompress) {
        await compresserContexte(mesure, {
          adapter,
          dossier,
          sessionId: store.getSessionId(agent.id, cleSession),
          systemPrompt,
          mcpConfigPath,
          mcpBridgePath: bridgePath,
          fullAccess,
          allowedTools: isOrchestrator && !project.isSelf ? orchestratorAllowList() : undefined,
          disallowedTools: isOrchestrator && !project.isSelf ? orchestratorDenyList() : undefined,
          env,
          cleSession,
        });
      }
    }
  }

  const finalAgent = store.getAgent(agent.id)!;
  // « stopped » et non « failed » : l'agent n'a pas échoué, il attend de savoir
  // sur quel compte poursuivre. La carte reste au repos, sans voyant d'échec.
  // Même verdict pour une panne du fournisseur qui a résisté à tous les essais :
  // le travail a été INTERROMPU, il n'a pas raté.
  setStatus(finalAgent, reprise || panneDefinitive ? 'stopped' : failed ? 'failed' : 'done', {
    endedAt: Date.now(),
  });

  /*
   * LE CONSTAT, avant tout déplacement de carte : le dépôt a-t-il bougé ? On le
   * lit ici, tant que le dossier est encore dans l'état où l'agent l'a laissé —
   * le découpage du travail hors tâche, juste après, remet la branche de départ
   * en arrière et effacerait la trace.
   */
  /*
   * QUATRE réponses possibles, pas deux : le dépôt a bougé, il n'a pas bougé, il
   * n'a pas pu être consulté, ou il a bougé AILLEURS que dans la copie de la
   * carte. Le troisième cas rendait `true` — une carte passait donc en
   * « Terminé » sur une observation qu'on n'avait pas pu faire ; il vaut
   * « inconnue ». Le quatrième était compté comme « rien n'a changé », alors que
   * l'agent avait bel et bien travaillé, dans le dossier partagé du projet.
   */
  const trace: TraceDuTravail = failed
    ? 'non'
    : await traceDuTravailDuTour({ dossier, repere, projet: project.path, remuesAvant }).catch(
        () => 'inconnue' as const,
      );

  /*
   * LE DOSSIER DE LA CARTE SE REFERME ICI, une fois le constat pris : la branche
   * rejoint la principale et la copie de travail est retirée. Sans cela, le
   * travail resterait sur une branche poussée — jamais livrée —, et le dossier
   * laissé ouvert empêcherait la carte de repartir. Un refus (travail non
   * enregistré, conflit) est DIT dans le journal, jamais tu.
   */
  if (agent.role === 'task' && agent.cardId && dossier !== project.path) {
    const carte = store.getCard(agent.cardId);
    if (carte) {
      try {
        await refermerDossierDeCarte(project.path, dossier, nomDeBranche(carte.title, carte.id));
      } catch (err) {
        log.error('fermeture du dossier de la carte impossible', err);
      }
    }
  }

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
       * OÙ VA LA CARTE — la règle entière vit dans `carteApresFinDeTour`
       * (`deplacement-carte.ts`), qui rend la carte telle qu'elle doit être
       * enregistrée : clôture si le dépôt a bougé, retour en file avec la RAISON
       * écrite si rien n'a changé, rangement si le travail était déjà livré.
       * Rien ne reste en « En cours » sans agent au travail.
       */
      const updated = store.saveCard({
        ...carteApresFinDeTour(card, {
          agentId: agent.id,
          role: agent.role,
          reussi: !failed,
          trace,
          moteurMuet,
          /*
           * TOUS LES ESSAIS ONT ÉCHOUÉ SUR UNE PANNE DU FOURNISSEUR. Le message
           * affiché promet en toutes lettres que le travail « repartira où il
           * s'était arrêté dès que le fournisseur répondra de nouveau »
           * (`messageDePanneDefinitive`) : c'est ce drapeau qui tient la
           * promesse, en renvoyant la carte en « Planifié » avec sa date de
           * reprise (`colonneApresPanneDuMoteur`). Sans lui, la carte restait
           * figée en « En cours », l'agent en « stopped » — donc hors d'atteinte
           * même du balayage des cartes oubliées — et il fallait la reprendre à
           * la main.
           */
          panneDuMoteur: !!panneDefinitive,
        }),
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
      await onComplete(finalText, !failed, measurement);
    } catch (err) {
      log.error('post-traitement du tour impossible', err);
    }
  }

  /*
   * LA DÉCISION EST POSÉE ICI, une fois la carte et la consommation à jour :
   * elle allume le triangle orange et prévient, exactement comme une question.
   * Un tour repris ne prévient donc JAMAIS d'un échec — ce n'en est pas un.
   */
  if (reprise) {
    poserDecisionDeReprise({
      messageId: runState.messageId,
      agent: finalAgent,
      reprise,
    });
  }

  if (failed && !reprise) {
    notify({
      motif: 'tache-echec',
      // Une panne du fournisseur ne se dit pas « en échec » : la tâche a été
      // interrompue, et l'alerte nomme la cause au lieu de l'imputer à l'agent.
      title: panneDefinitive ? 'Tâche interrompue par une panne du moteur' : 'Tâche en échec',
      body: panneDefinitive ? `${agent.title} — ${causeEnClair(panneDefinitive)}` : agent.title,
      // Un tour raté par agent : deux tentatives sur la même carte se disent
      // toutes les deux, mais un seul échec ne se dit jamais deux fois.
      reference: agent.id,
      element: agent.title,
      cardId: agent.cardId,
      projectId: agent.projectId,
    });
  }

  /*
   * LA QUESTION QUE PERSONNE N'A ENTENDUE. Un tour qui s'achève sur une
   * question écrite en texte n'a rien enregistré : le triangle orange s'allume
   * bien (`decisionsEnAttente` reconnaît le cas), mais rien ne sort de
   * l'application, alors qu'une question posée par l'outil, elle, prévient
   * aussitôt. On répare l'asymétrie ici : même motif, même guichet unique.
   *
   * Le dédoublonnage de `notify` fait le reste — sujet « decision » et numéro
   * de carte : si l'agent avait AUSSI appelé l'outil dans ce tour, la seconde
   * alerte se tait d'elle-même. Rien pour un tour en échec (sa panne est déjà
   * dite) ni pour un agent sans carte (le fil du chef est sous les yeux de qui
   * l'a écrit).
   */
  if (!failed && agent.cardId) {
    const dernier = store.getMessage(runState.messageId);
    const question = dernier
      ? decisionEnTexteLibre({ statut: 'done', dernierMessage: dernier })
      : null;
    if (question) {
      notify({
        motif: 'decision-attendue',
        title: 'Une réponse est attendue',
        body: question.slice(0, 120),
        // La CARTE, pas le tour : deux tours de la même carte qui reposent la
        // même question ne font qu'une alerte tant qu'elle n'a pas de réponse.
        reference: agent.cardId,
        element: question.slice(0, 120),
        cardId: agent.cardId,
        projectId: agent.projectId,
        agentId: agent.id,
      });
      bus.emit({ type: 'attention', ...store.signalAttention() });
    }
  }

  /*
   * CE QUE LE RANGEMENT A COÛTÉ, écrit une fois pour toutes sur la réponse.
   * Entre la réponse figée et cette ligne, le démon a comprimé le fil, constaté
   * le dépôt, refermé le dossier de la carte et fusionné sa branche — du
   * travail invisible, qui explique pourquoi l'agent tenait encore son tour
   * alors que sa réponse était là depuis un moment.
   */
  noterLeRangement(runState);

  retirerLeTourVivant(agent.id);
  bus.emit({ type: 'capacity', capacity: (await import('./capacity.js')).snapshot() });

  // Dès que l'agent se tait, il regarde sa file et enchaîne tout seul.
  enchainerLaFile(agent.id);
}

interface OptionsCompression {
  adapter: ReturnType<typeof adapterFor>;
  dossier: string;
  sessionId: string | null;
  systemPrompt: string;
  mcpConfigPath: string;
  mcpBridgePath: string;
  fullAccess: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  env: Record<string, string>;
  cleSession: string;
}

/**
 * La liste de tâches à reprendre : celle du DERNIER tour qui en portait une.
 * Un tour coupé n'en a pas toujours écrit — le moteur peut être tombé avant —,
 * on remonte donc le fil jusqu'à la dernière liste connue plutôt que de rendre
 * un vide qui ferait croire à un travail sans étapes.
 */
function tachesReprises(agentId: string): TodoItem[] {
  const dernier = [...store.listMessages(agentId)].reverse().find((message) => message.todos.length);
  if (!dernier) return [];
  return tachesAPoursuivre(dernier.todos).map((todo) => TodoItem.parse(todo));
}

/**
 * LE RÉSUMÉ NE REMONTE PAS AVANT LE DERNIER DÉPART. « Repartir de zéro » range
 * l'ancien fil derrière un lien (`messagesDepuis`, [[nouveau-depart]]) : le
 * renvoyer ici en résumé annulerait le geste. On borne donc le résumé aux
 * messages VISIBLES, et l'on peut en écarter un — la demande du tour en cours,
 * qui part déjà en clair juste à côté.
 */
function resumePourAgent(
  agent: Agent,
  motif: MotifDeContinuite = 'compression',
  sauf?: string | null,
): string {
  const project = store.getProject(agent.projectId)!;
  const card = agent.cardId ? store.getCard(agent.cardId) : null;
  const messages = messagesDepuis(store.listMessages(agent.id), store.nouveauDepart(agent.id)).filter(
    (message) => message.id !== sauf,
  );
  const dernierAvecTaches = [...messages].reverse().find((message) => message.todos.length);
  const decisions = messages.flatMap((message) => [
    ...message.questions.map((question) =>
      question.answer
        ? `${question.question} → ${question.answer}`
        : `${question.question} → réponse encore attendue`,
    ),
    ...message.proposals.map((proposal) => `${proposal.title} → ${proposal.decision}`),
  ]);
  const attachments = [...new Set(messages.flatMap((message) => [
    ...message.attachments,
    ...message.questions.flatMap((question) => question.answerAttachments),
  ]))]
    .map((id) => store.getAttachment(id))
    .filter(Boolean)
    .map((attachment) => path.join(PATHS.attachments, `${attachment!.id}-${attachment!.name}`));

  return resumeContinuite({
    project: project.name,
    workdir: agent.workdir ?? project.path,
    role: agent.role,
    title: agent.title,
    card: card ? { title: card.title, description: card.description, column: card.column } : undefined,
    exchanges: messages.map((message) => ({ role: message.role, content: message.content })),
    decisions,
    todos: dernierAvecTaches?.todos.map((todo) => `${todo.state} : ${todo.label}`),
    attachments,
    memoire: memoireDeReprise(project.path, agent, card),
    motif,
  });
}

/**
 * LA MÉMOIRE QU'UNE REPRISE RECHARGE : les fichiers de sujet que touche le
 * travail en cours, jamais toute la mémoire. Le texte examiné est le même pour
 * TOUS les rôles — carte, titre de l'agent, rôle réunis : le chef d'orchestre et
 * l'agent de tâche passent par la même règle, seul leur travail diffère.
 */
function memoireDeReprise(projectPath: string, agent: Agent, card: Card | null): MemoireDeReprise | undefined {
  const texte = [
    card?.title,
    card?.description,
    agent.title,
    agent.role === 'orchestrator' ? "chef d'orchestre : cartes, projets, conversation" : agent.role,
  ]
    .filter(Boolean)
    .join('\n');

  const retenus = sujetsUtiles(texte);
  const sujets = retenus
    .map((id) => ({ id, libelle: libelleSujet(id), faits: faitsDuSujet(projectPath, id) }))
    .filter((sujet) => sujet.faits.length);
  if (!sujets.length) return undefined;

  const autres = SUJETS_MEMOIRE.filter(
    (sujet) => !retenus.includes(sujet.id) && faitsDuSujet(projectPath, sujet.id).length,
  ).map((sujet) => sujet.libelle);

  return { sujets, autres };
}

async function compresserContexte(agent: Agent, options: OptionsCompression): Promise<void> {
  if (!agent.context?.pending) return;

  if (options.adapter.compact && options.sessionId) {
    const native = await options.adapter.compact({
      cwd: options.dossier,
      prompt: '/compact',
      model: agent.run.model,
      thinking: agent.run.thinking,
      sessionId: options.sessionId,
      systemPrompt: options.systemPrompt,
      mcpConfigPath: options.mcpConfigPath,
      mcpBridgePath: options.mcpBridgePath,
      fullAccess: options.fullAccess,
      allowedTools: options.allowedTools,
      disallowedTools: options.disallowedTools,
      env: options.env,
      // Un appel de SERVICE, passé après la réponse : il ne retient jamais la
      // barre d'écriture plus que son plafond.
      plafondMs: PLAFOND_APPEL_APRES_REPONSE_MS,
      // …et il se fait suivre, pour que le bouton d'arrêt puisse le couper.
      surLancement: suivreLeService(agent.id),
      onEvent: () => {},
    });
    if (native.ok && native.context) {
      const frais = store.getAgent(agent.id) ?? agent;
      const context = contexteApresCompression(frais.context!, {
        at: Date.now(),
        method: 'native',
        tokens: native.context.tokens,
        window: native.context.window,
      });
      const maj = store.saveAgent({
        ...frais,
        context,
        contextUsage: mesurerContexte(context.tokens, context.window),
      });
      bus.emit({ type: 'agent.upsert', agent: maj });
      return;
    }
    log.warn(`compression native impossible pour l'agent ${agent.id} : ${native.error ?? 'raison inconnue'}`);
  }

  // Repli commun : aucun message visible n'est touché. Seul le fil du moteur
  // courant est remplacé, avec un résumé borné qui repart au prochain tour.
  // Le socle déterministe garantit les champs indispensables ; le moteur
  // ajoute la compréhension des décisions formulées librement dans un fil long.
  const socle = resumePourAgent(agent);
  const semantique = options.sessionId
    ? await resumeSemantique(agent, options)
    : '';
  const summary = semantique
    ? `${socle}\n\nSYNTHÈSE SÉMANTIQUE DU FIL\n${semantique.slice(0, 8_000)}`
    : socle;
  store.clearSession(agent.id, options.cleSession);
  const frais = store.getAgent(agent.id) ?? agent;
  const context = contexteApresCompression(frais.context!, {
    at: Date.now(),
    method: 'summary',
    tokens: 0,
    summary,
  });
  const maj = store.saveAgent({ ...frais, context, contextUsage: undefined });
  bus.emit({ type: 'agent.upsert', agent: maj });
}

/**
 * LA RELANCE QUI EXIGE LE PLAN ENTIER.
 *
 * Un second passage dans la MÊME session : le chef a donc encore sous les yeux
 * la demande et sa propre réponse, il ne relit rien et ne coûte qu'un tour
 * court. Aucun outil ne lui est laissé — on ne veut qu'un texte, et une
 * question posée ici (`ask_user`) bloquerait le tour déjà fini.
 */
async function rendreLePlanEntier(options: {
  adapter: EngineAdapter;
  cwd: string;
  projectRoot?: string;
  agent: Agent;
  sessionId?: string | null;
  mcpBridgePath?: string;
  fullAccess: boolean;
  env?: Record<string, string>;
  consigne: string;
}): Promise<string> {
  let texte = '';
  let erreur = false;
  const handle = options.adapter.run({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    prompt: options.consigne,
    model: options.agent.run.model ?? undefined,
    thinking: options.agent.run.thinking,
    sessionId: options.sessionId,
    fullAccess: options.fullAccess,
    role: options.agent.role,
    mcpBridgePath: options.mcpBridgePath,
    disallowedTools: OUTILS_FERMES_POUR_LA_RELANCE,
    env: options.env,
    // Une relance de forme ne vaut pas qu'on retienne l'agent : au plafond, on
    // garde le texte d'origine plutôt que d'attendre un moteur muet.
    plafondMs: PLAFOND_APPEL_APRES_REPONSE_MS,
    surLancement: suivreLeService(options.agent.id),
    onEvent: (event) => {
      if (event.kind === 'text' && event.text) texte += `${texte ? '\n\n' : ''}${event.text}`;
      if (event.kind === 'error') erreur = true;
    },
  });
  const resultat = await handle.finished;
  return resultat.ok && !erreur ? texte.trim() : '';
}

/**
 * LA RELANCE QUI EXIGE L'APPEL DE L'OUTIL.
 *
 * Même principe que `rendreLePlanEntier` — un second passage dans la MÊME
 * session, borné —, à une différence près : ici les outils RESTENT OUVERTS,
 * puisque c'est justement l'appel qui manque. La configuration du pont est
 * celle du tour (même identifiant de tour), donc la proposition qui naît se
 * rattache au message déjà affiché.
 */
async function exigerLappelDeLoutil(options: {
  adapter: EngineAdapter;
  cwd: string;
  projectRoot?: string;
  agent: Agent;
  sessionId?: string | null;
  mcpConfigPath: string;
  mcpBridgePath?: string;
  fullAccess: boolean;
  env?: Record<string, string>;
  allowedTools?: string[];
  disallowedTools?: string[];
  consigne: string;
}): Promise<string> {
  /*
   * LE TEXTE DE LA RELANCE EST GARDÉ, il ne se jette plus. Un modèle qui
   * recommence à ÉCRIRE sa carte au lieu de l'appeler vient de nous la donner
   * en toutes lettres : c'est exactement ce qu'il faut au filet du démon
   * (`carteDecriteEnTexte`) pour appeler l'outil à sa place.
   */
  let texte = '';
  const handle = options.adapter.run({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    prompt: options.consigne,
    model: options.agent.run.model ?? undefined,
    thinking: options.agent.run.thinking,
    sessionId: options.sessionId,
    fullAccess: options.fullAccess,
    role: options.agent.role,
    mcpConfigPath: options.mcpConfigPath,
    mcpBridgePath: options.mcpBridgePath,
    allowedTools: options.allowedTools,
    disallowedTools: options.disallowedTools,
    env: options.env,
    // Un rattrapage ne retient pas l'agent : au plafond, on garde la réponse
    // d'origine et son avertissement.
    plafondMs: PLAFOND_APPEL_APRES_REPONSE_MS,
    surLancement: suivreLeService(options.agent.id),
    onEvent: (event) => {
      if (event.kind === 'text' && event.text) texte += `${texte ? '\n\n' : ''}${event.text}`;
    },
  });
  await handle.finished;
  return texte.trim();
}

/**
 * LE FILET : LE DÉMON APPELLE L'OUTIL À LA PLACE DU MODÈLE.
 *
 * On ne peut pas obliger un moteur à appeler un outil ; on peut faire le geste
 * pour lui. Quand la réponse DÉCRIT une carte (`carteDecriteEnTexte`), le démon
 * passe par le MÊME outil que l'agent — `board_create_card`, avec ses règles :
 * la description est jugée, le niveau traduit en réglages, la proposition
 * s'attache au message du tour. Rien n'est écrit sur le tableau pour autant :
 * une proposition attend toujours le clic de l'utilisateur.
 *
 * On rend `false` quand l'outil refuse (une description trop maigre reste
 * refusée, d'où qu'elle vienne) : la suite du rattrapage prend alors le relais.
 */
async function poserLaCarteRelue(agent: Agent, projectId: string, relue: CarteRelue): Promise<boolean> {
  try {
    const resultat = await callTool(
      {
        agentId: agent.id,
        projectId,
        role: agent.role,
        cardId: agent.cardId,
        run: { engine: agent.run.engine, model: agent.run.model, thinking: agent.run.thinking },
        mode: agent.run.mode,
      },
      'board_create_card',
      { title: relue.titre, description: relue.description, niveau: relue.niveau ?? NIVEAU_PAR_DEFAUT },
    );
    if (!resultat.proposal) {
      log.warn(`carte relue refusée par l'outil pour l'agent ${agent.id} : ${resultat.text.slice(0, 200)}`);
      return false;
    }
    // L'attachement range lui-même la proposition dans sa table, avant
    // d'allumer le signal : rien à enregistrer ici.
    attachToCurrentMessage(agent.id, { proposal: resultat.proposal });
    return true;
  } catch (error) {
    log.warn(`carte relue non posée pour l'agent ${agent.id} : ${(error as Error).message}`);
    return false;
  }
}

/** Tout ce que la relance n'a pas à toucher : elle ne rend qu'un texte. */
const OUTILS_FERMES_POUR_LA_RELANCE = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'WebSearch',
  'WebFetch',
  'Task',
  'Agent',
  'Workflow',
  ...toolsFor('orchestrator').map((outil) => `mcp__haikodev__${outil.name}`),
];

async function resumeSemantique(agent: Agent, options: OptionsCompression): Promise<string> {
  let texte = '';
  let erreur = false;
  const outilsInterdits = [
    'Bash',
    'Read',
    'Write',
    'Edit',
    'WebSearch',
    'WebFetch',
    'Task',
    'Agent',
    'Workflow',
    ...toolsFor(agent.role).map((outil) => `mcp__haikodev__${outil.name}`),
  ];
  const handle = options.adapter.run({
    cwd: options.dossier,
    prompt:
      'COMPRESSION INTERNE — sans outil et sans question. Résume ce fil pour ton prochain démarrage en 1 200 mots maximum. ' +
      "Conserve l'objectif actif, les décisions même formulées librement, ce qui est terminé, ce qui reste à faire, " +
      'les noms exacts utiles et les pièges à éviter. Réponds uniquement par le résumé.',
    model: agent.run.model,
    thinking: agent.run.thinking,
    sessionId: options.sessionId,
    fullAccess: false,
    mcpBridgePath: options.mcpBridgePath,
    disallowedTools: outilsInterdits,
    env: options.env,
    // Repli de compression : lui aussi passe après la réponse, lui aussi borné.
    plafondMs: PLAFOND_APPEL_APRES_REPONSE_MS,
    surLancement: suivreLeService(agent.id),
    onEvent: (event) => {
      if (event.kind === 'text' && event.text) texte += `${texte ? '\n\n' : ''}${event.text}`;
      if (event.kind === 'error') erreur = true;
    },
  });
  const resultat = await handle.finished;
  return resultat.ok && !erreur ? texte.trim() : '';
}

/**
 * LE RANGEMENT D'APRÈS-RÉPONSE SE MESURE, IL NE SE DEVINE PAS.
 *
 * `pushMessage` refuse d'écrire sur un tour déjà refermé : cette note-ci part
 * donc directement au magasin, à l'instant où le tour se termine pour de bon.
 * Rien n'est écrit si la réponse n'a jamais été figée (tour tombé avant), ni si
 * le rangement a été instantané — une durée nulle n'apprend rien.
 */
function noterLeRangement(run: LiveRun): void {
  if (!run.reponseFigeeA) return;
  const rangementMs = Date.now() - run.reponseFigeeA;
  if (rangementMs < 1_000) return;
  const message = store.getMessage(run.messageId);
  if (!message || message.rangementMs !== undefined) return;
  const maj = store.saveMessage({ ...message, rangementMs });
  bus.emit({ type: 'message.upsert', message: maj });
}

function pushMessage(run: LiveRun, patch: Partial<Message>): void {
  const current = store.getMessage(run.messageId);
  if (!current) return;
  /*
   * UN TOUR REFERMÉ NE SE RALLUME PLUS. Le corps du tour continue de se dérouler
   * après une fermeture d'autorité (`refermerLeTour` arrête le moteur, fige le
   * message et retire le tour des tours vivants) : la dernière bribe de texte
   * arrivée ensuite reposait `streaming: true` DERRIÈRE la fermeture, et plus
   * rien ne venait l'éteindre — le témoin « réflexion en cours » tournait alors
   * dans le vide sur un agent en échec. Le contenu déjà écrit, lui, se garde :
   * seule la marque d'écriture est refusée.
   */
  const refermé = live.get(run.agentId) !== run;
  const applique = refermé ? { ...patch, streaming: false } : patch;
  const updated = store.saveMessage({ ...current, ...applique } as Message);
  bus.emit({ type: 'message.upsert', message: updated });
}

/**
 * LES CHEMINS DE SECOURS REFERMENT LA LISTE, EUX AUSSI. La fin normale d'un
 * tour passe par `cloturerLesTaches` ; mais un tour peut aussi se refermer
 * d'autorité, s'éteindre en écriture orpheline ou disparaître avec le démon.
 * Chacun de ces chemins fige un message : il doit figer sa liste avec lui,
 * sinon la ligne « en cours » survit à tout — c'est justement le cas qu'on
 * répare. Refermer une liste déjà refermée ne change rien.
 *
 * Une réponse RÉDIGÉE vaut un tour rendu (même lecture que
 * `statutDeFermetureForcee`) : sa dernière ligne se coche. Un message muet,
 * lui, a été coupé : ses lignes ouvertes disent « non faite ».
 */
function tachesRefermees(message: Message): TodoItem[] {
  return cloturerLesTaches(message.todos, {
    issue: message.content.trim().length > 0 ? 'reussi' : 'interrompu',
    maintenant: Date.now(),
  });
}

/**
 * LE DÉCOMPTE DE L'AGENT SUIT LA LISTE, JUSQU'À LA CLÔTURE COMPRISE.
 *
 * Les étapes vivent sur les messages ; le décroché du tableau, lui, lit le
 * résumé posé sur l'agent (`agent.todos`). Il n'était rafraîchi qu'à l'arrivée
 * d'une liste du moteur : la clôture du tour cochait donc la dernière ligne
 * dans la conversation sans jamais toucher ce résumé, et la carte gardait
 * « 4/5 faites » pour toujours. On repasse ici à CHAQUE mise à jour comme à
 * chaque fermeture, en relisant l'agent frais pour ne pas écraser un statut
 * posé ailleurs. Rendu vrai quand le décompte a réellement changé.
 */
function poserLaProgression(agentId: string, todos: readonly TodoItem[]): boolean {
  if (!todos.length) return false;
  const progression = progressionDesTaches(todos);
  const etape = todos.find((todo) => todo.state === 'running')?.label;
  const frais = store.getAgent(agentId);
  if (!frais) return false;
  const avant = frais.todos;
  if (
    avant?.done === progression.done &&
    avant?.total === progression.total &&
    (avant?.unfinished ?? 0) === progression.unfinished &&
    frais.etapeEnCours === etape
  ) {
    return false;
  }
  const maj = store.saveAgent({ ...frais, todos: progression, etapeEnCours: etape });
  bus.emit({ type: 'agent.upsert', agent: maj });
  return true;
}

/**
 * REPLI SUR LES ÉTAPES D'EXÉCUTION : un agent qui ne s'annonce jamais de
 * liste de tâches (`todos`) mais avance par étapes internes (`steps`, visibles
 * repliées dans la conversation) n'a alors aucun libellé posé par
 * `poserLaProgression` — le tableau resterait muet. Même geste, même bus,
 * source différente ; appelé UNIQUEMENT quand aucune todo n'est active.
 */
function poserLetapeDesSteps(agentId: string, steps: readonly RunStep[]): void {
  const etape = [...steps].reverse().find((step) => step.state === 'running')?.label;
  const frais = store.getAgent(agentId);
  if (!frais || frais.todos?.total || frais.etapeEnCours === etape) return;
  const maj = store.saveAgent({ ...frais, etapeEnCours: etape });
  bus.emit({ type: 'agent.upsert', agent: maj });
}

/**
 * UN TOUR QUI SE REFERME ÉTEINT SON ÉTAPE. `poserLaProgression` l'efface déjà
 * quand des todos existent (plus aucune ne reste `running` après clôture) ;
 * ce filet couvre le cas d'un agent qui n'a annoncé que des `steps`, jamais de
 * todos — sans lui, le tableau garderait à vie le libellé du dernier tour.
 */
function effacerEtapeEnCours(agentId: string): void {
  const frais = store.getAgent(agentId);
  if (!frais || frais.etapeEnCours === undefined) return;
  const maj = store.saveAgent({ ...frais, etapeEnCours: undefined });
  bus.emit({ type: 'agent.upsert', agent: maj });
}

/**
 * ÉTEINDRE UNE ÉCRITURE ORPHELINE : un message resté marqué « en cours
 * d'écriture » alors que son agent est au repos depuis. La règle du jugement
 * vit dans `shared` (`ecritureOrpheline`) ; ici on ne fait que constater et
 * diffuser. Rendu vrai quand une marque a réellement été éteinte.
 */
function eteindreEcritureOrpheline(
  agent: Agent,
  options: { suivi: boolean; force?: boolean } = { suivi: false },
): boolean {
  if (options.suivi) return false;
  const messages = store.listMessages(agent.id, 5);
  const enEcriture = messages.find((message) => message.streaming);
  if (!enEcriture) return false;
  if (
    !options.force &&
    !ecritureOrpheline({
      statut: agent.status,
      finDuTour: agent.endedAt,
      messageEnEcritureA: enEcriture.createdAt,
    })
  ) {
    return false;
  }
  const fige = store.saveMessage({ ...enEcriture, streaming: false, todos: tachesRefermees(enEcriture) });
  bus.emit({ type: 'message.upsert', message: fige });
  poserLaProgression(agent.id, fige.todos);
  effacerEtapeEnCours(agent.id);
  log.warn(`écriture orpheline éteinte (agent ${agent.id}, message ${enEcriture.id})`);
  return true;
}

/**
 * Ajoute une proposition ou un téléchargement au message en cours d'écriture.
 * Rend l'identifiant du message touché : c'est LUI que la table des
 * propositions doit désigner, jamais un « dernier message » relu à part — les
 * deux pouvaient déjà se contredire quand une demande en file arrivait pendant
 * le tour.
 */
export function attachToCurrentMessage(
  agentId: string,
  patch: {
    proposal?: TaskProposal;
    question?: Message['questions'][number];
    download?: Message['downloads'][number];
    /** L'identifiant d'une pièce jointe que l'agent vient de produire (ex. capture d'écran). */
    attachment?: string;
  },
): string | undefined {
  const run = live.get(agentId);
  const messageId = run?.messageId ?? store.listMessages(agentId, 1).slice(-1)[0]?.id;
  if (!messageId) return undefined;
  const current = store.getMessage(messageId);
  if (!current) return undefined;
  const updated = store.saveMessage({
    ...current,
    proposals: patch.proposal ? [...current.proposals, patch.proposal] : current.proposals,
    questions: patch.question ? [...current.questions, patch.question] : current.questions,
    downloads: patch.download ? [...current.downloads, patch.download] : current.downloads,
    attachments:
      patch.attachment && !current.attachments.includes(patch.attachment)
        ? [...current.attachments, patch.attachment]
        : current.attachments,
  });
  bus.emit({ type: 'message.upsert', message: updated });
  /*
   * LA PROPOSITION EST RANGÉE AVANT QUE LE SIGNAL PARTE.
   *
   * Le compte des décisions attendues se lit dans la TABLE des propositions,
   * pas sur le message. Chaque appelant enregistrait donc la sienne APRÈS ce
   * tour de fonction : le signal partait sur une table qui ne la contenait pas
   * encore, le panneau « Carte à valider » s'affichait, et la ligne du projet
   * restait éteinte jusqu'au prochain événement — souvent un rechargement de
   * page. L'écriture vit ici, dans le même geste que l'attachement.
   */
  if (patch.proposal) {
    const projectId = store.getAgent(agentId)?.projectId;
    if (projectId) store.saveProposal(messageId, projectId, patch.proposal);
  }
  // Une carte présentée à valider attend une décision au même titre qu'une
  // question : elle allume donc le même signal dans la liste des projets.
  if (patch.question || patch.proposal) {
    bus.emit({ type: 'attention', ...store.signalAttention() });
  }
  if (patch.proposal) {
    notify({
      motif: 'decision-attendue',
      title: 'Une carte attend votre validation',
      body: patch.proposal.title.slice(0, 120),
      reference: `${agentId}:proposition:${patch.proposal.title}`,
      element: patch.proposal.title.slice(0, 120),
      projectId: store.getAgent(agentId)?.projectId,
      cardId: store.getAgent(agentId)?.cardId,
      agentId,
    });
  }
  if (patch.question) {
    notify({
      motif: 'decision-attendue',
      title: 'Une réponse est attendue',
      body: patch.question.question.slice(0, 120),
      reference: `${agentId}:question:${patch.question.question}`,
      element: patch.question.question.slice(0, 120),
      projectId: store.getAgent(agentId)?.projectId,
      cardId: store.getAgent(agentId)?.cardId,
      agentId,
    });
  }
  return messageId;
}

/**
 * Une proposition naît pendant le tour, avant que l'usage réel soit connu.
 * À la fin du tour du chef, on complète son chiffrage dans les DEUX sources
 * persistantes (message et table des propositions). Si l'utilisateur a déjà
 * cliqué, la carte reçoit aussi cette mesure tardive sans relancer d'analyse.
 */
function finaliserPropositionsDuChef(
  messageId: string,
  projectId: string,
  measurement: TurnMeasurement,
): void {
  const current = store.getMessage(messageId);
  if (!current?.proposals.length) return;

  let change = false;
  const proposals = current.proposals.map((proposal) => {
    const finalisee = finaliserAnalyseDeProposition(proposal, measurement);
    if (finalisee === proposal) return proposal;
    change = true;
    store.saveProposal(messageId, projectId, finalisee);

    if (finalisee.cardId) {
      const card = store.getCard(finalisee.cardId);
      if (card) {
        const updated = store.saveCard({
          ...card,
          estimate: finalisee.estimate,
          analysisContext: finalisee.analysisContext,
        });
        bus.emit({ type: 'card.upsert', card: updated });
      }
    }
    return finalisee;
  });

  if (!change) return;
  const updated = store.saveMessage({ ...current, proposals });
  bus.emit({ type: 'message.upsert', message: updated });
}

/**
 * ARRÊTER UN AGENT — ET QUE LE CLIC AIT TOUJOURS UN EFFET.
 *
 * Le geste ne savait faire qu'une chose : retrouver le tour vivant et couper
 * son moteur. Sans tour vivant il rendait « faux » et n'allait pas plus loin :
 * l'agent restait marqué « au travail », son compteur continuait de courir
 * (parfois depuis des milliers d'heures, quand une préparation s'était coincée
 * bien avant), et rien — ni arrêt, ni message — ne répondait au clic.
 *
 * La décision vit dans `shared` (`decisionDArret`). Ici on l'applique : couper
 * le moteur quand il y en a un, refermer d'autorité sinon. Le tour de
 * préparation est retiré des tours qui « démarrent » : sans cela, un agent
 * pendu dans cette fenêtre restait considéré comme suivi, donc la veille ne le
 * refermait jamais et il retenait même les redémarrages.
 *
 * TROIS TROUS ONT ÉTÉ BOUCHÉS ICI, tous du même genre — le clic partait, et
 * quelque chose continuait pourtant de tourner.
 *
 * 1. UN TOUR VIVANT SANS MOTEUR. On constate désormais le processus AVANT de
 *    décider (`processusVivant`) : un tour dont le moteur est déjà mort, ou
 *    dont la réponse est figée depuis longtemps, ne se « coupe » plus dans le
 *    vide — il se referme.
 * 2. LES MOTEURS DE SERVICE. Compression du fil, relance d'un plan : de vrais
 *    processus, que `run.handle` ne désigne pas. Ils tombent avec le reste.
 * 3. LE SIGNAL SANS RÉPONSE. Couper, c'est demander poliment : un moteur pendu
 *    dans un appel réseau peut ne jamais rendre la main, et l'agent restait « au
 *    travail » malgré le clic. On revient donc constater quelques secondes plus
 *    tard, et on referme d'autorité si le même tour est toujours là.
 */
export function arreterLAgent(agentId: string): DecisionDArret {
  const agent = store.getAgent(agentId);
  const run = live.get(agentId);
  const decision = decisionDArret({
    statut: agent?.status ?? 'idle',
    tourVivant: !!run,
    enPreparation: demarrant.has(agentId),
    moteurVivant: run ? moteurRepondEncore(run) : undefined,
    reponseFigee: !!run?.reponseFigeeA,
    moteursDeService: moteursDeService.get(agentId)?.size ?? 0,
  });

  // Les moteurs de service tombent dans TOUS les cas : ils ne dépendent pas du
  // tour, et un agent qu'on arrête n'a plus rien à faire tourner nulle part.
  couperLesServices(agentId);

  if (decision.geste === 'coupe' && run) {
    run.stopping = true;
    run.handle.stop();
    acheverLArretSiBesoin(agentId, run);
    return decision;
  }

  if (decision.geste === 'secours') {
    demarrant.delete(agentId);
    libererLesAttentes(agentId);
    const referme = refermerLeTour(agentId, RAISON_ARRET_DE_SECOURS);
    /*
     * `refermerLeTour` range le tour selon ce qui a été rendu : sans réponse,
     * il marque « en échec ». Or rien n'a échoué ici — c'est un arrêt DEMANDÉ,
     * et il se dit « arrêté ». Seule une réponse déjà rendue (« terminé »)
     * garde son statut. Rien n'a été refermé (un agent au repos dont on ne
     * coupait qu'un moteur de service) : son statut ne bouge pas non plus.
     */
    const frais = referme ? store.getAgent(agentId) : undefined;
    if (frais && frais.status !== 'done') {
      setStatus(frais, 'stopped', { endedAt: frais.endedAt ?? Date.now() });
    }
    void import('./demon.js').then((demon) => demon.appliquerRedemarrageEnAttente());
  }

  return decision;
}

/**
 * Le moteur de ce tour répond-il encore ? `undefined` quand on ne peut pas le
 * savoir — aucun numéro de processus connu, un moteur qui n'a pas encore
 * démarré : on ne conclut alors rien, et la règle suppose qu'il vit.
 */
function moteurRepondEncore(run: LiveRun): boolean | undefined {
  const pid = run.handle.pid;
  if (!pid) return undefined;
  return processusVivant(pid);
}

/**
 * REVENIR CONSTATER APRÈS LE SIGNAL.
 *
 * Couper un moteur, c'est lui envoyer un signal — donc lui demander de partir,
 * pas l'y obliger. Le cas ordinaire est instantané : le processus quitte, le
 * tour se referme par son chemin normal, et on ne trouve plus rien ici. Mais un
 * moteur peut rester pendu (appel réseau sans fin, sortie tenue ouverte par un
 * petit-fils), et c'est exactement le « rien ne se passe » reproché.
 *
 * On ne referme QUE si le tour visé est toujours le tour vivant de cet agent :
 * un tour suivant, parti depuis, ne nous appartient pas.
 */
function acheverLArretSiBesoin(agentId: string, run: LiveRun): void {
  const minuteur = setTimeout(() => {
    if (!arretAAchever({ memeTourEncoreVivant: live.get(agentId) === run })) return;
    demarrant.delete(agentId);
    libererLesAttentes(agentId);
    const referme = refermerLeTour(agentId, RAISON_ARRET_SANS_REPONSE);
    if (!referme) return;
    const frais = store.getAgent(agentId);
    if (frais && frais.status !== 'done') {
      setStatus(frais, 'stopped', { endedAt: frais.endedAt ?? Date.now() });
    }
    // Le premier message disait « son moteur a été coupé » : il a fallu faire
    // plus, et cela se dit — sinon le clic reste, pour l'utilisateur, un geste
    // dont il ne sait pas s'il a mordu.
    direLeBlocage(agentId, RAISON_ARRET_SANS_REPONSE);
    bus.toast('warning', MESSAGE_ARRET_ACHEVE, frais?.cardId);
    void import('./demon.js').then((demon) => demon.appliquerRedemarrageEnAttente());
  }, DELAI_CONFIRMATION_ARRET_MS);
  minuteur.unref?.();
}

/**
 * L'ancien nom, gardé pour les appels qui ne veulent qu'un oui/non : l'arrêt
 * a-t-il touché un agent qui travaillait ?
 */
export function stopAgent(agentId: string): boolean {
  return arreterLAgent(agentId).travaillait;
}

/**
 * TOUT CE QUI TOURNE ENCORE, quelle que soit la façon dont ça tourne.
 *
 * On ne se fiait qu'au STATUT enregistré (« running », « starting »), donc à ce
 * que la base croit savoir. C'est précisément ce qui est faux quand rien
 * n'avance : un tour vivant sur un agent que la base dit au repos, une
 * préparation coincée avant même que le statut ne soit posé, un moteur de
 * SERVICE (compression du fil, relance d'un plan) qui n'apparaît nulle part.
 * Ces trois-là survivaient au bouton « tout arrêter » — et retenaient ensuite le
 * redémarrage sans que personne ne comprenne pourquoi.
 *
 * On part donc de l'UNION de quatre sources : le statut, les tours vivants, les
 * préparations en route, les moteurs de service.
 */
function agentsQuiTournentEncore(): string[] {
  const identifiants = new Set<string>();
  for (const agent of store.listAgents()) {
    if (agent.status === 'running' || agent.status === 'starting') identifiants.add(agent.id);
  }
  for (const agentId of live.keys()) identifiants.add(agentId);
  for (const agentId of demarrant.keys()) identifiants.add(agentId);
  for (const [agentId, ouverts] of moteursDeService) {
    if (ouverts.size) identifiants.add(agentId);
  }
  return [...identifiants];
}

/**
 * ARRÊTER TOUS LES AGENTS, SUR TOUS LES PROJETS — ET RENDRE LE GESTE FAIT SUR
 * CHACUN.
 *
 * Même geste EN FORCE que le bouton d'un agent seul, appliqué un par un :
 * moteur coupé puis achevé s'il fait la sourde oreille, descendance emportée,
 * tour refermé d'autorité quand il n'y a plus de moteur à couper. Ce qui change
 * ici, c'est le compte rendu : chaque agent rapporte SON geste, et l'écran peut
 * enfin dire ce qui s'est passé au lieu d'un nombre sans contenu.
 */
export function stopAllAgents(): Array<{
  agentId: string;
  cardId?: string;
  geste: DecisionDArret['geste'];
  message: string;
}> {
  const arretes: Array<{
    agentId: string;
    cardId?: string;
    geste: DecisionDArret['geste'];
    message: string;
  }> = [];

  for (const agentId of agentsQuiTournentEncore()) {
    const decision = arreterLAgent(agentId);
    arretes.push({
      agentId,
      cardId: store.getAgent(agentId)?.cardId,
      geste: decision.geste,
      message: decision.message,
    });
  }

  return arretes;
}

/**
 * ACHEVER TOUT CE QUI TOURNE, TOUT DE SUITE — le geste du redémarrage FORCÉ.
 *
 * `stopAllAgents` demande d'abord et n'achève qu'au bout du délai de grâce : très
 * bien tant que le serveur reste là pour tenir sa promesse. Au redémarrage
 * forcé, il quitte avant — le minuteur meurt avec lui et le moteur récalcitrant
 * survit, orphelin, à tourner sur la machine (constaté par
 * `scripts/verif-arret-en-force.mjs`). On repasse donc derrière, sans rien
 * demander : chaque moteur encore inscrit est achevé par son NUMÉRO EXACT, sa
 * descendance avec lui — jamais un motif de nom, jamais un groupe de processus,
 * qui emporteraient le démon.
 */
export function acheverTousLesMoteurs(): number {
  let acheves = 0;
  for (const [agentId, run] of live) {
    acheves += acheverLArbre(run.handle.pid, `tour de ${agentId}`);
  }
  for (const [agentId, ouverts] of moteursDeService) {
    for (const handle of ouverts) acheves += acheverLArbre(handle.pid, `service de ${agentId}`);
  }
  return acheves;
}

/* ------------------------------------------------------------------ */
/* Fermeture forcée et veille des tours bloqués                        */
/* ------------------------------------------------------------------ */

/** Ce numéro de processus répond-il encore ? Le signal 0 ne tue rien, il constate. */
function processusVivant(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // « EPERM » : le processus existe, il appartient à quelqu'un d'autre.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * REFERMER UN TOUR D'AUTORITÉ. Le geste de dernier recours : le moteur est
 * arrêté s'il traîne encore, le message resté en écriture est figé, l'agent
 * revient au repos et la barre d'écriture se libère. Une réponse déjà rendue
 * n'est PAS un échec — la fermeture a mal tourné, pas le travail.
 *
 * Sans effet sur un agent déjà refermé : c'est ce qui permet de l'appeler à la
 * fin de CHAQUE tour, en filet, sans rien casser du chemin normal.
 */
export function refermerLeTour(agentId: string, raison: string): boolean {
  const agent = store.getAgent(agentId);
  if (!agent) return false;
  const run = live.get(agentId);
  const enCours = agent.status === 'running' || agent.status === 'starting';
  if (!run && !enCours) {
    // Rien à refermer — mais si une marque de tour vivant traînait encore, elle
    // ferait tourner le témoin dans le vide : on l'éteint au passage.
    if (agent.tourVivantDepuis !== undefined) retirerLeTourVivant(agentId);
    return false;
  }

  if (run) {
    try {
      run.handle.stop();
    } catch {
      /* le processus est déjà parti */
    }
  }

  const dernier = run
    ? store.getMessage(run.messageId)
    : [...store.listMessages(agentId, 5)].reverse().find((message) => message.role === 'assistant');
  const reponseRendue = !!dernier && dernier.content.trim().length > 0;
  if (dernier?.streaming) {
    const fige = store.saveMessage({
      ...dernier,
      streaming: false,
      todos: tachesRefermees(dernier),
      // Une réponse écrite se garde telle quelle : y coller un bandeau rouge
      // ferait passer un travail livré pour une panne. C'est le silence qui se
      // dit, jamais le texte rendu.
      error: reponseRendue ? dernier.error : (dernier.error ?? raison),
    });
    bus.emit({ type: 'message.upsert', message: fige });
    poserLaProgression(agentId, fige.todos);
    effacerEtapeEnCours(agentId);
  }

  retirerLeTourVivant(agentId);
  // Un tour refermé d'autorité peut être arrêté sur une question : son attente
  // tombe avec lui, sinon le drapeau « attend une réponse » resterait gravé sur
  // un agent que plus personne ne fait travailler.
  libererLesAttentes(agentId);
  const frais = store.getAgent(agentId) ?? agent;
  /*
   * UN STATUT DÉJÀ DÉCIDÉ NE SE RÉÉCRIT PAS. La fermeture d'autorité peut
   * désormais tomber APRÈS que le chemin normal a rendu la réponse et remis
   * l'agent au repos — c'est même son nouveau terrain : le rangement
   * d'après-réponse resté pendu. Repasser par `statutDeFermetureForcee`
   * transformerait alors un tour « interrompu » par une panne du fournisseur en
   * tour « terminé », donc en travail rendu. On ne libère que ce qui reste à
   * libérer.
   */
  if (frais.status === 'running' || frais.status === 'starting') {
    setStatus(frais, statutDeFermetureForcee({ reponseRendue }), { endedAt: Date.now() });
  }
  log.warn(`tour refermé d'autorité (agent ${agentId}) : ${raison}`);

  void import('./capacity.js').then((capacity) =>
    bus.emit({ type: 'capacity', capacity: capacity.snapshot() }),
  );
  bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });

  // La file reprend son cours : un message écrit pendant le blocage part enfin.
  enchainerLaFile(agentId);
  return true;
}

/**
 * LA VEILLE : plus aucun agent ne peut rester « au travail » indéfiniment.
 *
 * Passée à chaque tour de l'ordonnanceur (toutes les quinze secondes), elle
 * relit les agents marqués au travail et referme ceux que plus rien n'attend —
 * le jugement lui-même vit dans `shared` (`tourBloque`). Elle ne juge JAMAIS la
 * durée d'un tour en cours : un agent qui réfléchit une heure travaille.
 *
 * Elle éteint AUSSI, au passage, les écritures orphelines : un agent au repos
 * dont un message porte encore la marque « en cours d'écriture ». C'est ce qui
 * fait disparaître le témoin « réflexion en cours » tout seul, sans recharger la
 * page — le message corrigé part sur le canal comme n'importe quel autre.
 */
export function veilleDesToursBloques(maintenant = Date.now()): number {
  let refermes = 0;
  for (const agent of store.listAgents()) {
    const run = live.get(agent.id);
    const preparation = demarrant.get(agent.id);
    const suivi = !!run || !!preparation;
    /*
     * LE STATUT N'EST PLUS LE SEUL PORTIER (§ 6 de `shared/src/fin-de-tour.ts`).
     * Le démon remet l'agent au repos dès la réponse rendue, puis CONTINUE son
     * rangement : constat du dépôt, fusion de la branche, fermeture de la copie
     * de travail. Une commande git pendue dans cette fenêtre laissait le tour
     * vivant pour toujours — barre « L'agent termine son tour… » allumée sous
     * une réponse pourtant complète — sans qu'aucun filet ne puisse le voir,
     * puisque l'agent n'était plus « au travail ». Un tour que le démon SUIT
     * ENCORE est donc jugé, quel que soit le statut inscrit.
     */
    if (agent.status !== 'running' && agent.status !== 'starting') {
      eteindreEcritureOrpheline(agent, { suivi });
      /*
       * ET LA MARQUE DE TOUR VIVANT NE SURVIT PAS À SON TOUR. Un agent au repos
       * que le démon ne suit plus n'a plus rien à allumer : la marque oubliée
       * ferait tourner le témoin dans le vide jusqu'au prochain redémarrage.
       */
      if (!suivi) {
        if (agent.tourVivantDepuis !== undefined) retirerLeTourVivant(agent.id);
        continue;
      }
    }
    const pid = run?.handle.pid;
    const verdict = tourBloque({
      statut: agent.status,
      suivi: !!run || !!preparation,
      // En préparation tant qu'aucun moteur ne tourne : c'est le démon qui
      // travaille, et c'est cette fenêtre-là qui n'avait aucun plafond.
      enPreparation: !run && !!preparation,
      processusVivant: pid ? processusVivant(pid) : undefined,
      reponseFigeeDepuisMs: run?.reponseFigeeA ? maintenant - run.reponseFigeeA : undefined,
      partiDepuisMs: maintenant - (run?.startedAt ?? preparation?.depuis ?? agent.startedAt ?? agent.updatedAt),
      silenceDepuisMs: run ? maintenant - run.dernierSigneDeVie : undefined,
      attendUneReponse: agentEnAttente(agent.id),
    });
    if (!verdict) continue;
    /*
     * LA PRÉPARATION EST ABANDONNÉE POUR DE BON. Sans cet oubli, elle resterait
     * inscrite ici : la veille la reverrait « suivie » à chaque passage, et
     * surtout, en revenant un jour de son sommeil, elle se croirait encore
     * légitime et poserait son moteur sur un agent déjà reparti.
     */
    demarrant.delete(agent.id);
    if (!refermerLeTour(agent.id, verdict.raison)) continue;
    refermes += 1;
    /*
     * ET LA DEMANDE NE RESTE PAS SANS RÉPONSE À L'ÉCRAN. Un tour refermé APRÈS
     * le moteur a un message en cours d'écriture, qui reçoit la raison. Un tour
     * bloqué AVANT lui n'a rien écrit du tout : sans ce mot, l'utilisateur
     * verrait sa demande partir dans le vide, exactement comme avant.
     */
    direLeBlocage(agent.id, verdict.raison);
  }
  return refermes;
}

/**
 * DIRE À L'ÉCRAN POURQUOI RIEN N'EST VENU.
 *
 * Un tour refermé d'autorité laisse sa raison sur le message qu'il écrivait.
 * Mais un tour bloqué AVANT le moteur n'a écrit aucun message : la demande de
 * l'utilisateur restait alors seule au fil, sans un mot, et le silence était
 * exactement ce dont il se plaignait. On pose donc la raison en clair.
 *
 * On n'écrit rien quand le dernier message dit déjà quelque chose : la fermeture
 * a pu figer une réponse ou poser son bandeau, et deux explications valent moins
 * qu'une.
 */
function direLeBlocage(agentId: string, raison: string): void {
  try {
    const dernier = [...store.listMessages(agentId, 1)].pop();
    if (dernier?.role === 'assistant' && (dernier.error || dernier.content.trim())) return;
    const message = store.saveMessage(
      Message.parse({
        id: store.newId(),
        agentId,
        role: 'assistant',
        content: raison,
        error: raison,
        createdAt: store.now(),
      }),
    );
    bus.emit({ type: 'message.upsert', message });
  } catch (err) {
    log.warn(`blocage non annoncé (agent ${agentId}) : ${(err as Error).message}`);
  }
}

/**
 * DIRE QUELQUE CHOSE DANS LA CONVERSATION D'UN AGENT — sans que ce soit une
 * panne.
 *
 * `direLeBlocage` pose un message d'ERREUR, et se tait quand une réponse est
 * déjà là. Ce n'est pas ce qu'il faut pour annoncer un travail SAUVÉ : ce n'est
 * pas un incident, et cela doit se dire même après une réponse rendue — c'est
 * justement la dernière chose écrite dans un fil qu'on vient de couper.
 */
export function annoncerDansLaConversation(agentId: string, texte: string): void {
  try {
    const message = store.saveMessage(
      Message.parse({
        id: store.newId(),
        agentId,
        role: 'assistant',
        content: texte,
        createdAt: store.now(),
      }),
    );
    bus.emit({ type: 'message.upsert', message });
  } catch (err) {
    log.warn(`annonce non écrite (agent ${agentId}) : ${(err as Error).message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Consignes de rôle                                                   */
/* ------------------------------------------------------------------ */

/**
 * L'outil de liste de tâches propre à chaque moteur. Le PROCESSUS (annoncer
 * avant d'agir, une seule ligne en cours, cocher au fur et à mesure) est décidé
 * par HaikoDev et identique partout ; seul le nom de l'outil qui l'exécute
 * dépend du moteur. Claude Code parle « TaskCreate / TaskUpdate », Codex parle
 * « update_plan ». On nomme à chaque moteur SON outil, jamais celui de l'autre.
 */
const OUTIL_LISTE: Record<EngineId, string> = {
  claude:
    "l'outil « TaskCreate » puis « TaskUpdate » (une tâche par appel, mise à jour par son numéro)",
  codex: "l'outil « update_plan » du moteur",
  // Cursor n'expose aucun outil de liste par son API : l'agent annonce donc son
  // déroulé dans sa réponse, en clair, plutôt qu'un outil qu'il n'a pas.
  cursor: 'une liste écrite en tête de ta réponse, une ligne par action prévue',
};

/**
 * LA MÉTHODE DE TRAVAIL, décidée par HaikoDev et identique pour tous les moteurs.
 * Sans elle, chaque modèle choisissait seul ce qu'il allait lire et comment il
 * allait raisonner : à demande égale, Codex et Claude ne regardaient pas les
 * mêmes fichiers et ne ressortaient pas les mêmes constats. Le texte ne nomme
 * donc AUCUN outil propre à un moteur — seuls les outils du projet, communs aux
 * deux, y figurent.
 */
/**
 * LE SILENCE SUR LES IDENTIFIANTS STOCKÉS, écrit UNE FOIS et servi à tous les
 * rôles — chef d'orchestre compris, dont la consigne ne porte plus la MÉTHODE
 * entière. Deux copies auraient divergé à la première réécriture.
 */
const SILENCE_IDENTIFIANTS = `SILENCE SUR LES IDENTIFIANTS STOCKÉS : les mots de passe, clés, jetons et fichiers d'identifiants gardés dans le projet sont un choix ASSUMÉ par l'utilisateur. Tu ne le signales pas, ne le commentes pas et ne recommandes rien à ce sujet — ni dans ta réponse, ni dans une carte proposée, ni dans une alerte, même en passant. Tu peux les lire et t'en servir comme n'importe quel fichier. Une PANNE se dit toujours : un identifiant absent, expiré ou refusé qui bloque ton travail s'annonce en toutes lettres.`;

const METHODE = `MÉTHODE DE TRAVAIL IMPOSÉE (elle vient de HaikoDev, pas de toi : applique-la telle quelle, dans cet ordre) :
1. LIRE AVANT DE RÉPONDRE : le fichier d'instructions du moteur cité dans le briefing, puis l'outil « project_memory » pour le SUJET de ta tâche — le bloc de mémoire ci-dessus en donne la LISTE, tu ne devines donc aucun nom ; un sujet rend d'un coup ses FAITS, ses RÈGLES et ses CONTRÔLES, sans le reste. Puis les fichiers réellement concernés — repérés par une recherche dans le projet, jamais devinés de mémoire.
   LES PASSAGES DE MÉMOIRE REÇUS SONT UN EXTRAIT, PAS LA MÉMOIRE : quelques morceaux choisis par une machine sur le texte de ta demande, sous plafond. Ils te disent OÙ regarder, jamais si tu as tout vu. Un travail bâti sur eux seuls passe à côté de la règle qui n'a pas été remontée : demande le sujet, ouvre le fichier cité.
2. CONSTATER PAR ÉCRIT avant de conclure : ce que le projet fait aujourd'hui, ce que la demande veut, ce qui manque entre les deux. C'est ce qui remplit la section « Analyse » de ta réponse.
3. NE RIEN INVENTER : un fichier, une commande ou un comportement ne se cite qu'après l'avoir vu. Ce que tu n'as pas vérifié se dit comme une hypothèse, en toutes lettres.
4. VÉRIFIER À LA FIN : rejoue les contrôles du projet qui touchent à ce que tu as changé, et donne leur résultat, même en échec. Un échec tu, c'est un travail rendu faux.
5. ${SILENCE_IDENTIFIANTS}
6. UNE QUESTION SE POSE AVEC L'OUTIL « ask_user », JAMAIS EN TEXTE SIMPLE : dès qu'un choix ne t'appartient pas — une option à retenir, une préférence, une information qui te manque —, tu appelles « ask_user » et tu attends la réponse. L'ATTENTE SE FAIT TOUTE SEULE : cet outil ne te rend la main qu'une fois l'utilisateur ayant répondu, et sa réponse arrive comme résultat de l'appel — tu n'as donc AUCUNE étape suivante à commencer en attendant, et tu reprends ton travail à partir de cette réponse. Une question écrite à la fin de ta réponse ne réveille personne : ton tour se termine, l'utilisateur ne voit aucune alerte, et la carte reste bloquée sans que personne ne sache qu'elle t'attend. Tu ne finis donc JAMAIS un tour sur une question posée en texte. Ce qui peut être tranché par ce que tu as lu se tranche : tu annonces ton choix en une ligne et tu continues.`;

/** Le rappel envoyé aux tours SUIVANTS, quand le moteur ne recolle pas ses consignes tout seul. */
export function rappelDeMethode(engine: EngineId = 'claude'): string {
  const outilListe = OUTIL_LISTE[engine] ?? OUTIL_LISTE.claude;
  return (
    'RAPPEL DE MÉTHODE (donné au début du fil, toujours valable) : ' +
    `annonce ta liste de tâches avec ${outilListe} et coche-la au fur et à mesure ; ` +
    'lis avant de répondre (instructions du moteur, « project_memory », fichiers concernés) ; ' +
    "n'affirme rien que tu n'aies vérifié ; rejoue les contrôles du projet et dis leur résultat ; " +
    'ne signale ni ne commente JAMAIS le stockage de mots de passe, clés ou identifiants dans le projet ' +
    "(une panne d'identifiant qui te bloque, elle, se dit) ; " +
    "et une question se pose avec l'outil « ask_user », jamais en texte simple à la fin d'un tour."
  );
}

/**
 * LA CONSIGNE D'UN DÉPANNAGE DE PUBLICATION, à la place du déroulé complet.
 *
 * Un agent appelé pour un conflit de fusion, un contrôle tombé ou une
 * construction cassée reçoit une demande qui NOMME déjà les fichiers, les
 * contrôles ou la cause, et qui liste les gestes dans l'ordre. La méthode
 * générale, elle, lui dirait d'annoncer une liste de tâches, de lire le fichier
 * d'instructions du projet et d'interroger la mémoire par sujet : trois détours
 * payants pour une panne de plomberie, et deux d'entre eux renvoient à un
 * briefing qu'il n'a plus. Ne restent donc que les interdits qui valent partout.
 */
const CONSIGNE_DEPANNAGE = `Tu travailles dans HaikoDev. Réponds en français simple, très court.

TU ES UN AGENT DE DÉPANNAGE appelé PENDANT une publication déjà en cours. Une seule chose bloque, elle t'est nommée dans la demande : tu la répares, tu t'arrêtes. Tu n'ouvres pas le projet en grand, tu ne cherches pas de travail à côté, tu n'annonces pas de liste de tâches.
Fais EXACTEMENT les gestes demandés, dans l'ordre donné, et rien d'autre. Ce qui n'est pas dans la demande n'est pas de ton ressort.
NE PUBLIE RIEN et NE REDÉMARRE RIEN : la publication reprend toute seule dès que ton tour est fini.
NE RIEN INVENTER : un fichier, une commande ou un comportement ne se cite qu'après l'avoir vu. Si tu n'arrives pas à réparer, dis-le en une phrase avec ce qui bloque encore — un échec tu, c'est une publication qui repart sur du faux.
SILENCE SUR LES IDENTIFIANTS STOCKÉS : les mots de passe, clés, jetons et fichiers d'identifiants gardés dans le projet sont un choix ASSUMÉ par l'utilisateur. Tu ne le signales pas, ne le commentes pas et ne recommandes rien à ce sujet. Une PANNE se dit toujours : un identifiant absent, expiré ou refusé qui bloque ton travail s'annonce en toutes lettres.`;

/**
 * L'OUVERTURE DE LA CONSIGNE DU CHEF D'ORCHESTRE.
 *
 * Le chef ne fait plus que deux gestes : rédiger une carte courte, et choisir le
 * NIVEAU de l'agent qui l'exécutera. Il n'ouvre plus le projet, ne chiffre plus,
 * ne prépare plus de relais — l'étude appartient à la carte, après validation.
 *
 * Le déroulé visible (liste de tâches) et la MÉTHODE de travail en six points ne
 * lui servent donc plus : ils disent de lire le fichier d'instructions, de
 * demander la mémoire par sujet, de constater par écrit et de rejouer les
 * contrôles du projet — quatre détours payés à chaque conversation neuve, pour
 * un tri. Ne restent que les trois règles qui valent quoi qu'il fasse : le
 * silence sur les identifiants, la question posée par l'outil, et l'adresse
 * demandée avant de monter un projet.
 */
/**
 * CE QUE LE CHEF ÉCRIT, annoncé au modèle.
 *
 * Sa frontière ne tient plus à un DOSSIER mais à la NATURE du fichier
 * (`cheminDuDocumentDuChef`, `shared/src/documents-du-chef.ts`) : les DOCUMENTS
 * partout, le CODE jamais. Cette consigne évite au chef de buter sur un refus,
 * et lui dit pourquoi le dossier des plans reste le rangement par défaut — ce
 * qu'il y écrit revient tout seul au lancement de la carte, par la recherche de
 * passages. Un document gardé dans la seule conversation, lui, meurt avec elle.
 */
export const CONSIGNE_DOCUMENTS_DU_CHEF = `TES DOCUMENTS S'ÉCRIVENT AVEC L'OUTIL « write_document », ET IL ÉCRIT PARTOUT DANS LE PROJET : documentation, mémoire, fichier d'instructions, compte-rendu, plan — tout ce qui est du TEXTE (${EXTENSIONS_DOCUMENT.join(', ')}) se crée, se remplace et se SUPPRIME (\`action: "supprimer"\`) sans carte et sans permission à demander. C'est ton seul geste d'écriture, et le seul qui survive à la conversation.
LE CODE RESTE FERMÉ, et lui seul : un fichier de programme, de configuration ou de script se crée, se modifie et s'efface par une CARTE confiée à un agent de tâche. L'outil refuse de toute façon toute autre extension que celles ci-dessus.
POUR MODIFIER un document existant, relis-le d'abord (« Read »), puis réécris-le ENTIER sous le MÊME chemin — « write_document » remplace le fichier, il n'ajoute pas à la fin.
UN NOM SANS DOSSIER EST RANGÉ DANS « ${DOSSIER_PLANS}/ » : c'est là que vivent tes plans, et CE DOSSIER EST RELU PAR LA RECHERCHE — au lancement d'une carte sur le même sujet, ton plan remonte tout seul dans le contexte de l'agent qui l'exécute. Pour écrire ailleurs, donne le chemin entier (« docs/memoire/cartes.md », « README.md »).`;

/**
 * LA COLONNE DE GAUCHE, ANNONCÉE AU CHEF.
 *
 * Ranger un projet dans un groupe, le renommer, le mettre de côté : ce ne sont
 * PAS des demandes de programmation, donc pas des cartes — mais le chef n'avait
 * aucun moyen de les faire, monté en lecture seule sur le projet. Les outils
 * `project_manage` et `group_manage` (`server/src/tools.ts`, règles pures dans
 * `shared/src/gestion-projets.ts`) les lui donnent ; cette consigne lui dit
 * qu'ils existent, et rappelle les deux interdits que les outils opposent de
 * toute façon — la suppression d'un projet, et un montage sans adresse.
 */
export const CONSIGNE_GESTION_PROJETS = `LA COLONNE DE GAUCHE EST À TOI : « project_manage » (lister, creer, renommer, deplacer, retirer, remettre) et « group_manage » (lister, creer, renommer, regler) rangent les projets et leurs groupes. Ranger, renommer ou grouper n'est pas de la programmation : tu le fais TOI-MÊME, aussitôt, sans carte — la colonne se redessine sous les yeux de l'utilisateur.
COMMENCE PAR « lister » : les projets et les groupes se désignent par leur NOM, et tu ne devines jamais un identifiant.
DEUX REFUS À CONNAÎTRE, opposés par l'outil : un projet ne se SUPPRIME pas (« retirer » le met de côté, rien n'est perdu), et un projet neuf ne se monte pas sans son adresse — sous-domaine et port se demandent d'abord avec « ask_user ».`;

const COMMUN_DU_CHEF = `Tu travailles dans HaikoDev. Réponds en français simple, pour un lecteur non technique. Tu ne publies JAMAIS de ta propre initiative : la mise en ligne est un geste de l'utilisateur.

TU ES LE CHEF D'ORCHESTRE du projet, et tu ne fais QUE DEUX CHOSES : tu réponds aux questions, et tu proposes des cartes courtes en disant à quel NIVEAU les exécuter. Tu n'ouvres pas le projet pour étudier une demande, tu ne chiffres rien, tu ne prépares aucun relais : tout cela appartient à la carte une fois validée, et le refaire ici serait le payer deux fois.
NE RIEN INVENTER : ce que tu n'as pas vu ne se cite pas. Si une réponse suppose de lire le projet, tu lis d'abord — mais une CARTE, elle, s'écrit sans rien lire.
${SILENCE_IDENTIFIANTS}
UNE QUESTION SE POSE AVEC L'OUTIL « ask_user », JAMAIS EN TEXTE SIMPLE : une question écrite à la fin de ta réponse ne réveille personne. Ce qui peut être tranché se tranche : tu annonces ton choix en une ligne et tu continues.

${CONSIGNE_DOCUMENTS_DU_CHEF}

${CONSIGNE_GESTION_PROJETS}

${CONSIGNE_CREATION_PROJET}`;

/**
 * LE TRI, cœur du métier du chef — inchangé. Il vit à part pour être mesuré et
 * vérifié pour lui-même : c'est ce texte qui décide si une demande devient une
 * carte ou du code écrit à la volée.
 */
export const TRI_DU_CHEF = `TON PREMIER GESTE SUR CHAQUE MESSAGE EST UN TRI, PAS UNE CRÉATION DE CARTE :
1. Question ou demande d'information (y compris « fais-moi la doc de X ») → tu RÉPONDS DANS LA CONVERSATION, aucune carte. Lire n'est pas agir ; produire un document fait partie de la réponse.
2. TOUTE DEMANDE DE PROGRAMMATION → tu PROPOSES UNE carte avec board_create_card, et tu t'arrêtes là. Rien n'est créé sur le tableau : la carte s'affiche dans la conversation avec ses boutons valider / refuser, et elle n'entre dans « Planifié » qu'après le clic de l'utilisateur — ensuite seulement, le parcours habituel s'enchaîne. Tu ne fais jamais le travail toi-même. C'est ainsi que l'utilisateur voit l'avancement du début à la fin, sur le tableau.
   PROGRAMMATION VEUT DIRE : nouvelle fonctionnalité, correction d'une fonctionnalité existante, suppression, changement de comportement, retouche d'interface, remaniement, script, réglage du moteur. AUCUNE EXCEPTION, quelle que soit la taille : une ligne à changer mérite sa carte autant qu'un chantier.
   ATTENDS-TOI À CE QUE LE MOT « TÂCHE » NE SOIT JAMAIS DIT. « Il faudrait que… », « ajoute… », « corrige… », « ce serait bien si… », « pourquoi ça ne marche pas ? » suivi d'un défaut réel, une fonctionnalité décrite au passage : c'est une demande de programmation, tu proposes la carte.
   REGROUPE AVANT DE COMPTER : plusieurs demandes qui servent le MÊME résultat, concernent le MÊME chantier ou doivent être réalisées dans un ordre logique forment UNE SEULE carte. Sa description énumère alors les étapes successives. Ne crée plusieurs cartes que pour des objectifs réellement indépendants, qui peuvent être menés et validés séparément sans perdre leur sens.
3. TOUTE DEMANDE D'EXÉCUTION SUR LA MACHINE → même traitement qu'une demande de programmation : tu PROPOSES AUSSITÔT UNE carte avec board_create_card. Lancer une commande, tester une connexion (SSH, base de données, adresse), ouvrir un terminal, faire tourner un contrôle ou un script, redémarrer un service, regarder un journal en direct : tout cela s'exécute, donc tout cela devient une carte. La description dit CE QU'IL FAUT LANCER et CE QU'ON ATTEND COMME RÉSULTAT.
   Tu ne demandes AUCUNE confirmation avant de proposer, et tu n'écris PAS un paragraphe sur tes propres limites : une phrase suffit pour dire qu'un agent de tâche exécutera la commande, puis la carte parle d'elle-même. Une limite expliquée sans carte proposée est une demande perdue.
4. Cas ambigu → TU NE TRANCHES PAS SEUL, TU PROPOSES LES DEUX CHEMINS.
   Quand tu hésites sur la NATURE de la demande — la faire tout de suite toi-même, ou en faire une carte —, tu poses la question avec « ask_user » et tu ATTENDS la réponse : deux options nommées, une ligne chacune. « Je le fais maintenant, dans la conversation » (une réponse, un document écrit avec write_document, un rangement du tableau ou de la colonne de gauche : c'est fait à la seconde, mais rien n'en reste sur le tableau) ou « J'en fais une carte » (un agent de tâche l'exécute, l'avancement se suit d'un bout à l'autre, et le travail est enregistré). Tu dis ce que chacun implique, sans conseiller à demi-mot, et tu fais ENSUITE ce qui a été choisi.
   Quand le doute ne porte QUE sur l'opportunité — c'est bien de la programmation, mais tu ne sais pas si l'utilisateur le veut vraiment maintenant —, tu réponds d'abord puis tu appelles propose_task : le clic tranche, sans question à poser.
   Ce cas ne s'applique JAMAIS à une demande claire : programmer ou exécuter, c'est une carte (cas 2 et 3), sans question et sans confirmation.
   Dans les deux cas, c'est le clic de l'utilisateur qui fait naître la carte : aucune carte ne part de ta seule initiative.
5. Gestion du tableau (« renomme », « déplace », « liste ») → appel d'outil direct.

LE SUJET D'UN MESSAGE EST SOUVENT PLUS HAUT DANS LA CONVERSATION. « Fais-en une carte », « corrige ça », « vas-y », « comme on vient d'en parler », « celui-là aussi » ne disent PAS de quoi il s'agit. AVANT d'écrire quoi que ce soit, tu REMONTES LE FIL : tu retrouves ce dont il était question juste avant, et c'est CE sujet-là que tu traites — jamais la dernière carte proposée par défaut, jamais un sujet voisin.
TA CARTE SE LIT SANS TA CONVERSATION : l'agent qui l'exécutera reçoit un titre et une description, rien d'autre. Le sujet retrouvé s'y écrit donc EN TOUTES LETTRES, avec ce qui comptait pour l'utilisateur dans l'échange (l'écran, le comportement, la contrainte qu'il a dite). « Corriger ce qui a été discuté » ou « voir la conversation » ne désignent rien pour qui n'était pas là : l'outil refuse ces cartes et te les rend à réécrire.
SI LE FIL NE SUFFIT PAS à retrouver le sujet, demande-le avec « ask_user » — jamais une carte au hasard. Ce n'est pas une confirmation (celles-là, tu ne les demandes jamais) : c'est l'information qui te manque pour écrire la carte.

UNE CARTE N'EXISTE QUE PAR L'APPEL DE L'OUTIL : écrire « j'ai créé la tâche » sans appeler board_create_card n'affiche RIEN, et l'utilisateur attend une carte qui ne viendra jamais. Le démon le vérifie à chaque tour et te relance pour l'appel manquant.
NE RECOPIE JAMAIS EN TEXTE une carte que tu viens de proposer : elle s'affiche déjà, entière, dans la conversation. Une phrase courte suffit.`;

/**
 * LE TRI EN MODE PLAN — remplace les cas 2, 3 et 4 de `TRI_DU_CHEF` tant que le
 * bouton « Plan » du composeur est activé (`RunConfig.mode`). Le but n'est plus
 * de proposer une carte mais de rendre un PLAN COMPLET, lisible par un lecteur
 * non technique, qui reste dans la conversation jusqu'à sa validation.
 *
 * Le plan s'AFFINE par itérations : chaque réponse — relance, ajustement, refus
 * — rend de nouveau les quatre parties EN ENTIER, enrichies des versions
 * précédentes, de sorte qu'un seul texte soit à lire (celui du bas). Côté
 * interface, seul ce dernier plan porte ses boutons ; les précédents se replient
 * en lecture seule (`indexDuPlanCourant`, `shared/src/plan-conversation.ts`).
 *
 * `board_create_card` et `propose_task` sont déjà refusés au niveau de l'outil
 * (`tools.ts`, PLAN §2 principe 3) : cette consigne évite au modèle de buter
 * dessus en silence, et lui dit quoi faire à la place.
 */
export const TRI_MODE_PLAN = `TU ES EN MODE PLAN (bouton « Plan » activé) : pour toute demande de programmation ou d'exécution (cas 2 et 3 ci-dessus), tu NE PROPOSES AUCUNE carte — board_create_card et propose_task sont refusés par l'outil. Le tableau reste intact.
À LA PLACE, tu réponds DANS LA CONVERSATION avec un plan complet, en quatre parties, chacune sous son titre :
— FAISABILITÉ : la VRAIE ANALYSE, et la partie la plus fournie du plan. Quatre morceaux, chacun ouvert par un titre court en gras : ce que le projet fait AUJOURD'HUI (constaté, pas supposé), ce que la demande veut de plus, l'ÉCART entre les deux, puis les points durs, les décisions déjà tranchées et ce dont tu n'es pas sûr. Une affirmation sans constat ne vaut rien : dis « je suppose » quand tu supposes.
— CHEMIN À SUIVRE : les étapes NUMÉROTÉES (trois au moins), chacune ouverte par un titre court en gras, puis une ou deux phrases disant ce qu'elle touche et ce qu'elle produit. L'ordre est un ordre : ce qui doit passer avant passe avant.
— CONSÉQUENCES : ce que ça change concrètement dans le produit, ce que ça casse, ce qui ne bouge pas.
— AMÉLIORATIONS APPORTÉES : une LISTE À PUCES (« - »), trois lignes au moins, d'idées à AJOUTER au plan — chacune formulée comme une demande actionnable, en une seule ligne. Ce ne sont pas les bénéfices de ce que tu viens d'écrire : ce sont les prochains pas que l'utilisateur pourra retenir d'un clic pour enrichir la version suivante.
FOUILLÉ, JAMAIS ILLISIBLE. Un plan hiérarchisé se parcourt des yeux : des titres en gras, des paragraphes de deux ou trois phrases, des listes. Jamais un pavé, jamais un fleuve — la profondeur est dans ce qui est CONSTATÉ, pas dans le nombre de mots.
POUR ÉCRIRE CE PLAN, TU OUVRES LE PROJET : tu lis les fichiers concernés et tu interroges la mémoire du projet sur le sujet touché. Un plan bâti de mémoire se voit tout de suite — il ne cite rien de réel.
CHAQUE RÉPONSE EN MODE PLAN EST UN PLAN COMPLET, JAMAIS UN COMMENTAIRE NI UN MORCEAU. Même pour une retouche minuscule, même après un refus, tu réécris les QUATRE PARTIES en entier : l'utilisateur n'a alors qu'un seul texte à lire, à jour, sans rien à recoller de tête.
SI UN PLAN A DÉJÀ ÉTÉ ÉCRIT PLUS HAUT DANS CETTE CONVERSATION, LE NOUVEAU LE REPREND ET L'ENRICHIT : ce qui tenait debout est conservé, la nouvelle demande s'y intègre, ce qui a été écarté ne revient pas. Ne rédige jamais un second plan indépendant à côté du premier, ni une simple liste des changements : un seul plan vit dans la conversation, le DERNIER, et il porte à lui seul tout ce qui a été dit avant.
TOUT NOUVEAU MESSAGE DE L'UTILISATEUR REFUSE LE PLAN PRÉCÉDENT : il ne s'ajoute pas à côté, il le REMPLACE. Tu reprends donc le dernier plan, tu l'adaptes à ce qui vient d'être dit, et tu rends la VERSION SUIVANTE en entier — c'est elle, et elle seule, qui portera les boutons.
UNE QUESTION DE L'UTILISATEUR SE RÉPOND DANS LE PLAN, PAS À CÔTÉ. « Que proposes-tu pour tel point ? », « quelles options ? », « qu'en penses-tu ? » : la réponse ne s'écrit pas en texte libre — elle s'INTÈGRE aux quatre parties et tu rends la version suivante ENTIÈRE. Une liste de pistes suivie de « dites-moi laquelle intégrer au plan » n'est PAS un plan : c'est le plan que l'utilisateur perd, et le bouton « Valider » porterait sur un fragment. Si un choix doit lui revenir, tu poses la question APRÈS les quatre parties, en une ligne, et le plan reste lisible du début à la fin sans elle.
LE DÉMON VÉRIFIE, DEUX FOIS. Un texte qui n'annonce pas ses quatre parties sous leurs titres est REFUSÉ : tu es relancé pour le rendre en entier, et s'il manque encore quelque chose ta réponse s'affiche sans cadre ni bouton de décision. Écris donc les quatre titres, toujours, même pour une retouche d'une ligne. Le FOND est vérifié ensuite : une analyse d'une phrase, un chemin sans étapes numérotées, un plan sans aucun titre en gras ou des améliorations qui ne sont pas une liste te font relancer une fois de plus — un tour de perdu, à chaque itération, pour un plan qu'il fallait fouiller du premier coup.
UN REFUS (« je refuse ce plan », « réfléchis à une autre approche », « ce n'est pas ça ») N'EST PAS UNE FIN : tu rends AUSSITÔT un nouveau plan complet, aux mêmes quatre parties, qui prend un chemin DIFFÉRENT — et tu dis en une phrase, dans FAISABILITÉ, ce que tu abandonnes du plan précédent et pourquoi. Jamais un refus répondu par une question seule, une excuse ou un paragraphe sans plan.
TU AS TOUS TES OUTILS EN MODE PLAN, écriture comprise : « write_document » et « ask_user » marchent ici comme ailleurs. Ne dis JAMAIS que le mode plan t'empêche d'écrire un fichier ou de poser une question — ce serait faux.
UNE DÉCISION QUI NE T'APPARTIENT PAS SE DEMANDE AVANT LE PLAN, avec l'outil « ask_user », et tu ATTENDS la réponse : deux options possibles, une préférence, une information qui te manque. Tu ne tranches JAMAIS « par défaut faute de pouvoir poser la question », et tu n'écris pas la question dans le texte du plan — personne n'y répondrait. Ce qui se tranche avec ce que tu as lu se tranche : tu l'annonces en une ligne et tu continues.
ENREGISTRE CHAQUE PLAN dans « ${DOSSIER_PLANS}/ » avec « write_document », en plus de l'écrire dans la conversation : un nom de fichier par SUJET (« refonte-accueil.md »), les mêmes quatre parties, et un titre en tête. Un ajustement RÉÉCRIT LE MÊME FICHIER, jamais un second. C'est ce fichier qui remontera tout seul au lancement de la carte, quand l'utilisateur validera.
CE PLAN N'EST PAS UNE CARTE : le tableau n'en sait rien tant que l'utilisateur ne l'a pas dit. Le plan le plus récent s'affiche avec deux boutons au bas de son cadre, « Valider » et « Refuser », qui envoient un message ordinaire dans la conversation ; les plans plus anciens se replient et n'en portent plus. Ne demande donc jamais à l'utilisateur de recopier un accord, et ne lui demande JAMAIS de quitter le mode plan lui-même : le bouton « Valider » s'en charge.
UNE FOIS QUE L'UTILISATEUR VALIDE CE PLAN dans un message qui suit (« vas-y », « lance-le », un accord clair) — le mode repasse alors tout seul sur « direct » —, tu proposes la carte comme d'habitude (cas 2 ou 3 du tri), MAIS tu recopies alors le DERNIER plan entier, tel que tu l'as écrit, dans le champ \`analysis.context\` de board_create_card/propose_task : c'est ainsi qu'il voyage jusqu'à l'agent qui exécutera la carte, qui le suit pendant le travail.`;

/**
 * Les consignes de rôle. EXPORTÉ pour être vérifié par un test : la règle « toute
 * demande de programmation passe par une carte » se perdrait à la première
 * réécriture du texte si rien ne la retenait.
 */
export function rolePrompt(
  role: AgentRole,
  isSelf: boolean,
  engine: EngineId = 'claude',
  /**
   * L'accueil de cet agent. « minimal » — un dépannage de publication — reçoit
   * une consigne CIBLÉE au lieu du déroulé complet : la méthode générale envoie
   * lire le fichier d'instructions et interroger la mémoire par sujet, ce que
   * l'agent n'a plus sous la main et ce dont sa panne n'a que faire.
   */
  niveau: NiveauDAccueil = 'complet',
  /**
   * Le mode de la conversation (`RunConfig.mode`). En « plan », le chef doit
   * rendre un plan écrit dans la conversation — jamais une carte : les outils
   * `board_create_card`/`propose_task` sont déjà refusés au niveau de l'outil
   * (`tools.ts`, PLAN §2 principe 3), cette consigne dit au modèle ce qu'il
   * doit faire à la place plutôt que de le laisser buter sur un refus muet.
   */
  mode: 'direct' | 'plan' = 'direct',
): string {
  if (niveau === 'minimal') return CONSIGNE_DEPANNAGE;

  // Le déroulé est le MÊME quel que soit le moteur : c'est HaikoDev qui décide,
  // pas le modèle. Seul le NOM de l'outil de liste change d'un moteur à l'autre.
  // On n'annonce donc à chaque moteur QUE son propre outil — lui présenter le
  // menu des deux reviendrait à lui laisser le choix, ce qu'on veut éviter.
  const outilListe = OUTIL_LISTE[engine] ?? OUTIL_LISTE.claude;
  const common =
    "Tu travailles dans HaikoDev. Réponds en français simple, pour un lecteur non technique. " +
    "Tu ne publies JAMAIS de ta propre initiative : la mise en ligne est un geste de l'utilisateur.\n\n" +
    "DÉROULÉ VISIBLE (obligatoire dès que la demande tient en plus d'une action) :\n" +
    `1. AVANT d'agir, annonce ta liste de tâches avec ${outilListe} : une ligne par action prévue, formulée en français simple.\n` +
    "2. Passe la ligne en cours à « en cours », et coche-la dès qu'elle est terminée, AVANT d'attaquer la suivante. Une seule ligne en cours à la fois.\n" +
    "Cette liste s'affiche dans la conversation et se coche sous les yeux de l'utilisateur : c'est ainsi qu'il suit ton avancement. Ne la recopie pas en texte, elle est déjà à l'écran.\n\n" +
    `${METHODE}\n\n` +
    /* Vaut pour TOUS les rôles : celui qui monte le projet comme celui qui
       propose la carte qui le montera. Un projet monté sans adresse est un
       projet dont chaque déploiement finira sans rien à contrôler. */
    `${CONSIGNE_CREATION_PROJET}`;

  if (role === 'orchestrator') {
    const base = `${COMMUN_DU_CHEF}

${TRI_DU_CHEF}
${mode === 'plan' ? `\n${TRI_MODE_PLAN}\n` : ''}
${CONSIGNE_CARTE_COURTE}

${CONSIGNE_NIVEAU_AGENT}

Les règles de mise en forme et de longueur voyagent avec la demande : ne les redemande pas, applique-les. Mets en gras le mot qui porte l'information, jamais la phrase entière.`;

    if (isSelf) {
      return `${base}

CE PROJET EST HAIKODEV LUI-MÊME. Tu y as les outils d'un agent complet : lire, modifier, exécuter, enregistrer, pousser.
CES OUTILS NE SONT PAS UNE PERMISSION DE COURT-CIRCUITER LE TABLEAU. Le tri du haut vaut ICI COMME AILLEURS : une demande de programmation reçoit SA CARTE, et c'est l'agent de cette carte qui fait le travail. Tu ne codes pas à sa place « parce que c'est plus rapide » — l'utilisateur perdrait la trace de ce qui se fait, et c'est précisément ce qu'il refuse.`;
    }
    return `${base}

INTERDITS ABSOLUS ici : modifier un fichier existant, exécuter une commande, lancer un sous-agent, piloter un terminal. Les outils correspondants sont bloqués : n'essaie pas de les contourner.
CES INTERDITS NE SONT PAS UNE FIN DE NON-RECEVOIR. Une demande qui réclame d'exécuter quelque chose n'est jamais refusée ni renvoyée à l'utilisateur : elle suit le cas 3 du tri, tu proposes la carte immédiatement et un agent de tâche l'exécutera. Tu ne t'expliques pas longuement sur ce que tu ne peux pas faire, et tu n'attends pas un « oui » avant de proposer.`;
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
Si ta tâche a changé une règle durable, une architecture ou une commande, mets aussi à jour le fichier d'instructions du moteur — celui que le briefing du projet NOMME, jamais un fichier qui se contente d'en renvoyer un autre : court, factuel, sans journal.`;
}

/* ------------------------------------------------------------------ */
/* Reprise après redémarrage (PLAN §12)                                */
/* ------------------------------------------------------------------ */

export function recoverAfterRestart(
  reprendrePublication?: (run: DeployRun, reprises: number) => void,
): void {
  const tous = store.listAgents();
  /*
   * AUCUNE ATTENTE DE RÉPONSE NE SURVIT NON PLUS : le moteur qui l'avait posée
   * est parti avec le démon. Le registre est vidé, et le drapeau gravé sur les
   * agents est effacé — sinon une conversation dirait « l'agent attend votre
   * réponse » alors que plus personne n'attend.
   */
  oublierToutesLesAttentes();
  for (const agent of tous) {
    if (!agent.attendReponse) continue;
    const frais = store.saveAgent({ ...agent, attendReponse: undefined });
    bus.emit({ type: 'agent.upsert', agent: frais });
  }
  /*
   * AUCUN TOUR NE SURVIT NON PLUS. La marque « un tour vit » est ce qui allume
   * le témoin de travail : un moteur étant parti avec le démon, une marque
   * encore là désigne un tour mort, et un tour mort ne rallume jamais rien.
   */
  for (const agent of tous) {
    if (agent.tourVivantDepuis === undefined) continue;
    // Relu en base : la boucle du dessus vient peut-être de réécrire ce même
    // agent, et repartir de la copie d'avant lui rendrait son ancien drapeau.
    retirerLeTourVivant(agent.id);
  }
  /*
   * AUCUN MESSAGE NE SURVIT « EN ÉCRITURE » À UN REDÉMARRAGE. Le nettoyage
   * d'en dessous ne visait que les agents encore marqués au travail : un agent
   * déjà en échec, dont le tour s'était mal refermé, gardait son message en
   * écriture pour toujours — et le témoin « réflexion en cours » avec lui. Plus
   * aucun processus de moteur n'existe à cet instant : une marque d'écriture y
   * est forcément orpheline, quel que soit le statut de l'agent.
   */
  for (const agent of tous) {
    if (agent.status === 'running' || agent.status === 'starting') continue;
    eteindreEcritureOrpheline(agent, { suivi: false, force: true });
  }

  const agents = tous.filter((a) => a.status === 'running' || a.status === 'starting');
  for (const agent of agents) {
    // Le processus a disparu avec le démon : on remet en file SANS consommer
    // une tentative d'exécution (piège coûteux de Paseo).
    const updated = store.saveAgent({ ...agent, status: 'idle', endedAt: Date.now() });
    bus.emit({ type: 'agent.upsert', agent: updated });
    effacerEtapeEnCours(agent.id);

    const messages = store.listMessages(agent.id, 5);
    const dangling = messages.find((m) => m.streaming);
    if (dangling) {
      const fixed = store.saveMessage({
        ...dangling,
        streaming: false,
        // Le moteur est parti avec le démon : rien de ce qui restait ouvert
        // n'a été mené à bout, et la liste doit le DIRE plutôt que garder une
        // ligne qui tourne à vide.
        todos: cloturerLesTaches(dangling.todos, { issue: 'interrompu', maintenant: Date.now() }),
        error: 'Interrompu par un redémarrage du serveur. Cette interruption ne compte pas comme un essai raté.',
      });
      bus.emit({ type: 'message.upsert', message: fixed });
      poserLaProgression(agent.id, fixed.todos);
    }

    if (agent.cardId) rendreLaCarteInterrompue(agent.cardId);
  }

  /*
   * … ET TOUTES LES AUTRES CARTES COUPÉES EN VOL. La boucle ci-dessus ne voit
   * que les agents encore marqués « au travail ». Or un tour se range en
   * plusieurs temps : l'agent passe en « terminé », puis le dépôt est constaté,
   * puis la branche est fusionnée, puis seulement la carte bouge. Coupé dans
   * cette fenêtre — qui contient la compression du fil, donc peut durer —,
   * l'agent était déjà « terminé » : personne ne le rattrapait, et la carte
   * restée en « En cours » affichait la coche verte du travail rendu, alors que
   * le code dormait sur une branche jamais fusionnée.
   *
   * La MARQUE portée par la carte tranche sans se fier au statut de l'agent :
   * aucun moteur ne survit à un arrêt du serveur, donc toute marque encore là
   * désigne un tour coupé. Une carte simplement rendue et laissée ouverte, elle,
   * n'en porte pas : on ne la touche pas.
   */
  for (const carte of store.cartesEnVol()) rendreLaCarteInterrompue(carte.id);

  /*
   * Une publication « running » a été coupée en plein vol par le redémarrage :
   * comme un agent disparu juste au-dessus, ce n'est pas un échec, on la REPREND
   * depuis le début de son étape et avec la même cible. Mais une reprise qui se
   * fait couper à son tour bouclerait à l'infini : on compte les reprises et, au
   * plafond, l'échec reste et NOMME la cause. La reprise elle-même ne part que si
   * le démon nous a passé de quoi la lancer (comptes et projets déjà chargés) —
   * jamais depuis un contrôle qui ne juge que la décision.
   *
   * Une publication réellement en échec (contrôles, construction, conflit) porte
   * déjà l'état « failed » : `runningDeploys()` ne la rend pas, elle n'est donc
   * jamais reprise.
   */
  for (const run of store.runningDeploys()) {
    const decision = decisionRepriseCoupure(run.reprises ?? 0);
    if (decision.reprendre && reprendrePublication) {
      // L'ancien run est CLOS pour ne pas être repris de nouveau au prochain
      // démarrage : la reprise vit dans une NOUVELLE publication, qui portera le
      // compte incrémenté.
      store.saveDeploy({
        ...run,
        state: 'stopped',
        error: 'Publication interrompue par un redémarrage — reprise dans une nouvelle publication.',
        endedAt: Date.now(),
      });
      log.info(
        `publication du projet ${run.projectId} reprise après redémarrage (reprise ${decision.reprises})`,
      );
      reprendrePublication(run, decision.reprises);
    } else {
      store.saveDeploy({
        ...run,
        state: 'failed',
        error: decision.reprendre
          ? 'Publication interrompue par un redémarrage du serveur.'
          : decision.erreur,
        endedAt: Date.now(),
      });
    }
  }
}

/**
 * Le repli pour les cartes d'AVANT la marque : une carte trouvée en « En cours »
 * alors que son agent était encore au travail est coupée en vol, marque ou pas.
 */
const ETAT_COUPURE_SANS_MARQUE = { colonne: 'planned' as const, raison: RAISON_COUPE_EN_VOL };

/**
 * Rendre une carte coupée en vol dans un état HONNÊTE : jamais « Terminé »,
 * jamais silencieuse. Elle retombe dans « Planifié » avec la raison écrite
 * dessus, et repart d'elle-même — le compteur de reprises l'y autorise
 * (`demarrageAutomatiqueAutorise`) sans redemander de geste à l'utilisateur.
 * Le compteur d'ESSAIS, lui, ne bouge pas : un arrêt du serveur n'est pas un
 * essai raté.
 */
function rendreLaCarteInterrompue(cardId: string): void {
  const card = store.getCard(cardId);
  if (!card) return;
  const etat = etatApresCoupure(card) ?? (card.column === 'running' ? ETAT_COUPURE_SANS_MARQUE : null);
  if (!etat) return;
  const scheduling = card.scheduling ?? { asap: false, attempts: 0, restarts: 0 };
  const updatedCard = store.saveCard({
    ...card,
    // La file d'avant-travail, c'est « Planifié » : « À faire » n'existe plus.
    // Viser l'ancienne colonne rendrait la carte illisible.
    ...(etat.colonne
      ? {
          column: etat.colonne,
          position: store.nextPosition(card.projectId, etat.colonne),
          // Une carte interrompue n'est pas une carte close : la date de
          // clôture d'un tour précédent ne doit pas la faire passer pour finie.
          doneAt: undefined,
        }
      : {}),
    scheduling: {
      ...scheduling,
      restarts: (scheduling.restarts ?? 0) + 1,
      waitingReason: etat.raison,
      tourEnVolDepuis: undefined,
    },
  });
  bus.emit({ type: 'card.upsert', card: updatedCard });
  log.info(`carte « ${card.title} » rendue interrompue après redémarrage`);
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
