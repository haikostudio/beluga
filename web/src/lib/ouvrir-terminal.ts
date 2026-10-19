/**
 * LE TERMINAL DU SERVEUR S'OUVRE DEPUIS PLUSIEURS ENDROITS, MAIS IL VIT À LA RACINE.
 *
 * Ses entrées : le bouton du tableau de bord et la page « Serveur et agents »
 * des réglages. Le terminal, lui, est un volet ancré en bas de l'application :
 * ouvert depuis la fenêtre des réglages, il resterait derrière elle. La racine
 * (`app.tsx`) le porte donc, referme les réglages et l'ouvre — l'entrée ne
 * fait que le demander.
 */
export const EVENEMENT_OUVRIR_TERMINAL = 'beluga:ouvrir-terminal';

export function ouvrirLeTerminal(): void {
  window.dispatchEvent(new CustomEvent(EVENEMENT_OUVRIR_TERMINAL));
}
