/**
 * « Où en est cette carte ? » — sans l'ouvrir.
 *
 * L'agent d'une carte lancée annonce une liste de tâches, cochée en direct
 * (« Liste des tâches — 2/3 faites »). Cet avancement ne se voyait que dans la
 * conversation ouverte : sur la colonne « En cours », il fallait ouvrir chaque
 * carte une à une pour savoir où elle en est.
 *
 * Ici, le même décompte (`faites`/`total`) est posé dans le décroché du bas de
 * la carte. La règle vit ici, sans base ni réseau : elle se teste seule, et le
 * texte reste cohérent avec le volet des tâches de la conversation.
 */

/** Le décompte tel qu'il voyage avec l'agent : combien de coché sur le total. */
export interface ProgressionTaches {
  done: number;
  total: number;
}

/** Ce qu'il faut savoir d'une carte pour décider d'afficher son avancement. */
export interface CartePourProgression {
  /** La colonne du tableau. Seule « En cours » est concernée. */
  column: string;
  /** Un agent de tâche travaille-t-il encore sur cette carte ? */
  agentActif?: boolean;
  /** Le décompte porté par l'agent d'exécution, s'il en a un. */
  todos?: ProgressionTaches;
}

/**
 * La ligne à poser dans le décroché, ou `null` quand il n'y a rien à dire.
 *
 * Trois silences : la carte n'est pas en « En cours » (sa colonne dit déjà où
 * elle en est), aucun agent de tâche ne travaille dessus (l'avancement d'un
 * tour fini n'apprend rien de vivant), ou l'agent n'a pas encore de liste de
 * tâches. Le décroché garde ses autres états prioritaires (chiffrage, attente,
 * échec) : cette mention ne s'affiche que lorsqu'aucun d'eux ne parle.
 */
export function mentionProgressionTaches(carte: CartePourProgression): string | null {
  if (carte.column !== 'running') return null;
  if (!carte.agentActif) return null;
  const todos = carte.todos;
  if (!todos || todos.total <= 0) return null;

  // Le pluriel suit le volet des tâches de la conversation : « 1/3 faite »,
  // « 2/3 faites ».
  const s = todos.done > 1 ? 's' : '';
  return `${todos.done}/${todos.total} faite${s}`;
}
