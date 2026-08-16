/**
 * ARRÊTER UN AGENT QUE PLUS AUCUN TOUR VIVANT NE PORTE.
 *
 * Le bouton d'arrêt ne savait faire qu'une chose : retrouver le tour vivant de
 * l'agent et couper son moteur. Sans tour vivant — une préparation restée
 * pendue, une panne qui a mangé la fermeture, un tour d'un démon d'avant — il
 * rendait « faux » et s'arrêtait là : rien ne bougeait à l'écran, aucune erreur
 * n'était dite, et l'agent gardait sa mention « au travail » pour toujours.
 * C'est l'agent « bloqué depuis des milliers d'heures » sur lequel le clic
 * semblait glisser.
 *
 * La règle vit ici, sans base ni disque : quel geste l'arrêt doit-il faire,
 * selon ce qu'on constate de l'agent — et que dire à l'utilisateur dans chaque
 * cas. Le démon l'applique, les tests la rejouent.
 */

import type { StatutDAgent } from './fin-de-tour.js';

/** Ce que le démon constate de l'agent au moment du clic. */
export interface EtatALArret {
  /** Le statut enregistré de l'agent. */
  statut: StatutDAgent;
  /** Un tour vivant porte-t-il encore cet agent (moteur lancé, suivi) ? */
  tourVivant: boolean;
  /**
   * Le tour est-il en cours de PRÉPARATION (parti, mais pas encore de moteur) ?
   * C'est la fenêtre où l'agent est marqué « starting » sans figurer dans les
   * tours vivants : elle pouvait durer pour toujours si la préparation se
   * coinçait, et le bouton n'avait alors rien à couper.
   */
  enPreparation?: boolean;
}

/**
 * Le geste à faire :
 *   - « coupe »   : un moteur tourne, on l'arrête — le chemin de tous les jours ;
 *   - « secours » : plus rien ne tourne mais l'agent se dit au travail, on le
 *                   referme d'autorité pour qu'il cesse enfin de le prétendre ;
 *   - « inactif » : l'agent ne travaillait déjà plus, il n'y a rien à faire.
 */
export type GesteDArret = 'coupe' | 'secours' | 'inactif';

export interface DecisionDArret {
  geste: GesteDArret;
  /** Ce qui est dit à l'utilisateur, dans tous les cas — jamais le silence. */
  message: string;
  /** L'agent était-il réellement en train de travailler ? */
  travaillait: boolean;
}

export const MESSAGE_ARRET_COUPE = "Agent arrêté : son moteur a été coupé.";

export const MESSAGE_ARRET_SECOURS =
  "Cet agent n'avait plus de moteur en marche : il se disait au travail sans que rien ne tourne. Il a été refermé et repasse au repos.";

export const MESSAGE_ARRET_INACTIF = "Cet agent ne travaille plus : il n'y avait rien à arrêter.";

/** L'agent se dit-il au travail ? Les deux seuls statuts qui l'affirment. */
export function seDitAuTravail(statut: StatutDAgent): boolean {
  return statut === 'running' || statut === 'starting';
}

/**
 * Que fait le bouton d'arrêt, ici et maintenant ?
 *
 * Un tour vivant se coupe. Sinon, tout agent qui se DIT encore au travail —
 * « running » ou « starting », préparation comprise — est refermé d'autorité :
 * c'est le seul moyen pour que le clic ait toujours un effet visible, quelle
 * que soit l'ancienneté du blocage. Un agent déjà au repos ne se referme pas,
 * et le dit.
 */
export function decisionDArret(etat: EtatALArret): DecisionDArret {
  if (etat.tourVivant) {
    return { geste: 'coupe', message: MESSAGE_ARRET_COUPE, travaillait: true };
  }
  if (seDitAuTravail(etat.statut) || etat.enPreparation) {
    return { geste: 'secours', message: MESSAGE_ARRET_SECOURS, travaillait: true };
  }
  return { geste: 'inactif', message: MESSAGE_ARRET_INACTIF, travaillait: false };
}

/** La raison écrite sur le tour refermé de force par le bouton d'arrêt. */
export const RAISON_ARRET_DE_SECOURS =
  "Arrêté à la main alors que plus aucun moteur ne tournait : le tour a été refermé pour libérer l'agent.";
