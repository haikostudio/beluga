import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  Agent,
  AgentRole,
  CONSIGNE_CADRAGE,
  analyseDeCadrageFaite,
  Ampleur,
  CONSIGNE_CREATION_PROJET,
  CONSIGNE_CARTE_COURTE,
  CONSIGNE_SYNTHESE_CARTE,
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
  PassageRetrouve,
  PhaseJournal,
  ConsultationMemoire,
  SentContextBlock,
  SentContextEtat,
  decisionRepriseCoupure,
  TaskProposal,
  TemplateKind,
  TodoItem,
  TurnMeasurement,
  ampleurDuTour,
  checkTemplate,
  rapportAuPlancher,
  relanceDuRapport,
  tachesDeFondVivantes,
  consigneDeRelanceDuRapport,
  nomDeTacheDeFond,
  PLAFOND_RELANCE_AVEC_TACHES_MS,
  type TacheDeFond,
  motifDArretQuota,
  chaineDeReprise,
  compteDuTour,
  echeanceAnnonceeParLeMoteur,
  arretDuAuQuota,
  ETAPE_PANNE_ID,
  MARGE_DE_REPRISE_MS,
  causeEnClair,
  causeLaPlusParlante,
  demandeDeRepriseApresPanne,
  libelleDeLEtape,
  libelleDeLaReprise,
  messageDePanneDefinitive,
  erreurDeTourAPoser,
  jalonDeFinDeTour,
  JALON_NOTE_DE_L_AGENT,
  noteAvantLAction,
  texteRenduDuTour,
  MotifDeContinuite,
  filARappeler,
  messagesDepuis,
  tachesAPoursuivre,
  cloturerLesTaches,
  progressionDesTaches,
  cleDeSession,
  partMoteurDeLaCle,
  colonneAuDemarrage,
  type Demandeur,
  etatApresCoupure,
  TraceDuTravail,
  raisonDeCoupure,
  cumulerPartsQuota,
  contexteApresCompression,
  decisionEnTexteLibre,
  enteteDuTour,
  etatDuPont,
  noteDePontEnEchec,
  panneDeLaMachine,
  tourARejouerFauteDOutils,
  ESSAIS_DE_PONT_MAX,
  issueDuPontMort,
  phraseDeRejeuDuPont,
  raisonDePontMortDefinitif,
  finaliserAnalyseDeProposition,
  LIBELLE_TYPE,
  CE_QUI_NE_SE_MEMORISE_JAMAIS,
  CONSIGNES_REDACTION_CHANGELOG,
  type TypeUnite,
  MemoireDeReprise,
  type MotifDAppel,
  CONSIGNE_ASSISTANT_BACKUP,
  CONSIGNE_ASSISTANT_SURVEILLANCE,
  CONSIGNE_AGENT_MARKETING,
  CONSIGNE_DE_VULGARISATION,
  RAPPEL_DE_VULGARISATION,
  consigneDeLangue,
  LANGUE_DORIGINE,
  type LangueId,
  type NiveauDAccueil,
  niveauDAccueil,
  effortDuTour,
  partsDAccueil,
  afficheEtapeMemoire,
  JALON_PLAN_PROPOSE,
  consigneDeRenduDuPlan,
  consigneDAffinageDuPlan,
  blocDuDernierPlan,
  numeroDuProchainPlan,
  planManquant,
  INCIDENT_PLAN_NON_RENDU,
  ETAPE_PLAN_RECLAME,
  ETAPE_PLAN_RECLAME_ID,
  comprehensionManquante,
  issueDeLaRelance,
  issueAEcrire,
  CONSIGNE_COMPREHENSION_RECLAMEE,
  INCIDENT_COMPREHENSION_NON_RENDUE,
  ETAPE_COMPREHENSION_RECLAMEE,
  ETAPE_COMPREHENSION_RECLAMEE_ID,
  questionEnTexteLibre,
  NIVEAU_PAR_DEFAUT,
  nomDeBranche,
  observerContexte,
  plafondDeContexte,
  poidsDeTour,
  RAISON_ARBRE,
  type OrigineDeBloc,
  consigneEspaceDeCadrage,
  detailDuRefus,
  resumeContinuite,
  ROLES_QUI_DEPLACENT,
  SUJETS_MEMOIRE,
  templateForColumn,
  wrapPrompt,
  mesurerContexte,
  metriquesDeSessionLlm,
  metriquesSessionLlmIndisponibles,
  jetonsMessageEnvoye,
  PLAFOND_APPEL_APRES_REPONSE_MS,
  PLAFOND_RATTRAPAGE_PLAN_MS,
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
  noteDeQualite,
  type IssueDeTache,
  titreEncoreVide,
  titreDepuisLaDiscussion,
  titreEclairDeLaDemande,
  aliasDe,
  blocPiecesJointes,
  tagsAvecAlias,
  tagsDuTexte,
  paramsLisibles,
  consigneEnTeteDeSession,
} from '@beluga/shared';
import {
  carteEnPublication,
  messageOuvreUneNouvelleCarte,
  migrationDeReglage,
  TEXTE_CARTE_EN_PUBLICATION,
} from '@beluga/shared';
import type { DecisionDArret } from '@beluga/shared';
import { cheminDePieceJointe, dossiersDeDonneesOuverts } from './pieces-jointes.js';
import { consigneDuCadrageReuni } from './regroupements.js';
import * as store from './store.js';
import { langueDesAgents } from './langue-configuree.js';
import { bus } from './bus.js';
import { CONFIG, PATHS } from './config.js';
import { adapterFor, cachedEngines, contextWindowFor, EngineAdapter, EngineEvent, EngineHandle } from './engines/index.js';
import { acheverLArbre } from './engines/fin-de-processus.js';
import { agentLog, log } from './logger.js';
import { estAgentMarketing } from './marketing.js';
import { AjoutJournal, ajouterAuJournal, phaseDeLaCarte } from './journal-carte.js';
import { getInternalToken } from './auth.js';
import { briefingSepare, competencesPertinentes } from './memory.js';
import { garderLesPertinents, indiquerLaNatureDeLaDemande } from './jugement-rapide.js';
import { accueilDesConnaissances, compterUnites, oublierLesLectures, pistesDesConnaissances, pistesParLesMots, texteDesPistes } from './connaissances.js';
import { allDone, mergeTodos } from './todos.js';
import { callTool, cadrageAllowList, cadrageDenyList, toolsFor, writeMcpConfig } from './tools.js';
import {
  AccountRecord,
  brancherAgentsDuCompte,
  pickAccount,
  noteAccountUse,
  applyAccountEnv,
  limiteBloquante,
  listAccountRecords,
  partsQuotaEnCache,
  relireQuotaDuCompte,
} from './accounts.js';
import {
  derniereRepriseDeLAgent,
  poserDecisionDeReprise,
  reprendreAutomatiquement,
  repriseDeCompte,
} from './reprise-compte.js';
import { poserDecisionErreurDeTour } from './erreur-de-tour.js';
import { limitesConnues, noterLimiteConnue } from './limites-connues.js';
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
import {
  ouvrirLesCopiesAnnexes,
  refermerLesCopiesAnnexes,
  travailDansLesAnnexes,
  type CopieAnnexe,
} from './copies-des-depots.js';
import { sortieGit } from './git.js';
import { consigneDeCreationDeLaCarte } from './mode-creation.js';
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
  /**
   * LE JOURNAL DE LA CARTE, tenu tout au long du tour. `cardIdJournal` est la
   * carte dont ce tour raconte un épisode (absente pour un agent sans carte :
   * rien n'est alors journalisé), `phaseJournal` la phase décidée UNE FOIS au
   * démarrage — cadrage, recadrage ou exécution — et `dejaJournalise` retient ce
   * qui a déjà été écrit, pour qu'une étape ou un point de travail réémis par le
   * moteur n'ajoute pas dix fois la même ligne (`server/src/journal-carte.ts`).
   */
  cardIdJournal?: string;
  phaseJournal: PhaseJournal;
  dejaJournalise: Set<string>;
  /**
   * LA REPRISE QUE CE TOUR CONSOMME : l'identifiant du message du tour coupé
   * par une limite, quand ce tour est sa poursuite. Posé sur la réponse
   * (`poursuiteDe`) et dans le jalon « Tour lancé » : le parcours rattache ce
   * tour au point de celui qu'il poursuit.
   */
  repriseDe?: string;
  startedAt: number;
  steps: Map<string, RunStep>;
  /**
   * L'OUTIL BRUT DE CHAQUE ÉTAPE, retenu du début à la fin de celle-ci.
   *
   * Le moteur annonce une étape DEUX fois : au départ avec son outil et son
   * entrée, à l'arrivée avec son résultat seul. Or c'est à l'arrivée qu'on
   * journalise — une étape en cours n'a pas encore de résultat. Sans ce
   * souvenir, le journal ne recevait donc que l'étiquette française
   * (« Commande : npm test ») et perdait la commande entière, le fichier lu,
   * le texte remplacé : le parcours ne pouvait plus rien montrer d'utile.
   */
  outilsDesEtapes: Map<string, { outil: string; entree?: Record<string, unknown> }>;
  todos: TodoItem[];
  /** La liste entièrement cochée n'est annoncée qu'une fois par tour. */
  todosNotified?: boolean;
  /** TOUT le texte du tour, bout à bout : ce qui s'affiche en direct. */
  text: string;
  /**
   * LE MÊME TEXTE, COUPÉ À CHAQUE ACTION DU MOTEUR (`shared/src/texte-du-tour.ts`).
   * Le dernier morceau est ce qui s'écrit depuis la dernière action ; les
   * autres sont des phrases de passage, déjà versées dans la réflexion. La
   * réponse du tour se tire de là, plus du texte entier.
   */
  morceauxDuTexte: string[];
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
  /**
   * L'ÉCHÉANCE JUSQU'À LAQUELLE CE TOUR ATTEND LÉGITIMEMENT SON NOUVEL ESSAI.
   *
   * Posée juste avant l'attente qui suit une panne passagère du fournisseur,
   * effacée dès que le moteur suivant est lancé. Tant qu'elle court, la veille
   * des tours bloqués ne prend pas le moteur mort pour un tour abandonné :
   * c'est un moteur qu'on a décidé de relancer (§ 7 de
   * `shared/src/fin-de-tour.ts`). Bornée : une reprise qui ne vient jamais rend
   * la main au filet.
   */
  repriseApresPanneJusqua?: number;
  /**
   * CE TOUR A ÉTÉ REFERMÉ D'AUTORITÉ. La boucle de relance le relit avant de
   * lancer son essai suivant : sans ce mot, elle posait un moteur tout neuf sur
   * un tour déjà mort — un moteur ORPHELIN, qui dépensait des jetons et dont
   * chaque appel d'outil se faisait refuser (« ce tour est terminé »).
   */
  refermeDAutorite?: boolean;
}

const live = new Map<string, LiveRun>();

// Le relevé de quota ne force pas le renouvellement d'un compte au travail, et
// un coffre trouvé vidé note qui tournait dessus : les deux lisent ce registre.
brancherAgentsDuCompte((accountId) =>
  [...live.values()].filter((run) => run.account === accountId).map((run) => run.agentId),
);

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
 * carte ; les autres rôles (cadrage, analyse, déploiement) restent
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
    } else if (agent.role === 'cadrage') {
      const carte = agent.cardId ? store.getCard(agent.cardId) : null;
      details.push(carte ? `le cadrage de « ${carte.title} » (${projet})` : `un cadrage du projet « ${projet} »`);
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
 * ÉCRIT UNE ENTRÉE AU JOURNAL DE LA CARTE DE CE TOUR.
 *
 * Le journal accumule la vie ENTIÈRE d'une carte, sur tous ses tours et tous
 * ses agents (`shared/src/journal-carte.ts`). Cette fonction est le seul chemin
 * d'écriture depuis un tour vivant : elle sait la carte, la phase et l'agent, et
 * ne demande donc que ce qui change d'une entrée à l'autre.
 *
 * Un agent SANS carte n'écrit rien — il n'y a pas d'histoire à raconter. Une
 * `cle` fournie garantit qu'un événement réémis par le moteur (une étape qui
 * passe de « en cours » à « faite », une liste de tâches renvoyée en entier à
 * chaque changement) n'ajoute qu'UNE ligne.
 */
export function journaliserDansLeTour(agentId: string, entree: AjoutJournalDuTour): void {
  const run = live.get(agentId);
  if (!run?.cardIdJournal) return;
  if (entree.cle) {
    if (run.dejaJournalise.has(entree.cle)) return;
    run.dejaJournalise.add(entree.cle);
  }
  const { cle: _cle, ...reste } = entree;
  const ecrite = ajouterAuJournal({
    ...reste,
    cardId: run.cardIdJournal,
    phase: reste.phase ?? run.phaseJournal,
    agentId,
    agentRole: store.getAgent(agentId)?.role,
    tourId: reste.tourId ?? run.messageId,
  });
  if (ecrite) bus.emit({ type: 'journal.entree', entree: ecrite });
}

/**
 * VERSE DANS LA RÉFLEXION LA PHRASE ÉCRITE DEPUIS L'ACTION PRÉCÉDENTE.
 *
 * Appelée à chaque action annoncée par le moteur : le morceau de texte en
 * cours se referme, s'écrit au journal comme « Note de l'agent »
 * (`JALON_NOTE_DE_L_AGENT`) — donc à son rang, juste avant l'action qui le
 * suit — et un morceau neuf s'ouvre. Une action qui suit une action ne verse
 * rien. Le texte entier du tour, lui, ne bouge pas : c'est ce qui s'affiche en
 * direct.
 */
function verserLaNoteAvantLAction(agentId: string, run: LiveRun): void {
  const note = noteAvantLAction(run.morceauxDuTexte[run.morceauxDuTexte.length - 1] ?? '');
  if (!note) return;
  const rang = run.morceauxDuTexte.length - 1;
  run.morceauxDuTexte.push('');
  journaliserDansLeTour(agentId, {
    cle: `note:${rang}`,
    nature: 'jalon',
    libelle: JALON_NOTE_DE_L_AGENT,
    resultat: note,
  });
}

/** Ce qu'un appelant peut demander d'écrire : la carte et la phase sont déduites. */
type AjoutJournalDuTour = Omit<AjoutJournal, 'cardId' | 'phase' | 'agentId' | 'agentRole'> & {
  phase?: PhaseJournal;
  /** Repère d'unicité : un événement réémis par le moteur n'écrit qu'une ligne. */
  cle?: string;
};

/**
 * LA DEMANDE OUVRE LE PARCOURS DE LA CARTE, DÈS SON ARRIVÉE.
 *
 * Elle était écrite après le lancement du moteur, donc après le relevé des
 * quotas, l'ouverture de la copie de travail et la composition du contexte :
 * l'écran d'une carte — dont la conversation EST son parcours — restait vide
 * pendant tout ce temps, et définitivement vide si la préparation tombait en
 * route. Elle s'écrit donc à la seconde où la phrase est enregistrée, avant
 * qu'aucun travail ne commence.
 *
 * `journaliserDansLeTour` ne convient pas ici : elle lit le tour VIVANT pour
 * connaître la carte et la phase, et il n'y a pas encore de tour. On écrit donc
 * directement, avec la carte de l'agent et la phase de sa carte. La ligne n'a
 * pas d'identifiant de tour — le tour n'existe pas encore — ce qui est exact :
 * la demande précède le tour, elle ne lui appartient pas.
 *
 * Ce qui est gardé est le texte de l'utilisateur TEL QU'IL L'A ÉCRIT, jamais le
 * prompt envoyé au moteur (mémoire, consigne et cadre en plus), qui se lit dans
 * « Contexte envoyé ». LES PIÈCES JOINTES VOYAGENT AVEC : sans elles, une
 * capture déposée avec la phrase n'apparaissait nulle part (`VueDemande`,
 * `contenu-journal.tsx`).
 */
function journaliserLaDemande(agent: Agent, demande: Message): void {
  if (!agent.cardId) return;
  if (demande.role !== 'user' || !demande.content?.trim()) return;
  const ecrite = ajouterAuJournal({
    cardId: agent.cardId,
    phase: phaseDeLaCarte(agent.cardId, agent.role),
    nature: 'jalon',
    libelle: 'Demande',
    agentId: agent.id,
    agentRole: agent.role,
    resultat: demande.content,
    at: demande.createdAt,
    donnees: {
      messageId: demande.id,
      ecriteLe: demande.createdAt,
      pieces: demande.attachments?.length ? demande.attachments : undefined,
    },
  });
  if (ecrite) bus.emit({ type: 'journal.entree', entree: ecrite });
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
export function suivreLeService(agentId: string): (handle: EngineHandle) => void {
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

/**
 * Un moteur de service de cet agent répond-il encore ? Un numéro inconnu (pas
 * encore posé) compte pour vivant : le service vient d'être inscrit.
 */
function serviceVivant(agentId: string): boolean {
  for (const handle of moteursDeService.get(agentId) ?? []) {
    if (!handle.pid || processusVivant(handle.pid)) return true;
  }
  return false;
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
  /*
   * UN TOUR RÉUSSI S'ÉCRIT SUR SA CARTE : cadrage, plan ou travail, c'est cet
   * instant qui allume la pastille « rendu non consulté »
   * (`shared/src/travail-rendu.ts`). Seul le PASSAGE à « done » compte — un
   * agent déjà fini qu'on réécrit ne rallume rien.
   */
  if (status === 'done' && agent.status !== 'done' && updated.cardId) {
    try {
      const carte = store.marquerRendu(updated, updated.endedAt ?? Date.now());
      if (carte) bus.emit({ type: 'card.upsert', card: carte });
    } catch (err) {
      log.warn('instant du rendu non écrit sur la carte', err);
    }
  }
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
  /**
   * CE QUI S'ÉCRIT JUSTE APRÈS LA DEMANDE. Le jalon « Plan demandé » de
   * l'interrupteur « Plan » (`annoncerPlanDuMemeTour`, `server/src/ws.ts`) se
   * notait AVANT la ligne « Demande » du même message : le passage du plan
   * s'ouvrait alors au-dessus de la demande qui le provoque, dans l'itération
   * précédente. Appelé une seule fois, derrière `journaliserLaDemande` — ou
   * aussitôt quand rien n'est écrit (demande silencieuse, reprise, file).
   */
  apresLaDemande?: () => void;
  /**
  /**
   * CE TOUR POURSUIT UN TRAVAIL COUPÉ — il ne commence rien.
   *
   * Le drapeau `poursuite` commande la façon dont le tour hérite du tour
   * d'avant : c'est lui qui recopie la liste de tâches du dernier tour qui en
   * portait une (`tachesReprises`). Il ne se levait que sur un compte imposé,
   * c'est-à-dire au clic « Avec quel compte poursuivre ? ». Une relance après
   * ERREUR passait donc à côté : l'agent repartait avec une liste vide, et
   * l'écran perdait sept étapes sur huit sous les yeux de l'utilisateur
   * (constaté le 06/09/2026).
   *
   * Il se pose depuis les chemins qui REPRENNENT — relance après erreur —, et
   * jamais sur un tour neuf ni sur le renvoi d'une demande perdue, qui doivent
   * repartir propres.
   */
  poursuite?: boolean;
  /**
   * LA REPRISE QUE CE TOUR CONSOMME : le message du tour coupé par une limite.
   * Voyage avec la demande, en file comprise ; la file jette une reprise déjà
   * consommée ou abandonnée (`purgerLesReprisesMortes`), et le tour qui part la
   * marque consommée dès que le moteur est lancé.
   */
  repriseDe?: string;
  attachments?: string[];
  /**
   * LA BULLE DE CETTE DEMANDE EXISTE DÉJÀ : voici son identifiant.
   *
   * Une demande est enregistrée et affichée dès son arrivée, avant même qu'on
   * sache si un compte peut la prendre. Faute de quota, elle retombe en file et
   * repartira plus tard — mais son message, lui, est déjà écrit et déjà lu. Ce
   * tour-là le REPREND ; sans ce repère, la même phrase s'affichait deux fois.
   */
  messageDejaEcrit?: string;
  /**
   * QUI DEMANDE, pour le rangement de la carte (`colonneAuDemarrage`). Par
   * défaut, un appel silencieux est automatique et un message écrit est humain.
   * Le rattrapage d'une carte écartée le pose en toutes lettres : c'est
   * l'exception écrite à « À déployer ne se rouvre que sur geste humain »
   * (`shared/src/rattrapage-ecartee.ts`) — la carte repasse « En cours » pendant
   * que son agent réconcilie, puis revient par le parcours normal.
   */
  demandeur?: Demandeur;
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
  passagesMode?: SentContextEtat['passagesMode'];
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
  passagesMode?: SentContextEtat['passagesMode'];
  passagesPertinents?: boolean;
  sentAt?: number;
}): SentContextEtat {
  const entier = input.enteteEntier ?? input.nouvelleSession;
  return SentContextEtat.parse({
    engine: input.engine,
    model: input.model,
    session: input.nouvelleSession ? 'new' : 'resumed',
    prompt: input.prompt,
    systemInstruction: {
      kind: entier ? 'full' : 'reminder',
      content: input.systemPrompt,
      // Claude porte cette consigne dans une option séparée ; Codex la place
      // devant le prompt. Le tiroir peut ainsi décrire le transport exact.
      transport: consigneEnTeteDeSession(input.engine) ? 'separate' : 'prefixed',
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
        cached: consigneEnTeteDeSession(input.engine) && !input.nouvelleSession,
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
export function replacerCarteAuDemarrage(agent: Agent, demandeur: Demandeur = 'automatique'): void {
  if (!agent.cardId) return;
  const carte = store.getCard(agent.cardId);
  if (!carte) return;
  /*
   * PLUS AUCUN RANGEMENT LIÉ AU CADRAGE : une carte discutée ne bouge pas du
   * tableau, ni au départ du plan ni à l'affinage qui suit. Ce qui change de
   * place, c'est l'étape courante du PARCOURS (`etapeCourante`), lue dans le
   * flux de la carte — pas la carte elle-même.
   */
  const cible = colonneAuDemarrage(carte.column, agent.role, demandeur);
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
    /*
     * UNE PHRASE DU TOUR PRÉCÉDENT NE SURVIT PAS AU TOUR SUIVANT.
     *
     * Le cas qui faisait mentir la carte : l'agent pose une question, la carte
     * RESTE en « Travail » avec « La tâche attend votre réponse »
     * (`RAISON_ATTEND_VOTRE_REPONSE`). On répond, le tour repart — mais comme
     * la carte ne CHANGE PAS de colonne, on passait ici, où seule la marque de
     * vol était posée. La barre jaune restait donc affichée pendant tout le
     * tour suivant, et pour toujours si ce tour tombait : un message d'attente
     * sans objet, alors que plus rien n'attendait de réponse.
     *
     * La branche d'à côté (celle qui déplace la carte) efface déjà cette
     * phrase ; il n'y avait aucune raison que celle-ci ne le fasse pas.
     */
    const phraseAEffacer = enVol && carte.sansModification !== undefined;
    const marqueAPoser = enVol && !carte.scheduling?.tourEnVolDepuis;
    // Rien à déplacer, rien à effacer : on ne touche pas au reste de la carte —
    // une carte rangée dans une fin de parcours n'a pas à voir sa date de
    // clôture ni sa suspension effacées par un simple tour de suite.
    if (!phraseAEffacer && !marqueAPoser) return;
    const marquee = store.saveCard({
      ...carte,
      ...(phraseAEffacer ? { sansModification: undefined } : {}),
      scheduling: {
        ...(carte.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
        ...(marqueAPoser ? { tourEnVolDepuis: Date.now() } : {}),
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
    // Une carte qu'on relance depuis une fin de travail (« À déployer ») a
    // DÉJÀ produit du code : on grave le drapeau qui empêchera un tour de
    // suite muet de rallumer « aucun fichier n'a changé ». C'est aussi ce qui
    // rattrape les cartes abouties avant l'existence du drapeau.
    codeDejaEnregistre: carte.codeDejaEnregistre || carte.column === 'to_deploy',
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
 * LE POST-TRAITEMENT D'UNE DEMANDE MISE EN FILE, le temps qu'elle en ressorte.
 *
 * `onComplete` est une fonction : elle ne s'écrit pas en base avec le reste de
 * la demande. Elle attend donc ici, sous le nom de l'élément empilé, et le
 * dépilage la lui rend. Un redémarrage du démon la perd — la demande, elle,
 * survit —, et c'est le seul morceau d'identité qui ne passe pas le disque.
 */
const posterTraitementEnAttente = new Map<string, NonNullable<PromptOptions['onComplete']>>();

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
  purgerLesReprisesMortes(agentId);
  const next = store.dequeuePrompt(agentId);
  bus.emit({ type: 'queue.etat', agentId, queue: store.listQueue(agentId) });
  if (!next) return;
  const onComplete = posterTraitementEnAttente.get(next.id);
  posterTraitementEnAttente.delete(next.id);
  setTimeout(() => {
    /* Une demande déjà écrite (retombée en file faute de quota) repart avec sa
       bulle : le tour la reprend, il n'en crée pas une seconde. Et elle repart
       telle qu'elle est ARRIVÉE : silencieuse si elle l'était, sur le compte
       qui lui avait été imposé — sans quoi une reprise après épuisement
       repartirait sur le compte que la limite vient de fermer. */
    sendPrompt(agentId, next.text, {
      attachments: next.attachments,
      messageDejaEcrit: next.messageId,
      silent: next.silencieuse || undefined,
      compteImpose: next.compteImpose,
      poursuite: next.poursuite || undefined,
      repriseDe: next.repriseDe,
      onComplete,
    }).catch((err) => log.error('enchaînement de file impossible', err));
  }, 400);
}

/**
 * UNE REPRISE NE SE REJOUE JAMAIS VERS UN TOUR DÉJÀ TERMINÉ.
 *
 * La demande de reprise attend en file, comme toute demande écrite pendant
 * qu'un agent travaille. Mais elle n'a de sens qu'UNE fois : dès que son tour
 * de reprise a été lancé (`consommeeA`), ou que la décision a été abandonnée,
 * la consigne « REPRISE APRÈS ÉPUISEMENT DU QUOTA » n'a plus rien à reprendre.
 * Rejouée — après un redémarrage du démon, ou parce que deux relèves s'étaient
 * empilées —, elle ouvrait un tour de plus sur un travail déjà rendu, et
 * l'agent répondait « rien de nouveau à faire » : constaté le 06.09.2026,
 * quatre fois sur la même carte.
 */
function purgerLesReprisesMortes(agentId: string): number {
  let purgees = 0;
  for (const demande of store.listQueue(agentId)) {
    if (!demande.repriseDe) continue;
    const reprise = store.getMessage(demande.repriseDe)?.repriseCompte;
    const morte = !reprise || !!reprise.consommeeA || !!reprise.abandonnee;
    if (!morte) continue;
    store.removeQueued(demande.id);
    posterTraitementEnAttente.delete(demande.id);
    purgees += 1;
    log.info(`reprise déjà ${reprise?.abandonnee ? 'abandonnée' : 'consommée'} retirée de la file (agent ${agentId})`);
  }
  if (purgees) bus.emit({ type: 'queue.etat', agentId, queue: store.listQueue(agentId) });
  return purgees;
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
  for (const agent of store.agentsAvecFileEnAttente()) {
    if (live.has(agent.id) || demarrant.has(agent.id)) continue;
    if (!store.listQueue(agent.id).length) continue;
    // Une reprise déjà consommée n'attend aucun quota : elle est jetée AVANT
    // qu'on cherche un compte pour elle — y compris au premier passage après
    // un redémarrage du démon.
    purgerLesReprisesMortes(agent.id);
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
   * L'AGENT DE « RÉSOUDRE LE PROBLÈME » GARDE SON MOTIF À CHAQUE TOUR : une
   * réponse tapée plus tard dans son tiroir n'en porte aucun, et il recevrait
   * sinon la consigne de l'agent de configuration — la consigne système ne
   * change pas d'un tour à l'autre dans une même session.
   */
  if (!options.motif && agent.depannagePublication) options = { ...options, motif: 'depannage-manuel' };
  /*
   * L'AGENT MARKETING GARDE SA CONSIGNE ET SON OUTIL d'un tour à l'autre : une
   * phrase tapée plus tard dans l'écran Marketing n'a pas de motif, et la
   * consigne système ne change pas dans une même session (`server/src/marketing.ts`).
   */
  const agentMarketing = estAgentMarketing(agentId);
  if (!options.motif && agentMarketing) options = { ...options, motif: 'configuration-marketing' };

  /*
   * NI PENDANT SA PUBLICATION. Le même verrou que la commande du client
   * (`agent.prompt`), redit ici pour tout autre chemin humain : un message
   * relancerait l'agent sur la branche qu'on est en train de pousser. Les
   * demandes silencieuses du démon et le conducteur de publication passent.
   */
  if (
    !options.silent &&
    agent.role !== 'deploy' &&
    carteEnPublication(store.latestDeploy(agent.projectId), agent.cardId)
  ) {
    bus.toast('warning', TEXTE_CARTE_EN_PUBLICATION);
    return;
  }

  /*
   * UNE CARTE DÉJÀ DÉPLOYÉE NE SE MODIFIE PAS SUR PLACE. Un message humain
   * tapé dans une conversation archivée relancerait le même agent, sur la
   * même branche déjà mise en ligne — donc un travail réécrit après coup, sans
   * passer par la revue ni par une nouvelle mise en ligne. Le message ouvre
   * donc une NOUVELLE carte (`ouvrirUneNouvelleCarteDepuis`), qui suit tout le
   * parcours ; l'ancienne reste intacte. L'ancien refus n'existe plus.
   * Le verrou de publication, plus haut, passe AVANT : aucune carte n'est créée
   * pendant une mise en ligne.
   */
  if (!options.silent && agent.cardId) {
    const carte = store.getCard(agent.cardId);
    // L'agent marketing ne livre aucun code : sa carte rangée avec un lot publié ne le rend pas muet.
    if (carte && messageOuvreUneNouvelleCarte(carte) && !agentMarketing) {
      const { ouvrirUneNouvelleCarteDepuis } = await import('./cadrage.js');
      await ouvrirUneNouvelleCarteDepuis(agentId, text, options.attachments ?? []);
      return;
    }
  }

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
    const queued = store.enqueuePrompt(agentId, text, options.attachments ?? [], options.messageDejaEcrit, {
      silencieuse: options.silent,
      compteImpose: options.compteImpose,
      poursuite: options.poursuite,
      repriseDe: options.repriseDe,
    });
    if (!queued) {
      bus.toast('warning', "Dix demandes en attente au maximum : celle-ci n'a pas été ajoutée.");
      return;
    }
    /*
     * LA FILE NE DÉNATURE PLUS CE QU'ELLE TRANSPORTE. Elle ne gardait qu'un
     * texte : une demande INTERNE en ressortait comme un message tapé par
     * l'utilisateur, sur le compte du choix automatique. C'est par ici que
     * passe la reprise après épuisement — la fin d'un tour se joue DANS sa
     * préparation, donc l'agent est encore marqué occupé quand elle part —, et
     * elle y perdait le compte choisi comme son silence : le tour repartait sur
     * le compte à sec, retombait sur la même limite, et reposait la même
     * question. Le post-traitement, lui, ne peut pas s'écrire en base ; il
     * attend en mémoire, le temps que la file redonne la main.
     */
    options.apresLaDemande?.();
    if (options.onComplete) posterTraitementEnAttente.set(queued.id, options.onComplete);
    bus.emit({ type: 'queue.etat', agentId, queue: store.listQueue(agentId) });
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
   * LA DEMANDE S'ENREGISTRE ET S'AFFICHE AVANT TOUT LE RESTE.
   *
   * Elle s'écrivait après le choix du compte, et sa ligne dans le parcours de
   * la carte n'était posée qu'une fois le MOTEUR lancé — soit, dans l'ordre :
   * relever les quotas de chaque compte (une lecture par compte, espacées de
   * 1,5 s), ouvrir la copie de travail (`git worktree`), composer le contexte,
   * démarrer le processus. Des dizaines de secondes pendant lesquelles l'écran
   * restait vide : on venait d'envoyer une phrase, et rien ne prouvait qu'elle
   * était partie. Quand la préparation tombait en route, elle ne s'affichait
   * même JAMAIS — il fallait redémarrer le démon et recharger l'application
   * pour la voir enfin.
   *
   * Elle est donc écrite ICI, à la seconde où elle arrive : la bulle, la ligne
   * « Demande » du parcours et le titre éclair de la carte partent ensemble aux
   * écrans, et le moteur ne se lance qu'ensuite.
   *
   * `messageDejaEcrit` dit qu'elle a déjà été écrite lors d'un passage
   * précédent — une demande revenue de la file faute de quota : on la reprend,
   * on ne la redit pas.
   */
  let userMessageId: string | undefined = options.messageDejaEcrit;
  if (!options.silent && !userMessageId) {
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
    journaliserLaDemande(agent, userMessage);
    options.apresLaDemande?.();
    /*
     * LE TITRE DE LA CARTE SE POSE ICI, AVANT MÊME QUE LE MOTEUR NE PARTE.
     *
     * Il était généré à la FIN du tour : la carte s'appelait « Nouvelle tâche »
     * pendant toute la réflexion de l'agent — souvent une minute ou deux, à
     * l'écran, sur la carte qu'on vient d'ouvrir. Or ce titre ne demande RIEN à
     * personne : il se lit dans la phrase que l'utilisateur vient d'envoyer.
     * On le pose donc à la seconde où elle arrive, sans un jeton.
     *
     * Il est marqué PROVISOIRE (`titreProvisoire`) : il tient la place, mais
     * l'agent de cadrage doit toujours écrire le sien au temps 2, et le sien
     * remplacera celui-ci (`titreDeCarteADonner`).
     */
    if (agent.role === 'cadrage' && agent.cardId) {
      const carteANommer = store.getCard(agent.cardId);
      if (carteANommer && titreEncoreVide(carteANommer.title)) {
        const eclair = titreEclairDeLaDemande(text);
        if (eclair && eclair !== carteANommer.title) {
          const nommee = store.saveCard({ ...carteANommer, title: eclair, titreProvisoire: true });
          bus.emit({ type: 'card.upsert', card: nommee });
        }
      }
    }
  } else {
    options.apresLaDemande?.();
  }

  /*
   * LE COMPTE SE CHOISIT AVANT TOUT LE TRAVAIL — avant la carte déplacée, avant
   * le contexte. Seule l'écriture de la demande passe désormais devant lui :
   * elle ne coûte rien, elle ne déplace rien, et l'écran l'attend.
   *
   * Le fil du moteur vit dans le COFFRE du compte : changer de compte, c'est
   * repartir d'une conversation vide, que ce soit sur bascule automatique ou
   * après une reprise pour limite atteinte. Or c'est plus bas que se décide ce
   * qu'on envoie — briefing entier ou simple message de suite. Choisir le
   * compte après, comme autrefois, revenait à préparer un message de suite pour
   * un fil qui n'existait pas : le moteur refusait le `--resume`, et le travail
   * en cours était perdu au lieu d'être poursuivi.
   *
   * ET IL SE CHOISIT DEVANT LA CARTE, pas seulement devant le contexte. Sans
   * quota, le tour ne partait JAMAIS — mais la carte était déjà remontée en
   * « En cours » avec sa marque de vol, et la demande, elle, purement PERDUE.
   * Cinq minutes plus tard, le balayage des cartes oubliées la fermait en
   * annonçant « Terminé » un travail que personne n'avait fait. Rien n'est donc
   * DÉPLACÉ tant qu'on ne sait pas qu'un moteur peut partir.
   *
   * Un compte IMPOSÉ passe devant : il vient d'un choix humain, revérifié à
   * l'instant du clic. Le choix automatique retomberait sur le compte à sec,
   * puisqu'il classe par priorité.
   */
  /*
   * LA RÈGLE DU COMPTE D'UN TOUR VIT DANS `shared` (`compteDuTour`,
   * `shared/src/compte-du-tour.ts`) : imposé, réglé, dernier compte de l'agent
   * tant qu'un compte mieux classé est à sa LIMITE CONNUE, sinon la
   * répartition — hors des comptes à limite connue. C'est ce qui fait tenir un
   * compte d'un tour à l'autre : sans elle, chaque tour ordinaire repartait sur
   * le compte qui venait de tomber, tombait, et une relève repartait.
   */
  const candidats = listAccountRecords().filter((a) => a.engine === agent.run.engine);
  const decision = compteDuTour({
    engine: agent.run.engine,
    impose: options.compteImpose,
    regle: agent.run.account,
    dernier: agent.account,
    comptes: candidats.map((a) => ({ id: a.id, engine: a.engine, plan: a.plan, priority: a.priority, disabled: a.disabled })),
    limites: limitesConnues(),
    now: Date.now(),
  });
  // Un compte demandé qu'on ne peut pas tenir — introuvable, coupé, ou à sa
  // limite connue — se DIT : cela ne se déduit plus d'un écran qui boucle.
  if (decision.refuse) {
    log.warn(
      `compte « ${decision.refuse.compte} » demandé pour l'agent ${agentId} (moteur ${agent.run.engine}) ` +
        `${decision.refuse.raison === 'limite-connue' ? 'à sa limite connue' : decision.refuse.raison} : ` +
        `ce tour part sur ${decision.compte ? `« ${decision.compte} »` : 'le choix automatique'}`,
    );
  }
  const compteImpose = decision.raison === 'impose' ? candidats.find((a) => a.id === decision.compte) : undefined;
  const compteRetenu = decision.compte ? candidats.find((a) => a.id === decision.compte) : undefined;
  if (decision.raison === 'dernier' && compteRetenu) {
    log.info(
      `compte retenu d'un tour à l'autre : ${compteRetenu.label} (agent ${agentId}) — ` +
        `${decision.ecartes.join(', ')} à sa limite connue`,
    );
  }
  const account = compteRetenu ?? (await pickAccount(agent.run.engine));
  if (!account) {
    /*
     * LA DEMANDE N'EST PAS PERDUE : ELLE ATTEND EN FILE. C'est la file ordinaire
     * de l'agent, celle qui repart d'elle-même dès qu'il se tait — ici, dès
     * qu'un compte redevient disponible (`reprendreLesFilesEnAttente`, rejouée
     * par le filet de veille toutes les quinze secondes). SA BULLE EST DÉJÀ
     * ÉCRITE ET DÉJÀ LUE : la demande s'affiche à son arrivée, bien avant qu'on
     * sache si un compte la prendra. La file emporte donc son identifiant
     * (`messageId`), et le tour qui la dépilera reprendra ce message-là au lieu
     * d'en écrire un second.
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
    const enFile = parLaFile && store.enqueuePrompt(agentId, text, options.attachments ?? [], userMessageId);
    if (enFile) bus.emit({ type: 'queue.etat', agentId, queue: store.listQueue(agentId) });
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


  /*
   * La carte quitte sa colonne d'arrivée AVANT qu'on écrive la demande : le
   * bloc de contexte qui suit doit annoncer à l'agent la colonne où il repart.
   *
   * `!options.silent` marque le GESTE HUMAIN : ce texte-là est un message que
   * l'utilisateur vient d'écrire dans la conversation, et non un appel interne
   * du démon. C'est lui, et lui seul, qui ressort une carte de « À déployer »
   * pour la remettre « En cours » (`colonneAuDemarrage`).
   */
  replacerCarteAuDemarrage(agent, options.demandeur ?? (options.silent ? 'automatique' : 'humain'));

  const card = agent.cardId ? store.getCard(agent.cardId) : null;
  const template: TemplateKind =
    options.template ??
    /* LE CADRAGE EST UNE CONVERSATION, PAS UN COMPTE RENDU. Le gabarit de sa
       colonne (« Planifié » → `pre_run`) réclamerait six titres et un chiffrage
       à un agent qui n'a pas ouvert le projet : on ne lui impose donc aucune
       forme. */
    (agent.role === 'cadrage' ? 'none' : templateForColumn(card?.column, !!card?.deployedAt));

  /*
   * La mémoire du projet part EN ENTIER au lancement d'une session — nouvelle
   * tâche, nouveau cadrage, changement de moteur. Ensuite l'agent l'a
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
   * Ce qui part désormais, ce sont les PISTES de la mémoire en classeurs : les
   * titres des fiches que la recherche locale rattache à la carte, et rien sous
   * le seuil de pertinence. L'agent OUVRE ensuite ce qui le concerne avec
   * l'outil « memoire ».
   */
  const memoireALAccueil = partsDAccueil(niveau).memoire;

  /*
   * LE BRIEFING D'EXÉCUTION SUIT LA PHASE, PAS SEULEMENT LA SESSION. L'agent de
   * cadrage devenu agent d'exécution reprend son propre fil : sa session n'est
   * pas neuve, mais il n'a jamais reçu le briefing d'un agent qui code (dossier
   * de travail, fichiers d'instructions, compétences). Il le reçoit une fois,
   * au premier tour d'exécution (`briefingDExecutionAttendu`).
   */
  const briefingDePhase = !nouvelleSession && agent.role === 'task' && agent.briefingDExecutionAttendu === true;
  if (agent.briefingDExecutionAttendu) {
    const servi = store.getAgent(agent.id);
    if (servi) store.saveAgent({ ...servi, briefingDExecutionAttendu: undefined });
  }
  if (nouvelleSession || briefingDePhase) {
    // Le briefing (chemin du projet, fichiers d'instructions, compétences)
    // n'a de sens qu'au premier tour : ensuite l'agent l'a en contexte. L'index
    // de la mémoire voyage à part (`kind: 'memory'`) : c'est ce qui permet au
    // tiroir « Contexte envoyé » de distinguer mémoire et reste du briefing.
    const travailDeLaCarte = card ? `${card.title}\n${card.description}` : '';
    const { sansMemoire, socle } = briefingSepare(
      project.path,
      project.name,
      true,
      agent.run.engine,
      agent.workdir,
      niveau,
      // Le POOL DE COMPÉTENCES est servi au poids du travail de la carte : les
      // fiches qui en parlent sont nommées, les autres comptées.
      travailDeLaCarte,
      // …et d'abord selon le juge local, quand il est éveillé et allumé.
      card && partsDAccueil(niveau).competences
        ? await competencesPertinentes(travailDeLaCarte, { cardId: card.id, projectId: project.id })
        : undefined,
    );
    contextParts.push({
      label: niveau === 'minimal' ? 'Briefing réduit (dépannage)' : 'Briefing du projet',
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
    /*
     * LA BASE DE CONNAISSANCES À CHAQUE COMPRÉHENSION. L'accueil part d'office :
     * la tête du projet (00_project), ce qu'il ne faut jamais supposer, les
     * unités P0 et P1, et le changelog récent — ce qui a déjà été fait —, sous un
     * plafond mesuré. Au-dessus, des PISTES : les identifiants d'autres unités
     * que la recherche locale rattache à la carte, et rien sous le seuil de
     * pertinence. Tout voyage avec le premier message, jamais dans la consigne
     * système, qui reste stable.
     */
    if (card && niveau !== 'minimal') {
      // L'accueil de la base est déjà dans le fil d'un cadrage devenu exécution.
      const accueil = nouvelleSession ? accueilDesConnaissances(project.id, project.name) : null;
      if (accueil) {
        contextParts.push({ label: 'Base de connaissances — accueil', kind: 'memory', origine: 'projet', content: accueil });
        memoryAndInstructionsCharacters += accueil.length;
      }
      /* Les pistes passent au tri du juge local : une piste franchement hors
         sujet ne vaut pas les signes qu'elle coûte. Sans avis, toutes restent. */
      const pistes = texteDesPistes(
        await garderLesPertinents(
          travailDeLaCarte,
          await pistesDesConnaissances(project.id, travailDeLaCarte),
          {
            cle: (t) => t.unite.id,
            texte: (t) => `${t.unite.titre} — ${t.unite.resume}`,
            intouchable: (t) => t.unite.importance === 'P0' || t.unite.jamaisSupposer,
          },
          { usage: 'pertinence-memoire', cardId: card.id, projectId: project.id },
        ),
      );
      if (pistes) {
        contextParts.push({ label: 'Pistes de la base de connaissances', kind: 'memory', origine: 'projet', content: pistes });
        memoryAndInstructionsCharacters += pistes.length;
      }
    }
  }
  if (nouvelleSession) {
    // Session neuve : l'agent repart d'un contexte vide — plus rien de ce qui
    // lui a été servi avant n'y est. On oublie ce qu'il a lu, sinon une reprise
    // se retrouverait privée de la mémoire qu'elle n'a plus.
    oublierLesLectures(agent.id);
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
       * Une conversation ne s'arrête jamais, mais son fil côté moteur repart à
       * neuf pour trois fois rien : une session expirée chez le fournisseur
       * (« No conversation found »), un modèle ou un moteur changé dans les
       * réglages. Le tour suivant partait alors avec le SEUL message qu'on
       * venait d'écrire — et « reprends ce qu'on disait » ne désigne plus rien.
       * L'agent redemandait de quoi on parlait, alors que le sujet s'affichait
       * deux lignes plus haut à l'écran.
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
  }

  /*
   * LA CONSIGNE D'ESPACE DE L'AGENT BRIDÉ PART À CHAQUE TOUR, JAMAIS AU SEUL PREMIER.
   *
   * Elle était posée dans le bloc « session neuve » : une conversation ouverte
   * il y a des jours ne l'avait donc JAMAIS reçue, et gardait les croyances de
   * son premier tour — celles du temps du bac à sable. Constaté le 11/08/2026 :
   * un agent d'une session vieille de neuf jours expliquait à l'utilisateur que
   * « le projet et le dossier servi sont en lecture seule pour moi », alors que
   * l'accès complet était en place depuis le matin. Le code d'un moteur change,
   * pas le souvenir d'une session : ce qui dit à l'agent ce qu'il PEUT faire
   * doit donc repartir à chaque tour. Elle tient en 1 570 signes, moins de 400
   * jetons — le prix d'un agent qui refuse un geste qu'on lui a ouvert est plus
   * élevé.
   */
  if (agent.role === 'cadrage') {
    const scratch = path.join(PATHS.cadrageScratch, project.id);
    const espace = consigneEspaceDeCadrage(scratch, project.path);
    // L'espace de l'agent bridé est une mécanique de la plateforme, la même partout.
    contextParts.push({ label: 'Espace de travail du cadrage', kind: 'extra', origine: 'plateforme', content: espace });
    /* UN PROJET RÉUNI : le cadrage apprend ses membres, leurs dépôts, et qu'il
       doit nommer les projets touchés (`server/src/regroupements.ts`). */
    const reuni = consigneDuCadrageReuni(project.id);
    if (reuni) contextParts.push({ label: 'Projet réuni', kind: 'extra', origine: 'plateforme', content: reuni });

    /*
     * QUESTION OU TRAVAIL : UNE INDICATION, JAMAIS UNE DÉCISION. Tant que rien
     * n'est compris sur la carte, le juge local dit à quoi ressemble le
     * message de l'utilisateur ; le cadrage garde les DEUX fins (répondre, ou
     * cadrer). Express : si Laya dort, rien n'est ajouté — et l'appel le
     * réveille pour la suite de la discussion et le lancement de la carte.
     */
    if (!options.silent && card && !card.parcours?.comprehension?.texte?.trim()) {
      const indication = await indiquerLaNatureDeLaDemande(text, { cardId: card.id, projectId: project.id });
      if (indication) contextParts.push({ label: 'Indication du juge local', kind: 'extra', origine: 'plateforme', content: indication });
    }

    /*
     * UN PLAN DÉJÀ RENDU NE RELANCE PLUS LE PLAN TOUT SEUL.
     *
     * Chaque message qui suivait une première version partait avec la consigne
     * d'AFFINER le plan, et posait la demande (`planDemandeA`) sur la carte :
     * une simple question de l'utilisateur — « pourquoi ce choix ? », « et si
     * on gardait l'ancien écran ? » — repartait donc en version suivante, sans
     * que personne ne l'ait demandé, et le tour se jugeait manqué s'il ne
     * rendait pas de plan. La consigne de plan et le drapeau ne partent
     * désormais QUE sur le clic « Générer le plan » (`plan.generer`,
     * `server/src/ws.ts`). Entre deux clics, le cadrage COMPREND : il répond,
     * questionne, et rend sa compréhension comme avant le premier plan.
     */
  }

  if (options.context) {
    contextParts.push({ label: 'Contexte ajouté par Beluga Build', kind: 'extra', origine: 'plateforme', content: options.context });
  }
  /*
   * LE MODE « CRÉATION », RELU À CHAQUE TOUR. L'interrupteur vit sur la carte
   * et peut basculer entre deux messages : sa consigne part donc avec la
   * DEMANDE, jamais dans la consigne système, qui ne change pas d'un tour à
   * l'autre d'une même session. Le cadrage comme l'exécution la reçoivent.
   */
  if (card?.parcours?.creationSouhaitee) {
    const consigneCreation = await consigneDeCreationDeLaCarte(card).catch((err) => {
      log.warn('consigne du mode Création indisponible', String((err as Error)?.message ?? err));
      return '';
    });
    if (consigneCreation) {
      contextParts.push({ label: 'Mode Création', kind: 'extra', origine: 'plateforme', content: consigneCreation });
    }
  }
  if (card) {
    const bloc = carteContexte(agent.id, card, nouvelleSession, agent.role === 'cadrage');
    if (bloc) contextParts.push({ label: 'Carte en cours', kind: 'card', origine: 'projet', content: bloc });
    /*
     * LA DERNIÈRE COMPRÉHENSION REPART AU CADRAGE, À CHAQUE TOUR.
     *
     * La compréhension est UNE valeur sur la carte, réécrite à chaque tour : un
     * cadrage qui ne se souvient plus de la précédente — contexte comprimé,
     * session neuve — n'en rendait qu'un morceau, celui du dernier message.
     * Elle lui est donc redonnée telle qu'elle est écrite, pour que la suivante
     * la COMPLÈTE (`FORME_DE_LA_COMPREHENSION`). Quelques centaines de signes,
     * et seulement pour ce rôle.
     */
    const precedente = agent.role === 'cadrage' ? card.parcours?.comprehension : undefined;
    if (precedente?.texte?.trim()) {
      const hypotheses = precedente.hypotheses?.length
        ? `\n\nHypothèses de cette compréhension :\n${precedente.hypotheses.map((ligne) => `- ${ligne}`).join('\n')}`
        : '';
      contextParts.push({
        label: 'Dernière compréhension rendue',
        kind: 'card',
        origine: 'projet',
        content:
          'DERNIÈRE COMPRÉHENSION RENDUE SUR CETTE CARTE — la prochaine la reprend EN ENTIER et y ajoute ce que ' +
          `les nouveaux messages apportent, sans rien en perdre :\n\n${precedente.texte.trim()}${hypotheses}`,
      });
    }
    /*
     * LE DERNIER PLAN REPART AU CADRAGE, MAIS SEULEMENT AU TOUR DE PLAN : la
     * compression efface vite l'ancien appel de `rendre_plan`, et la version
     * suivante doit être GLOBALE (`blocDuDernierPlan`, règle partagée).
     */
    const dernierPlan = blocDuDernierPlan({
      role: agent.role,
      planDemandeA: card.parcours?.planDemandeA,
      plans: card.parcours?.plans,
    });
    if (dernierPlan) {
      contextParts.push({ label: 'Dernier plan rendu', kind: 'card', origine: 'projet', content: dernierPlan });
    }
  }
  /*
   * LES PIÈCES JOINTES SE DÉSIGNENT PAR LEUR IDENTIFIANT COURT.
   *
   * Le chemin entier d'une image commence par son identifiant unique : trente-six
   * signes, illisibles dans le prompt, et rien ne reliait le tag
   * « [fichier: image.png] » de la phrase au fichier posé sur le disque. Chaque
   * pièce porte donc un alias PERMANENT de quelques signes, repris à l'identique
   * dans le tag du texte et dans cette liste.
   */
  const jointes = (options.attachments ?? [])
    .map((id) => store.getAttachment(id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  if (jointes.length) {
    contextParts.push({
      label: 'Pièces jointes',
      kind: 'attachment',
      origine: 'demande',
      content: blocPiecesJointes(
        jointes.map((a) => ({ alias: aliasDe(a), nom: a.name, chemin: cheminDePieceJointe(a) })),
      ),
    });
  }

  // La règle vit dans `shared/src/templates.ts` (`ampleurDuTour`) : le cran de
  // suivi ne s'applique qu'à une ampleur DÉDUITE de la demande, jamais à celle
  // qu'un lancement de carte a EXIGÉE.
  const ampleur = ampleurDuTour({ imposee: options.ampleur, kind: template, texte: text, nouvelleSession });
  const contexteAssemble = contextParts.map((part) => part.content).join('\n\n');
  // Le message ENREGISTRÉ garde son tag court ; seul celui qui part au moteur
  // porte l'identifiant de son fichier.
  const texteEnvoye = jointes.length ? tagsAvecAlias(text, jointes, tagsDuTexte(text)) : text;
  const prompt = wrapPrompt(template, texteEnvoye, contexteAssemble, {
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
      label: 'Gabarit et séparateurs Beluga Build',
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
// POURSUITE : ce tour ne commence rien, il reprend un travail coupé. Un
      // compte imposé en est un cas (le clic « Avec quel compte poursuivre ? »),
      // la relance après erreur en est un autre — elle le demande par
      // `options.poursuite` ou par `options.repriseDe`. C'est ce drapeau qui autorise le tour à garder
      // l'avancement et la liste de tâches du tour d'avant.
      poursuite: Boolean(options.repriseDe || compteImpose || options.poursuite === true),
      repriseDe: options.repriseDe,
      preparation,
      ampleurImposee: options.ampleur,
    },
    options.motif,
  );
  return false;
}

/**
 * Le bloc « carte en cours ». Entier au lancement de la session ; ensuite rien,
 * sauf si la carte a bougé — et dans ce cas une seule ligne quand seule la
 * colonne a changé.
 */
function carteContexte(
  agentId: string,
  card: Card,
  nouvelleSession: boolean,
  /**
   * L'AGENT DE CADRAGE ÉCRIT CETTE CARTE : il lui faut donc son identifiant,
   * seul argument obligatoire de `board_update_card`. Les autres rôles ne le
   * reçoivent pas — ils n'ont rien à mettre à jour, et ce serait une ligne de
   * plus à chaque tour.
   */
  ecritLaCarte = false,
): string | null {
  const entier =
    `CARTE EN COURS : « ${card.title} »\n${card.description || '(pas de description)'}\nColonne : ${card.column}.` +
    (ecritLaCarte
      ? `\nIdentifiant de cette carte, à passer à « board_update_card » : ${card.id}` +
        `\nNiveau d'exécution actuellement retenu : ${card.run?.niveau ?? '(aucun — dis-le dès que tu sais)'}`
      : '');
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
 * c'est la copie de la carte : présente, on la garde ; disparue, on la rouvre
 * sur la même branche — et ON LE DIT.
 *
 * UN DOSSIER DISPARU N'EST PAS UN DÉTAIL D'INTENDANCE. Le 06/09/2026, le
 * nettoyage du disque a retiré la copie d'une carte EN TRAIN de travailler : le
 * moteur est mort sur un « spawn claude ENOENT », l'écran a dit « Le moteur a
 * échoué », et personne n'a su pourquoi. La copie était bel et bien rouverte au
 * tour suivant — silencieusement, dans un `log.warn` que seul le serveur lit.
 * La réouverture s'écrit donc dans le journal de la carte, avec la branche
 * retrouvée et son dernier enregistrement : c'est la vraie histoire de la
 * carte, pas une panne de moteur.
 *
 * ET ON NE RETOMBE PLUS SUR LE DOSSIER DU PROJET. Une carte dont la copie ne se
 * rouvre pas repartait dans le dossier PARTAGÉ du projet, donc sur sa branche
 * de déploiement : l'agent y aurait travaillé par-dessus « dev », hors de toute
 * branche de carte. Mieux vaut ARRÊTER le tour en disant pourquoi — la décision
 * « Relancer / Ignorer / Arrêter » est posée, le triangle orange s'allume — que
 * de laisser un agent écrire au mauvais endroit.
 */
async function dossierDuTour(agent: Agent, project: Project): Promise<string> {
  if (!agent.workdir) return project.path;
  if (fs.existsSync(agent.workdir)) return agent.workdir;
  const card = agent.cardId ? store.getCard(agent.cardId) : null;
  // Un agent SANS carte n'a pas de branche à retrouver : le dossier du projet
  // est bien le sien, il n'y a rien à recréer.
  if (!card) return project.path;

  const disparu = agent.workdir;
  const ouvert = await ouvrirDossierDeCarte(project.path, card, project.branchesDePublication).catch(
    (err) => {
      log.error('réouverture du dossier de la carte impossible', err);
      return null;
    },
  );

  if (!ouvert || ouvert.kind === 'echec') {
    const detail = ouvert && ouvert.kind === 'echec' ? ouvert.raison : 'git n’a pas rendu la copie';
    const raison =
      `La copie de travail de cette carte a disparu (${disparu}) et n’a pas pu être recréée : ` +
      `${detail}. Le tour s’arrête ici : reprendre dans le dossier partagé du projet ferait ` +
      `travailler l’agent hors de la branche de la carte.`;
    log.error(raison);
    journaliserLaCopieRecreee(agent, card, { texte: raison, reussie: false });
    direLeBlocage(agent.id, raison);
    throw new Error(raison);
  }

  if (ouvert.dossier !== agent.workdir) store.saveAgent({ ...agent, workdir: ouvert.dossier });

  const dernier = (await sortieGit(ouvert.dossier, ['log', '-1', '--format=%h %s'])) ?? '';
  journaliserLaCopieRecreee(agent, card, {
    texte:
      `La copie de travail de cette carte avait disparu (${disparu}) : elle a été recréée sur la ` +
      `branche « ${ouvert.branche} »` +
      (dernier.trim() ? `, dernier enregistrement « ${dernier.trim()} ».` : '.') +
      ' Rien du travail enregistré n’est perdu.',
    reussie: true,
  });
  return ouvert.dossier;
}

/**
 * LES COPIES DES DÉPÔTS ANNEXES de ce tour (`copies-des-depots.ts`), rouvertes
 * au besoin sur la branche de la carte. Vide pour un projet à dépôt simple, pour
 * un agent sans carte, et pour un agent qui travaille à même le dossier du projet.
 * Une copie qui ne se rouvre pas ARRÊTE le tour en se nommant, exactement comme
 * la copie principale : un agent ne travaille pas avec une partie du projet en
 * moins sans le savoir.
 */
async function copiesAnnexesDuTour(agent: Agent, project: Project, dossier: string): Promise<CopieAnnexe[]> {
  if (!project.depots?.length || !agent.cardId || dossier === project.path) return [];
  if (agent.role !== 'task' && agent.role !== 'analysis') return [];
  const card = store.getCard(agent.cardId);
  if (!card) return [];
  const ouvertes = await ouvrirLesCopiesAnnexes(project, card);
  if (ouvertes.kind === 'echec') {
    const raison =
      `Une copie de travail d’un dépôt annexe n’a pas pu être ouverte — ${ouvertes.raison}. ` +
      'Le tour s’arrête ici : l’agent aurait travaillé avec une partie du projet en moins.';
    log.error(raison);
    journaliserLaCopieRecreee(agent, card, { texte: raison, reussie: false });
    direLeBlocage(agent.id, raison);
    throw new Error(raison);
  }
  return ouvertes.copies;
}

/**
 * La ligne que la carte garde d'une copie de travail disparue. Elle s'écrit
 * AVANT le tour — il n'y a pas encore de tour vivant, donc pas de
 * `journaliserDansLeTour` : on écrit directement, comme le fait la demande.
 */
function journaliserLaCopieRecreee(
  agent: Agent,
  card: Card,
  entree: { texte: string; reussie: boolean },
): void {
  const ecrite = ajouterAuJournal({
    cardId: card.id,
    phase: phaseDeLaCarte(card.id, agent.role),
    nature: 'jalon',
    libelle: entree.reussie ? 'Copie de travail recréée' : 'Copie de travail introuvable',
    agentId: agent.id,
    agentRole: agent.role,
    resultat: entree.texte,
    reussie: entree.reussie,
  });
  if (ecrite) bus.emit({ type: 'journal.entree', entree: ecrite });
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

/**
 * L'agent de cadrage a-t-il déjà ouvert la mémoire du projet ? C'est ce qui
 * décide s'il reçoit ses outils de terrain (lecture, shell, recherche d'outil)
 * — voir `cadrageAllowList`. La trace est celle des ouvertures réelles de
 * `project_memory`, y compris celles qui n'ont rien rendu : ce qui compte est
 * d'être allé voir, pas d'avoir trouvé.
 */
function analyseDuCadrageFaite(agentId: string): boolean {
  try {
    return analyseDeCadrageFaite({ ouverturesMemoire: store.consultationsDeLAgent(agentId).ouvertures });
  } catch (err) {
    // Une mesure illisible ne doit jamais murer un cadrage : on lui rend tout.
    log.warn('analyse du cadrage : mesure de mémoire illisible', err);
    return true;
  }
}

/**
 * UN TOUR NE PART JAMAIS SUR UNE VERSION RETIRÉE. Les moteurs se mettent à
 * jour seuls (`mise-a-jour-moteurs.ts`) et leur catalogue ne garde que la
 * version la plus récente de chaque famille : un agent réglé sur
 * « claude-opus-5 » part alors sur « claude-opus-5-5 », son réglage réécrit
 * pour que l'écran dise ce qui tourne. Même famille, et seulement sur un
 * catalogue réellement lu (`migrationDeReglage`) — pas un choix réécrit au sens
 * de DEC-213.
 */
function versionActuelleDuModele(agent: Agent): Agent {
  const engine = cachedEngines().find((entry) => entry.id === agent.run.engine);
  const migration = migrationDeReglage(engine, agent.run.model, agent.run.thinking);
  if (!migration) return agent;
  const maj = store.saveAgent({
    ...agent,
    run: { ...agent.run, model: migration.model, thinking: migration.thinking ?? agent.run.thinking },
  });
  bus.emit({ type: 'agent.upsert', agent: maj });
  return maj;
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
  tour: {
    account: AccountRecord;
    cleSession: string;
    poursuite: boolean;
    repriseDe?: string;
    preparation: number;
    /** L'ampleur EXIGÉE par l'appelant (lancement de carte) : elle pose le plancher du rapport. */
    ampleurImposee?: Ampleur;
  },
  /**
   * Pourquoi cet agent est appelé, quand ce n'est pas pour une carte. Le NIVEAU
   * d'accueil ne suffit pas à le dire : deux motifs très différents — un
   * dépannage de publication, l'assistant qui configure un site à sauvegarder —
   * partagent l'accueil « minimal » et n'attendent pas la même consigne.
   */
  motif?: MotifDAppel,
): Promise<void> {
  // Le réglage retenu est celui enregistré à l'instant du départ : si le moteur
  // a été changé entre-temps, c'est le nouveau qui part, pas l'ancien.
  const agent = versionActuelleDuModele(store.getAgent(agentBefore.id) ?? agentBefore);
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
  const copiesAnnexes = await copiesAnnexesDuTour(agent, project, dossier);

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

  // Un accueil sans mémoire (dépannage, assistant de sauvegarde ou de
  // surveillance) n'affiche pas d'étape « Base de connaissances » : rien n'est
  // parti au moteur, l'écran ne doit pas le laisser croire.
  const memoryStep: RunStep | null = afficheEtapeMemoire({ nouvelleSession, niveau })
    ? (() => {
        const unites = compterUnites([project.id, 'global']);
        return {
          id: MEMORY_STEP_ID,
          label: unites
            ? `Base de connaissances — ${unites} unité${unites > 1 ? 's' : ''} à portée`
            : 'Base de connaissances encore vide',
          state: unites ? 'done' : 'skipped',
          startedAt: Date.now(),
          endedAt: Date.now(),
        };
      })()
    : // Session déjà ouverte : la mémoire est dans le contexte de l'agent, on ne
      // la relit pas et on n'affiche donc pas l'étape. Accueil minimal : aucune
      // mémoire n'a été donnée.
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
    /*
     * LA PHASE SE DÉCIDE UNE FOIS, AU DÉPART. La relire à chaque entrée ferait
     * basculer un cadrage en « recadrage » au milieu de son propre tour, dès
     * que la première ligne d'exécution serait écrite ailleurs.
     */
    cardIdJournal: agent.cardId ?? undefined,
    phaseJournal: agent.cardId ? phaseDeLaCarte(agent.cardId, agent.role) : 'execution',
    dejaJournalise: new Set<string>(),
    repriseDe: tour.repriseDe,
    startedAt: Date.now(),
    // Le moteur n'a encore rien dit : son lancement vaut premier signe de vie.
    dernierSigneDeVie: Date.now(),
    steps: new Map(memoryStep ? [[memoryStep.id, memoryStep]] : []),
    outilsDesEtapes: new Map(),
    todos: todosRepris,
    text: '',
    morceauxDuTexte: [''],
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
   * LE PONT EST-IL SEULEMENT SUR LE DISQUE ? Le fichier de configuration se
   * RÉÉCRIT à chaque tour — c'est ce qui relance le pont d'un rejeu à l'autre —
   * mais il désigne un programme qui doit exister. S'il manque (projet jamais
   * construit, construction interrompue), aucun rejeu n'y changera rien : la
   * cause se DIT au lieu de se répéter trois fois en silence.
   */
  const pontSurLeDisque = fs.existsSync(bridgePath);
  if (!pontSurLeDisque) log.error(`pont d'outils introuvable : ${bridgePath}`);
  /*
   * Le garde posé devant chaque commande de l'agent : il refuse ce qui pourrait
   * couper le démon ou un moteur au travail (`shared/src/garde-demon.ts`).
   */
  const gardePath = path.join(CONFIG.selfPath, 'server', 'garde-demon.mjs');
  const verrouPath = path.join(CONFIG.selfPath, 'server', 'verrou-analyse.mjs');
  const token = getInternalToken();
  const url = `http://127.0.0.1:${CONFIG.port}`;
  writeMcpConfig(mcpConfigPath, token, url, agent.id, bridgePath, tourId);

  /*
   * L'AGENT DE CADRAGE NE CODE JAMAIS, PAS MÊME SUR BELUGA : sa carte n'a pas
   * encore de branche, et le travail appartient à l'agent lancé après lui. Il
   * est donc le SEUL rôle bridé — outils d'édition fermés, dossier de travail à
   * part.
   */
  const bride = agent.role === 'cadrage';
  const fullAccess = !bride;

  /*
   * LA FRONTIÈRE DE L'AGENT BRIDÉ. Il a tous les droits sauf modifier le code
   * du projet : on lui donne un DOSSIER DE TRAVAIL à part comme `cwd` — le seul
   * écrivable — et on garde le projet en LECTURE SEULE (monté par `projectRoot`,
   * jamais dans l'espace écrivable du bac à sable). Un dossier par projet, hors
   * des dépôts, gardé d'un tour à l'autre pour qu'il y retrouve ses notes.
   * L'agent de tâche, lui, travaille dans le dossier du projet (`dossier`).
   */
  let cwd = dossier;
  let projectRoot: string | undefined;
  if (bride) {
    const scratch = path.join(PATHS.cadrageScratch, project.id);
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
  /*
   * …SAUF L'ANALYSE QUI N'A PAS DE COPIE DE TRAVAIL. Le rendez-vous de la nuit
   * a désormais sa carte (`ouvrirCarteDAgent`) : sans cette garde, sa carte lui
   * aurait valu la consigne de TÂCHE, donc le droit d'écrire, alors qu'il ne
   * doit rien modifier. Seul le chiffrage d'une carte lancée vivait dans une
   * copie de travail.
   */
  const roleMoteur = agent.role === 'analysis' && agent.cardId && agent.workdir ? 'task' : agent.role;
  const systemPrompt = rolePrompt(
    roleMoteur,
    project.isSelf,
    agent.run.engine,
    niveau,
    motif,
    langueDesAgents(),
  );
  composition = { ...composition, systemPromptCharacters: systemPrompt.length };

  const env: Record<string, string> = {
    BELUGA_TOKEN: token,
    BELUGA_URL: url,
    BELUGA_AGENT: agent.id,
    // Le tour, pas seulement l'agent : c'est lui qui rend un appel d'outil
    // rattachable au travail en cours (`appelDuPontRecevable`).
    BELUGA_TOUR: tourId,
    /*
     * Le numéro du démon voyage avec l'agent : le garde posé devant ses
     * commandes (`shared/src/garde-demon.ts`) doit pouvoir reconnaître un
     * « kill -9 <numéro> » qui viserait le serveur lui-même.
     */
    BELUGA_DEMON_PID: String(process.pid),
    BELUGA_DEMON_RACINE: CONFIG.selfPath,
    /*
     * UN OUTIL A LE DROIT D'ATTENDRE UNE PERSONNE. Une question posée par
     * `ask_user` arrête le moteur jusqu'à la réponse : sans ce délai, Claude
     * abandonnerait l'appel au bout de cinq minutes et repartirait travailler
     * sans elle. Le plafond réel est tenu par le démon
     * (`shared/src/attente-question.ts`) ; ici on laisse simplement la place.
     */
    MCP_TOOL_TIMEOUT: String(delaiOutilMoteurMs()),
    /*
     * …ET LE DROIT DE RESTER MUET PENDANT CE TEMPS. Claude coupe aussi un outil
     * qui n'a rien dit depuis 1 800 s (« sent no response or progress for
     * 1800s; aborting ») — exactement le plafond d'attente d'une question : il
     * abandonnait donc en rouge une seconde avant que le démon rende proprement
     * son « personne n'a répondu ». Ce second délai suit le premier.
     */
    CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: String(delaiOutilMoteurMs()),
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
  const systemPromptRappel = rappelDeMethode(agent.run.engine, langueDesAgents());
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

  /*
   * LE SOCLE DU LANCEMENT, CONSTRUIT UNE SEULE FOIS pour tous les moteurs du
   * tour : le tour lui-même, la compression du fil, son résumé de repli et les
   * relances de rapport ou de plan. La compression partait sans `projectRoot`,
   * sans dossiers déclarés ni garde, et dans le dossier du PROJET au lieu du
   * brouillon du cadrage ; une relance de plan partait sans configuration du
   * pont, donc sans l'outil « rendre_plan » qu'elle réclamait.
   */
  const lancement: SocleDuLancement = {
    cwd,
    projectRoot,
    // Le stockage CENTRAL des pièces jointes, ouvert sur TOUS les projets :
    // c'est le seul endroit où vivent les images de la conversation, et leur
    // chemin part dans le prompt (`dossiersLisibles`, `engines/types.ts`).
    // …et, pour un projet à plusieurs dépôts, les copies de la carte dans chaque
    // annexe : ouvertes en ÉCRITURE à l'agent de tâche (plein accès), le bac à
    // sable de Codex étant levé pour lui.
    dossiersLisibles: [...dossiersDeDonneesOuverts(), ...copiesAnnexes.map((copie) => copie.dossier)],
    mcpConfigPath,
    mcpBridgePath: bridgePath,
    gardeDuDemonPath: gardePath,
    // LE VERROU D'ANALYSE EST VIVANT : tant que la mémoire n'est pas ouverte, il
    // est posé devant les outils de terrain et demande au démon, À L'APPEL, si
    // elle l'est devenue (`shared/src/cadrage.ts`, `server/verrou-analyse.mjs`).
    verrouAnalysePath: bride && !analyseDuCadrageFaite(agent.id) ? verrouPath : undefined,
    fullAccess,
    role: agent.role,
    allowedTools: bride ? cadrageAllowList() : undefined,
    disallowedTools: bride ? cadrageDenyList() : undefined,
    env,
  };

  const lancerLeMoteur = (promptDuTour: string, sessionDuTour: string | null) =>
    adapter.run({
      ...lancement,
      prompt: promptDuTour,
      model: agent.run.model ?? undefined,
      /*
       * LE CRAN D'UN AGENT QUE PERSONNE N'A RÉGLÉ SUIT SA FAMILLE. Une carte qui
       * porte le sien l'emporte toujours ; ce repli ne vise que les agents lancés
       * par le démon lui-même — dépannage, publication, analyse de la nuit —, qui
       * partaient sans aucun `--effort` et héritaient donc de celui du moteur,
       * le même pour un conflit de fusion que pour un chantier d'architecture
       * (`shared/src/effort-par-agent.ts`).
       */
      thinking: effortDuTour(agent.run.thinking, {
        role: agent.role,
        motif,
        porteUneCarte: Boolean(agent.cardId),
      }),
      sessionId: sessionDuTour,
      systemPrompt,
      systemPromptRappel,
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
              const rang = runState.morceauxDuTexte.length - 1;
              const morceau = runState.morceauxDuTexte[rang];
              runState.morceauxDuTexte[rang] = morceau + (morceau ? '\n\n' : '') + event.text;
              pushMessage(runState, { content: runState.text, streaming: true });
            }
            break;
          case 'step':
            if (event.step) {
              /*
               * UNE ACTION REFERME LA PHRASE DE PASSAGE QUI LA PRÉCÈDE. Ce que
               * l'agent a écrit depuis l'action d'avant (« Je vérifie… ») n'est
               * pas sa réponse : il rejoint le journal À SA PLACE, juste avant
               * l'action qu'il annonce, et se lit dans « Réflexions ». La
               * réponse ne garde que ce qui suit la dernière action.
               */
              verserLaNoteAvantLAction(agent.id, runState);
              const existing = runState.steps.get(event.step.key);
              /*
               * UN REFUS DU BAC À SABLE SE DIT EN FRANÇAIS. Le projet est monté en
               * lecture seule pour un agent bridé et l'élévation de privilèges y
               * est coupée : une commande qui l'oublie rendait « EROFS », « sudo:
               * no new privileges » ou « Read-only file system », que l'agent
               * reprenait en « je n'ai pas les droits » — alors que rien ne manque.
               * On ajoute la cause réelle et la route à prendre AU-DESSUS de la
               * sortie d'origine, qui reste lisible. Étape en cours exclue : son
               * détail est la commande, pas encore son résultat.
               */
              /* L'outil brut n'arrive qu'au DÉPART de l'étape : on le retient
                 pour la journaliser correctement à son arrivée. */
              if (event.step.outil) {
                runState.outilsDesEtapes.set(event.step.key, {
                  outil: event.step.outil,
                  entree: event.step.entree,
                });
              }
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
                /* L'image regardée est annoncée au DÉBUT de l'étape ; la fin,
                   elle, ne renvoie que l'étiquette : elle se reprend donc de
                   l'étape déjà en place, sinon la capture disparaîtrait juste
                   au moment où l'étape se coche. */
                capture: event.step.capture ?? existing?.capture,
                /* L'OUTIL ET SON ENTRÉE SUIVENT L'ÉTAPE JUSQU'À L'ÉCRAN. Ils
                   n'arrivent qu'au DÉPART de l'étape : la fin les reprend de
                   l'étape déjà en place, comme la capture — sans quoi le
                   déroulé en direct perdrait son encadré au moment même où
                   l'étape se coche. */
                outil: event.step.outil ?? existing?.outil,
                entree: event.step.entree
                  ? paramsLisibles(event.step.entree)
                  : existing?.entree,
              };
              runState.steps.set(event.step.key, step);
              pushMessage(runState, { steps: [...runState.steps.values()], streaming: true });
              poserLetapeDesSteps(agent.id, [...runState.steps.values()]);
              /*
               * LA REQUÊTE REJOINT LE JOURNAL DE LA CARTE, une fois ACHEVÉE.
               * Une étape « en cours » ne porte pas encore son résultat : la
               * journaliser tout de suite écrirait une ligne vide, et la clé
               * d'unicité empêcherait ensuite d'écrire la vraie. On attend donc
               * qu'elle se coche, se rate ou soit sautée
               * (`shared/src/journal-carte.ts`).
               */
              if (step.state !== 'running' && step.state !== 'todo') {
                /*
                 * L'OUTIL DU JOURNAL EST LE NOM BRUT, PAS L'ÉTIQUETTE. C'est lui
                 * que le parcours relit pour montrer un contenu plutôt qu'un
                 * pavé (`vueDeLEntree`), et lui qui remplit le menu de filtrage :
                 * « Bash (12) » se choisit, « Commande : cat -n … » ne se
                 * choisit pas, puisqu'il diffère à chaque appel. L'étiquette
                 * française reste le LIBELLÉ, qui est ce qui se lit sur la ligne.
                 */
                const appel = runState.outilsDesEtapes.get(step.id);
                journaliserDansLeTour(agent.id, {
                  cle: `step:${step.id}`,
                  nature: 'requete',
                  libelle: step.label,
                  outil: appel?.outil ?? step.label,
                  params: appel?.entree,
                  resultat: step.detail ?? '',
                  reussie: step.state !== 'failed',
                  dureeMs:
                    step.startedAt && step.endedAt ? Math.max(0, step.endedAt - step.startedAt) : undefined,
                });
              }
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
               * LES POINTS DE TRAVAIL REJOIGNENT LE JOURNAL, un par ÉTAT. Le
               * moteur renvoie sa liste entière à chaque changement : la clé
               * mêle le libellé et l'état, si bien qu'une même ligne écrit une
               * entrée quand elle démarre et une autre quand elle se coche —
               * jamais dix fois la même.
               */
              runState.todos.forEach((todo, rang) => {
                journaliserDansLeTour(agent.id, {
                  cle: `todo:${rang}:${todo.label}:${todo.state}`,
                  nature: 'point',
                  libelle: todo.label,
                  etat: todo.state,
                  donnees: {
                    rang: rang + 1,
                    sur: runState.todos.length,
                    debutLe: todo.startedAt,
                    finLe: todo.endedAt,
                  },
                });
              });

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
            /*
             * LA VRAIE CAUSE NE SE FAIT PLUS ÉCRASER PAR UN BRUIT DE FIN.
             *
             * Un tour qui tombe reçoit d'abord l'erreur qui EXPLIQUE
             * (« Selected model is at capacity »), puis, à la clôture, un
             * message de fin de course sans contenu — le code de sortie nu, ou
             * la note « Reading additional input from stdin… » que codex-cli
             * écrit sur sa sortie d'erreur à CHAQUE lancement. La seconde
             * remplaçait la première : la carte finissait en rouge sur un code
             * de sortie, et la relance après panne passagère ne voyait plus rien
             * à reconnaître. On garde donc celle qui dit quelque chose.
             */
            sawError = causeLaPlusParlante(sawError, event.error);
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

  /*
   * LE TOUR QUI PART OUVRE SON ÉPISODE DANS LE JOURNAL DE LA CARTE. Écrit
   * APRÈS `live.set` : `journaliserDansLeTour` lit l'état vivant du tour pour
   * savoir la carte et la phase, et n'aurait rien trouvé avant.
   */
  journaliserDansLeTour(agent.id, {
    cle: `depart:${runState.messageId}`,
    nature: 'jalon',
    libelle: 'Tour lancé',
    donnees: {
      moteur: agent.run.engine,
      modele: agent.run.model ?? undefined,
      reflexion: agent.run.thinking,
      session: sessionId ? 'reprise' : 'nouvelle',
      // Ce tour POURSUIT un tour coupé : le parcours le rattache à son point.
      poursuiteDe: tour.repriseDe,
    },
  });
  consommerLaReprise(tour.repriseDe, runState.messageId);

  /*
   * LA DEMANDE QUI A DÉCLENCHÉ CE TOUR N'EST PLUS ÉCRITE ICI : elle ouvre le
   * parcours dès son ARRIVÉE (`journaliserLaDemande`, appelée par
   * `preparerLeTour`), des dizaines de secondes avant que le moteur ne parte.
   * L'écrire une seconde fois à cet endroit la doublerait dans la ligne de
   * temps.
   */
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

  bus.emit({ type: 'capacity', capacity: (await import('./capacity.js')).etatCapacite() });

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
      // Le moteur suivant est posé : le filet reprend son office sur LUI.
      runState.repriseApresPanneJusqua = undefined;
      return suivant;
    },
    etat: () => ({
      erreur: sawError,
      texte: runState.text,
      // La fermeture d'autorité ferme la porte comme un arrêt à la main : sans
      // elle, la boucle posait son essai suivant sur un tour déjà refermé.
      arretDemande: runState.stopping || runState.refermeDAutorite,
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
      /*
       * ET LE FILET DE FERMETURE EST PRÉVENU AVANT L'ATTENTE. Le processus du
       * moteur vient de mourir ; sans ce mot, la veille des tours bloqués le
       * verrait dans les quinze secondes et refermerait d'autorité un tour qui
       * allait repartir — le nouvel essai partait alors dans le vide, outils
       * refusés et travail perdu au milieu de la tâche.
       */
      runState.repriseApresPanneJusqua = Date.now() + attenteMs + MARGE_DE_REPRISE_MS;
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


  const plancher = rapportAuPlancher({
    role: agent.role,
    porteUneCarte: Boolean(agent.cardId),
    kind: template,
    ampleurImposee: tour.ampleurImposee,
  });
  /*
   * LA RÉPONSE EST CE QUI SUIT LA DERNIÈRE ACTION. Les phrases de passage sont
   * déjà dans la réflexion de la carte (`verserLaNoteAvantLAction`) : les
   * recoller en tête de la réponse les faisait lire deux fois, et au mauvais
   * endroit. Un rapport écrit en plusieurs fois garde ce qu'il faut pour tenir
   * son gabarit (`texteRenduDuTour`). Un agent SANS carte n'a pas de journal où
   * verser ces phrases : il garde son texte entier.
   */
  let finalText = runState.cardIdJournal
    ? texteRenduDuTour(
        runState.morceauxDuTexte,
        template !== 'none' ? (texte) => checkTemplate(template, texte, ampleur, { plancher }).ok : undefined,
      )
    : runState.text.trim();
  // Contrôle de forme : un moteur qui ignore le gabarit se fait rattraper.
  /*
   * LE RAPPORT QUI FERME UNE CARTE A UN PLANCHER, ET UNE SEULE RELANCE.
   *
   * Une carte s'est refermée sur deux paragraphes où l'agent disait attendre
   * ses contrôles, lancés en tâche de fond : sous 160 mots, le texte passait en
   * « brève », qui n'exige aucune section. Le tour d'EXÉCUTION d'une carte ne
   * descend plus sous « moyenne » (`rapportAuPlancher`) ; s'il rend un texte
   * hors gabarit sans être tombé ni arrêté, il est relancé UNE fois, dans la
   * même session, avec une consigne qui nomme ses tâches de fond encore
   * vivantes (`shared/src/relance-du-rapport.ts`). Le texte relancé devient la
   * réponse et le jalon `rapport` ; s'il reste hors format, la note ci-dessous
   * le dit, sans nouvel essai.
   */
  let formCheck = checkTemplate(template, finalText, ampleur, { plancher });
  let tachesDeFond: TacheDeFond[] = [];
  let rapportRelance: 'rendu' | 'hors-format' | 'sans-reponse' | undefined;
  const questionOuverte = plancher
    ? (store.listMessages(agent.id).find((m) => m.id === runState.messageId)?.questions ?? []).some(
        (q) => !q.answer && !q.cancelled,
      )
    : false;
  if (
    relanceDuRapport({
      plancher,
      formeTenue: formCheck.ok,
      texte: finalText,
      echec: !result.ok || !!sawError || !!panneDefinitive,
      arrete: runState.stopping || !!runState.refermeDAutorite,
      questionPosee: questionOuverte,
    })
  ) {
    tachesDeFond = tachesDeFondVivantes(
      [...runState.steps.values()].map((etape) => ({
        cle: etape.id,
        outil: runState.outilsDesEtapes.get(etape.id)?.outil ?? '',
        entree: runState.outilsDesEtapes.get(etape.id)?.entree,
        resultat: etape.detail,
        etat: etape.state,
      })),
    );
    const plafondMs = tachesDeFond.length ? PLAFOND_RELANCE_AVEC_TACHES_MS : PLAFOND_APPEL_APRES_REPONSE_MS;
    const departRelance = Date.now();
    const detailRelance = tachesDeFond.length
      ? `Tâches de fond : ${tachesDeFond.map(nomDeTacheDeFond).join(' ; ')}`
      : undefined;
    runState.steps.set(ETAPE_RAPPORT_RELANCE_ID, {
      id: ETAPE_RAPPORT_RELANCE_ID,
      label: ETAPE_RAPPORT_RELANCE,
      state: 'running',
      detail: detailRelance,
      startedAt: departRelance,
    });
    pushMessage(runState, { steps: [...runState.steps.values()], streaming: true });
    // Le moteur d'origine est fini : la veille des tours bloqués ne doit pas
    // prendre la relance pour un tour abandonné.
    runState.repriseApresPanneJusqua = departRelance + plafondMs + MARGE_DE_REPRISE_MS;
    const texteRelance = await rendreLePlanEntier({
      adapter,
      lancement,
      agent,
      sessionId: store.getSessionId(agent.id, cleSession),
      consigne: consigneDeRelanceDuRapport({ manquantes: formCheck.missing, taches: tachesDeFond }),
      outilsNatifsOuverts: tachesDeFond.length ? ['Bash', 'Read'] : [],
      plafondMs,
      runState,
    }).catch(() => '');
    runState.repriseApresPanneJusqua = undefined;
    runState.dernierSigneDeVie = Date.now();
    if (texteRelance && !runState.stopping) {
      finalText = texteRelance;
      runState.text = texteRelance;
      runState.morceauxDuTexte = [texteRelance];
      formCheck = checkTemplate(template, finalText, ampleur, { plancher });
    }
    rapportRelance = !texteRelance || runState.stopping ? 'sans-reponse' : formCheck.ok ? 'rendu' : 'hors-format';
    runState.steps.set(ETAPE_RAPPORT_RELANCE_ID, {
      id: ETAPE_RAPPORT_RELANCE_ID,
      label:
        rapportRelance === 'rendu'
          ? `${ETAPE_RAPPORT_RELANCE} — rendu`
          : rapportRelance === 'hors-format'
            ? `${ETAPE_RAPPORT_RELANCE} — toujours hors format`
            : `${ETAPE_RAPPORT_RELANCE} — sans réponse`,
      state: rapportRelance === 'rendu' ? 'done' : 'failed',
      detail: detailRelance,
      startedAt: departRelance,
      endedAt: Date.now(),
    });
    log.info(`rapport relancé pour l'agent ${agent.id} : ${rapportRelance} (${tachesDeFond.length} tâche(s) de fond)`);
  }
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
  const passage = passageDuPont(agent.id);
  const pont = etatDuPont(passage, pontSurLeDisque);
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
  /*
   * LA RELÈVE NE BOUCLE PLUS (`chaineDeReprise`, `shared/src/reprise-compte.ts`) :
   * un tour qui était lui-même une relève, et qui tombe aussitôt, allonge la
   * chaîne des comptes déjà essayés ; la relève automatique n'y repuise pas.
   */
  const reprise = motifQuota
    ? repriseDeCompte({
        engine: agent.run.engine,
        compte: account,
        motif: motifQuota,
        chaine: chaineDeReprise({
          precedente: derniereRepriseDeLAgent(agent.id, runState.messageId),
          compteEpuise: account.id,
          dureeDuTourMs: Date.now() - runState.startedAt,
        }),
      })
    : undefined;
  /*
   * LA LIMITE EST NOTÉE, PAR COMPTE ET PERSISTÉE : le choix du tour suivant
   * l'écarte tant qu'elle court, quoi qu'en dise le relevé
   * (`server/src/limites-connues.ts`). C'est la mémoire qui manquait entre le
   * tour tombé et le tour d'après.
   */
  if (reprise) {
    /*
     * L'HEURE ANNONCÉE PAR LE MOTEUR (« resets 12:20pm (UTC) ») PASSE DEVANT le
     * dernier relevé en cache : c'est elle qui rend le premier compte à l'heure
     * exacte, au lieu de l'écarter jusqu'à cinq heures de trop.
     */
    const annoncee = echeanceAnnonceeParLeMoteur(`${sawError ?? result.error ?? ''}\n${runState.text ?? ''}`, Date.now());
    noterLimiteConnue({ compte: account.id, motif: reprise.motif, resetsAt: annoncee ?? reprise.resetsAt });
  }

  /*
   * CE TOUR A-T-IL TRAVAILLÉ SANS SES OUTILS — ET QU'EN FAIT-ON ?
   *
   * Deux questions, dans cet ordre. `tourARejouerFauteDOutils` dit si le tour
   * doit être refait : le pont a manqué, le moteur avait démarré, aucun appel
   * n'a abouti, personne n'a coupé à la main. `issueDuPontMort` dit ensuite
   * s'il se REJOUE en silence ou si l'on DEMANDE — trois rejeux, puis on
   * s'arrête.
   *
   * Ce calcul se faisait autrefois au seul moment d'enregistrer la carte, sans
   * jamais consulter le compteur d'essais : le quatrième tour privé d'outils
   * repartait comme le premier, sans délai et sans décision. La carte tournait
   * en rond indéfiniment, en brûlant du quota à chaque passage, et le champ
   * `pontEpuise` — pourtant écrit et testé dans `deplacement-carte.ts` — n'était
   * jamais alimenté par personne.
   */
  const pontARejouer = tourARejouerFauteDOutils({
    pontOk: pont.ok,
    moteurMuet,
    echec: failed,
    /*
     * CE QUI COMPTE N'EST PAS LE TEXTE RENDU, C'EST L'OUTIL JOINT. Un tour
     * privé de son pont écrit quand même son compte rendu — il ne sait pas
     * qu'il lui manque quelque chose — et cette réponse refermait la carte.
     */
    outilAbouti: !!passage?.appelAbouti,
    arretDemande: runState.stopping,
    autreRoute: Boolean(reprise) || Boolean(panneDefinitive),
  });
  const carteDuPont = pontARejouer && agent.cardId ? store.getCard(agent.cardId) : null;
  const issuePont = pontARejouer
    ? issueDuPontMort(carteDuPont?.scheduling?.essaisSansOutils ?? 0)
    : null;
  /** On rejoue en silence : la carte repart en file, avec son délai croissant. */
  const pontRejoue = !!issuePont?.rejouer;
  /** Les rejeux sont épuisés : la carte ne bouge plus, la décision l'attend. */
  const pontEpuise = !!issuePont && !issuePont.rejouer;
  /*
   * LA TRACE DU REJEU SILENCIEUX. Rien ne s'affiche en grand — c'est tout
   * l'intérêt d'un rejeu automatique —, mais rien n'est caché non plus : la
   * ligne se lit dans le fil de la carte, repliée avec le reste du détail. Sans
   * elle, une carte reprise trois fois de suite ne portait aucune explication.
   */
  if (issuePont?.rejouer) {
    log.warn(
      `pont d'outils mort-né pour l'agent ${agent.id} : rejeu ${issuePont.essai}/${ESSAIS_DE_PONT_MAX} ` +
        `dans ${Math.round(issuePont.delaiMs / 1000)} s`,
    );
    journaliserDansLeTour(agent.id, {
      nature: 'jalon',
      libelle: 'Outils du projet indisponibles',
      resultat: phraseDeRejeuDuPont(issuePont.essai),
      cle: `rejeu-pont-${runState.messageId}`,
    });
  }
  if (pontEpuise) log.warn(`pont d'outils épuisé pour l'agent ${agent.id} : décision posée`);

  /*
   * UN TOUR À QUI L'ON A DEMANDÉ LE PLAN LE REND, OU IL LE DIT.
   *
   * La carte porte la demande (`planDemandeA`, posée par le clic « Générer le
   * plan » ou par un message d'affinage) ; l'outil `rendre_plan` la retire en
   * enregistrant la version. Si elle est encore là à la fin du tour, le tour
   * n'a pas tenu sa promesse : on le relance UNE FOIS, dans la même session,
   * avec le seul outil `rendre_plan` ouvert. S'il ne rend toujours rien, un
   * INCIDENT est posé sur la carte, avec le bouton pour redemander — plus
   * jamais un écran figé sous un bouton mort (`shared/src/parcours-carte.ts`).
   *
   * Une question d'outil laissée ouverte n'est pas un manquement : l'agent
   * attend une réponse, la demande tombe sans incident. Un tour en échec non
   * plus : sa bulle d'erreur porte déjà la décision.
   */
  if (agent.role === 'cadrage' && agent.cardId) {
    const carteDuTour = store.getCard(agent.cardId);
    const demandeDePlan = carteDuTour?.parcours?.planDemandeA;
    const messageDuTour = store.listMessages(agent.id).find((m) => m.id === runState.messageId);
    const questionPosee =
      (messageDuTour?.questions ?? []).some((q) => !q.answer && !q.cancelled) ||
      !!questionEnTexteLibre({ role: 'assistant', content: finalText });
    if (carteDuTour && demandeDePlan) {
      const manque = planManquant({
        planDemandeA: demandeDePlan,
        questionPosee,
        echec: failed || !!reprise || !!panneDefinitive,
      });
      if (manque) {
        runState.steps.set(ETAPE_PLAN_RECLAME_ID, {
          id: ETAPE_PLAN_RECLAME_ID,
          label: ETAPE_PLAN_RECLAME,
          state: 'running',
          startedAt: Date.now(),
        });
        pushMessage(runState, { steps: [...runState.steps.values()] });
        const numero = numeroDuProchainPlan(carteDuTour.parcours?.plans);
        await rendreLePlanEntier({
          adapter,
          lancement,
          agent,
          sessionId: store.getSessionId(agent.id, cleSession),
          consigne: `${numero > 1 ? consigneDAffinageDuPlan(numero) : consigneDeRenduDuPlan(numero)}\n\nTa réponse précédente n'a pas appelé « rendre_plan » : appelle-le MAINTENANT, avec toutes les parties — « taches » (la liste des tâches, deux entrées au moins, chacune avec son titre et sa description détaillée) et « decisions » (ce qui a été décidé, changé ou abandonné, une ligne au moins) comprises.`,
          outilsOuverts: ['rendre_plan'],
          // Un plan ENTIER s'écrit ici, pas une remise en forme de 90 s.
          plafondMs: PLAFOND_RATTRAPAGE_PLAN_MS,
          runState,
        }).catch(() => '');
        const rendu = !store.getCard(agent.cardId)?.parcours?.planDemandeA;
        runState.steps.set(ETAPE_PLAN_RECLAME_ID, {
          id: ETAPE_PLAN_RECLAME_ID,
          label: rendu ? `${ETAPE_PLAN_RECLAME} — rendu` : `${ETAPE_PLAN_RECLAME} — sans réponse`,
          state: rendu ? 'done' : 'failed',
          startedAt: Date.now(),
          endedAt: Date.now(),
        });
        if (!rendu) {
          const fraiche = store.getCard(agent.cardId);
          if (fraiche) {
            const rangee = store.saveCard({
              ...fraiche,
              parcours: {
                ...(fraiche.parcours ?? { plans: [] }),
                planDemandeA: undefined,
                incident: { texte: INCIDENT_PLAN_NON_RENDU, at: Date.now(), etape: 'plan' },
              },
            });
            bus.emit({ type: 'card.upsert', card: rangee });
            journaliserDansLeTour(agent.id, {
              cle: `incident-plan:${runState.messageId}`,
              nature: 'jalon',
              libelle: 'Tour interrompu',
              resultat: INCIDENT_PLAN_NON_RENDU,
              reussie: false,
            });
          }
        }
      } else {
        /* La demande tombe sans incident : une question attend, ou le tour est
           tombé et sa bulle d'erreur porte déjà la décision. */
        const fraiche = store.getCard(agent.cardId);
        if (fraiche?.parcours?.planDemandeA) {
          const rangee = store.saveCard({ ...fraiche, parcours: { ...fraiche.parcours, planDemandeA: undefined } });
          bus.emit({ type: 'card.upsert', card: rangee });
        }
      }
    }

    /*
     * ET LA MÊME EXIGENCE POUR LA COMPRÉHENSION.
     *
     * Un tour de cadrage a DEUX fins : cadrer (il appelle
     * `rendre_comprehension`) ou répondre à une question. Rien ne le
     * vérifiait : un tour qui oubliait l'outil laissait la carte à mi-chemin,
     * et l'écran proposait la suite au-dessus d'une étape jamais franchie.
     * On le relance donc UNE FOIS, dans la même session, avec le seul outil de
     * compréhension ouvert ; la relance n'a que deux sorties — l'appeler, ou
     * dire que ce tour n'était qu'une réponse. Rien d'autre pose un INCIDENT
     * nommé sur la carte (`shared/src/tour-de-cadrage.ts`).
     *
     * L'ISSUE DU TOUR EST ÉCRITE DANS TOUS LES CAS : c'est elle que le flux en
     * points lit, au lieu de deviner la fin du tour dans les traces.
     */
    if (carteDuTour && agent.cardId) {
      const rendueDansCeTour = carteDuTour.parcours?.comprehension?.tourId === runState.messageId;
      /*
       * UN TOUR QUI A RENDU SON PLAN N'EST PAS UN CADRAGE INCOMPLET. La demande
       * (`planDemandeA`) est relue ici APRÈS le tour, et `rendre_plan` l'a déjà
       * retirée : lue seule, elle faisait passer le tour de plan pour un tour
       * de compréhension oublieux, et le démon réclamait une compréhension —
       * écrite après le plan, dans le même tour, d'où le plan en double à
       * l'écran (carte b40e2e98, 14.09.2026). Le plan rendu PAR CE TOUR le dit.
       */
      const planRenduCeTour = (carteDuTour.parcours?.plans ?? []).some((plan) => plan.tourId === runState.messageId);
      const jugement = {
        comprehensionRendue: rendueDansCeTour,
        questionPosee,
        echec: failed || !!reprise || !!panneDefinitive,
        arretDemande: runState.stopping,
        planDemande: !!demandeDePlan || planRenduCeTour,
      };
      let relance: 'cadrage' | 'reponse' | 'incident' | undefined;
      if (comprehensionManquante(jugement)) {
        runState.steps.set(ETAPE_COMPREHENSION_RECLAMEE_ID, {
          id: ETAPE_COMPREHENSION_RECLAMEE_ID,
          label: ETAPE_COMPREHENSION_RECLAMEE,
          state: 'running',
          startedAt: Date.now(),
        });
        pushMessage(runState, { steps: [...runState.steps.values()] });
        const texteRelance = await rendreLePlanEntier({
          adapter,
          lancement,
          agent,
          sessionId: store.getSessionId(agent.id, cleSession),
          consigne: CONSIGNE_COMPREHENSION_RECLAMEE,
          outilsOuverts: ['rendre_comprehension'],
          runState,
        }).catch(() => '');
        const apres = store.getCard(agent.cardId);
        relance = issueDeLaRelance({
          comprehensionRendue: !!apres?.parcours?.comprehension?.texte?.trim(),
          texte: texteRelance,
        });
        runState.steps.set(ETAPE_COMPREHENSION_RECLAMEE_ID, {
          id: ETAPE_COMPREHENSION_RECLAMEE_ID,
          label:
            relance === 'cadrage'
              ? `${ETAPE_COMPREHENSION_RECLAMEE} — rendue`
              : relance === 'reponse'
                ? `${ETAPE_COMPREHENSION_RECLAMEE} — le tour ne faisait que répondre`
                : `${ETAPE_COMPREHENSION_RECLAMEE} — sans réponse`,
          state: relance === 'incident' ? 'failed' : 'done',
          startedAt: Date.now(),
          endedAt: Date.now(),
        });
        if (relance === 'incident') {
          const fraiche = store.getCard(agent.cardId);
          if (fraiche) {
            const rangee = store.saveCard({
              ...fraiche,
              parcours: {
                ...(fraiche.parcours ?? { plans: [] }),
                incident: { texte: INCIDENT_COMPREHENSION_NON_RENDUE, at: Date.now(), etape: 'comprehension' },
              },
            });
            bus.emit({ type: 'card.upsert', card: rangee });
            journaliserDansLeTour(agent.id, {
              cle: `incident-comprehension:${runState.messageId}`,
              nature: 'jalon',
              libelle: 'Tour interrompu',
              resultat: INCIDENT_COMPREHENSION_NON_RENDUE,
              reussie: false,
            });
          }
        }
      }
      const issue = issueAEcrire({ ...jugement, relance });
      if (issue) {
        const fraiche = store.getCard(agent.cardId);
        if (fraiche) {
          const rangee = store.saveCard({
            ...fraiche,
            parcours: {
              ...(fraiche.parcours ?? { plans: [] }),
              issueDuTour: { issue, at: Date.now(), tourId: runState.messageId },
            },
          });
          bus.emit({ type: 'card.upsert', card: rangee });
        }
      }
    }
  }

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
  /*
   * L'ÉCHEC ORDINAIRE — ni une reprise de quota, ni une panne passagère du
   * fournisseur, ni un moteur jamais joint — mérite lui aussi une décision,
   * pas seulement un bandeau rouge qu'on peut ne jamais rouvrir
   * (`shared/src/erreur-de-tour.ts`). Relancer, ignorer ou arrêter : trois
   * boutons posés sur ce message, et le triangle orange qui va avec.
   */
  /*
   * LA CAUSE DIT CE QUI S'EST VRAIMENT PASSÉ. Un tour privé d'outils au bout de
   * ses rejeux n'a souvent aucune erreur à montrer — il a « réussi » — et la
   * décision se serait affichée sous un « Le moteur s'est arrêté avant la
   * fin. » qui n'apprend rien. Elle nomme donc les essais.
   */
  const causeErreurDeTour =
    pontEpuise && issuePont && !issuePont.rejouer
      ? raisonDePontMortDefinitif(issuePont.essais)
      : (sawError ?? result.error ?? "Le moteur s'est arrêté avant la fin.");
  const erreurAPoser = erreurDeTourAPoser({
    failed,
    reprise: Boolean(reprise),
    panneDefinitive: Boolean(panneDefinitive),
    moteurMuet,
    arretDemande: runState.stopping,
    pontEpuise,
  });
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
          ? causeErreurDeTour
          : undefined,
    repriseCompte: reprise,
    poursuiteDe: runState.repriseDe,
    erreurDeTour: erreurAPoser ? { cause: causeErreurDeTour, at: Date.now() } : undefined,
  });

  /*
   * LE DERNIER MOT DU TOUR REJOINT LE JOURNAL DE LA CARTE, sous la phase
   * `rapport` : c'est lui qui referme l'épisode dans la ligne de temps du cycle
   * complet, qu'il porte une réponse ou l'explication d'un tour tombé. Un tour
   * en échec écrit donc SA ligne, avec sa cause — c'est justement celle qu'on
   * cherche à relire après coup (`shared/src/journal-carte.ts`).
   */
  /*
   * CE QUE LE TOUR LAISSE AU JOURNAL SE DÉCIDE PAR UNE RÈGLE PURE
   * (`jalonDeFinDeTour`, `shared/src/issue-de-tour.ts`), plus sur le seul `failed`.
   * Un arrêt de QUOTA — la cause de 38 des 61 « Tour interrompu » relevés en
   * base — n'est plus un incident : sa relève a sa propre route, et l'étape
   * « Rapport » n'a aucune raison de rougir. Un tour tombé APRÈS avoir écrit
   * son compte rendu garde ce compte rendu ; c'est la cause qui voyage à côté.
   */
  const issue = jalonDeFinDeTour({
    failed,
    reprise: Boolean(reprise),
    moteurMuet,
    arretDemande: runState.stopping,
    texte: finalText,
    // Un gabarit « none » ne juge rien : sa validité serait un faux témoignage.
    rapportEntier: template !== 'none' && formCheck.ok,
    cause: causeErreurDeTour,
  });
  journaliserDansLeTour(agent.id, {
    cle: `rapport:${runState.messageId}`,
    phase: 'rapport',
    nature: 'jalon',
    libelle: issue.libelle,
    resultat: issue.resultat,
    reussie: issue.reussie,
    dureeMs: Math.round(elapsedSeconds * 1000),
    donnees: {
      compte: account.label,
      moteur: agent.run.engine,
      modele: agent.run.model ?? undefined,
      jetons: tokensAffiches || undefined,
      // La cause reste LISIBLE même quand le compte rendu a pris sa place :
      // un tour tombé après sa réponse doit dire POURQUOI il est tombé.
      ...(issue.reussie && issue.cause ? { causeDArret: issue.cause } : {}),
      // Ce que la relance du rapport a trouvé et obtenu, relisible après coup.
      ...(rapportRelance ? { relanceDuRapport: rapportRelance } : {}),
      ...(tachesDeFond.length ? { tachesDeFond: tachesDeFond.map(nomDeTacheDeFond) } : {}),
    },
  });

  /*
   * LA RÉPONSE EST RENDUE. Tout ce qui suit est du service — compression du fil,
   * constat du dépôt, dossier de carte refermé — et l'utilisateur, lui, voit
   * déjà sa réponse. On date ce moment : passé le plafond, la veille des tours
   * bloqués referme d'autorité plutôt que de laisser tourner un compteur vide.
   */
  runState.reponseFigeeA = Date.now();
  /*
   * LE TITRE DE LA CARTE SE GÉNÈRE DÈS LE PREMIER ÉCHANGE, PAS SEULEMENT AU
   * LANCEMENT. Une carte de cadrage encore appelée « Nouvelle tâche » — parce
   * que l'agent n'a pas pris la peine d'écrire un titre, ou qu'un tour raté
   * l'en a empêché — reçoit ici la première phrase de la première demande de
   * l'utilisateur, débarrassée de ses tags « [fichier: …] ». Un titre déjà
   * posé par l'agent (`board_update_card`) n'est jamais écrasé.
   */
  if (agent.role === 'cadrage' && agent.cardId) {
    const carteDeCadrage = store.getCard(agent.cardId);
    if (carteDeCadrage) {
      const messagesDuCadrage = store.listMessages(agent.id);
      let carte = carteDeCadrage;
      let changee = false;
      if (titreEncoreVide(carte.title)) {
        const titre = titreDepuisLaDiscussion(messagesDuCadrage, carte.title);
        if (titre !== carte.title) {
          carte = { ...carte, title: titre };
          changee = true;
        }
      }
      /* LE PLAN NE SE RECOPIE PLUS DEPUIS LE FIL : l'outil `rendre_plan` écrit
         la carte lui-même (`server/src/tools.ts`). */
      if (changee) {
        const fraiche = store.saveCard(carte);
        bus.emit({ type: 'card.upsert', card: fraiche });
      }
    }
  }

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

  if (!failed) {
    finaliserPropositionsDuTour(runState.messageId, agent.projectId, measurement);
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
          lancement,
          sessionId: store.getSessionId(agent.id, cleSession),
          systemPrompt,
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
  let trace: TraceDuTravail = failed
    ? 'non'
    : await traceDuTravailDuTour({ dossier, repere, projet: project.path, remuesAvant }).catch(
        () => 'inconnue' as const,
      );
  /*
   * UN PROJET À PLUSIEURS DÉPÔTS : un tour qui n'a touché QU'UN annexe (l'admin
   * seule, par exemple) a bel et bien travaillé. On lit donc la branche de la
   * carte dans chaque annexe avant de conclure « rien n'a changé ».
   */
  if (trace === 'non' && !failed && copiesAnnexes.length && agent.cardId) {
    const carte = store.getCard(agent.cardId);
    if (carte && (await travailDansLesAnnexes(project, carte).catch(() => false))) trace = 'oui';
  }

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
      // Chaque copie annexe se range de la même façon, dépôt par dépôt.
      if (project.depots?.length) await refermerLesCopiesAnnexes(project, carte);
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
       * LA PRÉPARATION EST FINIE, PAR OÙ QUE LE TOUR SOIT SORTI.
       *
       * La barre « Préparation en cours » n'était refermée que par le
       * post-traitement du lancement (`startCard`). Tous les tours qui se
       * terminent AILLEURS — reprise par un message, relève de compte, tour
       * coupé, panne du moteur — laissaient donc le signal ouvert, et l'écran
       * gardait sa barre jaune une demi-heure sur une carte déjà rangée. La fin
       * de tour est le seul endroit que TOUS ces chemins traversent.
       */
      bus.emit({ type: 'card.lancement', cardId: card.id, projectId: card.projectId, depuis: Date.now() });
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
          /*
           * L'AGENT N'A JAMAIS REÇU LES OUTILS DU PROJET, ET IL EST TOMBÉ. Sans
           * mémoire, sans écriture de mémoire et sans geste de tableau, il ne
           * pouvait même pas ranger sa carte : elle restait figée en « En
           * cours », sans agent au travail, jusqu'à une reprise à la main.
           * `tourARejouerFauteDOutils` écarte les tours qui ont RENDU malgré
           * tout, ceux qu'on a coupés à la main et ceux qui partent déjà sur une
           * autre route (relève de compte, panne du fournisseur).
           */
          pontMort: pontRejoue,
          /*
           * …ET LES REJEUX ONT UNE FIN. Au quatrième tour privé d'outils, la
           * carte ne repart plus : elle reste où elle est, avec sa décision
           * « Relancer / Ignorer / Arrêter » posée sur le message. Sans ce
           * drapeau, `pontMort` restait vrai indéfiniment et la carte
           * retournait en « Planifié » à chaque passage, sans délai — une
           * boucle qui brûlait du quota sans que rien ne la voie
           * (`retenueApresPontEpuise`).
           */
          pontEpuise,
          /*
           * LA MACHINE ELLE-MÊME ÉTAIT PLEINE. Ni le moteur ni le fournisseur
           * n'y sont pour rien : la carte porte alors cette cause-là, et attend
           * que la charge d'à côté retombe.
           */
          machineSaturee: panneDeLaMachine(panneDefinitive),
        }),
        consumption: {
          tokens,
          machineSeconds: elapsedSeconds,
          account: account.id,
          turns: runState.usage?.turns,
          measuredAt: Date.now(),
        },
        llmSessionMetrics: metriquesDeSessionLlm({
          state: failed || Boolean(reprise) || Boolean(panneDefinitive) ? 'interrupted' : 'completed',
          usage: runState.usage,
          durationMs: Math.round(elapsedSeconds * 1000),
          context: runState.context ? { tokens: runState.context.tokens, window: contextWindow } : undefined,
        }),
      });
      bus.emit({ type: 'card.upsert', card: updated });
    }

    /*
     * LA TÉLÉMÉTRIE DE LA TÂCHE, ÉCRITE ICI ET NULLE PART AILLEURS.
     *
     * C'est le seul endroit où les trois grandeurs sont ensemble : les jetons
     * réels du moteur (l'événement d'usage, pas une estimation), la durée
     * machine du tour, et ce que l'agent est allé chercher dans la mémoire.
     * Ailleurs, chacune vit dans sa table et personne ne peut les recouper.
     *
     * UN TOUR = UNE LIGNE. Une carte reprise trois fois en porte trois, que la
     * lecture additionne : écrire la seule dernière ferait passer une tâche
     * reprise pour une tâche courte.
     *
     * Seuls les agents de TÂCHE sont mesurés : le cadrage discute des
     * demandes, il ne fait pas le travail d'une carte, et mêler ses tours
     * fausserait toutes les moyennes.
     *
     * RIEN DE SENSIBLE N'Y ENTRE : des nombres, un identifiant de carte, et les
     * NOMS des sujets de mémoire ouverts. Aucun texte de demande, de réponse ou
     * de fait.
     */
    if (agent.role === 'task') {
      try {
        const memoire = store.consultationsDeLAgent(agent.id);
        const mesure = {
          cardId: agent.cardId,
          projectId: agent.projectId,
          agentId: agent.id,
          issue: (failed
            ? 'echec'
            : reprise || panneDefinitive
              ? 'interrompue'
              : 'terminee') as IssueDeTache,
          tours: runState.usage?.turns ?? 1,
          tokensEntree: runState.usage?.inputTokens ?? 0,
          tokensCache: runState.usage?.cachedTokens ?? 0,
          tokensSortie: runState.usage?.outputTokens ?? 0,
          secondes: elapsedSeconds,
          memoire,
          at: Date.now(),
        };
        store.recordTelemetrieTache({ ...mesure, note: noteDeQualite(mesure).note });
      } catch (err) {
        // Une mesure ratée ne fait pas rater un tour : elle se dit et s'oublie.
        log.error('télémétrie de la tâche impossible', err);
      }
    }
  }

  if (onComplete) {
    try {
      await onComplete(finalText, !failed, measurement);
    } catch (err) {
      log.error('post-traitement du tour impossible', err);
    }
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
   * ET LE GESTE QUE PERSONNE N'A VU. Un tour qui s'achève sans question laisse
   * souvent une carte qui attend quelque chose : le plan peut être généré, il
   * peut être validé, la tâche peut partir. Ce signal-là ne naît d'aucun
   * message — il se DÉDUIT de l'état de la carte une fois le tour tu
   * (`attentesDeGeste`, `store.ts`) — donc rien ne le diffusait. On recalcule
   * l'attention à la vraie fin de tour, et à ce seul instant : jamais à chaque
   * bribe de texte.
   */
  if (agent.cardId) bus.emit({ type: 'attention', ...store.signalAttention() });

  /*
   * CE QUE LE RANGEMENT A COÛTÉ, écrit une fois pour toutes sur la réponse.
   * Entre la réponse figée et cette ligne, le démon a comprimé le fil, constaté
   * le dépôt, refermé le dossier de la carte et fusionné sa branche — du
   * travail invisible, qui explique pourquoi l'agent tenait encore son tour
   * alors que sa réponse était là depuis un moment.
   */
  noterLeRangement(runState);

  retirerLeTourVivant(agent.id);
  bus.emit({ type: 'capacity', capacity: (await import('./capacity.js')).etatCapacite() });

  /*
   * LA RELÈVE PART UNE FOIS LE TOUR SORTI DES VIVANTS. Avec un quota frais, le
   * même agent repart automatiquement ; sinon la décision manuelle existante
   * s'affiche et prévient comme avant.
   *
   * L'agent reste malgré tout marqué EN PRÉPARATION à cet instant : cette fin
   * de tour se déroule dans `startTurn`, que `preparerLeTour` attend encore.
   * La reprise passe donc par la file — c'est normal, elle y prend son rang —
   * et la file lui rend son compte imposé et son silence en la dépilant
   * (`enchainerLaFile`). Tant qu'elle ne le faisait pas, la reprise repartait
   * sur le compte que la limite venait de fermer, et la question de compte
   * revenait sans fin.
   */
  if (reprise) {
    const repartie = await reprendreAutomatiquement(runState.messageId);
    if (!repartie) {
      poserDecisionDeReprise({
        messageId: runState.messageId,
        agent: finalAgent,
        reprise,
      });
    }
  }

  if (erreurAPoser) {
    poserDecisionErreurDeTour({
      messageId: runState.messageId,
      agent: finalAgent,
      cause: causeErreurDeTour,
    });
  }

  // Dès que l'agent se tait, il regarde sa file et enchaîne tout seul.
  enchainerLaFile(agent.id);
}

/**
 * CE QUE TOUS LES MOTEURS D'UN TOUR PARTAGENT : dossier, portée, pont, garde,
 * verrou, listes d'outils et environnement. Construit une seule fois par
 * `startTurn`, jamais recopié champ par champ — un chemin qui en oubliait un
 * partait sans garde ni dossiers déclarés.
 */
type SocleDuLancement = Pick<
  Parameters<EngineAdapter['run']>[0],
  | 'cwd'
  | 'projectRoot'
  | 'dossiersLisibles'
  | 'mcpConfigPath'
  | 'mcpBridgePath'
  | 'gardeDuDemonPath'
  | 'verrouAnalysePath'
  | 'fullAccess'
  | 'role'
  | 'allowedTools'
  | 'disallowedTools'
  | 'env'
>;

interface OptionsCompression {
  adapter: ReturnType<typeof adapterFor>;
  /** Le MÊME socle que le tour qui vient de finir. */
  lancement: SocleDuLancement;
  sessionId: string | null;
  systemPrompt: string;
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
    // Le même identifiant court que dans le prompt : une reprise ne renomme
    // jamais une image dont l'agent parlait deux messages plus haut.
    .map((attachment) => `#${aliasDe(attachment!)} — ${cheminDePieceJointe(attachment!)}`);

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
    memoire: memoireDeReprise(project.id, agent, card),
    motif,
  });
}

/**
 * LA MÉMOIRE QU'UNE REPRISE RECHARGE : les IDENTIFIANTS et titres des unités que
 * la recherche locale rattache au travail en cours, rangés par type — jamais un
 * corps, que l'agent rouvre avec l'outil « memoire ». Le texte examiné est le
 * même pour TOUS les rôles : carte, titre de l'agent, rôle réunis.
 */
function memoireDeReprise(projectId: string, agent: Agent, card: Card | null): MemoireDeReprise | undefined {
  const texte = [card?.title, card?.description, agent.title, agent.role].filter(Boolean).join('\n');
  const pistes = pistesParLesMots(projectId, texte);
  if (!pistes.length) return undefined;
  const parType = new Map<TypeUnite, string[]>();
  for (const { unite } of pistes) parType.set(unite.type, [...(parType.get(unite.type) ?? []), `${unite.id} — ${unite.titre}`]);
  return { sujets: [...parType].map(([id, faits]) => ({ id, libelle: LIBELLE_TYPE[id], faits })), autres: [] };
}

async function compresserContexte(agent: Agent, options: OptionsCompression): Promise<void> {
  if (!agent.context?.pending) return;

  if (options.adapter.compact && options.sessionId) {
    const native = await options.adapter.compact({
      ...options.lancement,
      prompt: '/compact',
      model: agent.run.model,
      thinking: agent.run.thinking,
      sessionId: options.sessionId,
      systemPrompt: options.systemPrompt,
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
  /** Le MÊME socle que le tour : la relance du plan a besoin du pont d'outils. */
  lancement: SocleDuLancement;
  agent: Agent;
  sessionId?: string | null;
  consigne: string;
  /**
   * LES OUTILS DU DÉMON QUE LA RELANCE GARDE OUVERTS. Elle ferme tout
   * d'ordinaire — elle ne rend qu'un texte — ; la relance du plan du cadrage,
   * elle, a besoin de `rendre_plan` : c'est par lui que le plan s'écrit.
   */
  outilsOuverts?: string[];
  /**
   * LES OUTILS DU MOTEUR QUE LA RELANCE GARDE OUVERTS. La relance du rapport
   * qui doit attendre des tâches de fond a besoin de `Bash` et `Read` pour
   * relire leur sortie, ou rejouer la commande au premier plan.
   */
  outilsNatifsOuverts?: string[];
  /** Le plafond de la relance ; le court plafond d'après réponse à défaut. */
  plafondMs?: number;
  /**
   * LE TOUR QUE CETTE RELANCE PROLONGE. Ses événements y comptent comme signes
   * de vie : c'est elle qui travaille, plus le processus du tour.
   */
  runState?: LiveRun;
}): Promise<string> {
  let texte = '';
  let erreur = false;
  const ouverts = new Set([
    ...(options.outilsOuverts ?? []).map((outil) => `mcp__beluga__${outil}`),
    ...(options.outilsNatifsOuverts ?? []),
  ]);
  const handle = options.adapter.run({
    ...options.lancement,
    // La relance ne rend qu'un texte : aucun outil de terrain, donc aucun verrou.
    verrouAnalysePath: undefined,
    allowedTools: undefined,
    prompt: options.consigne,
    model: options.agent.run.model ?? undefined,
    thinking: options.agent.run.thinking,
    sessionId: options.sessionId,
    role: options.agent.role,
    disallowedTools: OUTILS_FERMES_POUR_LA_RELANCE.filter((outil) => !ouverts.has(outil)),
    // Une relance de forme ne vaut pas qu'on retienne l'agent : au plafond, on
    // garde le texte d'origine plutôt que d'attendre un moteur muet.
    plafondMs: options.plafondMs ?? PLAFOND_APPEL_APRES_REPONSE_MS,
    surLancement: suivreLeService(options.agent.id),
    onEvent: (event) => {
      if (options.runState) options.runState.dernierSigneDeVie = Date.now();
      if (event.kind === 'text' && event.text) texte += `${texte ? '\n\n' : ''}${event.text}`;
      if (event.kind === 'error') erreur = true;
    },
  });
  const resultat = await handle.finished;
  return resultat.ok && !erreur ? texte.trim() : '';
}

/** L'étape qui dit, dans le fil, que le rapport de la carte a été redemandé. */
const ETAPE_RAPPORT_RELANCE_ID = 'rapport-relance';
const ETAPE_RAPPORT_RELANCE = 'Compte rendu redemandé au gabarit';

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
  ...toolsFor('task', { creation: true }).map((outil) => `mcp__beluga__${outil.name}`),
  ...toolsFor('cadrage', { creation: true }).map((outil) => `mcp__beluga__${outil.name}`),
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
    ...toolsFor(agent.role, { creation: true }).map((outil) => `mcp__beluga__${outil.name}`),
  ];
  const handle = options.adapter.run({
    ...options.lancement,
    // Un résumé sans outil : ni pont, ni verrou, ni liste blanche.
    mcpConfigPath: undefined,
    verrouAnalysePath: undefined,
    allowedTools: undefined,
    prompt:
      'COMPRESSION INTERNE — sans outil et sans question. Résume ce fil pour ton prochain démarrage en 1 200 mots maximum. ' +
      "Conserve l'objectif actif, les décisions même formulées librement, ce qui est terminé, ce qui reste à faire, " +
      'les noms exacts utiles et les pièges à éviter. Réponds uniquement par le résumé.',
    model: agent.run.model,
    thinking: agent.run.thinking,
    sessionId: options.sessionId,
    fullAccess: false,
    disallowedTools: outilsInterdits,
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

/**
 * LA REPRISE EST CONSOMMÉE À L'INSTANT OÙ SON TOUR PART. Une reprise a trois
 * issues — choisie, consommée, abandonnée — et jamais deux tours : dès que le
 * moteur est lancé sur le compte choisi, la décision se referme pour de bon,
 * la file jette toute copie de cette reprise, et le bloc se replie à l'écran.
 */
function consommerLaReprise(messageId: string | undefined, tourMessageId: string): void {
  if (!messageId) return;
  const message = store.getMessage(messageId);
  const reprise = message?.repriseCompte;
  if (!message || !reprise || reprise.consommeeA) return;
  const consommee = store.saveMessage({
    ...message,
    repriseCompte: { ...reprise, consommeeA: Date.now() },
  });
  bus.emit({ type: 'message.upsert', message: consommee });
  bus.emit({ type: 'attention', ...store.signalAttention() });
  log.info(`reprise consommée : le tour ${tourMessageId} repart sur « ${reprise.choisiLabel ?? reprise.choisi} »`);
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
  /*
   * TOUS les messages encore marqués, pas seulement parmi les cinq derniers.
   * Un orphelin plus ancien que cette fenêtre n'était jamais éteint, et la
   * veille de quinze secondes continuait pourtant de convoquer son agent à
   * chaque passage, à jamais (§ `store.messagesEnEcriture`). Ordre : du plus
   * récent au plus ancien.
   */
  const enEcriture = store.messagesEnEcriture(agent.id);
  if (!enEcriture.length) return false;
  let eteint = false;
  for (const [rang, message] of enEcriture.entries()) {
    if (
      !options.force &&
      !ecritureOrpheline({
        statut: agent.status,
        finDuTour: agent.endedAt,
        messageEnEcritureA: message.createdAt,
      })
    ) {
      // Le plus récent est encore trop frais pour être dit orphelin : les plus
      // anciens le sont forcément, on continue.
      continue;
    }
    const fige = store.saveMessage({ ...message, streaming: false, todos: tachesRefermees(message) });
    bus.emit({ type: 'message.upsert', message: fige });
    // La progression et l'étape en cours n'appartiennent qu'au message VIVANT :
    // un orphelin d'août ne doit pas venir réécrire la barre d'aujourd'hui.
    if (rang === 0) {
      poserLaProgression(agent.id, fige.todos);
      effacerEtapeEnCours(agent.id);
    }
    log.warn(`écriture orpheline éteinte (agent ${agent.id}, message ${message.id})`);
    eteint = true;
  }
  return eteint;
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
 * À la fin du tour, on complète son chiffrage dans les DEUX sources
 * persistantes (message et table des propositions). Si l'utilisateur a déjà
 * cliqué, la carte reçoit aussi cette mesure tardive sans relancer d'analyse.
 */
function finaliserPropositionsDuTour(
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
    /*
     * D'ABORD LE MOT À LA BOUCLE DE RELANCE, ENSUITE LE MOTEUR. Un tour refermé
     * pendant l'attente d'un nouvel essai voyait sa relance partir quand même,
     * quelques secondes plus tard : un moteur orphelin, qui dépense et dont
     * chaque appel d'outil est refusé. Le drapeau est posé AVANT l'arrêt pour
     * qu'aucune relance ne se glisse entre les deux.
     */
    run.refermeDAutorite = true;
    run.repriseApresPanneJusqua = undefined;
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
  /*
   * Une session coupée avant sa réponse garde ce qu'elle avait déjà mesuré.
   * Les champs jamais rendus restent « unavailable » ; on ne reconstruit rien
   * depuis le texte du message ou depuis un ancien tour.
   */
  if (run && !reponseRendue && agent.cardId) {
    const card = store.getCard(agent.cardId);
    if (card?.agentId === agent.id) {
      const updated = store.saveCard({
        ...card,
        llmSessionMetrics: metriquesDeSessionLlm({
          state: 'interrupted',
          usage: run.usage,
          durationMs: Math.max(0, Date.now() - run.startedAt),
          context: run.context,
        }),
      });
      bus.emit({ type: 'card.upsert', card: updated });
    }
  }
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
    bus.emit({ type: 'capacity', capacity: capacity.etatCapacite() }),
  );
  bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });

  // La file reprend son cours : un message écrit pendant le blocage part enfin.
  enchainerLaFile(agentId);
  return true;
}

/**
 * UN TOUR DONT L'AGENT N'EXISTE PLUS.
 *
 * La veille juge des agents : elle part de la table `agents`
 * (`agentsDeLaVeille`). Un tour dont l'agent a été EFFACÉ de la base lui est
 * donc invisible — et c'est arrivé le 09.09.2026, une suppression en cascade
 * ayant emporté l'agent de tâche qui travaillait (cause corrigée dans
 * `backups.ts`, § `refusDeSupprimerLAgent`). Le tour restait alors inscrit
 * dans `live` pour toujours : son moteur pouvait continuer de tourner, la
 * capacité du système comptait un travail fantôme, et rien ne le disait.
 *
 * On coupe donc ce qui reste, on oublie le tour, et on DIT la suppression à
 * l'écran : le client garde sinon dans son magasin un agent qui n'existe plus,
 * dont le statut et la marque de tour vivant allument le témoin « Réflexion en
 * cours » sans qu'aucun événement ne puisse jamais venir l'éteindre.
 */
function purgerLesToursSansAgent(): number {
  let purges = 0;
  for (const agentId of [...live.keys(), ...demarrant.keys()]) {
    if (store.getAgent(agentId)) continue;
    const run = live.get(agentId);
    if (run) {
      run.refermeDAutorite = true;
      try {
        run.handle.stop();
      } catch {
        /* le processus est déjà parti */
      }
    }
    live.delete(agentId);
    demarrant.delete(agentId);
    couperLesServices(agentId);
    libererLesAttentes(agentId);
    bus.emit({ type: 'agent.delete', id: agentId });
    log.warn(`tour purgé : l'agent ${agentId} a disparu de la base pendant son tour`);
    purges += 1;
  }
  return purges;
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
  refermes += purgerLesToursSansAgent();
  const idsSuivis = [...live.keys(), ...demarrant.keys()];
  for (const agent of store.agentsDeLaVeille(idsSuivis)) {
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
      // Un moteur mort SOUS UNE REPRISE PROGRAMMÉE n'est pas un tour abandonné.
      repriseApresPanneEnCours: !!run?.repriseApresPanneJusqua && maintenant < run.repriseApresPanneJusqua,
      // Un rattrapage (plan, compréhension, compte rendu) travaille dans un
      // SECOND processus : `run.handle` désigne le premier, déjà sorti.
      serviceEnCours: serviceVivant(agent.id),
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
 *
 * ET CE MOT PORTE UNE DÉCISION, PLUS SEULEMENT UN CONSTAT. Un tour tombé APRÈS
 * le moteur pose déjà « Relancer / Ignorer / Arrêter » et allume le triangle
 * orange (`erreurDeTourAPoser`, fin de `startTurn`). Un tour mort AVANT lui
 * n'atteignait jamais ce code : la demande de l'utilisateur restait au fil sous
 * une phrase grise, sans alerte, sans bouton, et il ne lui restait qu'à la
 * retaper — deux fois de suite le 05.09.2026, sur deux cartes voisines. Le même
 * guichet sert donc les deux, et la demande jamais partie voyage avec
 * (`demandeARejouer`) pour que « Relancer » la RENVOIE au lieu de demander de
 * poursuivre un travail qui n'a pas commencé.
 */
function direLeBlocage(agentId: string, raison: string): void {
  try {
    const dernier = [...store.listMessages(agentId, 1)].pop();
    if (dernier?.role === 'assistant' && (dernier.error || dernier.content.trim())) return;
    /*
     * LA DEMANDE PERDUE, quand il y en a une : le dernier message du fil est
     * celui de l'utilisateur, écrit à l'entrée de la préparation et resté sans
     * la moindre réponse. Un appel interne du démon (publication, analyse) n'en
     * a pas : sa relance garde alors le texte de reprise ordinaire.
     */
    const demandeARejouer = dernier?.role === 'user' && dernier.content.trim() ? dernier.id : undefined;
    const message = store.saveMessage(
      Message.parse({
        id: store.newId(),
        agentId,
        role: 'assistant',
        content: raison,
        error: raison,
        erreurDeTour: { cause: raison, at: Date.now(), demandeARejouer },
        createdAt: store.now(),
      }),
    );
    bus.emit({ type: 'message.upsert', message });
    const agent = store.getAgent(agentId);
    if (agent) poserDecisionErreurDeTour({ messageId: message.id, agent, cause: raison });
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
 * par Beluga Build et identique partout ; seul le nom de l'outil qui l'exécute
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
  // MiMo tourne dans l'outil de Claude : mêmes outils de liste.
  mimo: "l'outil « TaskCreate » puis « TaskUpdate » (une tâche par appel, mise à jour par son numéro)",
};

/**
 * LA MÉTHODE DE TRAVAIL, décidée par Beluga Build et identique pour tous les moteurs.
 * Sans elle, chaque modèle choisissait seul ce qu'il allait lire et comment il
 * allait raisonner : à demande égale, Codex et Claude ne regardaient pas les
 * mêmes fichiers et ne ressortaient pas les mêmes constats. Le texte ne nomme
 * donc AUCUN outil propre à un moteur — seuls les outils du projet, communs aux
 * deux, y figurent.
 */
/**
 * LE SILENCE SUR LES IDENTIFIANTS STOCKÉS, écrit UNE FOIS et servi à tous les
 * rôles — agent de cadrage compris, dont la consigne ne porte plus la MÉTHODE
 * entière. Deux copies auraient divergé à la première réécriture.
 *
 * ET SURTOUT, DEPUIS LE 29/08/2026, UN CONTRAT POSITIF : le coffre-fort est
 * OUVERT à tout agent, en lecture ET en écriture, et sa consultation est le
 * PREMIER geste dès qu'un accès manque. L'ancien texte se contentait de dire
 * « appelle-le avant de redemander » : les agents continuaient d'annoncer
 * « je n'ai pas accès » ou de renvoyer la balle (« fournis-moi la clé »,
 * « débrouille-toi ») sans avoir seulement listé le coffre — un refus FAUX, sur
 * un accès qui était là. Le vocabulaire du refus est donc nommé et interdit, et
 * la panne ne se dit plus qu'APRÈS la recherche.
 */
const SILENCE_IDENTIFIANTS = `SILENCE SUR LES IDENTIFIANTS STOCKÉS : les mots de passe, clés, jetons et fichiers d'identifiants gardés dans le projet sont un choix ASSUMÉ par l'utilisateur. Tu ne le signales pas, ne le commentes pas et ne recommandes rien à ce sujet — ni dans ta réponse, ni dans une carte proposée, ni dans une alerte, même en passant. Tu peux les lire et t'en servir comme n'importe quel fichier.
LE COFFRE-FORT (outil « coffre_fort ») EST LA CENTRALE DES IDENTIFIANTS, ET IL T'EST OUVERT EN LECTURE ET EN ÉCRITURE SUR TOUT CE QU'IL CONTIENT : les accès de TOUS les projets et ceux de Beluga Build, quel que soit le projet où tu travailles. DÈS QU'IL TE FAUT UN ACCÈS — clé, mot de passe, jeton, connexion SSH, base de données —, TON PREMIER GESTE EST « lister », AVANT toute question et AVANT tout constat d'échec. Chercher est TON travail, jamais celui de l'utilisateur.
TU NE DIS JAMAIS « je n'ai pas accès », « je n'ai pas les droits », « il me faudrait la clé » NI « à toi de regarder » : l'accès t'a été donné, et annoncer une porte fermée sans avoir ouvert le coffre est FAUX. Tu ne renvoies pas non plus la balle — pas de « fournis-moi l'identifiant », pas de « débrouille-toi », tant que tu n'as pas cherché toi-même.
Une PANNE se dit toujours, mais APRÈS avoir cherché : un identifiant absent du coffre, expiré ou refusé par la machine s'annonce en toutes lettres, en disant ce que tu as cherché et ce qui manque exactement.
Toute clé NOUVELLE que tu découvres ou reçois pendant le travail (donnée dans la conversation, générée par toi, trouvée dans un fichier non versionné) s'ENREGISTRE aussitôt avec « enregistrer », jamais laissée seulement dans un message ou un fichier du dépôt.
UNE FICHE PAR SECRET : chaque mot de passe, clé ou jeton a sa propre fiche, du bon type, nommée d'après ce qu'il ouvre et son environnement. Un fichier plein d'accès (.env, config.php…) ne se colle jamais en entier : il donne une fiche par secret, et le coffre refuse une fiche qui en regroupe plusieurs. « supprimer » archive six mois, il n'efface pas.`;

const METHODE = `MÉTHODE DE TRAVAIL IMPOSÉE (elle vient de Beluga Build, pas de toi : applique-la telle quelle, dans cet ordre) :
1. LIRE AVANT DE RÉPONDRE : le fichier d'instructions du moteur cité dans le briefing, puis la BASE DE CONNAISSANCES du projet. Son ACCUEIL est déjà dans ton contexte — la tête du projet, « À ne jamais supposer », les unités P0 et P1, et le changelog récent, qui dit ce qui a déjà été fait — : lis-le. Pour le reste, l'outil « memoire » : geste « chercher » avec les mots précis de ta tâche dans « demande » et son « contexte », qui rend des UNITÉS pondérées du projet puis du global, puis « lire » l'unité utile par son « id » (ou une fiche numérotée, ou le « changelog »). Les PISTES données au lancement sont déjà des identifiants : ouvre celles qui te servent. La recherche est locale et ne coûte aucun quota. Puis les fichiers réellement concernés — repérés par une recherche dans le projet, jamais devinés de mémoire.
2. CONSTATER PAR ÉCRIT avant de conclure : ce que le projet fait aujourd'hui, ce que la demande veut, ce qui manque entre les deux. C'est ce qui remplit la section « Analyse » de ta réponse.
3. NE RIEN INVENTER : un fichier, une commande ou un comportement ne se cite qu'après l'avoir vu. Ce que tu n'as pas vérifié se dit comme une hypothèse, en toutes lettres.
4. VÉRIFIER À LA FIN : rejoue les contrôles du projet qui touchent à ce que tu as changé, et donne leur résultat, même en échec. Un échec tu, c'est un travail rendu faux.
5. ${SILENCE_IDENTIFIANTS}
6. UNE QUESTION SE POSE AVEC L'OUTIL « ask_user », JAMAIS EN TEXTE SIMPLE : dès qu'un choix ne t'appartient pas — une option à retenir, une préférence, une information qui te manque —, tu appelles « ask_user » et tu attends la réponse. L'ATTENTE SE FAIT TOUTE SEULE : cet outil ne te rend la main qu'une fois l'utilisateur ayant répondu, et sa réponse arrive comme résultat de l'appel — tu n'as donc AUCUNE étape suivante à commencer en attendant, et tu reprends ton travail à partir de cette réponse. Une question écrite à la fin de ta réponse ne réveille personne : ton tour se termine, l'utilisateur ne voit aucune alerte, et la carte reste bloquée sans que personne ne sache qu'elle t'attend. Tu ne finis donc JAMAIS un tour sur une question posée en texte. Ce qui peut être tranché par ce que tu as lu se tranche : tu annonces ton choix en une ligne et tu continues.
7. CE QUE TU APPRENDS DE DURABLE SE RANGE, IL NE S'EMPILE PAS : un FAIT (décision, piège, convention) s'écrit avec « remember », sous le thème qui convient ; un fait devenu faux se REMPLACE en passant le début de l'ancienne ligne dans « replaces », jamais en ajoutant une ligne à côté. Une RÈGLE durable s'écrit dans le fichier d'attente que le briefing nomme, JAMAIS dans le fichier d'instructions du moteur : le démon la range la nuit.`;

/** Le rappel envoyé aux tours SUIVANTS, quand le moteur ne recolle pas ses consignes tout seul. */
export function rappelDeMethode(
  engine: EngineId = 'claude',
  langue: LangueId = LANGUE_DORIGINE,
): string {
  const outilListe = OUTIL_LISTE[engine] ?? OUTIL_LISTE.claude;
  return (
    `${consigneDeLangue(langue)}\n${RAPPEL_DE_VULGARISATION}\n` +
    'RAPPEL DE MÉTHODE (donné au début du fil, toujours valable) : ' +
    `annonce ta liste de tâches avec ${outilListe} et coche-la au fur et à mesure ; ` +
    'lis avant de répondre (instructions du moteur, outil « memoire », fichiers concernés) ; ' +
    "n'affirme rien que tu n'aies vérifié ; rejoue les contrôles du projet et dis leur résultat ; " +
    'ne signale ni ne commente JAMAIS le stockage de mots de passe, clés ou identifiants dans le projet ' +
    "(une panne d'identifiant qui te bloque, elle, se dit) ; " +
    "un accès qui te manque se cherche D'ABORD dans le coffre-fort (outil « coffre_fort », action " +
    "« lister »), ouvert en lecture et en écriture à tout agent — ne dis jamais « je n'ai pas accès » " +
    'et ne renvoie jamais la balle à l\'utilisateur sans avoir cherché ; ' +
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
const CONSIGNE_DEPANNAGE = `Tu travailles dans Beluga Build. Réponds très court.

TU ES UN AGENT DE DÉPANNAGE appelé PENDANT une publication déjà en cours. Une seule chose bloque, elle t'est nommée dans la demande : tu la répares, tu t'arrêtes. Tu n'ouvres pas le projet en grand, tu ne cherches pas de travail à côté, tu n'annonces pas de liste de tâches.
Fais EXACTEMENT les gestes demandés, dans l'ordre donné, et rien d'autre. Ce qui n'est pas dans la demande n'est pas de ton ressort.
NE PUBLIE RIEN et NE REDÉMARRE RIEN : la publication reprend toute seule dès que ton tour est fini.
NE RIEN INVENTER : un fichier, une commande ou un comportement ne se cite qu'après l'avoir vu. Si tu n'arrives pas à réparer, dis-le en une phrase avec ce qui bloque encore — un échec tu, c'est une publication qui repart sur du faux.
SILENCE SUR LES IDENTIFIANTS STOCKÉS : les mots de passe, clés, jetons et fichiers d'identifiants gardés dans le projet sont un choix ASSUMÉ par l'utilisateur. Tu ne le signales pas, ne le commentes pas et ne recommandes rien à ce sujet.
S'IL TE FAUT UN ACCÈS, CHERCHE-LE D'ABORD DANS LE COFFRE-FORT (outil « coffre_fort », action « lister ») : il t'est ouvert en lecture et en écriture. Ne dis JAMAIS « je n'ai pas accès » ni « donne-moi la clé » sans l'avoir listé. Une PANNE se dit toujours, mais après avoir cherché : un identifiant absent du coffre, expiré ou refusé qui bloque ton travail s'annonce en toutes lettres.`;

/**
 * LA CONSIGNE DE L'AGENT OUVERT PAR « RÉSOUDRE LE PROBLÈME ».
 *
 * Même esprit que le dépannage automatique — une panne nommée, réparée sur
 * place —, à une différence près : la publication est déjà TOMBÉE, personne ne
 * la reprendra à sa place. C'est donc lui qui la relance, par l'outil
 * `relancer_publication`, et par lui seul : jamais une nouvelle publication,
 * jamais une mise en production que l'utilisateur n'a pas lancée, jamais un
 * redémarrage du démon Beluga.
 */
const CONSIGNE_DEPANNAGE_MANUEL = `Tu travailles dans Beluga Build. Réponds court, en mots simples : l'utilisateur ne programme pas.

TU ES L'AGENT DE DÉPANNAGE D'UNE PUBLICATION TOMBÉE. L'utilisateur a cliqué « Résoudre le problème » : la demande te nomme l'étape tombée, son message et la fin de son journal. Trouve la cause, répare-la, puis relance la publication.
1. COMPRENDS avant de toucher : relis le message et le journal, rejoue la commande qui a échoué si c'est sans danger. Une saturation de la machine (fork, EAGAIN, ENOMEM, « Resource temporarily unavailable ») n'est PAS une erreur de code : ne corrige rien, relance.
2. RÉPARE au plus court, dans le dossier du projet : « git add » NOMMÉ fichier par fichier, jamais « git add -A » ; un commit poussé si tu as changé du code.
3. RELANCE avec l'outil « relancer_publication », UNE fois la réparation faite. Il rejoue la même publication, à la même étape, dès la fin de ton tour. C'est le SEUL geste de publication qui t'est permis : tu ne lances jamais une autre publication, ni une mise en production, par aucun autre moyen.
NE REDÉMARRE JAMAIS le serveur Beluga Build (son service, son processus) : d'autres agents et publications en dépendent.
Si la cause te dépasse ou demande un choix, pose la question avec l'outil « ask_user », jamais en texte simple. Si tu ne peux pas réparer, dis-le en une phrase avec ce qui bloque encore, et ne relance pas.
NE RIEN INVENTER : un fichier, une commande ou un comportement ne se cite qu'après l'avoir vu.
SILENCE SUR LES IDENTIFIANTS STOCKÉS : les mots de passe, clés, jetons et fichiers d'identifiants gardés dans le projet sont un choix ASSUMÉ par l'utilisateur. Tu ne le signales pas, ne le commentes pas et ne recommandes rien à ce sujet.
S'IL TE FAUT UN ACCÈS, CHERCHE-LE D'ABORD DANS LE COFFRE-FORT (outil « coffre_fort », action « lister ») : il t'est ouvert en lecture et en écriture. Ne dis JAMAIS « je n'ai pas accès » sans l'avoir listé.`;

/**
 * Les consignes de rôle. EXPORTÉ pour être vérifié par un test : la règle « toute
 * demande de programmation passe par une carte » se perdrait à la première
 * réécriture du texte si rien ne la retenait.
 */
function corpsDeConsigne(
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
   * Le MOTIF de l'appel, quand il en a un. Deux accueils minimaux existent, et
   * ils n'attendent pas la même chose : un dépannage de publication répare une
   * panne nommée ; l'assistant des backups, lui, configure UN site — il pose
   * ses questions et enregistre une fiche (`shared/src/backups-agent.ts`).
   */
  motif?: MotifDAppel,
): string {
  if (motif === 'configuration-backup') return CONSIGNE_ASSISTANT_BACKUP;
  if (motif === 'configuration-surveillance') return CONSIGNE_ASSISTANT_SURVEILLANCE;
  if (motif === 'configuration-marketing') return CONSIGNE_AGENT_MARKETING;
  if (motif === 'depannage-manuel') return CONSIGNE_DEPANNAGE_MANUEL;
  if (niveau === 'minimal') return CONSIGNE_DEPANNAGE;

  // Le déroulé est le MÊME quel que soit le moteur : c'est Beluga Build qui décide,
  // pas le modèle. Seul le NOM de l'outil de liste change d'un moteur à l'autre.
  // On n'annonce donc à chaque moteur QUE son propre outil — lui présenter le
  // menu des deux reviendrait à lui laisser le choix, ce qu'on veut éviter.
  const outilListe = OUTIL_LISTE[engine] ?? OUTIL_LISTE.claude;
  const common =
    'Tu travailles dans Beluga Build. ' +
    "Tu ne publies JAMAIS de ta propre initiative : la mise en ligne est un geste de l'utilisateur.\n\n" +
    "DÉROULÉ VISIBLE (obligatoire dès que la demande tient en plus d'une action) :\n" +
    `1. AVANT d'agir, annonce ta liste de tâches avec ${outilListe} : une ligne par action prévue, formulée simplement.\n` +
    "2. Passe la ligne en cours à « en cours », et coche-la dès qu'elle est terminée, AVANT d'attaquer la suivante. Une seule ligne en cours à la fois.\n" +
    "Cette liste s'affiche dans la conversation et se coche sous les yeux de l'utilisateur : c'est ainsi qu'il suit ton avancement. Ne la recopie pas en texte, elle est déjà à l'écran.\n\n" +
    `${METHODE}\n\n` +
    /* Vaut pour TOUS les rôles : celui qui monte le projet comme celui qui
       propose la carte qui le montera. Un projet monté sans adresse est un
       projet dont chaque déploiement finira sans rien à contrôler. */
    `${CONSIGNE_CREATION_PROJET}`;

  /*
   * L'AGENT DE CADRAGE reçoit une consigne COURTE, la sienne, et rien du
   * déroulé général : il ne lit pas le projet, ne coche pas de liste de tâches
   * et ne rend aucun compte rendu à titres — il discute un besoin, puis écrit
   * la carte. Le silence sur les identifiants reste : il vaut quoi qu'il fasse.
   */
  if (role === 'cadrage') {
    return `${CONSIGNE_CADRAGE}

UNE QUESTION SE POSE AVEC L'OUTIL « ask_user », JAMAIS EN TEXTE SIMPLE : une question écrite à la fin de ta réponse ne réveille personne. Ce qui peut être tranché se tranche : tu annonces ton choix en une ligne et tu continues.

${SILENCE_IDENTIFIANTS}`;
  }

  if (role === 'analysis') {
    return `${common}

TU ES L'AGENT D'ANALYSE. Tu n'écris ni ne modifies aucun fichier : tu lis le projet et tu chiffres.
Distingue TOUJOURS deux durées : ta durée machine (secondes d'exécution de l'agent) et les heures qu'un développeur senior facturerait à la main. Les confondre reviendrait à facturer trois minutes pour une journée de travail.`;
  }

  if (role === 'deploy') {
    return `${common}

TU ES L'AGENT DE PUBLICATION. Tu CONFIGURES la mise en production d'un projet : étudier le projet, interroger l'utilisateur avec ask_user, préparer ce qui doit l'être, puis écrire le processus que le bouton « Mise en production » jouera ensuite sans toi. Tu as l'ACCÈS COMPLET, sans branche « tache/… » : tu peux modifier les fichiers du projet dans son dossier, sur sa branche de travail — « git add » NOMMÉ fichier par fichier, jamais « git add -A », un commit poussé par tour, puis tu dis ce que tu as changé. Tu n'exécutes JAMAIS toi-même une mise en ligne.`;
  }

  return `${common}

TU ES UN AGENT DE TÂCHE, en ACCÈS COMPLET : tu lis, tu écris, tu exécutes des commandes, tu enregistres et tu pousses sans demander la permission au coup par coup — le consentement a été donné en validant la carte.
Travaille sur la branche de la carte. Pendant la tâche, ce que tu manipules (pistes, hypothèses, points à revoir) peut aller au « brouillon » de la carte (outil « memoire », geste « brouillon ») : il n'est jamais servi comme mémoire et s'efface à la fermeture de la carte.
À LA FIN, L'ÉTAPE DE PROMOTION : relis ton travail et PROPOSE à la base de connaissances zéro, une ou quelques unités durables — outil « memoire », geste « proposer » (ou « remember » pour un fait d'une ligne) —, en remplaçant (« remplace ») l'unité que ta tâche a rendue fausse. Ne se mémorise JAMAIS : ${CE_QUI_NE_SE_MEMORISE_JAMAIS.join(' ; ')}. Une proposition refusée te dit pourquoi : corrige-la ou renonce. Puis appelle l'outil « memoire », geste « changelog », qui écrit l'entrée du JOURNAL DES CHANGEMENTS, lue par quelqu'un qui ne programme pas (la branche s'ajoute toute seule) : ${CONSIGNES_REDACTION_CHANGELOG.map((c) => c.replace(/^Le TITRE/, '« titre »').replace(/^L’EXPLICATION/, '« explication »').replace(/^Le POIDS/, '« poids »')).join(' ')} Une entrée sans explication, ou dont le titre est un nom de branche, est refusée : réécris-la.
Si ta tâche a changé une règle durable, une architecture ou une commande, dépose-la dans le fichier d'attente que le briefing nomme — jamais dans le fichier d'instructions du moteur, que tu ne modifies pas.`;
}

/**
 * LA CONSIGNE D'UN RÔLE, DANS LA LANGUE DE L'UTILISATEUR.
 *
 * Le corps du texte est le même pour tout le monde ; ce qui change, c'est la
 * LANGUE annoncée en tête. Elle est posée là, avant la méthode, parce qu'un
 * modèle applique le mieux ce qu'il lit en premier — et elle vaut pour TOUS les
 * accueils, dépannage de publication et assistant des backups compris.
 *
 * La langue par défaut reste le français : un appel qui n'en donne aucune (les
 * tests, un outil isolé) rend exactement le texte d'avant, à ce bloc près.
 */
export function rolePrompt(
  role: AgentRole,
  isSelf: boolean,
  engine: EngineId = 'claude',
  niveau: NiveauDAccueil = 'complet',
  motif?: MotifDAppel,
  langue: LangueId = LANGUE_DORIGINE,
): string {
  return `${consigneDeLangue(langue)}\n${CONSIGNE_DE_VULGARISATION}\n\n${corpsDeConsigne(role, isSelf, engine, niveau, motif)}`;
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
const etatCoupureSansMarque = (suspendue?: boolean) => ({
  colonne: 'planned' as const,
  raison: raisonDeCoupure(suspendue),
});

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
  const etat =
    etatApresCoupure(card) ??
    (card.column === 'running' ? etatCoupureSansMarque(card.scheduling?.suspendu) : null);
  if (!etat) return;
  const scheduling = card.scheduling ?? { asap: false, attempts: 0, restarts: 0 };
  const updatedCard = store.saveCard({
    ...card,
    // Après un redémarrage, le processus qui détenait les compteurs a disparu.
    // L'interruption est certaine, les quatre valeurs ne le sont pas.
    llmSessionMetrics: metriquesSessionLlmIndisponibles('interrupted'),
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
