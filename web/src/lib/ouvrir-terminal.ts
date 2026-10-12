/**
 * LE TERMINAL DU SERVEUR S'OUVRE DEPUIS LES RÉGLAGES, MAIS IL VIT À LA RACINE.
 *
 * Son entrée a quitté le menu « … » de la barre d'en-tête pour la page
 * « Serveur et agents » des réglages. Le terminal, lui, est une PAGE de la zone
 * principale : ouvert depuis la fenêtre des réglages, il resterait derrière
 * elle. La racine (`app.tsx`) le porte donc, referme les réglages et l'ouvre —
 * l'entrée ne fait que le demander.
 */
export const EVENEMENT_OUVRIR_TERMINAL = 'beluga:ouvrir-terminal';

export function ouvrirLeTerminal(): void {
  window.dispatchEvent(new CustomEvent(EVENEMENT_OUVRIR_TERMINAL));
}
