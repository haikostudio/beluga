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

/** « La publication de « X » est terminée. » — ou sans titre si on n'en a pas. */
export function phraseFinDePublication(titre?: string): string {
  const propre = titre ? nettoyerPourVoix(titre) : '';
  return propre ? `La publication de « ${propre} » est terminée.` : 'Une publication est terminée.';
}

/** « La publication de « X » a échoué. » — ou sans titre si on n'en a pas. */
export function phraseEchecDePublication(titre?: string): string {
  const propre = titre ? nettoyerPourVoix(titre) : '';
  return propre ? `La publication de « ${propre} » a échoué.` : 'Une publication a échoué.';
}

/** De quoi parle la décision : la tâche concernée, à défaut le projet. */
export interface ContexteDecision {
  /** Le titre de la tâche, quand la décision est née dans son travail. */
  tache?: string;
  /** Le nom du projet où la décision arrive. */
  projet?: string;
}

/**
 * L'annonce d'une décision attendue. Le nombre reste petit : une décision, ou
 * plusieurs. On ne récite pas un chiffre — « plusieurs » se dit mieux à voix
 * haute et vieillit bien si d'autres arrivent le temps de la phrase.
 *
 * Quand on sait DE QUOI il s'agit, on le dit pour qu'on comprenne sans regarder
 * l'écran : la tâche d'abord (le plus précis), sinon le projet. On garde le
 * repli le plus court qui tienne sous `VOIX_LONGUEUR_MAX` — un titre à rallonge
 * ne doit pas faire déborder l'annonce ; à défaut, la phrase générique.
 */
export function phraseDecisionAttendue(nouvelles: number, contexte?: ContexteDecision): string {
  const plusieurs = nouvelles > 1;
  const tache = contexte?.tache ? nettoyerPourVoix(contexte.tache) : '';
  const projet = contexte?.projet ? nettoyerPourVoix(contexte.projet) : '';

  const candidates: string[] = [];
  if (tache) {
    candidates.push(
      plusieurs
        ? `Plusieurs réponses vous attendent, dont la tâche « ${tache} ».`
        : `La tâche « ${tache} » attend votre réponse.`,
    );
  }
  if (projet) {
    candidates.push(
      plusieurs
        ? `Plusieurs réponses vous attendent, dont le projet ${projet}.`
        : `Le projet ${projet} attend votre réponse.`,
    );
  }
  candidates.push(
    plusieurs
      ? 'Plusieurs décisions attendent votre réponse.'
      : 'Une décision attend votre réponse.',
  );

  // La phrase générique tient toujours : `find` renvoie donc au moins elle.
  return candidates.find((p) => p.length <= VOIX_LONGUEUR_MAX) ?? candidates[candidates.length - 1];
}

/**
 * La phrase à lire pour un motif de notification, ou `null` quand ce motif ne
 * se dit pas à voix haute. La fin d'une tâche et la fin d'une publication
 * (réussie ou en échec) parlent par cette voie. La décision attendue, elle,
 * passe par le compte d'attention (sinon on la dirait deux fois), et le reste —
 * quota, redémarrage — n'est pas une parole d'assistant.
 */
export function phraseVocaleDeNotification(motif: string | undefined, titre?: string): string | null {
  if (motif === 'tache-terminee') return phraseFinDeTache(titre);
  if (motif === 'publication-terminee') return phraseFinDePublication(titre);
  if (motif === 'publication-echec') return phraseEchecDePublication(titre);
  return null;
}
