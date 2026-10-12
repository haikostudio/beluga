/**
 * LES RÉPONSES QUI N'ONT PLUS DE CANAL POUR PARTIR.
 *
 * Une commande longue (créer un projet : dépôt GitHub, adresse publique…) peut
 * durer plusieurs minutes. Si le canal de l'écran se renouvelle entre-temps —
 * onglet mis en veille, battement de cœur sans réponse, réseau qui change —, la
 * réponse partait sur l'ANCIEN canal, déjà fermé, et se perdait : le projet
 * apparaissait dans la colonne (diffusé à tous), mais le bouton de la fenêtre
 * tournait dans le vide jusqu'à son délai (carte « Fin des volets
 * intempestifs », 09/10/2026).
 *
 * Désormais le serveur GARDE la réponse orpheline un quart d'heure, au nom du
 * compte qui l'a demandée. L'écran qui se reconnecte réclame les réponses
 * qu'il attend encore (`acks.reclamer`) ; une réponse ne se rend qu'une fois,
 * et seulement au compte qui l'a demandée.
 *
 * Règle pure, sans réseau ni base : le temps est donné par l'appelant.
 */

/** Combien de temps une réponse orpheline attend son écran. */
export const DUREE_DES_ACCUSES_ORPHELINS_MS = 15 * 60_000;
/** Au-delà, les plus anciennes partent : la boîte ne grossit jamais sans fin. */
export const PLAFOND_DES_ACCUSES_ORPHELINS = 500;

export interface AccuseOrphelin<T> {
  compteId: string;
  accuse: T;
  a: number;
}

export class BoiteDesAccuses<T extends { id: string }> {
  private readonly accuses = new Map<string, AccuseOrphelin<T>>();

  constructor(
    private readonly duree = DUREE_DES_ACCUSES_ORPHELINS_MS,
    private readonly plafond = PLAFOND_DES_ACCUSES_ORPHELINS,
  ) {}

  /** Garde une réponse que son canal n'a pas pu emporter. */
  garder(compteId: string, accuse: T, maintenant: number): void {
    this.oublierLesVieux(maintenant);
    this.accuses.set(accuse.id, { compteId, accuse, a: maintenant });
    while (this.accuses.size > this.plafond) {
      const plusAncien = this.accuses.keys().next().value;
      if (plusAncien === undefined) break;
      this.accuses.delete(plusAncien);
    }
  }

  /**
   * Rend — et retire — les réponses demandées que ce compte attend encore.
   * Une réponse d'un AUTRE compte reste où elle est, et ne se dit pas.
   */
  reprendre(compteId: string, ids: readonly string[], maintenant: number): T[] {
    this.oublierLesVieux(maintenant);
    const rendus: T[] = [];
    for (const id of ids) {
      const garde = this.accuses.get(id);
      if (!garde || garde.compteId !== compteId) continue;
      this.accuses.delete(id);
      rendus.push(garde.accuse);
    }
    return rendus;
  }

  get taille(): number {
    return this.accuses.size;
  }

  private oublierLesVieux(maintenant: number): void {
    for (const [id, garde] of this.accuses) {
      if (maintenant - garde.a > this.duree) this.accuses.delete(id);
    }
  }
}
