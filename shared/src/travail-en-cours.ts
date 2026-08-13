/**
 * LE TÉMOIN « RÉFLEXION EN COURS » : qui décide qu'un agent travaille ENCORE.
 *
 * L'interface allumait ce témoin dès qu'un message portait la marque « en cours
 * d'écriture » (`streaming`), sans regarder l'agent. Or cette marque peut rester
 * posée sur un message que plus personne n'écrit :
 *
 *   1. UN TOUR REFERMÉ D'AUTORITÉ fige le message, puis le corps du tour, encore
 *      en train de se dérouler, pousse une dernière bribe de texte — la marque
 *      se rallume derrière la fermeture, et plus rien ne viendra l'éteindre.
 *   2. UN REDÉMARRAGE DU SERVEUR ne nettoyait que les agents encore marqués « au
 *      travail » : un agent déjà en échec gardait son message en écriture pour
 *      toujours.
 *
 * Dans les deux cas, l'agent est au repos et le témoin tourne dans le vide. La
 * règle est donc : L'AGENT FAIT FOI, pas le message — exactement comme la
 * colonne affichée d'une carte (`colonne-affichee.ts`).
 *
 * Une seule nuance, mais elle compte : au DÉPART d'un tour, le message est créé
 * avant que l'agent passe « au travail ». Le statut seul ferait clignoter le
 * témoin pendant la préparation. On compare donc les DATES : un message en
 * écriture né APRÈS la dernière fin de tour appartient au tour qui démarre.
 */

export type StatutDAgentSuivi = 'idle' | 'starting' | 'running' | 'stopped' | 'failed' | 'done';

export interface EtatDuTemoin {
  /** Le statut de l'agent, tel qu'enregistré. Absent : aucun agent connu. */
  statut?: StatutDAgentSuivi;
  /** L'instant où le dernier tour de cet agent s'est refermé, s'il y en a eu un. */
  finDuTour?: number;
  /**
   * La date du message resté marqué « en cours d'écriture », s'il y en a un.
   * Absente : aucun message en écriture, donc rien à trancher.
   */
  messageEnEcritureA?: number;
}

/**
 * Cet agent travaille-t-il vraiment en ce moment ?
 *
 * Vrai tant qu'il est marqué au travail. Sinon, un message resté en écriture ne
 * compte que s'il est né APRÈS la dernière fin de tour connue : plus vieux, il
 * est ORPHELIN — le tour qui l'écrivait est fini depuis.
 */
export function temoinDeTravail(etat: EtatDuTemoin): boolean {
  if (etat.statut === 'running' || etat.statut === 'starting') return true;
  if (etat.messageEnEcritureA === undefined) return false;
  // Aucune fin de tour connue : on ne peut rien reprocher au message, le témoin
  // reste allumé (repli sûr — mieux vaut un témoin de trop qu'un tour invisible).
  if (etat.finDuTour === undefined) return true;
  return etat.messageEnEcritureA > etat.finDuTour;
}

/**
 * Ce message resté « en cours d'écriture » est-il ORPHELIN — c'est-à-dire plus
 * écrit par personne ? C'est la même règle, lue dans l'autre sens : le démon
 * s'en sert pour éteindre la marque, l'interface pour ne pas l'afficher.
 */
export function ecritureOrpheline(etat: EtatDuTemoin): boolean {
  if (etat.messageEnEcritureA === undefined) return false;
  return !temoinDeTravail(etat);
}
