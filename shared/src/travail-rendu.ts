/**
 * « Un agent a fini, et personne n'a encore lu sa réponse. »
 *
 * La roue qui tourne dit déjà qu'un agent travaille. Ce qui manquait, c'est
 * l'état d'APRÈS : le travail est rendu, la carte attend une lecture, et un
 * projet fermé — ou un groupe replié — n'en laissait rien voir.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */

export interface CarteRendue {
  cardId: string;
  projectId: string;
  /** Colonne de la carte : une carte archivée ne réclame plus rien. */
  colonne?: string;
  /** Statut du dernier agent de la carte. */
  agentStatut?: 'idle' | 'starting' | 'running' | 'stopped' | 'failed' | 'done';
  /** Quand cet agent a rendu sa réponse. */
  agentFiniA?: number;
  /** Quand la conversation de cette carte a été ouverte pour la dernière fois. */
  luA?: number;
}

/**
 * Une carte compte-t-elle comme « rendue, pas encore lue » ?
 *
 * Seul « done » compte : un agent arrêté ou en échec n'a rien rendu. Et la
 * lecture doit être POSTÉRIEURE à la réponse — ouvrir la carte avant que
 * l'agent ait fini n'éteint rien.
 */
export function carteNonLue(entree: CarteRendue): boolean {
  if (entree.colonne === 'archived') return false;
  if (entree.agentStatut !== 'done') return false;
  const rendu = entree.agentFiniA ?? 0;
  if (!rendu) return false;
  return rendu > (entree.luA ?? 0);
}

/** Combien de réponses non lues par projet — la pastille de la liste. */
export function rendusParProjet(entrees: CarteRendue[]): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const entree of entrees) {
    if (!carteNonLue(entree)) continue;
    compte[entree.projectId] = (compte[entree.projectId] ?? 0) + 1;
  }
  return compte;
}

/**
 * Le compte d'un groupe replié : la somme de ses projets. Sans cela, refermer
 * un groupe cacherait précisément l'information qu'on veut voir.
 */
export function rendusDuGroupe(membres: string[], parProjet: Record<string, number>): number {
  return membres.reduce((total, id) => total + (parProjet[id] ?? 0), 0);
}
