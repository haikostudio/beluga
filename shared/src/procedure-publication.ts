/**
 * L'INITIALISATION DE LA MISE EN PRODUCTION — le dialogue avec l'agent.
 *
 * Refonte du 22/09/2026. Le DÉPLOIEMENT n'a plus de procédure : il est le même
 * pour tous les projets, sans agent (`publication-simple.ts`) — il est donc
 * toujours « en place ». La MISE EN PRODUCTION, elle, part d'une page blanche :
 * tant que le projet n'a pas de PROCESSUS, le bouton propose de l'INITIALISER.
 * Un agent étudie alors le projet, INTERROGE l'utilisateur (outil ask_user,
 * affiché dans le tiroir) sur l'instance qui accueille la production, puis rend
 * le processus — une suite d'étapes que le bouton « Mise en production »
 * déroulera ensuite telle quelle, sans agent.
 *
 * Règles PURES : ni base, ni disque, ni date.
 */

import type { CiblePublication } from './etapes-publication.js';
import {
  aUnProcessus,
  lireProcessusRendu,
  processusEnTexte,
  type ProcessusDeProduction,
} from './publication-simple.js';

export type ProjetAvecProcedures = {
  miseEnProduction?: { processus?: ProcessusDeProduction; agentId?: string };
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

/* ------------------------------------------------------------------ */
/* LE TIROIR DE LA MISE EN PRODUCTION — deux onglets                    */
/* ------------------------------------------------------------------ */

/**
 * Le bandeau du bas ouvre UN tiroir, calqué sur celui d'une tâche, avec deux
 * onglets : la CONVERSATION avec l'agent de configuration, et la
 * CONFIGURATION qu'il a écrite, suivie du bouton de mise en production.
 */
export type OngletDeProduction = 'conversation' | 'configuration';

/**
 * L'ONGLET D'ENTRÉE : la conversation tant que rien n'est configuré (il n'y a
 * rien d'autre à faire que parler à l'agent), la configuration ensuite — et
 * toujours elle pendant qu'une mise en production se déroule, puisque c'est là
 * que son suivi s'affiche.
 */
export function ongletDEntreeDeProduction(input: { enPlace: boolean; deroule?: boolean }): OngletDeProduction {
  return input.enPlace || input.deroule ? 'configuration' : 'conversation';
}

/** L'agent de configuration retenu sur le projet, s'il y en a un. */
export function agentDeConfiguration(projet: ProjetAvecProcedures | undefined): string | undefined {
  return projet?.miseEnProduction?.agentId || undefined;
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
 * LA QUESTION QUE L'AGENT POSE AVEC SON OUTIL, portée jusqu'au tiroir.
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
     que l'onglet « Configuration » affiche. */
  if (lu.processus) {
    return {
      processus: lu.explication ? { ...lu.processus, explication: lu.explication } : lu.processus,
      resume: lu.explication,
    };
  }
  if (lu.erreur) return { raison: `Le processus rendu est inutilisable : ${lu.erreur}` };
  return { question: contenu };
}
