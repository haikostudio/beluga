import type { PieceDuDocument, SectionDuDocument } from './document-du-brief.js';

/**
 * LE BRIEF EN ARBRE (26/10/2026, demande de l'utilisateur : « un système
 * d'arbres qui permet une meilleure lecture, comme dans la colonne de gauche »).
 * Le document du Brief (`documentDuBrief`) se lit sur TROIS niveaux reliés par
 * le fil pointillé des projets réunis : la PARTIE (Brief, Direction, Scénario,
 * Plans…), l'ÉLÉMENT (une section : Scène 3, Plan 2, la direction retenue…),
 * la RUBRIQUE (un bloc de `blocsDePiece` : Objectif, Durée, On voit…).
 *
 *  - Chaque partie et chaque élément se replie. À l'ouverture : les parties
 *    sont DÉPLIÉES, les Plans et les Scènes REPLIÉS sur leur titre ; le reste
 *    (brief, direction, scénario) déplié.
 *  - Une partie FONDUE dans sa section unique (« Brief ») ne fait qu'un nœud :
 *    celui de la partie.
 *  - La clé d'un nœud est son ANCRE (stable tant que le document garde ses
 *    pièces) ; ce qu'on a ouvert ou replié est retenu PAR CARTE dans une
 *    préférence partagée entre appareils (`suivi.brief.bascules`), qui ne
 *    garde que les nœuds BASCULÉS (l'écart au défaut), et seulement pour les
 *    `MAX_CARTES_RETENUES` cartes touchées en dernier.
 *  - Copier et Télécharger lisent le document entier : le repli n'est qu'un
 *    affichage.
 */

export const PREF_DES_BASCULES_DU_BRIEF = 'suivi.brief.bascules';
export const MAX_CARTES_RETENUES = 40;

/** Les genres de pièce repliés à l'ouverture : on lit d'abord leur liste, titre par titre. */
const GENRES_REPLIES = new Set(['plan', 'scene']);

/** Par carte, les clés des nœuds dont l'état diffère du défaut ; l'ordre des cartes dit la plus récente en dernier. */
export type BasculesDuBrief = Record<string, readonly string[]>;

/** Un élément (section) est-il déplié à l'ouverture ? Les Plans et les Scènes, non. */
export function elementOuvertParDefaut(section: Pick<SectionDuDocument<PieceDuDocument>, 'piece'>): boolean {
  return !(section.piece && GENRES_REPLIES.has(section.piece.genre));
}

/** Un nœud est-il ouvert ? Son défaut, retourné s'il a été basculé. */
export function noeudOuvert(bascules: BasculesDuBrief | null | undefined, cardId: string, cle: string, parDefaut: boolean): boolean {
  const liste = bascules?.[cardId];
  const basculee = Array.isArray(liste) && liste.includes(cle);
  return basculee ? !parDefaut : parDefaut;
}

/**
 * BASCULER UN NŒUD : la clé entre dans la liste de la carte, ou en sort si elle
 * y était (retour au défaut). La carte passe en dernier ; au-delà de
 * `MAX_CARTES_RETENUES`, les plus anciennes s'oublient ; une carte revenue au
 * défaut partout disparaît. La préférence ne grossit donc pas.
 */
export function basculerUnNoeud(bascules: BasculesDuBrief | null | undefined, cardId: string, cle: string, max = MAX_CARTES_RETENUES): BasculesDuBrief {
  const avant = bascules && typeof bascules === 'object' ? bascules : {};
  const liste = Array.isArray(avant[cardId]) ? avant[cardId]! : [];
  const nouvelle = liste.includes(cle) ? liste.filter((c) => c !== cle) : [...liste, cle];
  const autres = Object.entries(avant).filter(([id, l]) => id !== cardId && Array.isArray(l) && l.length);
  const entrees = nouvelle.length ? [...autres, [cardId, nouvelle] as const] : autres;
  return Object.fromEntries(entrees.slice(Math.max(0, entrees.length - max)));
}

/** OUVRIR un nœud (le sommaire qui vise une partie repliée) : rien ne change s'il l'est déjà. */
export function ouvrirUnNoeud(bascules: BasculesDuBrief | null | undefined, cardId: string, cle: string, parDefaut: boolean, max = MAX_CARTES_RETENUES): BasculesDuBrief | null {
  return noeudOuvert(bascules, cardId, cle, parDefaut) ? null : basculerUnNoeud(bascules, cardId, cle, max);
}

const MAJUSCULE = /\p{Lu}/u;
const MINUSCULE = /\p{Ll}/u;

/**
 * UN INTITULÉ ÉCRIT D'UNE SEULE FAÇON (capture #7671 : « DURÉE » à côté de
 * « Capacité ») : un intitulé tout en capitales passe en minuscules sous une
 * majuscule initiale (« ACCROCHE (0-2 s) » → « Accroche (0-2 s) »), sauf un
 * sigle de trois lettres au plus ; un
 * intitulé déjà en casse mixte ne bouge pas. Affichage seulement : le texte
 * stocké, Copier et Télécharger gardent ce qui est écrit.
 */
export function intituleLisible(titre: string): string {
  const s = String(titre ?? '');
  /* Seul le libellé compte : une précision entre parenthèses (« (0-2 s) ») garde sa casse. */
  const libelle = s.replace(/\([^()]*\)/g, ' ');
  /* Un sigle seul (« IA », « CTA ») reste un sigle. */
  if (!MAJUSCULE.test(libelle) || MINUSCULE.test(libelle) || (libelle.match(/\p{L}/gu)?.length ?? 0) <= 3) return s;
  const bas = s.replace(/([^()]+)|(\([^()]*\))/g, (_, hors: string | undefined, dans: string | undefined) => dans ?? hors!.toLocaleLowerCase('fr'));
  const i = bas.search(/\p{L}/u);
  return i < 0 ? bas : bas.slice(0, i) + bas.charAt(i).toLocaleUpperCase('fr') + bas.slice(i + 1);
}
