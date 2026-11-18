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

/*
 * LE MICRO NE VIT PAS HORS DE L'ÉCRAN (décision de l'utilisateur, 16/11/2026) : dans l'application iPhone, le repère
 * orange restait allumé application fermée. L'attente du mot de réveil comptait comme une écoute VOULUE, donc
 * survivait au passage en arrière-plan, et le mode audio de l'application la gardait vivante. Désormais :
 *   — l'attente du mot n'existe QUE page visible ;
 *   — seule une CONVERSATION en cours continue écran verrouillé, jusqu'à sa fin ;
 *   — à sa fin, page cachée, tout se coupe ; l'attente ne reprend qu'au retour à l'écran.
 */
export interface MomentDuMicro {
  /** La page est-elle à l'écran ? */
  visible: boolean;
  /** Une conversation en direct est-elle ouverte ? */
  conversation: boolean;
}

/** L'attente du mot (micro ouvert, rien n'en sort) est-elle permise maintenant ? */
export function attenteDuMotPermise(moment: MomentDuMicro): boolean {
  return moment.visible || moment.conversation;
}

/** Ce qui compte comme écoute VOULUE en arrière-plan : la conversation, et elle seule. */
export function ecouteVoulueHorsEcran(moment: Pick<MomentDuMicro, 'conversation'>): boolean {
  return moment.conversation;
}

/**
 * Le micro d'attente se rouvre-t-il SANS geste au retour à l'écran ? Dans l'application iPhone seulement (décision
 * de l'utilisateur : « Dis Jarvis » attendu dès que l'application est à l'écran), et jamais si l'utilisateur l'a
 * coupé lui-même. Dans le navigateur et l'application installée depuis Safari, il faut toujours un geste.
 */
export function attenteRouverteSansGeste(p: { appNative: boolean; coupeParLUtilisateur: boolean }): boolean {
  return p.appNative && !p.coupeParLUtilisateur;
}
