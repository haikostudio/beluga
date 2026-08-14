/**
 * LES CARTES D'UNE COLONNE ARRIVENT PAR PAQUETS DE VINGT.
 *
 * Le tableau posait TOUTES les cartes de TOUTES les colonnes dans la page, d'un
 * seul bloc. Avec quelques centaines de cartes, chaque changement d'état de
 * l'application (un agent qui avance, un quota qui bouge, une frappe au
 * clavier) refaisait l'affichage de la totalité : l'application ramait et la
 * frappe s'affichait au ralenti.
 *
 * On n'affiche donc plus qu'un PAQUET à la fois, et le paquet suivant arrive
 * quand le défilement approche du bas de la colonne. Deux garde-fous portés
 * par cette règle :
 *
 *  - le COMPTEUR de la tête de colonne dit toujours le TOTAL réel, jamais le
 *    nombre de cartes déjà posées — sinon le chiffre mentirait tant qu'on n'a
 *    pas fait défiler ;
 *  - une carte qu'on cherche ailleurs que par le défilement (sélection en lot,
 *    carte ouverte) n'est pas perdue : `paquetsPourVoir` dit combien de paquets
 *    il faut pour la faire apparaître.
 *
 * Règle pure : ni base, ni disque, ni navigateur — elle se teste seule.
 */

/** Combien de cartes arrivent d'un coup. */
export const CARTES_PAR_PAQUET = 20;

/**
 * À quelle distance du bas (en pixels) le paquet suivant est demandé. Assez
 * large pour que les cartes soient déjà là quand on arrive au bout, assez
 * courte pour ne pas tout charger dès le premier pixel de défilement.
 */
export const MARGE_DE_CHARGEMENT_PX = 320;

/**
 * Les cartes RÉELLEMENT posées dans la page pour un nombre de paquets donné.
 *
 * `paquets` vaut au moins 1 : une colonne montre toujours son premier paquet,
 * même sans avoir jamais défilé.
 */
export function cartesDuPaquet<T>(cartes: readonly T[], paquets: number): T[] {
  const combien = Math.max(1, Math.floor(paquets)) * CARTES_PAR_PAQUET;
  return cartes.length <= combien ? [...cartes] : cartes.slice(0, combien);
}

/** Reste-t-il des cartes derrière ce qui est posé ? */
export function resteDesCartes(total: number, paquets: number): boolean {
  return total > Math.max(1, Math.floor(paquets)) * CARTES_PAR_PAQUET;
}

/**
 * Le paquet SUIVANT : un de plus, jamais deux — sinon un geste de défilement
 * rapide reposerait toute la colonne d'un coup. Rien de plus à charger, le
 * compte ne bouge pas : l'appelant peut alors s'épargner un rendu.
 */
export function paquetSuivant(paquets: number, total: number): number {
  const courant = Math.max(1, Math.floor(paquets));
  return resteDesCartes(total, courant) ? courant + 1 : courant;
}

/**
 * Combien de paquets pour qu'une carte de rang `index` soit posée dans la page.
 * Sert quand une carte doit apparaître sans qu'on ait défilé jusqu'à elle
 * (sélection en lot, carte ouverte depuis un lien ou une notification).
 */
export function paquetsPourVoir(index: number): number {
  if (index < 0) return 1;
  return Math.floor(index / CARTES_PAR_PAQUET) + 1;
}
