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
  Card,
  DeployRun,
  ETAPE_PONT,
  ETAPE_PONT_ID,
  EngineId,
  MEMORY_STEP_ID,
  Message,
  Project,
  RunStep,
  SentContextBlock,
  SentContextSnapshot,
  decisionRepriseCoupure,
  TaskProposal,
  TemplateKind,
  TodoItem,
  TurnMeasurement,
  ampleurDeSuivi,
  ampleurParDefaut,
  checkTemplate,
  motifDArretQuota,
  cleDeSession,
  colonneApresMoteurMuet,
  colonneAuDemarrage,
  colonneEnFinDeTour,
  cumulerPartsQuota,
  contexteApresCompression,
  decisionEnTexteLibre,
  etatDuPont,
  finaliserAnalyseDeProposition,
  libelleSujet,
  MemoireDeReprise,
  type MotifDAppel,
  type NiveauDAccueil,
  niveauDAccueil,
  nomDeBranche,
  observerContexte,
  poidsDeTour,
  raisonSansModification,
  RAISON_MOTEUR_INJOIGNABLE,
  resumeContinuite,
  ROLES_QUI_DEPLACENT,
  SUJETS_MEMOIRE,
  sujetsUtiles,
  templateForColumn,
  tourDeLaCarte,
  wrapPrompt,
  mesurerContexte,
} from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { CONFIG, PATHS } from './config.js';
import { adapterFor, contextWindowFor, EngineEvent, EngineHandle } from './engines/index.js';
import { agentLog, log } from './logger.js';
import { getInternalToken } from './auth.js';
import { briefingSepare, empreintesDesFaits, faitsDuSujet, memorySummary, newFactsSince } from './memory.js';
import { allDone, mergeTodos } from './todos.js';
import { orchestratorAllowList, orchestratorDenyList, toolsFor, writeMcpConfig } from './tools.js';
import {
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
import { cartesDuTravailHorsTache, depotModifieDepuis, repereAvant } from './hors-tache.js';
import { oublierLePont, passageDuPont } from './pont.js';
import { ouvrirDossierDeCarte, refermerDossierDeCarte } from './dossier-de-carte.js';

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
}

const live = new Map<string, LiveRun>();

/** Dernier relevé dont la hausse a déjà été répartie, compte par compte. */
const dernierQuotaReparti = new Map<string, { session?: number; weekly?: number }>();

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
 */
const demarrant = new Set<string>();

/**
 * Tous les agents qu'un redémarrage COUPERAIT : ceux dont le moteur écrit, et
 * ceux dont le tour est en train de partir. C'est cette liste-là que doivent
 * regarder le bouton de redémarrage et la fin d'une publication — jamais le
 * seul compte des processus déjà nés.
 */
export function agentsActifs(): string[] {
  // `live` d'abord (le moteur écrit), puis ceux qui démarrent : un même agent
  // peut être dans les deux, on ne le compte qu'une fois.
  return [...new Set([...live.keys(), ...demarrant])];
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
  messageId: string;
  blocks: SentContextBlock[];
}

/** Fabrique la photographie persistée sur la demande, sans lire l'ancien fil. */
export function instantaneContexteEnvoye(input: {
  engine: EngineId;
  model?: string;
  nouvelleSession: boolean;
  prompt: string;
  systemPrompt: string;
  blocks: SentContextBlock[];
  sentAt?: number;
}): SentContextSnapshot {
  return SentContextSnapshot.parse({
    engine: input.engine,
    model: input.model,
    session: input.nouvelleSession ? 'new' : 'resumed',
    prompt: input.prompt,
    systemInstruction: {
      kind: input.nouvelleSession ? 'full' : 'reminder',
      content: input.systemPrompt,
      // Claude porte cette consigne dans une option séparée ; Codex la place
      // devant le prompt. Le tiroir peut ainsi décrire le transport exact.
      transport: input.engine === 'claude' ? 'separate' : 'prefixed',
    },
    blocks: [
      ...input.blocks,
      {
        kind: 'system',
        label: input.nouvelleSession ? 'Consigne système complète' : 'Rappel de méthode',
        characters: input.systemPrompt.length,
      },
    ],
    history: input.nouvelleSession ? 'none' : 'retained_by_engine',
    sentAt: input.sentAt ?? Date.now(),
  });
}

/** La mesure d'entrée appartient à la demande, pas au message de réponse. */
export function mesureEntreeMoteur(usage: NonNullable<EngineEvent['usage']>): {
  inputTokens: number;
  cachedInputTokens?: number;
  totalInputTokens: number;
} {
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedTokens,
    totalInputTokens: usage.inputTokens + (usage.cachedTokens ?? 0),
  };
}

function mesurerContexteUtilisateur(messageId: string, usage: NonNullable<EngineEvent['usage']>): void {
  const message = store.getMessage(messageId);
  if (!message?.sentContext) return;
  const mesure = mesureEntreeMoteur(usage);
  const updated = store.saveMessage({
    ...message,
    tokens: mesure.totalInputTokens,
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
  if (!cible) return;
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
    scheduling: carte.scheduling
      ? { ...carte.scheduling, suspendu: false, waitingReason: undefined }
      : carte.scheduling,
  });
  bus.emit({ type: 'card.upsert', card: relancee });
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

  /*
   * À partir d'ici, le tour est PARTI, même si aucun processus n'existe encore :
   * l'agent compte comme occupé jusqu'au bout, pour qu'un redémarrage
   * automatique ne le coupe pas dans la fenêtre de préparation.
   */
  demarrant.add(agentId);
  try {
    await preparerLeTour(agent, text, options);
  } finally {
    demarrant.delete(agentId);
  }
}

async function preparerLeTour(agent: Agent, text: string, options: PromptOptions): Promise<void> {
  const agentId = agent.id;
  const project = store.getProject(agent.projectId);
  if (!project) throw new Error('projet introuvable');

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
  const nouvelleSession = !store.getSessionId(agent.id, cleDeSession(agent.run.engine, agent.run.model));
  /*
   * Le NIVEAU d'accueil ne dit pas QUAND on accueille (ça, c'est
   * `nouvelleSession`), mais AVEC QUOI. Un dépannage de publication n'emporte
   * ni index de mémoire, ni compétences, ni fichiers d'instructions.
   */
  const niveau = niveauDAccueil({ role: agent.role, motif: options.motif });
  const contextParts: { label: string; kind: SentContextBlock['kind']; content: string }[] = [];
  let memoryAndInstructionsCharacters = 0;

  if (nouvelleSession) {
    // Le briefing (chemin du projet, fichiers d'instructions, compétences)
    // n'a de sens qu'au premier tour : ensuite l'agent l'a en contexte. L'index
    // de la mémoire voyage à part (`kind: 'memory'`) : c'est ce qui permet au
    // tiroir « Contexte envoyé » de distinguer mémoire et reste du briefing.
    const { sansMemoire, memoire } = briefingSepare(
      project.path,
      project.name,
      true,
      agent.run.engine,
      agent.workdir,
      niveau,
    );
    contextParts.push({
      label:
        niveau === 'minimal'
          ? 'Briefing réduit (dépannage)'
          : niveau === 'tri'
            ? 'Briefing réduit (tri du chef)'
            : 'Briefing du projet',
      kind: 'briefing',
      content: sansMemoire,
    });
    memoryAndInstructionsCharacters += sansMemoire.length;
    if (memoire) {
      contextParts.push({ label: 'Index de la mémoire du projet', kind: 'memory', content: memoire });
      memoryAndInstructionsCharacters += memoire.length;
    }
    // Le chef bridé a tous les droits SAUF modifier le code du projet : on lui
    // dit où il peut écrire (son dossier de travail) et que le projet est en
    // lecture seule — une écriture y échoue, une modification s'ouvre en carte.
    if (agent.role === 'orchestrator' && !project.isSelf) {
      const scratch = path.join(PATHS.chefScratch, project.id);
      const espace =
        `TON ESPACE DE TRAVAIL : tu peux lancer des commandes (sondages, études, analyses) et ` +
        `écrire tes brouillons dans ${scratch} — c'est le SEUL dossier où tu as le droit d'écrire. ` +
        `Le projet (${project.path}) est monté en LECTURE SEULE : lis-y tout ce qu'il te faut, mais ` +
        `toute écriture y échoue. Modifier le code du projet n'est pas ton rôle : tu l'ouvres en carte ` +
        `confiée à un agent de tâche.`;
      contextParts.push({ label: 'Espace de travail du chef', kind: 'extra', content: espace });
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
        content: agent.context.continuitySummary,
      });
    }
  } else {
    const nouveaux = newFactsSince(project.path, store.memorySeen(agent.id));
    if (nouveaux.length) {
      const ajout = `MÉMOIRE DU PROJET — faits ajoutés depuis :\n${nouveaux.map((f) => `- ${f}`).join('\n')}`;
      contextParts.push({ label: 'Nouveaux faits de la mémoire', kind: 'memory', content: ajout });
      memoryAndInstructionsCharacters += ajout.length;
      store.setMemorySeen(agent.id, empreintesDesFaits(project.path));
    }
  }

  if (options.context) {
    contextParts.push({ label: 'Contexte ajouté par HaikoDev', kind: 'extra', content: options.context });
  }
  if (card) {
    const bloc = carteContexte(agent.id, card, nouvelleSession);
    if (bloc) contextParts.push({ label: 'Carte en cours', kind: 'card', content: bloc });
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
        content: `PIÈCES JOINTES fournies par l'utilisateur (lis-les) :\n${files.join('\n')}`,
      });
    }
  }

  let ampleur = options.ampleur ?? ampleurParDefaut(template, text);
  // Un tour de SUIVI (session déjà ouverte) part d'un cran plus bas : la question
  // de fond a eu sa réponse ample, la suite est une précision.
  if (!nouvelleSession) ampleur = ampleurDeSuivi(template, ampleur);
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
    { kind: 'request', label: 'Demande utilisateur', characters: text.length },
    ...contextParts.map((part) => ({ kind: part.kind, label: part.label, characters: part.content.length })),
    {
      kind: 'format',
      label: 'Gabarit et séparateurs HaikoDev',
      characters: Math.max(0, prompt.length - text.length - contexteAssemble.length),
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
    userMessageId ? { messageId: userMessageId, blocks } : undefined,
    niveau,
    options.compteImpose,
  );
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

async function startTurn(
  agentBefore: Agent,
  prompt: string,
  template: TemplateKind,
  onComplete?: PromptOptions['onComplete'],
  /** Vrai au tout premier tour d'une session : c'est là qu'on lit la mémoire. */
  nouvelleSession = true,
  ampleur: Ampleur = 'complete',
  composition: TurnMeasurement['composition'] = {
    promptCharacters: 0,
    systemPromptCharacters: 0,
    cardDescriptionCharacters: 0,
    memoryAndInstructionsCharacters: 0,
  },
  contexteUtilisateur?: ContexteUtilisateurDuTour,
  /** L'accueil que mérite cet agent : « minimal » pour un dépannage de publication. */
  niveau: NiveauDAccueil = 'complet',
  /** Le compte choisi à la main pour ce tour (reprise après épuisement). */
  compteImpose?: string,
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
   * Choix du compte (x20 d'abord, Pro en relève) — décidé AU LANCEMENT, jamais
   * en plein vol (PLAN §13).
   *
   * Un compte IMPOSÉ passe devant : il vient d'un choix humain, revérifié à
   * l'instant du clic (reprise après épuisement). Le choix automatique
   * retomberait sur le compte à sec, puisqu'il classe par priorité.
   */
  const compteChoisi = compteImpose
    ? listAccountRecords().find((a) => a.id === compteImpose && a.engine === agent.run.engine)
    : undefined;
  const account = compteChoisi ?? (await pickAccount(agent.run.engine));
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
   * Où en est le dépôt AVANT que l'agent ne touche à quoi que ce soit. UN SEUL
   * repère, pris pour TOUS les agents, qui sert deux fois à la fin du tour :
   * dire si du code a été enregistré sans carte — et mérite donc une fiche —,
   * et dire si la carte a le droit de passer en « Terminé ».
   */
  const repere = await repereAvant(dossier).catch(() => null);

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
    quota5h: 0,
    quotaSemaine: 0,
  };

  // Le premier tour du groupe pose le repère commun. Les suivants le gardent
  // jusqu'à ce que le dernier tour du compte soit rangé.
  if (!dernierQuotaReparti.has(account.id)) dernierQuotaReparti.set(account.id, quotaAvant);

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
  const systemPrompt = rolePrompt(roleMoteur, project.isSelf, agent.run.engine, niveau);
  composition = { ...composition, systemPromptCharacters: systemPrompt.length };

  const env: Record<string, string> = {
    HAIKODEV_TOKEN: token,
    HAIKODEV_URL: url,
    HAIKODEV_AGENT: agent.id,
    ...applyAccountEnv(account),
  };

  /*
   * Le fil à reprendre appartient au moteur ET, sous Codex, au modèle qui l'a
   * ouvert : `codex exec resume` refuse un fil enregistré avec un autre modèle
   * (voir `cleDeSession`). Un changement de réglage ouvre donc un fil neuf au
   * lieu d'afficher une erreur.
   */
  const cleSession = cleDeSession(agent.run.engine, agent.run.model);
  const sessionId = store.getSessionId(agent.id, cleSession);
  const systemPromptRappel = rappelDeMethode(agent.run.engine);
  const instantane = contexteUtilisateur
    ? instantaneContexteEnvoye({
        engine: agent.run.engine,
        model: agent.run.model ?? adapter.defaultModel,
        nouvelleSession: !sessionId,
        prompt,
        systemPrompt: sessionId ? systemPromptRappel : systemPrompt,
        blocks: contexteUtilisateur.blocks,
      })
    : undefined;

  // Le pont d'outils du tour précédent ne prouve rien pour celui-ci.
  oublierLePont(agent.id);

  // L'avancement d'un tour précédent ne vaut rien pour celui-ci : on repart
  // sans liste, sinon le décroché de la carte montrerait un vieux « 3/3 ».
  setStatus(agent, 'running', {
    startedAt: Date.now(),
    account: account.id,
    todos: undefined,
    // Un fil neuf ne réutilise jamais la mesure du fil précédent. Tant que le
    // moteur ne parle pas, l'interface montre explicitement « indisponible ».
    contextUsage: nouvelleSession ? undefined : agent.contextUsage,
  });

  let sawError: string | undefined;

  const handle = adapter.run({
    cwd,
    projectRoot,
    prompt,
    model: agent.run.model ?? undefined,
    thinking: agent.run.thinking,
    sessionId,
    systemPrompt,
    systemPromptRappel,
    mcpConfigPath,
    mcpBridgePath: bridgePath,
    fullAccess,
    mode: agent.run.mode,
    allowedTools: isOrchestrator && !project.isSelf ? orchestratorAllowList() : undefined,
    disallowedTools: isOrchestrator && !project.isSelf ? orchestratorDenyList() : undefined,
    env,
    onEvent: (event) => {
      agentLog(PATHS.logs, agent.id, JSON.stringify(event));
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

            /*
             * L'avancement voyage AUSSI avec l'agent : les étapes vivent sur les
             * messages (chargés seulement à l'ouverture d'une carte), mais le
             * décroché du tableau doit montrer « n/N faites » sans ouvrir la
             * carte. On pose donc le décompte sur l'agent lui-même, en relisant
             * son état frais pour ne pas écraser un statut posé ailleurs.
             */
            const progression = {
              done: runState.todos.filter((t) => t.state === 'done').length,
              total: runState.todos.length,
            };
            const frais = store.getAgent(agent.id);
            if (frais && (frais.todos?.done !== progression.done || frais.todos?.total !== progression.total)) {
              const maj = store.saveAgent({ ...frais, todos: progression });
              bus.emit({ type: 'agent.upsert', agent: maj });
            }

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
          runState.usage = event.usage;
          if (contexteUtilisateur && event.usage) {
            mesurerContexteUtilisateur(contexteUtilisateur.messageId, event.usage);
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

  // Seulement après que l'adaptateur a accepté et lancé le tour : une demande
  // restée en file ou refusée avant ce point n'affiche aucun faux envoi.
  if (contexteUtilisateur && instantane) {
    const message = store.getMessage(contexteUtilisateur.messageId);
    if (message) {
      const updated = store.saveMessage({ ...message, sentContext: instantane });
      bus.emit({ type: 'message.upsert', message: updated });
      // Un adaptateur d'essai peut rendre l'usage dès son appel ; dans ce cas
      // on applique aussitôt la mesure qui serait sinon arrivée trop tôt.
      if (runState.usage) mesurerContexteUtilisateur(contexteUtilisateur.messageId, runState.usage);
    }
  }

  runState.handle = handle;
  live.set(agent.id, runState);
  bus.emit({ type: 'capacity', capacity: (await import('./capacity.js')).snapshot() });

  const result = await handle.finished;
  const elapsedSeconds = (Date.now() - runState.startedAt) / 1000;
  const tokens =
    (runState.usage?.inputTokens ?? 0) +
    (runState.usage?.cachedTokens ?? 0) +
    (runState.usage?.outputTokens ?? 0);

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
  const moteurMuet = !result.ok && !etapesDuMoteur.length && !runState.text.trim();
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

  if (!failed && agent.role === 'orchestrator') {
    finaliserPropositionsDuChef(runState.messageId, agent.projectId, measurement);
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
    // Un arrêt dû au quota n'affiche pas de panne : le bloc de reprise dit ce
    // qui s'est passé et propose la suite, ce que « code 1 » ne faisait pas.
    error: reprise
      ? undefined
      : failed
        ? sawError ?? result.error ?? "Le moteur s'est arrêté avant la fin."
        : undefined,
    repriseCompte: reprise,
  });

  /*
   * FRONTIÈRE SÛRE : la réponse visible est finie, mais l'agent reste dans
   * `live`, donc toute nouvelle demande s'empile encore. C'est ici seulement
   * que le remplissage est gravé et qu'une éventuelle compression peut partir.
   */
  const contextWindow = runState.context?.window ?? catalogContextWindow;
  if (runState.context && contextWindow) {
    const frais = store.getAgent(agent.id)!;
    const observation = observerContexte(frais.context, runState.context.tokens, contextWindow);
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
  setStatus(finalAgent, reprise ? 'stopped' : failed ? 'failed' : 'done', { endedAt: Date.now() });

  /*
   * LE CONSTAT, avant tout déplacement de carte : le dépôt a-t-il bougé ? On le
   * lit ici, tant que le dossier est encore dans l'état où l'agent l'a laissé —
   * le découpage du travail hors tâche, juste après, remet la branche de départ
   * en arrière et effacerait la trace.
   */
  const depotModifie = failed ? false : await depotModifieDepuis(dossier, repere).catch(() => true);

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
       * L'agent d'exécution a rendu ET le dépôt a changé : la carte passe en
       * « Terminé » toute seule. Trois freins, chacun suffisant : un tour en
       * échec (le travail n'est pas fait), un rôle qui n'exécute pas (l'étude ne
       * clôt rien), un tour qui n'a rien modifié (répondre n'est pas
       * travailler). Dans ce dernier cas, la carte porte la raison en toutes
       * lettres — sinon elle aurait l'air simplement oubliée.
       */
      /*
       * … et un quatrième frein, qui n'est pas une règle de colonne mais un
       * constat : ce tour est-il encore CELUI de la carte ? Un tour arrêté rend
       * la main à son rythme ; entre-temps un nouvel agent a pu reprendre la
       * carte. Le laisser écrire « Terminé » afficherait la fin du travail
       * pendant que quelqu'un écrit encore.
       */
      const leSien = tourDeLaCarte(card, agent.id);
      // Le moteur n'a jamais parlé : le LANCEMENT n'a pas pu le joindre, ce
      // n'est pas la tâche qui a échoué. La carte ne reste pas figée en
      // « En cours » comme un échec ordinaire : elle repart en « Planifié »,
      // prête à être retentée toute seule par l'ordonnanceur.
      const relanceMoteurMuet = leSien ? colonneApresMoteurMuet(card.column, agent.role, moteurMuet) : null;
      const cible = leSien
        ? (relanceMoteurMuet ?? colonneEnFinDeTour(card.column, !failed, agent.role, depotModifie))
        : null;
      // Ce tour vient-il de produire du code ? Alors la carte l'a « déjà
      // enregistré » pour de bon — le drapeau ne s'effacera plus.
      const aProduit =
        leSien && !failed && ROLES_QUI_DEPLACENT.includes(agent.role) && depotModifie;
      const dejaEnregistre = card.codeDejaEnregistre || aProduit;
      const raison = leSien
        ? raisonSansModification(card.column, !failed, agent.role, depotModifie, dejaEnregistre)
        : null;
      const updated = store.saveCard({
        ...card,
        ...(cible
          ? {
              column: cible,
              position: store.nextPosition(card.projectId, cible),
              ...(cible === 'done' ? { doneAt: Date.now() } : {}),
            }
          : {}),
        ...(relanceMoteurMuet
          ? {
              scheduling: {
                ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
                restarts: (card.scheduling?.restarts ?? 0) + 1,
                waitingReason: RAISON_MOTEUR_INJOIGNABLE,
              },
            }
          : {}),
        codeDejaEnregistre: dejaEnregistre,
        // La phrase « rien n'a changé » n'appartient qu'à l'agent de la carte :
        // un tour étranger la laisse telle quelle plutôt que de l'effacer.
        ...(leSien ? { sansModification: raison ?? undefined } : {}),
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
      title: 'Tâche en échec',
      body: agent.title,
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
      });
      bus.emit({ type: 'attention', ...store.signalAttention() });
    }
  }

  live.delete(agent.id);
  bus.emit({ type: 'capacity', capacity: (await import('./capacity.js')).snapshot() });

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

function resumePourAgent(agent: Agent): string {
  const project = store.getProject(agent.projectId)!;
  const card = agent.cardId ? store.getCard(agent.cardId) : null;
  const messages = store.listMessages(agent.id);
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
    onEvent: (event) => {
      if (event.kind === 'text' && event.text) texte += `${texte ? '\n\n' : ''}${event.text}`;
      if (event.kind === 'error') erreur = true;
    },
  });
  const resultat = await handle.finished;
  return resultat.ok && !erreur ? texte.trim() : '';
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
    });
  }
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
1. LIRE AVANT DE RÉPONDRE : le fichier d'instructions du moteur cité dans le briefing, puis l'outil « project_memory » — pour CHAQUE ligne de l'index qui touche au sujet ET pour le SUJET de ta tâche (« publication », « cartes », « voix », « quotas »…) : il rend d'un coup les FAITS, les RÈGLES du moteur et les CONTRÔLES qui le concernent, sans le reste. Puis les fichiers réellement concernés — repérés par une recherche dans le projet, jamais devinés de mémoire.
2. CONSTATER PAR ÉCRIT avant de conclure : ce que le projet fait aujourd'hui, ce que la demande veut, ce qui manque entre les deux. C'est ce qui remplit la section « Analyse » de ta réponse.
3. NE RIEN INVENTER : un fichier, une commande ou un comportement ne se cite qu'après l'avoir vu. Ce que tu n'as pas vérifié se dit comme une hypothèse, en toutes lettres.
4. VÉRIFIER À LA FIN : rejoue les contrôles du projet qui touchent à ce que tu as changé, et donne leur résultat, même en échec. Un échec tu, c'est un travail rendu faux.
5. ${SILENCE_IDENTIFIANTS}
6. UNE QUESTION SE POSE AVEC L'OUTIL « ask_user », JAMAIS EN TEXTE SIMPLE : dès qu'un choix ne t'appartient pas — une option à retenir, une préférence, une information qui te manque —, tu appelles « ask_user » et tu attends la réponse. Une question écrite à la fin de ta réponse ne réveille personne : ton tour se termine, l'utilisateur ne voit aucune alerte, et la carte reste bloquée sans que personne ne sache qu'elle t'attend. Tu ne finis donc JAMAIS un tour sur une question posée en texte. Ce qui peut être tranché par ce que tu as lu se tranche : tu annonces ton choix en une ligne et tu continues.`;

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
const COMMUN_DU_CHEF = `Tu travailles dans HaikoDev. Réponds en français simple, pour un lecteur non technique. Tu ne publies JAMAIS de ta propre initiative : la mise en ligne est un geste de l'utilisateur.

TU ES LE CHEF D'ORCHESTRE du projet, et tu ne fais QUE DEUX CHOSES : tu réponds aux questions, et tu proposes des cartes courtes en disant à quel NIVEAU les exécuter. Tu n'ouvres pas le projet pour étudier une demande, tu ne chiffres rien, tu ne prépares aucun relais : tout cela appartient à la carte une fois validée, et le refaire ici serait le payer deux fois.
NE RIEN INVENTER : ce que tu n'as pas vu ne se cite pas. Si une réponse suppose de lire le projet, tu lis d'abord — mais une CARTE, elle, s'écrit sans rien lire.
${SILENCE_IDENTIFIANTS}
UNE QUESTION SE POSE AVEC L'OUTIL « ask_user », JAMAIS EN TEXTE SIMPLE : une question écrite à la fin de ta réponse ne réveille personne. Ce qui peut être tranché se tranche : tu annonces ton choix en une ligne et tu continues.

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
4. Cas ambigu → tu réponds d'abord, puis tu appelles propose_task. Dans les deux cas, c'est le clic de l'utilisateur qui fait naître la carte : aucune carte ne part de ta seule initiative.
5. Gestion du tableau (« renomme », « déplace », « liste ») → appel d'outil direct.

NE RECOPIE JAMAIS EN TEXTE une carte que tu viens de proposer : elle s'affiche déjà, entière, dans la conversation. Une phrase courte suffit.`;

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
          // La file d'avant-travail, c'est « Planifié » : « À faire » n'existe
          // plus. Viser l'ancienne colonne rendrait la carte illisible.
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
