import type { SensDArchivage } from '@beluga/shared';

/**
 * LA PORTE DE LA FENÊTRE D'ARCHIVAGE (`components/fenetre-d-archivage.tsx`). Ce petit module reste dans le paquet
 * principal : la fenêtre, elle, ne se télécharge qu'à la première demande. La dernière demande est gardée, pour que
 * la fenêtre qui se monte APRÈS l'événement la lise quand même.
 */
export const EVENEMENT_ARCHIVAGE = 'beluga:archivage-projet';

export interface DemandeDArchivage {
  projectId: string;
  sens: SensDArchivage;
  /** Change à chaque demande : rouvrir la même fenêtre la remet à zéro. */
  n: number;
}

let derniere: DemandeDArchivage | null = null;
let compteur = 0;

export function ouvrirLArchivage(projectId: string, sens: SensDArchivage): void {
  derniere = { projectId, sens, n: ++compteur };
  window.dispatchEvent(new CustomEvent(EVENEMENT_ARCHIVAGE, { detail: derniere }));
}

export function derniereDemandeDArchivage(): DemandeDArchivage | null {
  return derniere;
}
