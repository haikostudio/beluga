/**
 * LA SAUVEGARDE DE LA BASE AVANCE PAR PAS QUI DURENT UN TEMPS BORNÉ, PAS UN
 * NOMBRE FIXE DE PAGES.
 *
 * Chaque pas de l'API de sauvegarde de SQLite tient le fil principal du démon :
 * 1 000 pages (4 Mo) prennent quelques millisecondes sur le disque du serveur,
 * mais 3,8 s sur un disque monté par le réseau (mesuré le 28/10/2026). On règle
 * donc la taille du pas suivant sur la durée du précédent, pour viser
 * `DUREE_VISEE_D_UN_PAS_MS` quel que soit le disque.
 */
export const DUREE_VISEE_D_UN_PAS_MS = 50;
export const PAGES_MIN_PAR_PAS = 16;
export const PAGES_MAX_PAR_PAS = 4_000;

export function pagesDuPasSuivant(pages: number, dureeMs: number): number {
  const actuel = Math.max(PAGES_MIN_PAR_PAS, Math.min(PAGES_MAX_PAR_PAS, Math.round(pages) || PAGES_MIN_PAR_PAS));
  if (!Number.isFinite(dureeMs) || dureeMs <= 0) return Math.min(PAGES_MAX_PAR_PAS, actuel * 2);
  // Jamais plus du double d'un coup : un pas rapide par hasard ne doit pas faire exploser le suivant.
  const vise = Math.min(actuel * 2, Math.round((actuel * DUREE_VISEE_D_UN_PAS_MS) / dureeMs));
  return Math.max(PAGES_MIN_PAR_PAS, Math.min(PAGES_MAX_PAR_PAS, vise));
}
