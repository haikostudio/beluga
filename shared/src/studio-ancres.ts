/**
 * LES REPÈRES DU STUDIO — où une pièce déplacée à la main s'AIMANTE, et à quel
 * repère elle reste COLLÉE quand la création se décline dans un autre format.
 *
 * Cinq repères par axe : le bord du cadre, la MARGE DE SÉCURITÉ (5 % de la
 * dimension, là où les réseaux posent leurs boutons et leurs légendes), le
 * centre, puis la marge et le bord opposés. Un bord de la pièce s'aimante au
 * repère de SON côté (bord gauche → bord ou marge gauche ; centre → centre ;
 * bord droit → marge ou bord droit) : c'est ce couple qui fait une ancre qui a
 * un sens dans un autre format (« collée au coin haut droit »).
 *
 * Règle PURE : l'écran l'utilise pendant le glisser (repères dessinés par la
 * page, MEM-4385) ; la page de composition rejoue la même géométrie pour
 * recaler une pièce ancrée (`studio-page.ts`, aperçu ET export).
 */

export const ANCRES_HORIZONTALES = ['gauche', 'marge-gauche', 'centre', 'marge-droite', 'droite'] as const;
export const ANCRES_VERTICALES = ['haut', 'marge-haut', 'centre', 'marge-bas', 'bas'] as const;
export type AncreHorizontale = (typeof ANCRES_HORIZONTALES)[number];
export type AncreVerticale = (typeof ANCRES_VERTICALES)[number];

/** À quel repère une pièce reste collée, par axe ; `t` : l'instant (depuis le début du segment) où elle a été posée. */
export interface AncrePiece {
  h?: AncreHorizontale;
  v?: AncreVerticale;
  t?: number;
}

/** La marge de sécurité, en part de la dimension du cadre. */
export const MARGE_SECURITE_STUDIO = 0.05;

/** Une boîte en pixels de composition. */
export interface BoiteStudio {
  x: number;
  y: number;
  l: number;
  h: number;
}

export type BordDePiece = 'debut' | 'centre' | 'fin';

/** Où tombe un repère sur son axe (dimension `d`), et quel bord de la pièce s'y pose. */
export function ligneDAncre(ancre: AncreHorizontale | AncreVerticale, d: number): { position: number; bord: BordDePiece } {
  switch (ancre) {
    case 'gauche':
    case 'haut':
      return { position: 0, bord: 'debut' };
    case 'marge-gauche':
    case 'marge-haut':
      return { position: Math.round(d * MARGE_SECURITE_STUDIO), bord: 'debut' };
    case 'centre':
      return { position: d / 2, bord: 'centre' };
    case 'marge-droite':
    case 'marge-bas':
      return { position: Math.round(d * (1 - MARGE_SECURITE_STUDIO)), bord: 'fin' };
    default:
      return { position: d, bord: 'fin' };
  }
}

function bordDe(debut: number, taille: number, bord: BordDePiece): number {
  return bord === 'debut' ? debut : bord === 'centre' ? debut + taille / 2 : debut + taille;
}

export interface Aimantation {
  /** Le décalage à ajouter pour que la pièce se pose sur ses repères (0 sur un axe libre). */
  dx: number;
  dy: number;
  ancre: AncrePiece;
  /** Les repères atteints, pour les dessiner. */
  reperes: { axe: 'x' | 'y'; position: number }[];
}

/**
 * L'AIMANT : la boîte d'une pièce (là où la main l'amène) se pose sur le repère
 * le plus proche de chaque axe, s'il est à moins de `seuil` pixels de
 * composition. Sinon l'axe reste libre, au pixel près.
 */
export function aimanter(boite: BoiteStudio, largeur: number, hauteur: number, seuil: number): Aimantation {
  const sortie: Aimantation = { dx: 0, dy: 0, ancre: {}, reperes: [] };
  const axe = <A extends AncreHorizontale | AncreVerticale>(liste: readonly A[], debut: number, taille: number, d: number) => {
    let meilleur: { ancre: A; ecart: number; position: number } | null = null;
    for (const ancre of liste) {
      const { position, bord } = ligneDAncre(ancre, d);
      const ecart = position - bordDe(debut, taille, bord);
      if (Math.abs(ecart) <= seuil && (!meilleur || Math.abs(ecart) < Math.abs(meilleur.ecart))) meilleur = { ancre, ecart, position };
    }
    return meilleur;
  };
  const h = axe(ANCRES_HORIZONTALES, boite.x, boite.l, largeur);
  if (h) {
    sortie.dx = Math.round(h.ecart);
    sortie.ancre.h = h.ancre;
    sortie.reperes.push({ axe: 'x', position: h.position });
  }
  const v = axe(ANCRES_VERTICALES, boite.y, boite.h, hauteur);
  if (v) {
    sortie.dy = Math.round(v.ecart);
    sortie.ancre.v = v.ancre;
    sortie.reperes.push({ axe: 'y', position: v.position });
  }
  return sortie;
}

/** Lit une ancre venue de l'écran ou d'un fichier : seuls les repères connus passent. */
export function lireAncre(brut: unknown): AncrePiece | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const b = brut as Record<string, unknown>;
  const sortie: AncrePiece = {};
  if ((ANCRES_HORIZONTALES as readonly string[]).includes(b.h as string)) sortie.h = b.h as AncreHorizontale;
  if ((ANCRES_VERTICALES as readonly string[]).includes(b.v as string)) sortie.v = b.v as AncreVerticale;
  if (!sortie.h && !sortie.v) return undefined;
  if (typeof b.t === 'number' && Number.isFinite(b.t)) sortie.t = Math.round(Math.max(0, Math.min(3600, b.t)) * 1000) / 1000;
  return sortie;
}
