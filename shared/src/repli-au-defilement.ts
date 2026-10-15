/**
 * SUR TÉLÉPHONE, L'EN-TÊTE D'UNE PAGE DE CARTE SE REPLIE DÈS QU'ON DESCEND,
 * ET REVIENT DÈS QU'ON REMONTE — À CHAQUE FOIS (demande du 14/10/2026).
 *
 * La première version comparait chaque position à la précédente, avec un seuil
 * de 6 px : un défilement LENT avance par pas plus petits que le seuil, et ne
 * repliait donc jamais rien. Ici, on compare à un POINT DE RÉFÉRENCE :
 *
 *  - en-tête replié, la référence suit le point le PLUS BAS atteint ;
 *  - en-tête affiché, elle suit le point le PLUS HAUT atteint ;
 *  - on bascule dès qu'on s'en écarte de plus de `SEUIL_DE_BASCULE`.
 *
 * Les petits pas s'additionnent donc, et un vrai retour vers le haut ramène
 * l'en-tête sans tremblement. La position est BORNÉE à la plage réelle du
 * défilement : le rebond élastique de l'iPhone (position négative, ou au-delà
 * du bas) ne compte pas comme un mouvement.
 *
 * Règle pure, sans écran : la mécanique d'écoute vit dans `card-panel.tsx`.
 */

export interface EtatDuRepli {
  masque: boolean;
  /** Le point le plus bas atteint (replié) ou le plus haut (affiché). */
  reference: number;
}

/** L'écart, en pixels, qui fait basculer : 5 px ne bougent rien, 20 px oui. */
export const SEUIL_DE_BASCULE = 10;
/** Sous cette hauteur, l'en-tête reste affiché : on est en haut de la page. */
export const HAUT_TOUJOURS_AFFICHE = 48;

export const ETAT_DU_REPLI_INITIAL: EtatDuRepli = { masque: false, reference: 0 };

/** La position ramenée dans la plage réelle : le rebond élastique n'existe pas. */
export function positionBornee(y: number, max: number): number {
  return Math.min(Math.max(y, 0), Math.max(max, 0));
}

/** Un mouvement VOULU : rend l'état suivant. */
export function suivreLeDefilement(etat: EtatDuRepli, y: number, max: number): EtatDuRepli {
  const position = positionBornee(y, max);
  if (position < HAUT_TOUJOURS_AFFICHE) return { masque: false, reference: position };
  if (etat.masque) {
    if (position >= etat.reference) return position === etat.reference ? etat : { masque: true, reference: position };
    return etat.reference - position > SEUIL_DE_BASCULE ? { masque: false, reference: position } : etat;
  }
  if (position <= etat.reference) return position === etat.reference ? etat : { masque: false, reference: position };
  return position - etat.reference > SEUIL_DE_BASCULE ? { masque: true, reference: position } : etat;
}

/**
 * Un mouvement qui n'est PAS un geste — le fil qui suit une réponse, la page
 * qui se recale après un repli — ne fait rien basculer : la référence se pose
 * seulement là où l'on est, pour que le prochain geste parte de là.
 */
export function recalerLeRepli(etat: EtatDuRepli, y: number, max: number): EtatDuRepli {
  const position = positionBornee(y, max);
  return position === etat.reference ? etat : { masque: etat.masque, reference: position };
}

/** L'écart toléré avec le bas exact : un arrondi de sous-pixel n'est pas une position. */
export const ECART_DU_BAS = 4;

/**
 * À L'OUVERTURE D'UNE TÂCHE, L'EN-TÊTE SE REPLIE COMME APRÈS UN DÉFILEMENT
 * (demande du 14/10/2026). Le fil se pose tout en bas par programme, hors de
 * tout geste : `recalerLeRepli` ne bascule donc rien, et l'en-tête restait
 * affiché. Cette règle tranche UNE fois, le fil posé et stable :
 *
 *  - pas posé en bas (l'utilisateur est ailleurs) : on ne touche à rien ;
 *  - fil trop court pour défiler, même une fois l'en-tête replié — sa hauteur
 *    `hauteurRepliee` rend de la place au fil — : l'en-tête reste ;
 *  - sinon, il se replie, la référence posée là où l'on est.
 *
 * Rend le nouvel état, ou `null` quand rien ne doit changer.
 */
export function repliALOuverture(y: number, max: number, hauteurRepliee = 0): EtatDuRepli | null {
  if (max <= 0) return null;
  if (y < max - ECART_DU_BAS) return null;
  if (max - Math.max(hauteurRepliee, 0) < HAUT_TOUJOURS_AFFICHE) return null;
  return { masque: true, reference: positionBornee(y, max) };
}
