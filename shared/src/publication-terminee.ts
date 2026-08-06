/**
 * Ce qui reste à l'écran une fois la publication finie.
 *
 * Le bloc de publication racontait indéfiniment le DERNIER passage : ses sept
 * étapes cochées restaient sous le bouton alors qu'un nouveau lot attendait
 * déjà. On lisait l'état d'hier en croyant lire celui d'aujourd'hui. Une fois
 * la mise en ligne réussie, le bloc se remet donc à zéro dès qu'il y a de quoi
 * repartir.
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
 * - après une réussite : seulement tant que rien de neuf n'attend. Dès qu'un
 *   lot est prêt, il laisse la place au bouton.
 */
export function rapportAGarder(etat: EtatPublication | undefined, aPublier: number): boolean {
  if (!etat) return false;
  if (etat === 'success') return aPublier <= 0;
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
