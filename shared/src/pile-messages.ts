/**
 * La pile des vignettes d'agents, en bas à droite.
 *
 * Les vignettes ne se mettent pas les unes SOUS les autres : elles s'empilent
 * les unes SUR les autres, la plus récente devant. Celles du dessous ne
 * dépassent que de quelques pixels, un peu plus petites et un peu plus pâles —
 * la pile occupe la place d'une seule vignette, quel qu'en soit le nombre. Au
 * survol, elle s'ouvre en liste complète.
 *
 * Tout est calculé ici, sans base ni disque : la géométrie est donc rejouable
 * seule, et l'affichage n'a plus qu'à poser les nombres rendus.
 *
 * Les messages d'information passagers (les « toasts »), eux, ne passent plus
 * par cette pile : ils s'empilent en HAUT AU CENTRE, en liste plate,
 * `web/src/components/toasts.tsx`. `heureEtDate` et `DUREE_MESSAGE_MS`
 * ci-dessous restent leur affaire.
 */

/** Combien de messages se voient dans la pile fermée ; le reste est compté. */
export const PILE_VISIBLES = 3;
/** Ce que chaque message du dessous laisse dépasser, en pixels. */
export const PILE_DECALAGE = 6;
/** L'écart entre deux messages, pile OUVERTE, en pixels. */
export const PILE_ECART = 6;
/** La durée de l'ouverture et de la fermeture, en millisecondes. */
export const PILE_DUREE = 200;
/** Ce que chaque rang perd en largeur : le rétrécissement se voit sans gêner. */
const RETRECISSEMENT = 0.04;

/** Où se pose un message de la pile, et comment il se montre. */
export interface PlaceDansLaPile {
  /** De combien de pixels il descend, depuis le haut de la pile. */
  decalage: number;
  /** Son échelle : 1 devant, un peu moins derrière. */
  echelle: number;
  /** Son opacité : pleine devant, atténuée derrière. */
  opacite: number;
  /** Sa profondeur d'empilement : le plus récent devant. */
  profondeur: number;
  /** S'affiche-t-il, ou est-il seulement compté ? */
  visible: boolean;
}

/** Les hauteurs mesurées des messages, du plus récent au plus ancien. */
export type HauteursDePile = number[];

/**
 * La place d'un message dans la pile.
 *
 * Pile fermée, les messages sont alignés par le BAS puis poussés vers le bas de
 * quelques pixels chacun : c'est ce qui garantit le liseré visible même quand
 * le message de derrière est plus court que celui de devant. Pile ouverte,
 * chacun se pose sous le précédent, à la hauteur réellement mesurée.
 */
export function placeDansLaPile(
  index: number,
  hauteurs: HauteursDePile,
  ouverte: boolean,
): PlaceDansLaPile {
  const total = hauteurs.length;
  const profondeur = Math.max(1, total - index);
  if (ouverte) {
    let decalage = 0;
    for (let i = 0; i < index; i += 1) decalage += (hauteurs[i] ?? 0) + PILE_ECART;
    return { decalage, echelle: 1, opacite: 1, profondeur, visible: true };
  }
  const visible = index < PILE_VISIBLES;
  const devant = hauteurs[0] ?? 0;
  const sien = hauteurs[index] ?? devant;
  return {
    // Aligner les bas, puis décaler : le message de derrière dépasse toujours.
    decalage: Math.max(0, devant - sien) + index * PILE_DECALAGE,
    echelle: Math.max(0.8, 1 - index * RETRECISSEMENT),
    opacite: visible ? Math.max(0.4, 1 - index * 0.25) : 0,
    profondeur,
    visible,
  };
}

/**
 * La hauteur que la pile réserve : celle d'un seul message quand elle est
 * fermée, celle de la liste entière quand elle est ouverte. Sans mesure encore
 * prise, on ne réserve rien — l'affichage se recale au premier rendu.
 */
export function hauteurDeLaPile(hauteurs: HauteursDePile, ouverte: boolean): number {
  if (!hauteurs.length) return 0;
  if (ouverte) {
    return hauteurs.reduce((somme, h) => somme + h, 0) + PILE_ECART * (hauteurs.length - 1);
  }
  const montrés = Math.min(hauteurs.length, PILE_VISIBLES);
  return (hauteurs[0] ?? 0) + PILE_DECALAGE * (montrés - 1);
}

/**
 * Ce qui reste sous la pile fermée, dit en toutes lettres. Rien à dire tant
 * qu'aucun élément n'est caché.
 *
 * Le bloc porte deux piles — les messages courts, les vignettes d'agents — et
 * la même règle les compte : seul le NOM de ce qu'on empile change, d'où le
 * second argument. Sans lui, la pile des vignettes annoncerait « + 2 autres
 * messages ».
 */
export function resteDeLaPile(total: number, nom = 'message'): string {
  const cachés = total - PILE_VISIBLES;
  if (cachés <= 0) return '';
  return cachés === 1 ? `+ 1 autre ${nom}` : `+ ${cachés} autres ${nom}s`;
}

/**
 * L'heure puis la date d'un message, en une ligne courte posée sous son texte :
 * « 14:32 · 04.08.2026 ». On donne les deux, toujours : un message resté à
 * l'écran depuis la veille ne doit pas se lire comme s'il venait d'arriver.
 */
export function heureEtDate(at?: number): string {
  if (!at) return '';
  const date = new Date(at);
  const heure = date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
  const jour = date.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${heure} · ${jour}`;
}

/**
 * Le temps qu'un message d'information passager reste à l'écran avant de se
 * fermer seul, sa barre de progression comprise — pour TOUS les niveaux, une
 * erreur y compris : 15 secondes suffisent à la lire, là où les 4,2 secondes
 * d'avant ne le permettaient qu'aux messages sans conséquence.
 */
export const DUREE_MESSAGE_MS = 15000;
