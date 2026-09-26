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
  /**
   * L'arrêt a été DEMANDÉ (bouton, sortie à la souris, signal) : le moteur
   * tombe « code null », mais personne n'a rien à trancher — la carte est déjà
   * rangée et suspendue par le geste lui-même.
   */
  arretDemande?: boolean;
  /**
   * LES REJEUX D'UN TOUR PRIVÉ D'OUTILS SONT ÉPUISÉS.
   *
   * Ce cas-là n'est PAS un échec au sens de `failed` : un moteur privé de son
   * pont écrit quand même son compte rendu — il ne sait pas qu'il lui manque
   * quelque chose — et le tour se termine « réussi ». Sans cette porte, la
   * décision n'était jamais posée : la carte repartait indéfiniment, trois
   * rejeux silencieux étant devenus une boucle sans fin
   * (`shared/src/pont-outils.ts`, `issueDuPontMort`).
   */
  pontEpuise?: boolean;
}

/**
 * Doit-on poser une décision « que faire de cette erreur ? » sur ce tour tombé ?
 * Vrai seulement pour l'échec ORDINAIRE : ni une reprise de quota, ni une panne
 * passagère (déjà dites autrement), ni un moteur muet (qui repart de lui-même),
 * ni un ARRÊT DEMANDÉ — un geste voulu n'est pas une erreur, et une décision
 * posée là interdirait le clic « Lancer » qui doit justement relancer la carte
 * suspendue (`decisionOuverteSurLaCarte`, constaté par
 * `scripts/verif-cycle-de-vie-carte.mjs`).
 *
 * UN PONT ÉPUISÉ OUVRE LA MÊME DÉCISION, MÊME SANS ÉCHEC. C'est le seul cas où
 * un tour qui a RENDU du texte mérite quand même les trois boutons : ce texte a
 * été écrit sans mémoire du projet, sans écriture de mémoire et sans geste de
 * tableau, après trois tours déjà rejoués en silence. Le tenir pour un travail
 * livré referme la carte sur du vide ; le rejouer une quatrième fois est une
 * boucle. On demande.
 */
export function erreurDeTourAPoser(etat: EtatDeTourTombe): boolean {
  if (etat.arretDemande) return false;
  if (etat.reprise || etat.panneDefinitive || etat.moteurMuet) return false;
  return etat.failed || !!etat.pontEpuise;
}

/** Les trois issues offertes à l'utilisateur face à une erreur qui a arrêté le travail. */
export type ChoixErreurDeTour = 'relancer' | 'ignorer' | 'arreter';

/** Une décision déjà tranchée ne se rejoue pas : un second clic ne fait rien. */
export function choixDejaFerme(choix: ChoixErreurDeTour | undefined): boolean {
  return choix !== undefined;
}
