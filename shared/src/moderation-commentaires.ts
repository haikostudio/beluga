import { FICHES_RESEAUX, type ReseauSocial } from './reseaux-sociaux.js';

/**
 * MASQUER OU SUPPRIMER UN COMMENTAIRE, LÀ OÙ LE RÉSEAU LE PERMET (décision de l'utilisateur du 04/11/2026). Ce qui
 * est déclaré ici est ce que l'interface officielle de chaque réseau permet RÉELLEMENT sur les commentaires reçus
 * par la marque — un test vérifie que chaque capacité a son geste dans l'adaptateur du réseau :
 *
 *   - Facebook : masquer (`is_hidden`) et supprimer un commentaire de sa page ;
 *   - Instagram : masquer (`hide`) et supprimer un commentaire de ses publications ;
 *   - YouTube : masquer (statut de modération « rejeté ») — la suppression n'est ouverte qu'à l'auteur ;
 *   - X : masquer une réponse à sa publication — la suppression n'est ouverte qu'à l'auteur ;
 *   - Threads : masquer une réponse — la suppression n'est ouverte qu'à l'auteur ;
 *   - LinkedIn, fiche Google : ni l'un ni l'autre par leur interface ;
 *   - TikTok, Pinterest : les commentaires ne sont même pas lus.
 *
 * Un geste impossible reste À L'ÉCRAN, éteint, avec sa raison : on sait pourquoi, et où le faire à la main. Rien ne
 * part sans le clic de l'utilisateur, et une suppression se confirme d'abord — elle est définitive.
 */
export const MODERATION_DES_COMMENTAIRES: Readonly<Record<ReseauSocial, { masquer: boolean; supprimer: boolean }>> = {
  facebook: { masquer: true, supprimer: true },
  instagram: { masquer: true, supprimer: true },
  youtube: { masquer: true, supprimer: false },
  x: { masquer: true, supprimer: false },
  threads: { masquer: true, supprimer: false },
  linkedin: { masquer: false, supprimer: false },
  'google-business': { masquer: false, supprimer: false },
  tiktok: { masquer: false, supprimer: false },
  pinterest: { masquer: false, supprimer: false },
};

export type GesteDeModeration = 'masquer' | 'supprimer';

/** Pourquoi ce geste est impossible sur ce réseau ; `null` s'il est permis. */
export function raisonModerationImpossible(reseau: ReseauSocial, geste: GesteDeModeration): string | null {
  const fiche = FICHES_RESEAUX[reseau];
  if (!fiche) return 'Réseau inconnu.';
  if (!fiche.commentaires) return `${fiche.libelle} ne donne pas ses commentaires aux applications.`;
  if (MODERATION_DES_COMMENTAIRES[reseau]?.[geste]) return null;
  return geste === 'masquer'
    ? `${fiche.libelle} ne permet pas de masquer un commentaire depuis une application : faites-le sur ${fiche.libelle}.`
    : `${fiche.libelle} ne laisse supprimer un commentaire qu’à son auteur : masquez-le, ou faites-le sur ${fiche.libelle}.`;
}
