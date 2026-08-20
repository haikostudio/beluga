/**
 * CE QUE LE TRI DE LA MÉMOIRE ÉCONOMISE, EN CLAIR.
 *
 * Depuis qu'un sujet nommé sur une carte est servi au POIDS DE SA DEMANDE et
 * non au poids de son fichier (`extrait-regles.ts`), chaque ouverture de
 * mémoire évite d'envoyer du texte. Le démon relève les deux poids MESURÉS —
 * ce qui serait parti, ce qui est parti — et ce module les traduit dans les
 * trois grandeurs que l'écran affiche : des signes, des jetons, une part de
 * quota.
 *
 * TROIS PRÉCAUTIONS, parce qu'une économie annoncée trop haut est un mensonge
 * qui se découvre à la fin du mois :
 *
 *   • LES SIGNES SONT MESURÉS, jamais estimés : ce sont deux longueurs de
 *     textes réellement construits ;
 *   • LES JETONS passent par le rapport MESURÉ de cette documentation
 *     (`SIGNES_PAR_JETON` = 2,2), arrondi prudemment vers le haut, donc plutôt
 *     vers le BAS de l'économie ;
 *   • LA PART DE QUOTA n'est rendue que si le rapport jetons → quota a été
 *     RELEVÉ sur la consommation réelle. Sans relevé, elle reste indéfinie et
 *     l'écran ne l'affiche pas : mieux vaut ne rien dire qu'inventer un chiffre.
 *
 * Ce module ne touche ni base ni disque : il se rejoue seul.
 */

import { SIGNES_PAR_JETON } from './couches-tokens.js';

/** L'économie d'une carte, d'un mois ou d'une seule ouverture — même calcul. */
export interface EconomieMemoire {
  /** Ce qui serait parti sans le tri, en signes. */
  signesEntiers: number;
  /** Ce qui est réellement parti, en signes. */
  signesServis: number;
  /** La différence : ce que le tri a évité d'envoyer. Jamais négative. */
  signesEvites: number;
  /** Les mêmes signes en jetons, au rapport mesuré de cette documentation. */
  jetonsEvites: number;
  /** La part évitée, entre 0 et 1. Zéro quand rien n'a jamais été servi. */
  part: number;
  /**
   * Les points de quota de la SEMAINE évités. Indéfini tant que le rapport
   * jetons → quota n'a pas été relevé sur de vrais tours.
   */
  quotaEvite?: number;
}

/**
 * Le calcul, une fois pour toutes. `quotaParJeton` est le rapport RELEVÉ sur la
 * consommation de la même période (points de quota de semaine par jeton) ;
 * absent ou nul, la part de quota n'est pas rendue.
 */
export function economieMemoire(
  signesEntiers: number,
  signesServis: number,
  quotaParJeton?: number | null,
): EconomieMemoire {
  const entiers = Math.max(0, signesEntiers);
  const servis = Math.max(0, signesServis);
  const evites = Math.max(0, entiers - servis);
  const jetonsEvites = Math.round(evites / SIGNES_PAR_JETON);
  return {
    signesEntiers: entiers,
    signesServis: servis,
    signesEvites: evites,
    jetonsEvites,
    part: entiers > 0 ? evites / entiers : 0,
    quotaEvite: quotaParJeton && quotaParJeton > 0 ? jetonsEvites * quotaParJeton : undefined,
  };
}

/**
 * L'ÉCONOMIE MOYENNE PAR CARTE, sur les cartes qui en ont vraiment une. Diviser
 * le total par le nombre de cartes du tableau donnerait une moyenne fausse :
 * une carte qui n'a jamais ouvert la mémoire n'a rien économisé, elle n'a pas
 * non plus rien à économiser.
 */
export function economieMoyenneParCarte(cartes: readonly { signesEvites: number }[]): number {
  if (!cartes.length) return 0;
  return cartes.reduce((total, carte) => total + carte.signesEvites, 0) / cartes.length;
}
