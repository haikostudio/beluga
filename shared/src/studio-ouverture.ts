/**
 * L'INSTANT OÙ S'OUVRE L'APERÇU DU STUDIO (demande du 12/11/2026, capture #8ca2).
 * À t = 0, les pièces d'une création entrent souvent en fondu (0,2 s et plus) :
 * l'aperçu s'ouvrait sur un cadre vide, pris pour un chargement raté.
 *
 * 1. La tête de lecture laissée la dernière fois (la sélection enregistrée à
 *    chaque déplacement, `studio.selection`) est reprise si elle tombe DANS la
 *    vidéo — ni à 0 (la valeur par défaut, le cadre vide), ni sur la toute fin.
 * 2. Sinon, un instant PARLANT : dans le premier élément visuel visible (le plus
 *    tôt sur la ligne de temps), une seconde après son entrée — le temps de son
 *    apparition — ou son milieu s'il est plus court. Un milieu fixe (1,5 s) tombe
 *    dans le vide quand le premier visuel commence plus tard ; le milieu du
 *    premier visuel de la piste du haut, sur un titre qui n'arrive qu'à 20 s.
 * 3. Rien de visuel : 0.
 *
 * L'écran (`web/src/components/studio/studio.tsx`) le pose UNE fois, à l'arrivée
 * des données d'une création — jamais à chaque version. Règle pure, verrouillée
 * par `server/src/test/studio-ouverture.test.ts`.
 */

import { pisteVisuelle, type Composition } from './studio.js';

/** Le temps laissé à une pièce pour finir d'apparaître. */
export const DELAI_D_APPARITION = 1;
/** Près de la fin, la tête de lecture ne se reprend pas : « Lire » repartirait de zéro sans rien montrer d'abord. */
const MARGE_DE_FIN = 0.05;

export function instantDOuverture(e: {
  pistes: Composition['pistes'];
  /** La durée exportée (`dureeExportee`). */
  duree: number;
  /** La tête de lecture enregistrée la dernière fois, si elle existe. */
  curseurRetenu?: number | null;
}): number {
  const duree = Number(e.duree) > 0 ? Number(e.duree) : 0;
  if (!duree) return 0;
  const borne = (t: number) => Math.round(Math.max(0, Math.min(duree - MARGE_DE_FIN, t)) * 100) / 100;
  const retenu = Number(e.curseurRetenu);
  if (Number.isFinite(retenu) && retenu > 0 && retenu < duree - MARGE_DE_FIN) return borne(retenu);
  let premier: { debut: number; duree: number } | null = null;
  for (const p of e.pistes) {
    if (!pisteVisuelle(p.genre) || p.masquee) continue;
    for (const s of p.segments) {
      const d = Number(s.duree);
      const debut = Number(s.debut) || 0;
      if (!(d > 0) || s.masque || debut >= duree) continue;
      if (!premier || debut < premier.debut) premier = { debut, duree: d };
    }
  }
  if (!premier) return 0;
  return borne(premier.debut + Math.min(DELAI_D_APPARITION, premier.duree / 2));
}
