/**
 * « CETTE CARTE ATTEND QUELQUE CHOSE DE VOUS : QU'ELLE SE VOIE. »
 *
 * Le triangle (ou la bulle, ou le chemin) posé sur une carte dit bien qu'une
 * décision l'attend, mais un petit dessin immobile se perd au milieu d'une
 * rangée de cartes. La carte se SECOUE donc, légèrement et à intervalles, tant
 * que l'attente dure — la même secousse que la ligne d'un projet dans la
 * colonne de gauche (`animate-secousse`, `signal-projet.ts`), rejouée.
 *
 * Ce qui secoue est EXACTEMENT ce qui alerte (`alertesParCarte`) : une question
 * posée, une validation à trancher, un geste de parcours attendu (compréhension
 * à valider, carte à lancer). Un incident n'alerte pas, un travail rendu non lu
 * non plus : ils ne secouent pas. Une carte au travail n'a aucune décision
 * ouverte : elle ne secoue pas davantage.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */

/** Tous les combien une carte qui attend se rappelle à vous. */
export const PERIODE_SECOUSSE_CARTE_MS = 6000;

/** Combien de temps la classe d'animation reste posée (l'animation dure 420 ms). */
export const DUREE_SECOUSSE_MS = 700;

export interface CarteQuiSecoue {
  /** Le nombre de décisions ALERTANTES de la carte (`alertesParCarte`). */
  alertes: number;
  /**
   * Le nombre d'alertes au moment où l'utilisateur a OUVERT la carte, ou
   * `undefined` s'il ne l'a pas ouverte depuis que l'attente a commencé.
   * Ouvrir la carte la calme : il a vu. Une NOUVELLE décision (le compte
   * remonte au-dessus de ce qu'il a vu) la fait repartir.
   */
  alertesVues?: number;
}

/** La carte doit-elle se secouer, à intervalles ? */
export function carteDoitSecouer(carte: CarteQuiSecoue): boolean {
  if (carte.alertes <= 0) return false;
  if (carte.alertesVues !== undefined && carte.alertes <= carte.alertesVues) return false;
  return true;
}
