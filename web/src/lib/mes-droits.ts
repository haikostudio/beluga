import { niveauDuService, niveauSuffit, type NiveauProjet, type NiveauService, type ServiceOuvrable } from '@beluga/shared';
import type { AppState } from '@/lib/client';

/**
 * CE QUE L'ÉCRAN D'UN ACCÈS TIERS MONTRE, d'après sa grille (`droits-d-acces.ts`).
 * L'administrateur a tout. Le serveur refuse de toute façon ce qui est fermé :
 * ici, on évite seulement de dessiner un geste qui échouerait.
 */
type Etat = Pick<AppState, 'monRole' | 'mesDroits'>;

/** Ce compte a-t-il au moins ce niveau sur ce projet ? */
export function aLeNiveauSurLeProjet(state: Etat, projectId: string | null | undefined, requis: NiveauProjet): boolean {
  if (state.monRole === 'admin') return true;
  if (!projectId) return false;
  // Un accès d'avant la grille : membre = travailler, lecteur = voir.
  const niveau = state.mesDroits?.projets[projectId] ?? (state.monRole === 'membre' ? 'travailler' : 'voir');
  return niveauSuffit(niveau, requis);
}

/** Le niveau de ce compte sur un service (`modifier` pour l'administrateur). */
export function niveauDeMonService(state: Etat, service: ServiceOuvrable): NiveauService {
  if (state.monRole === 'admin') return 'modifier';
  return state.mesDroits ? niveauDuService(state.mesDroits, service) : 'aucun';
}
