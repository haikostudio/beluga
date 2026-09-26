/**
 * SUPPRIMER UNE CARTE, C'EST AUSSI ÉTEINDRE CE QU'ELLE FAISAIT CLIGNOTER.
 *
 * `store.deleteCard` n'efface qu'une ligne de table. Le fil de l'agent, lui,
 * reste : ses questions ouvertes, son tour arrêté sur `ask_user`, ses cartes
 * proposées jamais tranchées. Résultat, avant ce fichier : un triangle orange
 * sur le projet et un chiffre sur la cloche qui n'ouvraient plus rien — le
 * tiroir répondait « Cette tâche n'existe plus », et l'alerte revenait au clic
 * suivant.
 *
 * Deux filets, et il en faut deux :
 *  - ICI, au moment du geste : les questions de la carte sont fermées (donc le
 *    tour suspendu repart), et le compte des décisions est rediffusé tout de
 *    suite ;
 *  - À LA LECTURE, dans `store.decisionsEnAttente`, pour tout ce qui a été
 *    supprimé AVANT cette règle et dort encore en base.
 */
import { bus } from './bus.js';
import { fermerLesQuestionsDeLaCarte } from './fermeture-questions.js';
import { log } from './logger.js';
import * as store from './store.js';

/**
 * Le geste unique de suppression. Rend `false` quand la carte n'existait déjà
 * plus — l'appelant décide alors quoi en dire.
 */
export function supprimerLaCarte(cardId: string): boolean {
  const carte = store.getCard(cardId);
  if (!carte) return false;

  /*
   * Le nettoyage vient AVANT la suppression : `fermerLesQuestionsDeLaCarte`
   * relit les messages de la carte, et il lui faut donc encore ses agents. Un
   * incident ne doit jamais empêcher la suppression demandée : il se dit dans
   * le journal, et la carte part quand même.
   */
  try {
    fermerLesQuestionsDeLaCarte(cardId);
  } catch (err) {
    log.warn(`suppression de la carte ${cardId} : fermeture des questions impossible`, err);
  }

  store.deleteCard(cardId);
  bus.emit({ type: 'card.delete', id: cardId, projectId: carte.projectId });
  // Le compte des décisions a changé : sans cette diffusion, le triangle du
  // projet resterait allumé jusqu'au prochain événement, quel qu'il soit.
  bus.emit({ type: 'attention', ...store.signalAttention() });
  return true;
}
