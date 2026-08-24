/**
 * UNE ERREUR API QUI ARRÊTE L'AGENT NE SE TAIT PLUS.
 *
 * Une panne PASSAGÈRE du fournisseur se retente toute seule
 * (`panne-passagere.ts`), un arrêt de QUOTA a sa propre route
 * (`reprise-compte.ts`), et un moteur jamais JOINT repart tout seul en
 * « Planifié ». Restait un trou : une erreur DÉFINITIVE (4xx, jeton refusé,
 * erreur inattendue non reconnue) qui coupe le tour net. Le message portait
 * déjà un bandeau rouge, mais la carte restait « En cours » sans que rien
 * n'allume le triangle orange ni ne propose de choix — l'échec passait
 * inaperçu jusqu'à ce que quelqu'un rouvre la carte par hasard.
 *
 * Ce fichier ne décide que deux choses, testables seules : cet échec-là
 * mérite-t-il une décision (`erreurDeTourAPoser`), et le clic est-il encore
 * recevable (`choixDejaFerme`).
 */

/** Ce qu'il faut savoir d'un tour tombé pour dire s'il lui manque une décision. */
export interface EtatDeTourTombe {
  /** Le tour s'est-il terminé en échec (moteur tombé, ou erreur vue en cours de route) ? */
  failed: boolean;
  /** Une reprise de compte a déjà sa propre route : « avec quel compte poursuivre ? ». */
  reprise: boolean;
  /** Une panne passagère du fournisseur a déjà sa propre route, après ses essais. */
  panneDefinitive: boolean;
  /** Un moteur jamais joint repart tout seul en « Planifié », sans qu'on demande rien. */
  moteurMuet: boolean;
}

/**
 * Doit-on poser une décision « que faire de cette erreur ? » sur ce tour tombé ?
 * Vrai seulement pour l'échec ORDINAIRE : ni une reprise de quota, ni une panne
 * passagère (déjà dites autrement), ni un moteur muet (qui repart de lui-même).
 */
export function erreurDeTourAPoser(etat: EtatDeTourTombe): boolean {
  return etat.failed && !etat.reprise && !etat.panneDefinitive && !etat.moteurMuet;
}

/** Les trois issues offertes à l'utilisateur face à une erreur qui a arrêté le travail. */
export type ChoixErreurDeTour = 'relancer' | 'ignorer' | 'arreter';

/** Une décision déjà tranchée ne se rejoue pas : un second clic ne fait rien. */
export function choixDejaFerme(choix: ChoixErreurDeTour | undefined): boolean {
  return choix !== undefined;
}
