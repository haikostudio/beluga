/**
 * LES AGENTS DE CONFIGURATION DES DEUX ÉTAPES — le dialogue avec l'agent.
 *
 * Refonte du 22/09/2026, complétée le 29/09/2026. La MISE EN PRODUCTION part
 * d'une page blanche : tant que le projet n'a pas de PROCESSUS, rien ne peut
 * partir. Le DÉPLOIEMENT a désormais le sien aussi, FACULTATIF : tant qu'aucun
 * n'est écrit, le déroulé commun reste en service (`publication-simple.ts`) —
 * il est donc toujours « en place ». Pour chaque étape, un agent étudie le
 * projet, INTERROGE l'utilisateur (outil ask_user) puis rend le processus —
 * une suite d'étapes que le bouton déroulera ensuite telle quelle, sans agent.
 * Sa conversation vit dans la rubrique de son étape, dans les réglages du
 * projet ; le processus rendu s'y lit juste au-dessus (`processus-en-place.ts`).
 *
 * Règles PURES : ni base, ni disque, ni date.
 */

import type { CiblePublication } from './etapes-publication.js';
import { agentSystemeTermine } from './cartes-systeme.js';
import { BANDE_GARDE_UN_FINI_MS } from './en-route.js';
import { agentTientSonTour } from './travail-en-cours.js';
import {
  aUnProcessus,
  lireProcessusRendu,
  processusEnTexte,
  type ProcessusDeProduction,
} from './publication-simple.js';

export type ProjetAvecProcedures = {
  miseEnProduction?: { processus?: ProcessusDeProduction; agentId?: string };
  deploiement?: { processus?: ProcessusDeProduction; agentId?: string };
};

/**
 * L'étape est-elle prête à partir ? Le déploiement l'est TOUJOURS ; la mise en
 * production seulement quand son processus a été écrit.
 */
export function procedureEnPlace(projet: ProjetAvecProcedures | undefined, cible: CiblePublication): boolean {
  return cible === 'dev' ? true : aUnProcessus(projet);
}

/**
 * LE BOUTON QUI MÈNE À L'AGENT DE CONFIGURATION. Il disait « Initialiser la
 * mise en production » ; il rouvre désormais la MÊME conversation, qu'elle
 * commence ou qu'elle reprenne : un seul libellé pour les deux.
 */
export function libelleInitier(_cible?: CiblePublication): string {
  return 'Configuration de la procédure';
}

/**
 * LE BOUTON D'EN-TÊTE DES RUBRIQUES « DÉPLOIEMENT » ET « MISE EN PRODUCTION »
 * (30/09/2026). Posé en haut à droite du titre, il ouvre le tiroir de l'agent
 * de configuration, et son libellé dit où l'on en est :
 *   - `question` : l'agent est arrêté sur sa question (ask_user) ;
 *   - `travail` : il tient son tour — une roue tourne à côté du libellé ;
 *   - `reconfigurer` : un processus est écrit et l'agent est au repos ;
 *   - `initialiser` : aucun processus encore.
 * La question passe avant le travail : un agent arrêté sur sa question n'est
 * en travail pour personne.
 */
export type EtatDuBoutonDeConfiguration = 'initialiser' | 'travail' | 'question' | 'reconfigurer';

export function etatDuBoutonDeConfiguration(entree: {
  processus: boolean;
  auTravail: boolean;
  question: boolean;
}): EtatDuBoutonDeConfiguration {
  if (entree.question) return 'question';
  if (entree.auTravail) return 'travail';
  return entree.processus ? 'reconfigurer' : 'initialiser';
}

export const LIBELLE_BOUTON_DE_CONFIGURATION: Record<EtatDuBoutonDeConfiguration, string> = {
  initialiser: 'Initialiser',
  travail: 'Agent au travail…',
  question: 'Répondre à l’agent',
  reconfigurer: 'Reconfigurer',
};

/** L'agent de configuration retenu sur le projet pour cette étape, s'il y en a un. */
export function agentDeConfiguration(
  projet: ProjetAvecProcedures | undefined,
  cible: CiblePublication = 'production',
): string | undefined {
  return (cible === 'dev' ? projet?.deploiement?.agentId : projet?.miseEnProduction?.agentId) || undefined;
}

/** L'étape dont cet agent est l'agent de configuration, ou `null`. */
export function etapeDeLAgentDeConfiguration(
  projet: ProjetAvecProcedures | undefined,
  agentId: string | undefined,
): CiblePublication | null {
  if (!agentId) return null;
  if (projet?.miseEnProduction?.agentId === agentId) return 'production';
  if (projet?.deploiement?.agentId === agentId) return 'dev';
  return null;
}

/**
 * LE SUIVI DE L'INITIALISATION — ce que montrent le bandeau du bas et la
 * vignette spéciale de « En cours » pendant que l'agent de configuration
 * travaille (demande du 26/09/2026 : la zone droite du bandeau restait vide et
 * rien, au tableau, ne disait qu'un agent écrivait la procédure).
 *
 * L'agent n'a ni carte ni branche (DEC-256) : ce n'est PAS une carte, et la
 * vignette ne compte ni dans le compteur de la colonne ni dans son avancement.
 *   - `demarre` / `travail` : il tient son tour (`agentTientSonTour`) ;
 *   - `question` : il attend la réponse de l'utilisateur (ask_user) ;
 *   - `fini` : il vient de finir, depuis moins d'une minute (la même garde que
 *     la bande des agents sans carte) — le BANDEAU le dit, la vignette non ;
 *   - `null` : rien à suivre (pas d'agent retenu, ou agent au repos).
 */
export type EtatDeLInitialisation = 'demarre' | 'travail' | 'question' | 'fini';

export interface AgentPourLInitialisation {
  id: string;
  status?: string;
  tourVivantDepuis?: number;
  attendReponse?: boolean;
  endedAt?: number;
}

export function etatDeLInitialisation(
  projet: ProjetAvecProcedures | undefined,
  agent: AgentPourLInitialisation | null | undefined,
  maintenant: number,
  cible: CiblePublication = 'production',
): EtatDeLInitialisation | null {
  const retenu = agentDeConfiguration(projet, cible);
  if (!retenu || !agent || agent.id !== retenu) return null;
  if (agent.attendReponse === true) return 'question';
  if (agentTientSonTour(agent)) return agent.status === 'starting' ? 'demarre' : 'travail';
  if (agent.endedAt && maintenant - agent.endedAt < BANDE_GARDE_UN_FINI_MS) return 'fini';
  return null;
}

/** La vignette de « En cours » : seulement tant que l'agent travaille ou attend. */
export function vignetteDInitialisationVisible(etat: EtatDeLInitialisation | null): boolean {
  return etat === 'demarre' || etat === 'travail' || etat === 'question';
}

/**
 * L'ÉTAT DE LA VIGNETTE (la carte Système de l'agent de configuration), qui
 * n'est PAS celui du bandeau : le bandeau oublie « terminé » au bout d'une
 * minute (`etatDeLInitialisation`), la vignette, elle, dit « fini » pendant
 * 24 heures (`agentSystemeTermine`, 06/10/2026) — dans « Terminés » des
 * Tableaux de bord ; le tableau d'un projet ne la garde que tant qu'elle est
 * active (`vignetteDInitialisationVisible`). `null` : pas de vignette.
 */
export function etatDeLaVignetteDInitialisation(
  projet: ProjetAvecProcedures | undefined,
  agent: AgentPourLInitialisation | null | undefined,
  maintenant: number,
  cible: CiblePublication = 'production',
): EtatDeLInitialisation | null {
  const retenu = agentDeConfiguration(projet, cible);
  if (!retenu || !agent || agent.id !== retenu) return null;
  const etat = etatDeLInitialisation(projet, agent, maintenant, cible);
  if (vignetteDInitialisationVisible(etat)) return etat;
  return agentSystemeTermine(agent, maintenant) ? 'fini' : null;
}

/* ------------------------------------------------------------------ */
/* LE TOUR NE SE LIVRE PLUS PAR LA RÉPONSE D'UNE REQUÊTE                */
/* ------------------------------------------------------------------ */

/**
 * Un tour de ce tiroir dure une à deux MINUTES : l'agent lit tout le projet
 * avant de parler. Faire attendre la réponse d'une commande pendant tout ce
 * temps rendait le dialogue impossible à suivre et surtout impossible à
 * RATTRAPER — tiroir refermé, page rechargée, serveur redémarré, réseau qui
 * cligne : la question, déjà payée, était perdue sans un mot, et chaque
 * réouverture repayait un tour.
 *
 * Le dialogue vit donc SUR LE SERVEUR, et l'écran ne fait que le suivre. Les
 * règles qui suivent sont pures : elles disent quoi afficher et quand relancer,
 * sans base ni disque.
 */

/** Une bulle du dialogue : ce que l'agent a dit, ce qu'on lui a répondu. */
export type EchangeDeProcedure = { qui: 'agent' | 'moi'; texte: string };

/**
 * LA QUESTION QUE L'AGENT POSE AVEC SON OUTIL, portée jusqu'à sa conversation.
 *
 * Un agent ne finit pas un tour sur une question écrite en texte : la méthode
 * du projet lui impose l'outil `ask_user`, qui ARRÊTE son tour jusqu'à la
 * réponse. Cette question-là s'affichait donc dans la cloche du bandeau (avec
 * toutes les autres décisions attendues) mais NULLE PART dans le tiroir ouvert
 * juste dessous — celui-ci restait sur « L'agent travaille… », sans rien à
 * répondre, alors que c'est exactement l'endroit où on l'attend.
 *
 * L'état du dialogue la porte donc, avec de quoi y répondre sur place :
 * le message qui la tient et son identifiant, comme partout ailleurs.
 */
export type QuestionDeProcedure = {
  messageId: string;
  questionId: string;
  texte: string;
  /** Les choix proposés, quand l'agent en propose : un clic répond. */
  options: { id: string; label: string; description?: string }[];
};

/** Le dialogue d'une étape, tel que le serveur le garde et l'écran l'affiche. */
export type EtatDeProcedure = {
  projectId: string;
  cible: CiblePublication;
  /** L'agent qui mène le dialogue : la question et la réponse dans une session. */
  agentId?: string;
  /** Un tour tourne-t-il en ce moment ? C'est LUI qui allume le témoin. */
  enCours: boolean;
  echanges: EchangeDeProcedure[];
  /** La procédure écrite ET enregistrée, quand le dialogue aboutit. */
  procedure?: string;
  /** Ce qui a empêché le tour d'aboutir, dit en clair. */
  raison?: string;
  /**
   * L'instant où le DERNIER tour est parti : de quoi afficher sa durée pendant
   * qu'il tourne, et de quoi juger ensuite si sa question est encore fraîche.
   * Il n'est donc PAS effacé à la fin du tour — sinon toute question posée
   * tiroir fermé paraissait vieille et se repayait à la réouverture.
   */
  depuis?: number;
  /** La question posée par l'outil de l'agent, tant que personne n'y a répondu. */
  question?: QuestionDeProcedure;
  /**
   * DEPUIS QUAND L'AGENT EST ARRÊTÉ SUR SA QUESTION, lu dans le registre des
   * attentes du serveur — le même pour tous les agents, quelle que soit leur
   * origine (`shared/src/attente-question.ts`). Présent : le témoin dit
   * l'attente et son chronomètre se fige ici. Absent : l'agent travaille
   * vraiment, ou plus rien ne tourne.
   */
  attendDepuis?: number;
};

/**
 * Le témoin de travail : jamais un mot seul, toujours ce qui se passe et depuis
 * quand.
 *
 * …SAUF QUAND L'AGENT ATTEND UNE RÉPONSE. Son appel d'outil est arrêté sur la
 * question affichée juste au-dessus : il ne travaille plus, et l'étape que le
 * moteur avait annoncée en dernier (« Outil ask_user ») ne décrit plus rien.
 * Le témoin dit alors l'attente, et son chronomètre s'arrête à l'instant de la
 * question — le temps de RÉPONDRE n'est pas du temps de travail
 * (`instantDuTemoin`, `shared/src/attente-question.ts`).
 */
/** Le tour attendu n'existe plus : le dire, au lieu de tourner sans fin. */
export const RAISON_TOUR_PERDU =
  'L’agent ne travaille plus sur cette question (serveur redémarré, ou agent arrêté). Rien n’a été écrit : reposez la question.';

/** Ce qu'un tour d'agent a rendu : une question, le processus, ou un échec dit en clair. */
export type IssueDuTour =
  | { question: string }
  /** Le processus, et l'explication en mots simples qui le précédait. */
  | { processus: ProcessusDeProduction; resume?: string }
  | { raison: string };

/**
 * L'ISSUE D'UN TOUR, décidée en un seul endroit. Sans bloc de processus, le
 * texte rendu est une question — l'agent devrait passer par ask_user, mais un
 * texte n'est jamais perdu. Un bloc illisible est dit, pas avalé.
 */
export function issueDuTour(input: { contenu?: string; statut?: string; erreur?: string }): IssueDuTour {
  const erreur = (input.erreur ?? '').trim();
  if (erreur) return { raison: `Le tour de l’agent s’est arrêté : ${erreur}` };
  if (input.statut && input.statut !== 'done') {
    return { raison: `Le tour de l’agent s’est terminé en « ${input.statut} », sans réponse.` };
  }
  const contenu = (input.contenu ?? '').trim();
  if (!contenu) return { raison: 'L’agent n’a rien rendu : aucune question, aucun processus.' };
  const lu = lireProcessusRendu(contenu);
  /* L'explication écrite avant le bloc VOYAGE avec le processus : c'est elle
     que la rubrique de l'étape affiche. */
  if (lu.processus) {
    return {
      processus: lu.explication ? { ...lu.processus, explication: lu.explication } : lu.processus,
      resume: lu.explication,
    };
  }
  if (lu.erreur) return { raison: `Le processus rendu est inutilisable : ${lu.erreur}` };
  return { question: contenu };
}
