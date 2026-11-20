/**
 * LA DISPOSITION D'UN PAQUET D'IMAGES DANS LE FIL (carte « Images groupées dans le fil », 19/11/2026) : des images
 * envoyées à la suite se posent EN JEU DE CARTES — la première devant, deux autres dépassent derrière, légèrement
 * tournées — et, au survol de la souris, S'ÉTALENT côte à côte.
 *
 * ÉTALÉES, ELLES GARDENT LEUR TAILLE PLEINE (carte « Images du fil en grand format », capture #6cf3c) : plus aucune
 * réduction pour tout faire tenir — douze images rapetissées à 0,3 n'étaient plus lisibles. La rangée mesure
 * `largeurEtalee(n)` ; quand elle dépasse la largeur du fil, l'écran la fait DÉFILER à l'horizontale. La hauteur du
 * paquet ne change pas entre les deux états : le fil ne saute pas au survol.
 *
 * Règle PURE (aucun écran) : l'écran applique ces positions en `transform`, jamais en `left`. Éprouvée dans
 * `server/src/test/paquet-d-images.test.ts`.
 */

/** La carte d'un paquet, à sa taille pleine (16:10), en pixels CSS. */
export const CARTE_DU_PAQUET = { largeur: 224, hauteur: 140 } as const;
/** Combien de cartes se voient dans la pile ; les suivantes attendent derrière, invisibles. */
export const CARTES_VISIBLES_EN_PILE = 3;
/** L'écart entre deux vignettes étalées. */
export const ECART_ETALE = 8;
/** Décalage et rotation des cartes de dessous, de la première à la troisième. */
const PILE: readonly { x: number; y: number; angle: number }[] = [
  { x: 0, y: 0, angle: 0 },
  { x: 10, y: 6, angle: 3 },
  { x: 20, y: 12, angle: -2.5 },
];

/** La place d'une carte : translation, rotation, échelle (origine en haut à gauche), visibilité, ordre d'empilement. */
export interface PlaceDUneCarte {
  x: number;
  y: number;
  angle: number;
  echelle: number;
  visible: boolean;
  /** Plus grand = devant. */
  plan: number;
}

/** La hauteur que réserve le paquet, la même pile ou étalé. */
export function hauteurDuPaquet(): number {
  const dernier = PILE[PILE.length - 1]!;
  return CARTE_DU_PAQUET.hauteur + dernier.y + 6;
}

/** La largeur de la rangée étalée : `nombre` cartes pleines et leurs écarts. C'est la largeur de la piste qui défile. */
export function largeurEtalee(nombre: number): number {
  if (nombre <= 0) return 0;
  return nombre * CARTE_DU_PAQUET.largeur + (nombre - 1) * ECART_ETALE;
}

/** Les places de `nombre` cartes, empilées ou étalées (étalées : taille pleine, pas constant, jamais réduites). */
export function placesDuPaquet(nombre: number, etale: boolean): PlaceDUneCarte[] {
  const places: PlaceDUneCarte[] = [];
  if (etale) {
    const pas = CARTE_DU_PAQUET.largeur + ECART_ETALE;
    /* Centrées en hauteur dans la place réservée, qui garde la hauteur de la pile. */
    const y = (hauteurDuPaquet() - CARTE_DU_PAQUET.hauteur) / 2;
    for (let rang = 0; rang < nombre; rang += 1) {
      places.push({ x: rang * pas, y, angle: 0, echelle: 1, visible: true, plan: nombre - rang });
    }
    return places;
  }
  for (let rang = 0; rang < nombre; rang += 1) {
    const pose = PILE[Math.min(rang, PILE.length - 1)]!;
    places.push({ ...pose, echelle: 1, visible: rang < CARTES_VISIBLES_EN_PILE, plan: nombre - rang });
  }
  return places;
}
