/**
 * LE MICRO NE S'OUVRE QUE SI ON L'A DEMANDÉ — les règles pures.
 *
 * Sur téléphone, le système allume un repère orange dès qu'un micro est ouvert.
 * Le voir s'allumer alors qu'on n'a rien demandé, c'est croire l'application à
 * l'écoute en permanence : un problème de confiance avant d'être un problème de
 * batterie. Deux causes tenaient à des règles, pas au son :
 *
 *   1. les interrupteurs d'écoute (mot de réveil, conversation vocale) étaient
 *      retenus SUR LE SERVEUR : allumés une fois sur un ordinateur, ils
 *      rouvraient le micro TOUT SEULS au chargement suivant, sur n'importe quel
 *      appareil, sans le moindre geste ;
 *   2. rien n'obligeait à tout refermer quand on quitte l'écran.
 *
 * Ce fichier ne connaît ni micro, ni navigateur : il ne dit QUE ce qui est
 * permis. Le micro lui-même vit dans `web/src/lib/micro.ts`, la seule porte de
 * l'application par où un flux s'ouvre.
 */

/** Ce qui peut se passer et qui doit faire refermer les micros ouverts. */
export interface MomentDeFermeture {
  /** Le nom de l'événement du navigateur. */
  evenement: string;
  /** La page est-elle encore visible ? (`visibilitychange`) */
  visible?: boolean;
  /**
   * Une écoute VOULUE est-elle en cours (mot de réveil, conversation) ? Elle
   * seule survit à un simple passage en arrière-plan — une dictée, non.
   */
  ecouteVoulue?: boolean;
}

/**
 * Faut-il tout refermer ? On quitte la page (`pagehide`, `beforeunload`) : oui,
 * toujours. On passe seulement en arrière-plan : oui aussi, sauf si une écoute
 * a été VOULUE — sinon un mode d'écoute demandé se couperait au premier coup
 * d'œil sur une autre application, sans jamais revenir.
 */
export function fermetureExigee(moment: MomentDeFermeture): boolean {
  if (moment.evenement === 'pagehide' || moment.evenement === 'beforeunload') return true;
  if (moment.evenement === 'visibilitychange' && moment.visible === false) {
    return moment.ecouteVoulue !== true;
  }
  return false;
}
