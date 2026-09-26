/**
 * « CETTE CARTE ATTEND UN GESTE DE VOUS, ET PERSONNE NE L'A VU. »
 *
 * Une question posée par un agent allume un repère depuis toujours
 * (`attention.ts`). Un GESTE attendu, lui, ne sortait pas du tiroir de la
 * carte : `gesteDuParcours` sait dire « le plan peut être généré », « le plan
 * attend votre validation », « la carte attend son lancement » — mais il
 * fallait OUVRIR la carte pour l'apprendre. Une carte de cadrage dont le tour
 * s'est tu ne disait donc rien, ni sur le tableau, ni sur la ligne de son
 * projet : on l'oubliait.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */
import type { EtatDuGeste, GesteDuParcours } from './parcours-carte.js';

/**
 * LES DEUX GESTES QUI SE SIGNALENT — et pas un de plus.
 *
 * `gesteDuParcours` en rend cinq. Deux seulement veulent dire « à VOUS de
 * jouer, maintenant » :
 *
 *  - `valider-et-lancer` : le cadrage a rendu ce qu'il a compris, il attend
 *    votre accord — et cet accord lance le travail dans la foulée ;
 *  - `lancer` : la décision est déjà prise, le départ attend votre clic.
 *
 * Les trois autres sont écartés VOLONTAIREMENT. `terminer` double le point
 * bleu du travail rendu (`travail-rendu.ts`), déjà posé sur chaque carte
 * finie : le compter ici allumerait un triangle sur toutes. `arreter` est
 * l'inverse d'une attente — quelque chose tourne. `reprendre` désigne une
 * carte interrompue, qui porte déjà sa propre marque.
 */
export const GESTES_QUI_ATTENDENT = ['valider-et-lancer', 'lancer'] as const;
export type GesteAttendu = (typeof GESTES_QUI_ATTENDENT)[number];

/** Ce geste réclame-t-il un clic de l'utilisateur ? */
export function gesteQuiAttend(geste: GesteDuParcours): geste is GesteAttendu {
  return (GESTES_QUI_ATTENDENT as readonly string[]).includes(geste);
}

/**
 * CE QUI EST DEMANDÉ, EN CLAIR. Ce texte voyage avec la décision : c'est lui
 * que la cloche affiche, et l'infobulle du repère.
 */
export const TEXTE_DU_GESTE_ATTENDU: Record<GesteAttendu, string> = {
  'valider-et-lancer': 'La compréhension attend votre validation',
  lancer: 'La carte attend votre lancement',
};

/** Ce qu'une carte doit dire d'elle pour qu'on juge si elle attend un geste. */
export interface CarteQuiAttend {
  /** Le geste principal, tel que `gesteDuParcours` vient de le rendre. */
  etat: Pick<EtatDuGeste, 'geste' | 'possible'>;
  /** Un tour vit encore dans son fil : rien n'attend personne. */
  tourEnCours?: boolean;
  /**
   * QUAND LE DERNIER TOUR S'EST TU (`agent.endedAt`). C'est la borne qui rend
   * le signal EXTINGUIBLE : sans elle, on ne saurait pas si la consultation de
   * la carte est venue avant ou après ce qui l'a rendue.
   *
   * Absente ou nulle : aucun tour n'a jamais rien rendu sur cette carte — une
   * carte écrite à la main qui n'a pas encore parlé n'a rien à signaler.
   */
  finDuTourA?: number;
  /** Quand la carte a été consultée pour la dernière fois (`card.lastReadAt`). */
  luA?: number;
}

/**
 * CETTE CARTE ATTEND-ELLE UN GESTE, PAS ENCORE VU ?
 *
 * Cinq conditions, toutes nécessaires : le tour est fini, le geste est l'un
 * des deux qui se signalent, il est POSSIBLE en l'état (un « Valider et
 * lancer » éteint parce que la compréhension manque n'attend rien de vous), un
 * tour a rendu quelque chose, et la carte n'a pas été rouverte depuis.
 *
 * Rend le geste attendu, ou `null`.
 */
export function gesteEnAttente(carte: CarteQuiAttend): GesteAttendu | null {
  if (carte.tourEnCours) return null;
  if (!carte.etat.possible) return null;
  if (!gesteQuiAttend(carte.etat.geste)) return null;
  const rendu = carte.finDuTourA ?? 0;
  if (!rendu) return null;
  if (rendu <= (carte.luA ?? 0)) return null;
  return carte.etat.geste;
}
