/**
 * UN TOUR DE CADRAGE A DEUX FINS, ET IL EN ÉCRIT TOUJOURS UNE.
 *
 * L'agent de cadrage peut CADRER un travail (il appelle `rendre_comprehension`,
 * et la carte porte ce qu'il a compris) ou RÉPONDRE à une question posée dans
 * le fil (il n'écrit rien sur la carte). Rien ne verrouillait ce cheminement :
 *
 *   1. UN TOUR QUI OUBLIAIT SA COMPRÉHENSION NE DISAIT RIEN. Le démon savait
 *      déjà relancer un tour qui n'avait pas tenu sa promesse — mot pour mot,
 *      pour le PLAN (`planManquant`, `shared/src/parcours-carte.ts`) —, mais
 *      rien d'équivalent n'existait pour la compréhension. La carte restait
 *      dans un entre-deux : l'écran proposait de générer le plan alors
 *      qu'aucune compréhension n'avait jamais été rendue, ou l'inverse.
 *   2. L'ISSUE DU TOUR SE DEVINAIT. Le flux en points cherchait la TRACE d'une
 *      réponse rendue dans le passage pour conclure « l'agent a répondu »
 *      (`tourDeReponseSeule`) : dès que cette trace manquait — tour coupé,
 *      journal purgé —, le passage « Compréhension » restait allumé « L'agent
 *      lit le projet… » des heures après la fin du tour.
 *
 * Cette règle tranche donc, sans base ni disque : ce qu'un tour de cadrage
 * DOIT rendre, quand son absence est un manquement, et ce que le démon ÉCRIT
 * sur la carte à la fermeture. Elle se rejoue seule
 * (`server/src/test/tour-de-cadrage.test.ts`).
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
}

/**
 * CE TOUR A-T-IL MANQUÉ SA COMPRÉHENSION ? Les exceptions sont exactement
 * celles du plan : une question ouverte, un tour tombé, un arrêt demandé — et
 * la demande de plan, qui a sa propre relance.
 */
export function comprehensionManquante(tour: TourDeCadrageFini): boolean {
  if (tour.comprehensionRendue) return false;
  if (tour.questionPosee || tour.echec || tour.arretDemande || tour.planDemande) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* 2. LA RELANCE, PUIS L'INCIDENT                                       */
/* ------------------------------------------------------------------ */

/** L'étape visible dans le fil pendant que le démon réclame la compréhension. */
export const ETAPE_COMPREHENSION_RECLAMEE = 'Compréhension réclamée';
export const ETAPE_COMPREHENSION_RECLAMEE_ID = 'comprehension-reclamee';

/**
 * LE MOT QUI DIT « CE TOUR N'ÉTAIT QU'UNE RÉPONSE ». La relance n'a que deux
 * sorties possibles, et aucune n'est le silence : appeler l'outil, ou écrire
 * ce mot. C'est ce qui distingue un oubli d'une discussion — sans quoi le
 * démon poserait un incident sur une simple question bien répondue.
 */
export const MOT_DE_LA_REPONSE_SEULE = 'REPONSE SEULE';

/** La consigne de la relance : elle réclame l'outil, ou le mot, rien d'autre. */
export const CONSIGNE_COMPREHENSION_RECLAMEE = [
  "Ta réponse précédente n'a appelé « rendre_comprehension » à aucun moment.",
  '',
  'DEUX SORTIES, PAS UNE DE PLUS :',
  "— ce message demandait un TRAVAIL à cadrer : appelle « rendre_comprehension » MAINTENANT, avec ce que tu as compris de TOUTE la conversation ;",
  `— ce message n'était qu'une QUESTION, et tu y as répondu dans le fil : réponds exactement « ${MOT_DE_LA_REPONSE_SEULE} », sans rien d'autre.`,
  '',
  "Dans le doute, on CADRE : appelle l'outil.",
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
 *   — `reponse` : l'agent dit que son tour n'était qu'une réponse — on le
 *     croit, et le passage se referme sur sa phrase propre ;
 *   — `incident` : ni l'un ni l'autre. La carte porte l'incident nommé.
 */
export function issueDeLaRelance(etat: {
  comprehensionRendue: boolean;
  texte?: string;
}): 'cadrage' | 'reponse' | 'incident' {
  if (etat.comprehensionRendue) return 'cadrage';
  const dit = (etat.texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
  return dit.includes(MOT_DE_LA_REPONSE_SEULE) ? 'reponse' : 'incident';
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
}): IssueDeTourDeCadrage | null {
  if (etat.echec || etat.arretDemande || etat.questionPosee) return null;
  if (etat.comprehensionRendue || etat.relance === 'cadrage') return 'cadrage';
  if (etat.relance === 'reponse') return 'reponse';
  if (etat.relance === 'incident') return null;
  /* Aucune relance n'a eu lieu et rien n'a été rendu : le tour ne portait pas
     de travail à cadrer (une demande de plan, par exemple). On n'invente pas
     d'issue pour lui. */
  return null;
}
