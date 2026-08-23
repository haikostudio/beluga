/**
 * LE DÉPLOIEMENT AUTOMATIQUE D'UN PROJET.
 *
 * Un interrupteur, en tête de la colonne « Terminé », ÉTEINT PAR DÉFAUT. Une
 * fois allumé, il vaut consentement PERMANENT pour ce projet : dès que plus
 * rien ne travaille, les cartes de « Terminé » passent d'elles-mêmes dans « À
 * déployer » et celles qui y attendaient déjà partent avec elles, sans second
 * clic sur « Publier maintenant ».
 *
 * La règle d'or n'est pas enfreinte : rien ne part de la propre initiative
 * d'une machine ou d'un agent — c'est l'utilisateur qui a allumé
 * l'interrupteur, projet par projet, et qui peut l'éteindre à tout moment.
 * Aucun agent ne peut l'allumer : le réglage ne se change que depuis
 * l'interface (`project.update`).
 *
 * CE QUI RETIENT LE LOT, et pourquoi :
 *
 *  - un agent au travail, ou une carte en « En cours » : le dossier du projet
 *    est PARTAGÉ ; publier pendant qu'un agent écrit embarque un fichier à
 *    moitié écrit (`startDeploy` refuse d'ailleurs déjà ce cas) ;
 *  - une carte qui va partir toute seule (départ programmé arrivé à échéance,
 *    « dès que possible ») : le calme est trompeur, le travail reprend dans
 *    quelques secondes ;
 *  - une publication déjà en cours sur ce projet ;
 *  - aucune carte dans « Terminé » ni « À déployer » : il n'y a rien à mettre
 *    en ligne ;
 *  - un travail terminé il y a moins d'une minute : deux cartes d'un même lot
 *    finissent rarement à la même seconde, et on ne veut pas d'une publication
 *    par carte.
 *
 * UNE CARTE QUI ATTEND UNE RÉPONSE NE COMPTE JAMAIS DANS LE LOT, même arrivée
 * dans « Terminé » : une question posée par l'agent restée sans réponse, ou une
 * liste de tâches refermée avec des étapes non faites, disent toutes deux
 * qu'une intervention de l'utilisateur reste due. L'interrupteur ne vaut
 * consentement que pour du travail RÉELLEMENT abouti — l'appelant (côté
 * serveur) exclut donc ces cartes de `cartesTerminees` avant d'appeler cette
 * règle, et compte ce qu'il a retenu dans `cartesEnAttenteDeDecision`.
 *
 * Règle PURE : ni base, ni disque, ni git — l'appelant apporte ce qu'il a lu.
 */

/** Le calme exigé après le dernier travail rendu, avant que le lot ne parte. */
export const DELAI_DE_CALME_MS = 60_000;

export interface EtatDuDeploiementAutomatique {
  /** L'interrupteur de la colonne « Terminé » de ce projet. */
  actif: boolean;
  /** Combien de cartes de « Terminé » sont réellement prêtes à partir. */
  cartesTerminees: number;
  /** Combien de cartes attendent déjà dans « À déployer ». */
  cartesADeployer: number;
  /**
   * Combien de cartes de « Terminé » sont RETENUES par une décision ouverte
   * (question sans réponse) ou une sous-tâche non faite — elles ne comptent
   * pas dans `cartesTerminees`, et ne partiront jamais toutes seules.
   */
  cartesEnAttenteDeDecision: number;
  /** Combien de cartes sont encore dans « En cours ». */
  cartesEnCours: number;
  /** Combien de cartes vont repartir d'elles-mêmes (programmées, « dès que possible »). */
  cartesQuiVontPartir: number;
  /** Combien d'agents travaillent encore dans le dossier (chef d'orchestre exclu). */
  agentsAuTravail: number;
  /** Une publication tourne déjà sur ce projet. */
  publicationEnCours: boolean;
  /** La procédure de l'étape de déploiement est définie. */
  procedureEnPlace: boolean;
  /** Quand le dernier travail a été rendu, en millisecondes — rien si aucune date connue. */
  dernierTravailRenduA?: number;
}

export interface DecisionDeploiementAutomatique {
  /** Le lot part-il maintenant ? */
  partir: boolean;
  /** Ce qui a été décidé, en français, pour le journal du serveur. */
  raison: string;
}

/**
 * Le lot de « Terminé » doit-il partir MAINTENANT ?
 *
 * Chaque refus NOMME ce qui retient, dans l'ordre où on le constate : c'est
 * cette phrase qu'on lit dans le journal quand rien ne part.
 */
export function decisionDeDeploiementAutomatique(
  etat: EtatDuDeploiementAutomatique,
  maintenant: number,
): DecisionDeploiementAutomatique {
  if (!etat.actif) return { partir: false, raison: 'déploiement automatique éteint' };
  if (!etat.procedureEnPlace) return { partir: false, raison: 'aucune procédure de déploiement définie' };
  if (etat.publicationEnCours) return { partir: false, raison: 'une publication tourne déjà' };
  if (etat.agentsAuTravail > 0) {
    return { partir: false, raison: `${etat.agentsAuTravail} agent(s) travaillent encore dans le dossier` };
  }
  if (etat.cartesEnCours > 0) {
    return { partir: false, raison: `${etat.cartesEnCours} carte(s) encore en cours` };
  }
  if (etat.cartesQuiVontPartir > 0) {
    return { partir: false, raison: `${etat.cartesQuiVontPartir} carte(s) sur le point de repartir` };
  }
  if (etat.cartesTerminees + etat.cartesADeployer < 1) {
    if (etat.cartesEnAttenteDeDecision > 0) {
      return {
        partir: false,
        raison: `${etat.cartesEnAttenteDeDecision} carte(s) terminée(s) attendent encore une décision de l'utilisateur`,
      };
    }
    return { partir: false, raison: 'rien à déployer dans « Terminé »' };
  }

  const rendu = etat.dernierTravailRenduA;
  if (typeof rendu === 'number' && maintenant - rendu < DELAI_DE_CALME_MS) {
    return { partir: false, raison: 'le dernier travail vient d’être rendu, on laisse le lot se compléter' };
  }

  return {
    partir: true,
    raison:
      `${etat.cartesTerminees} carte(s) terminée(s), ${etat.cartesADeployer} déjà prête(s) ` +
      'et plus rien au travail : le lot part tout seul',
  };
}
