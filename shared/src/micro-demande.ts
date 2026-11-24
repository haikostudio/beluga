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
 *   — à sa fin, page cachée, tout se coupe ; l'attente ne reprend qu'au prochain geste (24/11/2026, plus bas).
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

/*
 * LE MICRO NE S'OUVRE PLUS JAMAIS SANS GESTE, APPLICATION IPHONE COMPRISE (décision de l'utilisateur, 24/11/2026) :
 * l'attente rouverte d'office au retour à l'écran (16/11/2026) posait la session audio « appel » de l'iPhone, qui
 * COUPAIT LA MUSIQUE à chaque retour dans Beluga. Désormais le micro repart coupé partout ; « Dis Jarvis » s'allume à
 * la main (Réglages › Voix) et se referme en quittant l'écran.
 *
 * ET UNE CONVERSATION REND LE MICRO TEL QU'ELLE L'A TROUVÉ : ouverte micro coupé (bouton du bord, toucher au dos, voix
 * d'une carte…), elle l'ouvre et le REFERME à sa fin — la dernière prise fermée rend la session audio de l'iPhone, et
 * la musique mise en pause reprend. Ouverte alors que « Dis Jarvis » était allumé à la main, elle le laisse ouvert :
 * l'attente du mot reprend.
 */
export interface EtatDuMicro {
  /** Le micro est ouvert (attente du mot, ou conversation). */
  microOuvert: boolean;
  /** Une conversation en direct est ouverte. */
  conversationAllumee: boolean;
  /** Le micro a été ouvert PAR la conversation (il était coupé avant elle) : il se referme avec elle. */
  microParLaConversation: boolean;
}

export type GesteDuMicro =
  /** L'interrupteur « Micro ouvert » des réglages (ou un arrêt qui coupe le micro). */
  | { genre: 'micro'; ouvert: boolean }
  /** La conversation s'ouvre ou se ferme (veille, silence, coupure, Arrêter). */
  | { genre: 'conversation'; allumee: boolean };

export const MICRO_AU_REPOS: EtatDuMicro = { microOuvert: false, conversationAllumee: false, microParLaConversation: false };

/** L'état du micro après un geste. Couper le micro coupe la conversation ; l'ouvrir à la main le rend « voulu ». */
export function etatDuMicroApres(etat: EtatDuMicro, geste: GesteDuMicro): EtatDuMicro {
  if (geste.genre === 'micro') {
    if (!geste.ouvert) return MICRO_AU_REPOS;
    return { microOuvert: true, conversationAllumee: etat.conversationAllumee, microParLaConversation: false };
  }
  if (geste.allumee) {
    if (etat.conversationAllumee) return etat;
    return { microOuvert: true, conversationAllumee: true, microParLaConversation: !etat.microOuvert };
  }
  if (!etat.conversationAllumee) return etat;
  return etat.microParLaConversation ? MICRO_AU_REPOS : { ...etat, conversationAllumee: false };
}
