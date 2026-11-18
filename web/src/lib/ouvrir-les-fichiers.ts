/**
 * OUVRIR LA FENÊTRE « FICHIERS » depuis n'importe où (bouton en haut de la colonne de gauche, explorateur d'un
 * projet), sur un dossier rangé précis ou sur la racine. La fenêtre elle-même (`components/fichiers/`) n'est chargée
 * qu'à sa première ouverture : un écran qu'on n'a pas ouvert ne se télécharge pas.
 */
export const EVENEMENT_OUVRIR_LES_FICHIERS = 'beluga:ouvrir-les-fichiers';

export interface DemandeDOuvertureDesFichiers {
  /** Le dossier rangé à montrer (« Beluga/Studio ») ; vide = la racine. */
  chemin?: string;
  /** Ouvrir directement sur le dossier de ce projet. */
  projetId?: string;
}

export function ouvrirLesFichiers(demande: DemandeDOuvertureDesFichiers = {}): void {
  window.dispatchEvent(new CustomEvent<DemandeDOuvertureDesFichiers>(EVENEMENT_OUVRIR_LES_FICHIERS, { detail: demande }));
}
