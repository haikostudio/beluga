/**
 * Lire la capacité de la machine SANS mentir sur la couleur.
 *
 * La barre affichée suivait la charge processeur, plafonnée à cent : sur ce
 * serveur, qui héberge déjà Paseo et une dizaine de serveurs de projets, cette
 * charge frôle en permanence le nombre de cœurs. La barre était donc rouge et
 * pleine pendant qu'il restait quatorze places libres — exactement le contraire
 * de ce qu'elle devait dire.
 *
 * Ce qui compte pour l'utilisateur, c'est la PLACE QUI RESTE : la barre montre
 * désormais l'occupation des places d'agents, et rien d'autre.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */

export interface EtatCapacite {
  /** Agents qui tournent en ce moment. */
  runningAgents: number;
  /** Agents qui pourraient encore démarrer tout de suite. */
  slotsFree: number;
  /** Les départs sont suspendus (saturation ou pause manuelle). */
  paused?: boolean;
}

/** Part des places occupées, en pour cent : zéro quand tout est libre. */
export function tauxOccupation(etat: EtatCapacite): number {
  if (etat.paused) return 100;
  const total = etat.runningAgents + etat.slotsFree;
  // Aucune place, aucun agent : la machine ne peut rien lancer, c'est plein.
  if (total <= 0) return 100;
  return Math.round((etat.runningAgents / total) * 100);
}

export type TonCapacite = 'libre' | 'tendu' | 'sature';

/**
 * Le ton de la barre. Il ne dépend QUE de la place restante : c'est la seule
 * question à laquelle la barre répond.
 */
export function tonCapacite(etat: EtatCapacite): TonCapacite {
  if (etat.paused || etat.slotsFree <= 0) return 'sature';
  return etat.slotsFree <= 2 ? 'tendu' : 'libre';
}

/** La phrase du gros titre, accord compris. */
export function phraseCapacite(etat: EtatCapacite): string {
  if (etat.paused) return 'Départs suspendus';
  if (etat.slotsFree <= 0) return 'Plus aucun agent ne peut démarrer';
  return etat.slotsFree === 1
    ? 'Un agent peut encore démarrer'
    : `${etat.slotsFree} agents peuvent encore démarrer`;
}

/** Part de la mémoire utilisée, en pour cent. */
export function partMemoire(usedMb: number, totalMb: number): number {
  if (!totalMb) return 0;
  return Math.round((usedMb / totalMb) * 100);
}
