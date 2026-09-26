/**
 * OÙ SE POSE LE MODULE DE VOIX.
 *
 * Le module était CLOUÉ en bas au centre de l'écran : il recouvrait parfois ce
 * qu'on lit, sans qu'on puisse le pousser ailleurs. Il se déplace désormais, à
 * la souris comme au doigt, et sa place est retenue dans le compte — par le
 * MÊME mécanisme que le bloc en bas à droite (une préférence serveur), donc
 * commune à tous les appareils.
 *
 * Ce qui est retenu n'est PAS une position absolue mais un DÉCALAGE, en pixels,
 * par rapport à la place d'origine (bas au centre) : un décalage nul rend
 * exactement l'affichage d'avant, et un petit écran ne reçoit pas la position
 * calculée pour un grand.
 *
 * Tout se calcule ici, sans navigateur : les règles sont rejouables seules.
 */

/** Où le décalage du module de voix est retenu (préférence serveur). */
export const CLE_VOIX_POSITION = 'voix';

/** Le décalage par défaut : aucun. Le module reste en bas au centre. */
export const DECALAGE_VOIX_DEFAUT: DecalageVoix = { x: 0, y: 0 };

/** Ce qu'on garde du bord de l'écran, en pixels, pour rester attrapable. */
export const MARGE_VOIX = 8;

/**
 * À partir de combien de pixels un appui devient un GLISSEMENT. En dessous, le
 * geste reste un clic : sinon un doigt qui tremble déplacerait le module au
 * lieu de le déplier.
 */
export const SEUIL_GLISSEMENT_VOIX = 4;

/** Un décalage en pixels, par rapport à la place d'origine. */
export interface DecalageVoix {
  x: number;
  y: number;
}

/** Une boîte à l'écran, telle que le navigateur la mesure. */
export interface BoiteVoix {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** La place disponible : la fenêtre du navigateur. */
export interface FenetreVoix {
  width: number;
  height: number;
}

/**
 * LA PLUS GRANDE PLACE CROYABLE, en pixels. Aucun écran ne fait vingt mille
 * pixels de côté : au-delà, la place retenue n'est plus une place, c'est une
 * valeur partie à la dérive. Le module se retrouverait alors si loin qu'on ne
 * pourrait plus ni le voir ni le rattraper — le recadrage lui-même se calcule
 * DEPUIS le décalage, si bien qu'une fois faussé il ne se corrige jamais tout
 * seul. On la borne donc à la lecture, une fois pour toutes.
 */
export const DECALAGE_VOIX_MAX = 20_000;

/**
 * Ce qui a été retenu est-il un vrai décalage ? Une préférence absente, d'un
 * ancien format, abîmée — ou partie à la dérive au-delà de toute échelle
 * d'écran — ne doit pas envoyer le module hors de l'écran : on retombe alors
 * sur la place d'origine.
 */
export function estDecalageVoix(valeur: unknown): valeur is DecalageVoix {
  if (!valeur || typeof valeur !== 'object') return false;
  const { x, y } = valeur as Partial<DecalageVoix>;
  return (
    typeof x === 'number' &&
    Number.isFinite(x) &&
    Math.abs(x) <= DECALAGE_VOIX_MAX &&
    typeof y === 'number' &&
    Number.isFinite(y) &&
    Math.abs(y) <= DECALAGE_VOIX_MAX
  );
}

/**
 * Le décalage retenu, ramené à quelque chose d'utilisable. On ne garde QUE `x`
 * et `y` : la valeur retenue peut porter d'autres champs (un reliquat de
 * l'ancienne accroche à un bord), qu'on ne laisse pas fuir dans le décalage.
 */
export function decalageRetenu(valeur: unknown): DecalageVoix {
  if (!estDecalageVoix(valeur)) return DECALAGE_VOIX_DEFAUT;
  return { x: valeur.x, y: valeur.y };
}

/** Ramène une valeur entre deux bornes, la plus petite l'emportant si elles se croisent. */
function borner(valeur: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, valeur));
}

/**
 * Le décalage corrigé pour que le module reste ENTIÈREMENT visible.
 *
 * `ancre` est la boîte du module SANS décalage — sa place d'origine. On en
 * déduit de combien on peut le pousser sans qu'un bord sorte de la fenêtre. Un
 * module plus grand que la fenêtre (téléphone tourné, panneau déplié) est collé
 * en haut à gauche plutôt que rogné n'importe où.
 *
 * Sert au chargement (une position venue d'un grand écran) comme au
 * redimensionnement, et pendant le glissement lui-même.
 */
export function ramenerDansLEcran(
  decalage: DecalageVoix,
  ancre: BoiteVoix,
  fenetre: FenetreVoix,
  marge: number = MARGE_VOIX,
): DecalageVoix {
  const x = borner(
    decalage.x,
    marge - ancre.left,
    fenetre.width - marge - ancre.width - ancre.left,
  );
  const y = borner(
    decalage.y,
    marge - ancre.top,
    fenetre.height - marge - ancre.height - ancre.top,
  );
  return { x, y };
}

/** Deux décalages sont-ils les mêmes ? (au pixel près, pour ne rien réécrire pour rien) */
export function memeDecalage(a: DecalageVoix, b: DecalageVoix): boolean {
  return Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);
}

/**
 * Le pointeur a-t-il assez bougé pour que ce soit un déplacement, et non un
 * clic ? C'est ce qui permet au même geste d'ouvrir le module (appui immobile)
 * ou de le déplacer (appui qui glisse).
 */
export function estUnGlissement(dx: number, dy: number, seuil: number = SEUIL_GLISSEMENT_VOIX): boolean {
  return Math.abs(dx) >= seuil || Math.abs(dy) >= seuil;
}

/* ------------------------------------------------------------------ */
/* De quel côté le panneau s'ouvre                                     */
/* ------------------------------------------------------------------ */

/**
 * DE QUEL CÔTÉ LE PANNEAU S'OUVRE.
 *
 * Le module fermé est un petit rond ; déplié, c'est un panneau bien plus large
 * et plus haut. Le BOUTON (le rond) ne bouge pas quand on ouvre : c'est le
 * panneau qui se place autour de lui, du côté où il reste de la place. Collé au
 * bord droit, il s'ouvre vers la gauche ; collé au bord gauche, vers la droite ;
 * posé en haut, il se déplie vers le bas au lieu du haut ; et de même pour les
 * coins. Ces règles sont pures, rejouables sans navigateur.
 */

/** Le sens horizontal : vers où le panneau S'ÉTEND depuis le bouton. */
export type SensHorizontal = 'centre' | 'gauche' | 'droite';
/** Le sens vertical : vers le haut (défaut, ancré en bas) ou vers le bas. */
export type SensVertical = 'haut' | 'bas';

/** Le côté choisi pour l'ouverture, en X et en Y. */
export interface SensOuverture {
  horizontal: SensHorizontal;
  vertical: SensVertical;
}

/** Une taille en pixels — celle du panneau, celle du rond. */
export interface TailleVoix {
  width: number;
  height: number;
}

/**
 * Le côté vers lequel déplier le panneau pour qu'il reste ENTIÈREMENT visible,
 * le bouton restant à sa place. On préfère toujours le centre (X) et le haut (Y)
 * — l'affichage d'avant — et l'on ne s'en écarte que si un bord sortirait.
 *
 * `rond` est la boîte du bouton fermé, telle qu'elle est à l'écran (décalage
 * compris). `panneau` est la taille du module DÉPLIÉ.
 */
export function sensDouverture(
  rond: BoiteVoix,
  panneau: TailleVoix,
  fenetre: FenetreVoix,
  marge: number = MARGE_VOIX,
): SensOuverture {
  const centreX = rond.left + rond.width / 2;
  const demi = panneau.width / 2;
  let horizontal: SensHorizontal;
  if (centreX - demi >= marge && centreX + demi <= fenetre.width - marge) {
    // La place est là des deux côtés : on reste centré, comme avant.
    horizontal = 'centre';
  } else if (rond.left + panneau.width <= fenetre.width - marge) {
    // Le bouton est vers la gauche : on s'étend vers la droite.
    horizontal = 'droite';
  } else if (rond.left + rond.width - panneau.width >= marge) {
    // Le bouton est vers la droite : on s'étend vers la gauche.
    horizontal = 'gauche';
  } else {
    // Plus large que l'écran : on va du côté où il reste le plus de place.
    horizontal = centreX <= fenetre.width / 2 ? 'droite' : 'gauche';
  }

  // Par défaut le panneau grandit vers le HAUT (le module vit en bas de l'écran).
  // S'il n'y a pas la place au-dessus, il se déplie vers le bas.
  let vertical: SensVertical = 'haut';
  if (rond.top + rond.height - panneau.height < marge) {
    vertical = rond.top + panneau.height <= fenetre.height - marge ? 'bas' : 'haut';
  }
  return { horizontal, vertical };
}

/**
 * La correction à AJOUTER au décalage du bouton pour poser le panneau du bon
 * côté sans que le bouton bouge. Elle est NULLE quand le panneau a la taille du
 * rond (module fermé). La boîte étant centrée en X et ancrée en bas :
 *   — une correction en X déplace le côté d'ancrage (à droite = on ancre le bord
 *     gauche du panneau sur le bouton, donc on grandit vers la droite) ;
 *   — une correction en Y positive (vers le bas) fait grandir le panneau vers le
 *     bas au lieu du haut.
 * Comme la largeur/hauteur et cette correction s'animent ensemble, en même temps
 * et de la même façon, le côté ancré (là où est le bouton) reste fixe pendant la
 * métamorphose.
 */
export function correctionOuverture(
  sens: SensOuverture,
  panneau: TailleVoix,
  rond: TailleVoix,
): DecalageVoix {
  let x = 0;
  if (sens.horizontal === 'droite') x = panneau.width / 2 - rond.width / 2;
  else if (sens.horizontal === 'gauche') x = rond.width / 2 - panneau.width / 2;
  const y = sens.vertical === 'bas' ? panneau.height - rond.height : 0;
  return { x, y };
}
