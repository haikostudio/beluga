import type { Attachment } from '@beluga/shared';

/**
 * JOINDRE UNE PIÈCE AU CHAMP D'ÉCRITURE D'UN AGENT, depuis ailleurs dans
 * l'écran (« Redemander avec une consigne » du menu d'un média). Le champ de
 * cet agent, s'il est monté, ajoute la pièce, pose son tag au curseur et prend
 * le focus ; rien n'est envoyé. Les pièces jointes suivent l'agent, pas le
 * composant : c'est l'identifiant de l'agent qui désigne le champ.
 */
export const EVENEMENT_JOINDRE_AU_CHAMP = 'beluga:joindre-au-champ';

export interface DetailJoindreAuChamp {
  agentId: string;
  /** Une pièce jointe : elle rejoint la liste et son tag se pose au curseur. */
  piece?: Attachment;
  /** Ou un texte (l'étiquette « [pièce: …] » du suivi), posé au curseur. */
  texte?: string;
  /**
   * Ou une PHRASE DE DÉPART (« Faire des modifications » de Communication) : elle s'ajoute À LA SUITE du brouillon,
   * sur une nouvelle ligne s'il n'est pas vide, curseur en fin pour que la personne complète. Avec `piece`, la pièce
   * rejoint la liste sans second tag : la phrase porte déjà le sien (`ancre(designationDePiece(piece))`).
   */
  ajout?: string;
  /** Avec `ajout`, ce qui le sépare d'un brouillon non vide (une ligne par défaut ; la synthèse de la voix : une ligne vide). */
  separation?: string;
  /** Avec `ajout`, PLUSIEURS pièces d'un coup (« Toutes les versions » d'un post décliné) : chacune rejoint la liste. */
  pieces?: Attachment[];
  /** Mis à vrai par le champ qui l'a reçu : sans champ monté, l'appelant prend le relais. */
  recu?: boolean;
}

/** Rend vrai quand un champ d'écriture monté a reçu la pièce ou le texte. */
export function joindreAuChamp(detail: DetailJoindreAuChamp): boolean {
  const envoye: DetailJoindreAuChamp = { ...detail, recu: false };
  window.dispatchEvent(new CustomEvent<DetailJoindreAuChamp>(EVENEMENT_JOINDRE_AU_CHAMP, { detail: envoye }));
  return !!envoye.recu;
}
