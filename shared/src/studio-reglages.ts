/**
 * LES RÉGLAGES QU'OFFRE UNE PIÈCE CHOISIE — une seule table pour l'inspecteur
 * (`inspecteur.tsx`) et pour le test qui la vérifie.
 *
 * Ce qu'une pièce propose dépend de CE QU'ELLE EST (sa nature, dite par la page
 * de l'aperçu, jamais devinée) et de CE QUI LA PORTE (un dessin de l'agent, ou
 * un segment texte, image ou vidéo qui règle déjà son contenu). Chaque bloc ne
 * pose que des champs de retouche que la page REND — à l'aperçu comme à
 * l'export (`traduireEnPage`) : un réglage montré qui ne changerait rien
 * n'existe pas ici.
 */
import type { GenreSegment, Retouche } from './studio.js';

/** Ce qu'est une pièce : un texte (simple ou découpé mot par mot), une image, une forme SVG, un groupe de pièces, une forme. */
export const NATURES_PIECE = ['texte', 'image', 'svg', 'groupe', 'forme'] as const;
export type NaturePiece = (typeof NATURES_PIECE)[number];

/** Les blocs de l'inspecteur, rangés comme dans Figma. */
export const BLOCS_DE_REGLAGE = ['piece', 'texte', 'image', 'calque', 'remplissage', 'trait', 'contour', 'marges', 'effets'] as const;
export type BlocDeReglage = (typeof BLOCS_DE_REGLAGE)[number];

/** Les champs de retouche que pose chaque bloc. */
export const CHAMPS_DES_BLOCS: Record<BlocDeReglage, (keyof Retouche)[]> = {
  piece: ['x', 'y', 'largeur', 'hauteur', 'rotation', 'arrondi', 'arrondiCoins', 'masquee'],
  texte: ['texte', 'police', 'graisse', 'taillePolice', 'interligne', 'espacementLettres', 'italique', 'decoration', 'casse', 'alignement', 'alignementVertical', 'couleur'],
  image: ['source', 'cadrage'],
  calque: ['opacite', 'fusion', 'rogner'],
  remplissage: ['fond', 'degrade', 'couleur'],
  trait: ['trait', 'epaisseurTrait'],
  contour: ['contour', 'epaisseurContour', 'contourPosition', 'contourStyle'],
  marges: ['marges', 'margesExterieures'],
  effets: ['ombres', 'flou', 'flouArrierePlan'],
};

/**
 * LES BLOCS D'UNE PIÈCE. Sans description (l'aperçu ne l'a pas encore dite) :
 * la place et l'opacité seules, rien ne se devine. `avecTrait` : la page a vu
 * des tracés dans la pièce (une icône au trait posée dans un groupe ou une
 * forme) — son trait se règle aussi.
 *
 * Hors dessin, le SEGMENT règle déjà le contenu (texte, couleur, police d'un
 * segment texte ; fichier et cadrage d'une image ou d'une vidéo, dans la scène) :
 * la pièce garde ce qu'il ne dit pas — fond, contour, arrondi, marges, ombres.
 */
export function blocsDeLaPiece(genre: GenreSegment, nature: NaturePiece | undefined, avecTrait = false): BlocDeReglage[] {
  if (!nature) return ['piece', 'calque'];
  if (genre === 'dessin') {
    switch (nature) {
      case 'texte':
        return ['piece', 'texte', 'calque', 'remplissage', 'contour', 'marges', 'effets'];
      case 'image':
        return ['piece', 'image', 'calque', 'remplissage', 'contour', 'marges', 'effets'];
      case 'svg':
        return ['piece', 'calque', 'remplissage', 'trait', 'contour', 'effets'];
      default:
        // Un groupe (la racine d'une scène comprise) ou une forme : son fond est son remplissage.
        return avecTrait ? ['piece', 'calque', 'remplissage', 'trait', 'contour', 'marges', 'effets'] : ['piece', 'calque', 'remplissage', 'contour', 'marges', 'effets'];
    }
  }
  if (genre === 'texte') return ['piece', 'calque', 'remplissage', 'contour', 'marges', 'effets'];
  if (genre === 'image' || genre === 'video') return ['piece', 'calque', 'contour', 'effets'];
  return ['piece', 'calque'];
}
