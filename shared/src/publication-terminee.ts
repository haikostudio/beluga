/**
 * Ce qui reste à l'écran une fois la publication finie.
 *
 * Le bloc de publication racontait indéfiniment le DERNIER passage : ses sept
 * étapes cochées et la ligne « Publié : N tâche(s) » restaient sous le bouton
 * alors même que la colonne était de nouveau vide. On lisait l'état d'hier en
 * croyant lire celui d'aujourd'hui. Une fois la mise en ligne RÉUSSIE, le bloc
 * se remet donc à zéro TOUT DE SUITE : plus aucun compte rendu, on repart d'un
 * bloc vierge — le bouton et son chevron, rien d'autre.
 *
 * Règle pure : aucune base, aucun disque — donc rejouable telle quelle.
 */

export type EtatPublication = 'running' | 'awaiting' | 'success' | 'failed' | 'stopped';

/**
 * Le rapport du dernier passage reste-t-il affiché ?
 *
 * - pendant le travail : oui, c'est lui qu'on regarde ;
 * - pendant une ATTENTE d'accord avant envoi : oui, c'est lui qui porte la
 *   décision et ses deux boutons — l'effacer laisserait la publication en plan ;
 * - après un échec ou un arrêt : oui, il porte le motif et le bouton
 *   « Relancer » — l'effacer priverait de la seule sortie ;
 * - après une RÉUSSITE : non, jamais. Le déploiement est fait, le bloc n'a plus
 *   rien à dire — il repart vierge, qu'un nouveau lot attende ou non.
 */
export function rapportAGarder(etat: EtatPublication | undefined): boolean {
  if (!etat) return false;
  if (etat === 'success') return false;
  return true;
}

/**
 * Le déroulé des étapes est-il déplié ?
 *
 * Il s'ouvre pendant le travail — on suit l'avancée — et se referme quand la
 * mise en ligne aboutit : une réussite tient en une ligne. Un échec, un arrêt
 * ou une attente d'accord restent ouverts, parce que c'est là qu'on lit ce qui
 * a coincé, ou ce qu'on doit trancher.
 */
export function derouleOuvert(etat: EtatPublication): boolean {
  return etat !== 'success';
}
