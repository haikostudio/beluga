/**
 * LE TITRE DU POINT D'UN TOUR DE CADRAGE (geste 1, `board_update_card`, champ `titreDuPoint`).
 *
 * La LISTE DES POINTS DU CADRAGE (20-21/10/2026) posée au-dessus de chaque réponse, avec le titre
 * « Réponse · sujet », a été RETIRÉE DU FIL le 13/11/2026 (captures #056f et #d26d : « ça doit être
 * une discussion »). Seule reste la mise au propre du titre que l'outil accepte toujours.
 */

export const LONGUEUR_MAX_DU_TITRE_DU_POINT = 60;

/** Un titre de point propre : une ligne, sans ponctuation finale, borné. */
export function titreDuPointPropre(titre: unknown): string | undefined {
  if (typeof titre !== 'string') return undefined;
  const ligne = titre.replace(/\s+/g, ' ').trim().replace(/[.;:]+$/, '');
  if (!ligne) return undefined;
  return ligne.length > LONGUEUR_MAX_DU_TITRE_DU_POINT ? `${ligne.slice(0, LONGUEUR_MAX_DU_TITRE_DU_POINT - 1).trimEnd()}…` : ligne;
}
