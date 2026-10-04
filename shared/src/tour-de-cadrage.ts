/**
 * UN TOUR DE CADRAGE PARLE, ET IL ÉCRIT TOUJOURS SON ISSUE.
 *
 * Le cadrage est une DISCUSSION (30/09/2026, `CONSIGNE_CADRAGE`) : chaque tour
 * RÉPOND en texte dans le fil, et ne met la compréhension à jour (outil
 * `rendre_comprehension`) que quand il a fait avancer le travail. Un tour qui
 * a parlé sans rendre de compréhension est donc un tour NORMAL — il écrit
 * l'issue `reponse` — et n'est plus relancé : la relance « Compréhension
 * réclamée » transformait chaque question en incident probable, et forçait
 * l'agent à justifier sa simple réponse par un mot convenu.
 *
 * La relance ne vise plus que le TOUR MUET — ni texte, ni compréhension, ni
 * question : un moteur qui a travaillé sans rien dire. Celui-là est rattrapé
 * une fois ; s'il ne rend toujours rien, l'incident est posé.
 *
 * Deux défauts d'avant restent fermés :
 *
 *   1. UN TOUR QUI NE RENDAIT RIEN NE DISAIT RIEN. La carte restait dans un
 *      entre-deux : l'écran proposait la suite au-dessus d'une étape jamais
 *      franchie. Le tour muet est toujours relancé.
 *   2. L'ISSUE DU TOUR SE DEVINAIT. Le flux en points cherchait la TRACE d'une
 *      réponse rendue pour conclure « l'agent a répondu »
 *      (`tourDeReponseSeule`) : dès qu'elle manquait, le passage
 *      « Compréhension » restait allumé des heures. L'issue s'écrit sur la
 *      carte (`ParcoursDeCarte.issueDuTour`).
 *
 * Règle pure, sans base ni disque (`server/src/test/tour-de-cadrage.test.ts`).
 */

import type { IssueDeTourDeCadrage } from './cadrage.js';

/* ------------------------------------------------------------------ */
/* 1. LE MANQUEMENT                                                     */
/* ------------------------------------------------------------------ */

/** Ce qu'il faut savoir d'un tour de cadrage fini pour le juger. */
export interface TourDeCadrageFini {
  /** Une compréhension a-t-elle été écrite PENDANT ce tour ? */
  comprehensionRendue: boolean;
  /**
   * Une question attend une réponse (outil `ask_user`, ou question posée en
   * texte libre) : l'agent est arrêté, il n'a rien manqué.
   */
  questionPosee?: boolean;
  /**
   * Le tour est tombé — échec ordinaire, limite de compte, panne du
   * fournisseur. Sa bulle porte déjà sa décision : on n'en rajoute pas.
   */
  echec?: boolean;
  /** L'arrêt a été demandé à la main : un geste, jamais un manquement. */
  arretDemande?: boolean;
  /**
   * LE PLAN EST DÉJÀ RÉCLAMÉ PAR AILLEURS. Un tour à qui l'on a demandé le
   * PLAN passe sous `planManquant` : lui réclamer en plus sa compréhension
   * ferait deux relances dans le même tour.
   */
  planDemande?: boolean;
  /**
   * LE TOUR A RENDU UN TEXTE À L'UTILISATEUR. C'est une DISCUSSION : l'agent a
   * répondu, et la compréhension déjà rendue (ou à venir) n'a pas à bouger.
   */
  texteRendu?: boolean;
  /**
   * LA CARTE A CHANGÉ DE PROJET PENDANT CE TOUR (outil `deplacer_vers_projet`).
   * Le cadrage part alors reprendre la demande dans le projet d'accueil, avec
   * une session neuve : ce tour-ci n'a rien à rendre, la compréhension est
   * l'affaire du tour suivant. Le lui réclamer relançait le moteur pendant des
   * minutes, puis posait « La compréhension n'est pas venue » au-dessus d'un
   * cadrage qui travaillait déjà ailleurs.
   */
  carteDeplacee?: boolean;
}

/**
 * CE TOUR EST-IL RESTÉ MUET ? Seul un tour qui n'a rendu NI compréhension NI
 * texte manque quelque chose. Les exceptions : une question ouverte, un tour
 * tombé, un arrêt demandé, la demande de plan (qui a sa propre relance,
 * `planManquant`), et la carte déplacée vers un autre projet — sa
 * compréhension se rend dans le tour de reprise.
 */
export function comprehensionManquante(tour: TourDeCadrageFini): boolean {
  if (tour.comprehensionRendue || tour.texteRendu) return false;
  if (tour.questionPosee || tour.echec || tour.arretDemande || tour.planDemande || tour.carteDeplacee) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* 2. LA RELANCE, PUIS L'INCIDENT                                       */
/* ------------------------------------------------------------------ */

/** L'étape visible dans le fil pendant que le démon réclame la compréhension. */
export const ETAPE_COMPREHENSION_RECLAMEE = 'Compréhension réclamée';
export const ETAPE_COMPREHENSION_RECLAMEE_ID = 'comprehension-reclamee';

/**
 * La consigne de la relance d'un tour MUET : il n'a rien dit à l'utilisateur.
 * Deux sorties : rendre la compréhension, ou répondre enfin — le texte rendu
 * par la relance devient alors la réponse du tour.
 */
export const CONSIGNE_COMPREHENSION_RECLAMEE = [
  "Ton tour précédent s'est terminé sans rien dire à l'utilisateur : aucun texte, et aucun appel à « rendre_comprehension ».",
  '',
  'DEUX SORTIES, PAS UNE DE PLUS :',
  "— la carte n'a encore aucune compréhension et le travail est clair, ou ton tour l'a fait avancer : appelle « rendre_comprehension » MAINTENANT, avec ce que tu as compris de TOUTE la conversation, puis dis-le en une phrase ;",
  "— sinon : écris MAINTENANT ta réponse au dernier message, en texte, comme tu l'aurais fait dans le fil.",
].join('\n');

/** Ce que porte l'incident posé sur la carte quand rien n'est venu. */
export const INCIDENT_COMPREHENSION_NON_RENDUE =
  "Ce tour de cadrage s'est terminé sans rendre ce qu'il avait compris, et la relance n'a rien donné. " +
  'Envoyez un message pour relancer le cadrage : tant qu’aucune compréhension n’est rendue, le plan ne peut pas être demandé.';

/**
 * CE QUE LA RELANCE A DONNÉ. Trois issues, lues sur ce que la carte porte
 * APRÈS la relance et sur le texte qu'elle a rendu :
 *
 *   — `cadrage` : la compréhension est là, le tour est rattrapé ;
 *   — `reponse` : l'agent a enfin répondu en texte — ce texte devient la
 *     réponse du tour ;
 *   — `incident` : toujours rien. La carte porte l'incident nommé.
 */
export function issueDeLaRelance(etat: {
  comprehensionRendue: boolean;
  texte?: string;
}): 'cadrage' | 'reponse' | 'incident' {
  if (etat.comprehensionRendue) return 'cadrage';
  return (etat.texte ?? '').trim() ? 'reponse' : 'incident';
}

/* ------------------------------------------------------------------ */
/* 3. L'ISSUE ÉCRITE                                                    */
/* ------------------------------------------------------------------ */

/**
 * QUELLE ISSUE ÉCRIRE À LA FERMETURE D'UN TOUR DE CADRAGE ?
 *
 * `null` quand il n'y a rien à écrire : un tour tombé, arrêté à la main ou
 * arrêté sur une question n'a pas d'issue — il n'est pas allé au bout, et son
 * message porte déjà ce qui s'est passé.
 */
export function issueAEcrire(etat: {
  comprehensionRendue: boolean;
  relance?: 'cadrage' | 'reponse' | 'incident';
  questionPosee?: boolean;
  echec?: boolean;
  arretDemande?: boolean;
  carteDeplacee?: boolean;
  texteRendu?: boolean;
  planDemande?: boolean;
}): IssueDeTourDeCadrage | null {
  if (etat.echec || etat.arretDemande || etat.questionPosee) return null;
  /* Un tour qui a déplacé la carte n'a pas d'issue : la reprise dans le projet
     d'accueil écrira la sienne (sauf compréhension déjà rendue, plus bas). */
  if (etat.carteDeplacee && !etat.comprehensionRendue) return null;
  if (etat.comprehensionRendue || etat.relance === 'cadrage') return 'cadrage';
  if (etat.relance === 'reponse') return 'reponse';
  if (etat.relance === 'incident') return null;
  /* UN TOUR QUI A PARLÉ SANS METTRE LA COMPRÉHENSION À JOUR A DISCUTÉ. Un
     tour de PLAN n'en est pas un : sa promesse se juge sous `planManquant`. */
  if (etat.texteRendu && !etat.planDemande) return 'reponse';
  /* Aucune relance n'a eu lieu et rien n'a été rendu : le tour ne portait pas
     de travail à cadrer (une demande de plan, par exemple). On n'invente pas
     d'issue pour lui. */
  return null;
}
