/**
 * ARRÊTER UN AGENT — ET QUE LE CLIC MORDE TOUJOURS.
 *
 * Le bouton d'arrêt ne savait faire qu'une chose : retrouver le tour vivant de
 * l'agent et couper son moteur. Sans tour vivant — une préparation restée
 * pendue, une panne qui a mangé la fermeture, un tour d'un démon d'avant — il
 * rendait « faux » et s'arrêtait là : rien ne bougeait à l'écran, aucune erreur
 * n'était dite, et l'agent gardait sa mention « au travail » pour toujours.
 *
 * Restait un cas plus sournois, celui du chef qui « refuse de s'arrêter » : un
 * tour vivant DONT LE MOTEUR N'EST PLUS LÀ. Cela arrive à chaque fin de tour, et
 * cela dure : passé la réponse, le tour continue en SERVICE (relire le quota du
 * compte, comprimer le fil, refermer la copie de travail, ranger la carte) et
 * reste inscrit parmi les tours vivants tout ce temps, l'agent affiché « au
 * travail », son compteur qui court. Le clic tombait alors sur le geste
 * « coupe », envoyait un signal à un processus déjà mort, ne disait rien — et
 * l'agent continuait de se dire au travail. C'est exactement le silence
 * reproché.
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
  /**
   * Le processus du moteur répond-il encore ? `undefined` quand on ne peut pas
   * le savoir (aucun numéro de processus connu) : on suppose alors qu'il vit,
   * pour ne pas refermer d'autorité un tour qui travaille peut-être.
   *
   * Faux, c'est un tour vivant SANS moteur : lui envoyer un signal ne fait rien
   * du tout. Il faut le refermer, pas le « couper ».
   */
  moteurVivant?: boolean;
  /**
   * La réponse est-elle DÉJÀ figée à l'écran ? Au-delà, le tour ne fait plus que
   * du service — et il n'y a plus de réflexion à interrompre, seulement un agent
   * à libérer.
   */
  reponseFigee?: boolean;
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
 * Ce tour vivant a-t-il encore quelque chose à COUPER ?
 *
 * Deux façons de n'avoir plus rien : son processus de moteur ne répond plus, ou
 * sa réponse est déjà figée — le tour ne fait plus que du service derrière
 * l'écran. Dans les deux cas, envoyer un signal ne change rien : c'est une
 * fermeture d'autorité qu'il faut.
 */
export function tourACouper(etat: EtatALArret): boolean {
  if (!etat.tourVivant) return false;
  if (etat.reponseFigee) return false;
  return etat.moteurVivant !== false;
}

/**
 * Que fait le bouton d'arrêt, ici et maintenant ?
 *
 * Un tour vivant qui a encore un moteur à couper se coupe. Sinon, tout agent qui
 * se DIT encore au travail — « running » ou « starting », préparation et tour de
 * service compris — est refermé d'autorité : c'est le seul moyen pour que le
 * clic ait toujours un effet visible, quel que soit l'endroit où le tour est
 * bloqué. Un agent déjà au repos ne se referme pas, et le dit.
 */
export function decisionDArret(etat: EtatALArret): DecisionDArret {
  if (tourACouper(etat)) {
    return { geste: 'coupe', message: MESSAGE_ARRET_COUPE, travaillait: true };
  }
  if (etat.tourVivant || seDitAuTravail(etat.statut) || etat.enPreparation) {
    return { geste: 'secours', message: MESSAGE_ARRET_SECOURS, travaillait: true };
  }
  return { geste: 'inactif', message: MESSAGE_ARRET_INACTIF, travaillait: false };
}

/** La raison écrite sur le tour refermé de force par le bouton d'arrêt. */
export const RAISON_ARRET_DE_SECOURS =
  "Arrêté à la main alors que plus aucun moteur ne tournait : le tour a été refermé pour libérer l'agent.";

/**
 * LE DÉLAI LAISSÉ AU MOTEUR APRÈS LE SIGNAL, avant de refermer d'autorité.
 *
 * Un moteur qui reçoit son coup d'arrêt rend la main en une seconde ou deux : le
 * tour se referme alors tout seul, par son chemin normal, et il n'y a rien à
 * faire de plus. Mais un moteur peut aussi ne jamais répondre — bloqué dans un
 * appel réseau, ou déjà mort sans que sa fin ne soit remontée. On lui laisse
 * donc cette fenêtre, puis on constate : si le tour est toujours là, on le
 * referme sans lui demander son avis.
 *
 * Six secondes : c'est un peu plus que le délai de grâce du signal lui-même
 * (SIGTERM, puis SIGKILL au bout de quatre secondes), pour ne pas refermer
 * par-dessus un moteur qui s'apprêtait à rendre la main.
 */
export const DELAI_CONFIRMATION_ARRET_MS = 6_000;

/** La raison écrite sur un tour que le signal d'arrêt n'a pas suffi à refermer. */
export const RAISON_ARRET_SANS_REPONSE =
  "Arrêté à la main : le moteur n'a pas rendu la main après son signal d'arrêt, le tour a été refermé d'autorité.";

/**
 * FAUT-IL ACHEVER L'ARRÊT ?
 *
 * Appelée un instant après le signal, sur le constat de ce qui reste. Vrai : le
 * même tour est toujours inscrit parmi les tours vivants, donc le signal n'a
 * rien donné et il faut refermer d'autorité. Faux : le tour s'est refermé de
 * lui-même (le cas ordinaire), ou un AUTRE tour a démarré depuis — celui-là ne
 * nous appartient pas, et le refermer couperait un travail que personne n'a
 * demandé d'arrêter.
 */
export function arretAAchever(constat: {
  /** Le tour visé par le clic est-il encore le tour vivant de cet agent ? */
  memeTourEncoreVivant: boolean;
}): boolean {
  return constat.memeTourEncoreVivant;
}
