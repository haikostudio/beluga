import { ColumnKey } from './columns.js';
import type { AgentRole } from './models.js';

/**
 * La carte suit l'état de son agent.
 *
 * Avant, une carte entrait en « En cours » et n'en sortait plus : la clôture
 * était un geste de l'utilisateur, et le tableau finissait par montrer une
 * colonne « En cours » pleine de travaux terminés depuis longtemps. Désormais
 * la carte se déplace toute seule, dans les deux sens :
 *
 *  — un agent repart sur la carte  → elle revient en « En cours » ;
 *  — l'agent d'EXÉCUTION a rendu   → elle passe en « Terminé ».
 *
 * Seul l'agent d'exécution clôt la carte. L'analyse, l'orchestration et la
 * publication portent elles aussi le numéro de carte, mais rendre une étude
 * n'est pas faire le travail : leur tour ne doit rien annoncer de terminé.
 *
 * Les deux règles sont PURES : elles ne connaissent ni la base ni le moteur,
 * elles disent seulement où la carte devrait être. Le démon les applique, les
 * tests les rejouent.
 */

/**
 * Les colonnes qu'un tour d'agent ne remet PAS en marche.
 *
 * « À déployer » et « Archivé » sont des fins de parcours choisies : poser une
 * question dans la conversation d'une carte déjà prête à publier ne doit pas la
 * sortir du lot sans qu'on l'ait demandé.
 */
export const COLONNES_HORS_REPRISE: ColumnKey[] = ['to_deploy', 'archived'];

/**
 * Où va la carte quand un tour d'agent DÉMARRE. Rend `null` s'il n'y a rien à
 * bouger — elle y est déjà, ou sa colonne est une fin de parcours assumée.
 */
export function colonneAuDemarrage(colonne: ColumnKey): ColumnKey | null {
  if (colonne === 'running') return null;
  if (COLONNES_HORS_REPRISE.includes(colonne)) return null;
  return 'running';
}

/**
 * Les rôles d'agent qui EXÉCUTENT le travail d'une carte, et sont donc les
 * seuls à pouvoir la poser en « Terminé ».
 */
export const ROLES_QUI_CLOTURENT: AgentRole[] = ['task'];

/**
 * Où va la carte quand le tour se TERMINE.
 *
 * Un tour réussi d'agent d'EXÉCUTION la pose en « Terminé ». Un tour en échec
 * ne la déplace pas : le travail n'est pas fait, l'annoncer terminé serait un
 * mensonge, et la carte reste là où on peut la relancer. Un tour d'analyse,
 * d'orchestration ou de publication ne la déplace pas non plus : une étude
 * rendue n'est pas un travail fait.
 */
export function colonneEnFinDeTour(
  colonne: ColumnKey,
  reussi: boolean,
  role: AgentRole,
): ColumnKey | null {
  if (!reussi) return null;
  if (!ROLES_QUI_CLOTURENT.includes(role)) return null;
  if (colonne !== 'running') return null;
  return 'done';
}
