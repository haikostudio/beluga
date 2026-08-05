/**
 * Ce que l'assistant DIT à voix haute aux moments clés (PLAN §22, mémoire n°35).
 *
 * La voix se déclenche seule à deux instants déjà signalés ailleurs : une tâche
 * terminée (motif de notification « tache-terminee ») et une décision attendue
 * (le compte d'« attention » qui monte). Ici on ne fabrique QUE la phrase —
 * courte, écrite pour l'oreille : l'important d'abord, sans jargon. La lecture
 * elle-même (Piper) et l'onde sonore vivent côté web.
 */

/** Le nombre de signes au-delà duquel on ne lit plus : une annonce reste brève. */
export const VOIX_LONGUEUR_MAX = 240;

/**
 * Le titre d'une carte arrive souvent précédé d'un emoji de genre (« ✅ Mon
 * titre ») : à l'oreille il ne dit rien, on le retire. On enlève de même les
 * guillemets qui entoureraient déjà le titre, pour ne pas les redoubler.
 */
export function nettoyerPourVoix(titre: string): string {
  return titre
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^["«»“”\s]+|["«»“”\s]+$/gu, '')
    .trim();
}

/** « La tâche « X » est terminée. » — ou sans titre si on n'en a pas. */
export function phraseFinDeTache(titre?: string): string {
  const propre = titre ? nettoyerPourVoix(titre) : '';
  return propre ? `La tâche « ${propre} » est terminée.` : 'Une tâche est terminée.';
}

/**
 * L'annonce d'une décision attendue. Le nombre reste petit : une décision, ou
 * plusieurs. On ne récite pas un chiffre — « plusieurs » se dit mieux à voix
 * haute et vieillit bien si d'autres arrivent le temps de la phrase.
 */
export function phraseDecisionAttendue(nouvelles: number): string {
  return nouvelles > 1
    ? 'Plusieurs décisions attendent votre réponse.'
    : 'Une décision attend votre réponse.';
}

/**
 * La phrase à lire pour un motif de notification, ou `null` quand ce motif ne
 * se dit pas à voix haute. Seule la fin d'une tâche parle par cette voie : la
 * décision attendue passe par le compte d'attention (sinon on la dirait deux
 * fois), et le reste — publication, quota, redémarrage — n'est pas une parole
 * d'assistant.
 */
export function phraseVocaleDeNotification(motif: string | undefined, titre?: string): string | null {
  if (motif === 'tache-terminee') return phraseFinDeTache(titre);
  return null;
}
