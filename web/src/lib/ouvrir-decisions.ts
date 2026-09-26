/**
 * UN « REPRENDRE » QUI HEURTE UNE DÉCISION OUVERTE MÈNE À ELLE.
 *
 * Tant qu'une décision attend sur la carte (« Avec quel compte poursuivre ? »,
 * « Relancer / Ignorer / Arrêter »), le démon refuse tout lancement. Le bouton
 * « Reprendre » renvoyait donc un refus en rouge, et l'utilisateur tournait en
 * rond (constaté le 13/09/2026). Il DÉPLIE désormais le panneau des décisions
 * et le fait défiler jusqu'à lui.
 */
export const EVENEMENT_OUVRIR_DECISIONS = 'beluga:ouvrir-decisions';

/** Rend vrai si un panneau de décisions était là et a été ouvert. */
export function ouvrirLesDecisions(): boolean {
  const panneau = document.querySelector<HTMLElement>('[data-panneau-decision]:not([data-panneau-decision="0"])');
  if (!panneau) return false;
  window.dispatchEvent(new CustomEvent(EVENEMENT_OUVRIR_DECISIONS));
  requestAnimationFrame(() => panneau.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  return true;
}
