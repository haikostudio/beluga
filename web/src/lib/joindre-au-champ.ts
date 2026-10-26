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
  /** Mis à vrai par le champ qui l'a reçu : sans champ monté, l'appelant prend le relais. */
  recu?: boolean;
}

/** Rend vrai quand un champ d'écriture monté a reçu la pièce ou le texte. */
export function joindreAuChamp(detail: DetailJoindreAuChamp): boolean {
  const envoye: DetailJoindreAuChamp = { ...detail, recu: false };
  window.dispatchEvent(new CustomEvent<DetailJoindreAuChamp>(EVENEMENT_JOINDRE_AU_CHAMP, { detail: envoye }));
  return !!envoye.recu;
}
