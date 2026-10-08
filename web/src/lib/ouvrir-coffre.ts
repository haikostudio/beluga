/**
 * MENER AU COFFRE-FORT depuis un écran qui ne le connaît pas (le Studio, quand
 * la clé OpenRouter de la voix finale manque) : l'application change de vue.
 * Vit hors du Studio, que l'application ne charge qu'à son ouverture.
 */
export const EVENEMENT_OUVRIR_COFFRE = 'beluga:ouvrir-coffre';

export function ouvrirLeCoffre(): void {
  window.dispatchEvent(new CustomEvent(EVENEMENT_OUVRIR_COFFRE));
}
