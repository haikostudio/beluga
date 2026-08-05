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
 * Ce qui a été retenu est-il un vrai décalage ? Une préférence absente, d'un
 * ancien format ou abîmée ne doit pas envoyer le module hors de l'écran : on
 * retombe alors sur la place d'origine.
 */
export function estDecalageVoix(valeur: unknown): valeur is DecalageVoix {
  if (!valeur || typeof valeur !== 'object') return false;
  const { x, y } = valeur as Partial<DecalageVoix>;
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y);
}

/** Le décalage retenu, ramené à quelque chose d'utilisable. */
export function decalageRetenu(valeur: unknown): DecalageVoix {
  return estDecalageVoix(valeur) ? valeur : DECALAGE_VOIX_DEFAUT;
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
