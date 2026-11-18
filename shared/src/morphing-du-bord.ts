/*
 * LE BOUTON DU BORD SE TRANSFORME EN BULLE, ET LA BULLE REDEVIENT BOUTON (décisions de l'utilisateur, 17/11/2026,
 * illustration #0666) : un seul objet qui se déforme, jamais un bouton qui disparaît pendant qu'une fenêtre apparaît à
 * côté. À l'ouverture : les trois traits du bouton rentrent en un seul, ce trait se courbe en cercle de chargement
 * pendant que le bouton se décolle du bord et devient rond ; le rond glisse jusqu'à la place du cercle dans la bulle,
 * puis s'étire jusqu'à elle. La bulle prend alors le relais (son cercle devient l'onde à l'écoute réelle). La fermeture
 * joue exactement l'inverse, jusqu'à la place du bouton, où les trois traits ressortent.
 *
 * La règle vit ici, sans DOM : l'avancée `u` (0 = bouton, 1 = bulle avec son onde) donne l'étape, la boîte, ses coins et
 * le mélange des deux fonds. Le dessin (le chemin du trait) et la boucle d'images sont dans `web/src/lib/morphing-du-bord.ts`.
 */
import type { BordDeLEcran } from './geste-de-bord.js';

export interface BoiteALEcran {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Les quatre coins : haut gauche, haut droit, bas droit, bas gauche. */
export type CoinsDeLaBoite = [number, number, number, number];

export type EtapeDuMorphing = 'traits' | 'cercle' | 'glisse' | 'bulle' | 'ondes';

/** Les bornes de chaque étape sur l'avancée `u`. L'ouverture s'arrête à `FIN_DE_L_OUVERTURE` : la bulle fait l'onde. */
export const ETAPES_DU_MORPHING: Record<EtapeDuMorphing, [number, number]> = {
  traits: [0, 0.15],
  cercle: [0.15, 0.32],
  glisse: [0.32, 0.58],
  bulle: [0.58, 0.85],
  ondes: [0.85, 1],
};
export const FIN_DE_L_OUVERTURE = ETAPES_DU_MORPHING.bulle[1];
/** La durée d'une traversée entière (u de 0 à 1), en ms. */
export const DUREE_DU_MORPHING_MS = 900;
/** Le diamètre du bouton devenu rond, et l'air qui le sépare du bord quand il s'en décolle. */
export const DIAMETRE_DU_ROND = 54;
export const AIR_DU_ROND = 10;

export interface GeometrieDuMorphing {
  /** La partie visible du bouton (sans ses congés). */
  bouton: BoiteALEcran;
  bord: BordDeLEcran;
  /** La surface ouverte (bulle vocale ou volet). */
  cible: BoiteALEcran;
  /** Le centre du cercle dans la surface (celui des ondes ; le milieu de la surface sans ondes). */
  centreCible: { x: number; y: number };
  /** L'arrondi des coins de la surface. */
  rayonCible: number;
}

export interface ImageDuMorphing {
  etape: EtapeDuMorphing;
  /** L'avancée DANS l'étape, de 0 à 1. */
  avancee: number;
  boite: BoiteALEcran;
  coins: CoinsDeLaBoite;
  /** 0 : le fond et le trait du bouton ; 1 : ceux de la bulle. */
  fond: number;
  /** Le centre du dessin (cercle ou trait), en coordonnées de l'écran. */
  centre: { x: number; y: number };
}

const borne = (x: number) => Math.min(1, Math.max(0, x));
const lin = (a: number, b: number, t: number) => a + (b - a) * t;
/** Doux aux deux bouts : le mouvement part et arrive sans à-coup. */
export const adoucirAuxDeuxBouts = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Les coins du « D » collé au bord : arrondis du côté libre, carrés contre le bord. */
export function coinsDuBouton(bord: BordDeLEcran, rayon: number): CoinsDeLaBoite {
  switch (bord) {
    case 'gauche':
      return [0, rayon, rayon, 0];
    case 'droite':
      return [rayon, 0, 0, rayon];
    case 'haut':
      return [0, 0, rayon, rayon];
    case 'bas':
    default:
      return [rayon, rayon, 0, 0];
  }
}

/** Le centre du rond une fois décollé : poussé vers l'intérieur, à `AIR_DU_ROND` du bord. */
export function centreDuRond(bouton: BoiteALEcran, bord: BordDeLEcran, largeur: number, hauteur: number): { x: number; y: number } {
  const cx = bouton.x + bouton.w / 2;
  const cy = bouton.y + bouton.h / 2;
  const r = DIAMETRE_DU_ROND / 2;
  switch (bord) {
    case 'gauche':
      return { x: AIR_DU_ROND + r, y: cy };
    case 'droite':
      return { x: largeur - AIR_DU_ROND - r, y: cy };
    case 'haut':
      return { x: cx, y: bouton.y + AIR_DU_ROND + r };
    case 'bas':
    default:
      return { x: cx, y: Math.min(hauteur, bouton.y + bouton.h) - AIR_DU_ROND - r };
  }
}

/** L'étape où tombe l'avancée `u`, et l'avancée dans cette étape. */
export function etapeDuMorphing(u: number): { etape: EtapeDuMorphing; avancee: number } {
  const v = borne(u);
  for (const etape of ['traits', 'cercle', 'glisse', 'bulle', 'ondes'] as const) {
    const [a, b] = ETAPES_DU_MORPHING[etape];
    if (v <= b || etape === 'ondes') return { etape, avancee: borne((v - a) / (b - a)) };
  }
  return { etape: 'ondes', avancee: 1 };
}

function rondCentre(c: { x: number; y: number }): BoiteALEcran {
  return { x: c.x - DIAMETRE_DU_ROND / 2, y: c.y - DIAMETRE_DU_ROND / 2, w: DIAMETRE_DU_ROND, h: DIAMETRE_DU_ROND };
}

function boiteEntre(a: BoiteALEcran, b: BoiteALEcran, t: number): BoiteALEcran {
  return { x: lin(a.x, b.x, t), y: lin(a.y, b.y, t), w: lin(a.w, b.w, t), h: lin(a.h, b.h, t) };
}

function coinsEntre(a: CoinsDeLaBoite, b: CoinsDeLaBoite, t: number): CoinsDeLaBoite {
  return [lin(a[0], b[0], t), lin(a[1], b[1], t), lin(a[2], b[2], t), lin(a[3], b[3], t)];
}

/**
 * L'IMAGE DU MORPHING à l'avancée `u` : la même fonction sert l'ouverture (u monte) et la fermeture (u descend), ce qui
 * rend les deux sens exactement symétriques — et un changement de sens en plein vol, sans saut.
 */
export function imageDuMorphing(u: number, g: GeometrieDuMorphing, largeur: number, hauteur: number): ImageDuMorphing {
  const { etape, avancee } = etapeDuMorphing(u);
  const t = adoucirAuxDeuxBouts(avancee);
  const D = coinsDuBouton(g.bord, Math.min(g.bouton.w, g.bouton.h) / 2);
  const ROND: CoinsDeLaBoite = [DIAMETRE_DU_ROND / 2, DIAMETRE_DU_ROND / 2, DIAMETRE_DU_ROND / 2, DIAMETRE_DU_ROND / 2];
  const BULLE: CoinsDeLaBoite = [g.rayonCible, g.rayonCible, g.rayonCible, g.rayonCible];
  const decolle = centreDuRond(g.bouton, g.bord, largeur, hauteur);
  const centreBouton = { x: g.bouton.x + g.bouton.w / 2, y: g.bouton.y + g.bouton.h / 2 };
  switch (etape) {
    case 'traits':
      return { etape, avancee, boite: g.bouton, coins: D, fond: 0, centre: centreBouton };
    case 'cercle': {
      const boite = boiteEntre(g.bouton, rondCentre(decolle), t);
      return { etape, avancee, boite, coins: coinsEntre(D, ROND, t), fond: 0, centre: { x: boite.x + boite.w / 2, y: boite.y + boite.h / 2 } };
    }
    case 'glisse': {
      const centre = { x: lin(decolle.x, g.centreCible.x, t), y: lin(decolle.y, g.centreCible.y, t) };
      return { etape, avancee, boite: rondCentre(centre), coins: ROND, fond: 0, centre };
    }
    case 'bulle':
      return { etape, avancee, boite: boiteEntre(rondCentre(g.centreCible), g.cible, t), coins: coinsEntre(ROND, BULLE, t), fond: t, centre: g.centreCible };
    case 'ondes':
    default:
      return { etape: 'ondes', avancee, boite: g.cible, coins: BULLE, fond: 1, centre: g.centreCible };
  }
}
