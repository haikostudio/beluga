/**
 * « Où en est cette carte ? » — sans l'ouvrir.
 *
 * L'agent d'une carte lancée annonce une liste de tâches, cochée en direct
 * (« Liste des tâches — 2/3 faites »). Cet avancement ne se voyait que dans la
 * conversation ouverte : il fallait ouvrir chaque carte une à une pour savoir
 * où elle en est.
 *
 * Ici, le même décompte (`faites`/`total`) est posé dans le décroché du bas de
 * la carte — TOUTES les cartes qui en ont un, pas seulement celle où un agent
 * travaille encore : le décompte reste le dernier connu tant que la carte n'en
 * a pas de plus récent. La règle vit ici, sans base ni réseau : elle se teste
 * seule, et le texte reste cohérent avec le volet des tâches de la
 * conversation.
 */

/** Le décompte tel qu'il voyage avec l'agent : combien de coché sur le total. */
export interface ProgressionTaches {
  done: number;
  total: number;
  /** Les étapes qui n'ont pas été menées à bout, quand le tour s'est refermé. */
  unfinished?: number;
}

/** Ce qu'il faut savoir d'une carte pour décider d'afficher son avancement. */
export interface CartePourProgression {
  /** Le décompte porté par l'agent de la carte, s'il en a un. */
  todos?: ProgressionTaches;
}

/**
 * La ligne à poser dans le décroché, ou `null` quand il n'y a rien à dire.
 *
 * Un seul silence : l'agent n'a pas (encore, ou jamais eu) de liste de
 * tâches. Le décroché garde ses autres états prioritaires (chiffrage,
 * attente, échec) : cette mention ne s'affiche que lorsqu'aucun d'eux ne
 * parle.
 *
 * UN RESTE NON FAIT SE DIT. Un tour coupé — panne, quota, arrêt à la main —
 * laisse des étapes jamais menées à bout. « 3/5 faites » tout court laissait
 * croire à un travail encore en route ; on ajoute donc ce qu'il est advenu du
 * reste (« 3/5 faites · 2 non faites »), la même mention que l'en-tête du volet
 * des tâches de la conversation.
 */
export function mentionProgressionTaches(carte: CartePourProgression): string | null {
  const todos = carte.todos;
  if (!todos || todos.total <= 0) return null;

  // Le pluriel suit le volet des tâches de la conversation : « 1/3 faite »,
  // « 2/3 faites ».
  const s = todos.done > 1 ? 's' : '';
  const faites = `${todos.done}/${todos.total} faite${s}`;
  const restees = todos.unfinished ?? 0;
  if (restees <= 0) return faites;
  return `${faites} · ${restees} non faite${restees > 1 ? 's' : ''}`;
}
