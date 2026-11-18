/**
 * OUVRIR LA BIBLIOTHÈQUE DE STYLES DU STUDIO DEPUIS UNE QUESTION DU DIRECTEUR (31/10/2026) : l'option « Voir la
 * bibliothèque » (`OPTION_VOIR_LA_BIBLIOTHEQUE`) ne répond pas, elle ouvre le tiroir des styles de l'atelier monté.
 * Rend vrai quand un atelier l'a reçue — sans atelier à l'écran, l'option reste un choix ordinaire.
 */
export const EVENEMENT_BIBLIOTHEQUE_DU_STUDIO = 'beluga:studio-bibliotheque';

export function ouvrirLaBibliothequeDuStudio(): boolean {
  const detail = { recu: false };
  window.dispatchEvent(new CustomEvent(EVENEMENT_BIBLIOTHEQUE_DU_STUDIO, { detail }));
  return detail.recu;
}
