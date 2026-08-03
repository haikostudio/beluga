import { ColumnKey } from './columns.js';
import type { AgentRole } from './models.js';

/**
 * La carte suit les ÉTAPES RÉELLES du travail.
 *
 * Parcours attendu : « À faire » → (clic de validation) → « Validé » →
 * (analyse rendue, chiffrage posé) → « En cours » → (exécution rendue) →
 * « Terminé ».
 *
 * Le piège : l'analyse, l'orchestration et la publication portent elles aussi
 * le numéro de carte. Appliquées à tout agent, les deux règles ci-dessous
 * faisaient sauter la carte en « En cours » dès que l'ANALYSE démarrait, puis
 * en « Terminé » quand cette même analyse rendait son chiffrage — alors que
 * rien n'avait encore été exécuté.
 *
 * D'où la règle unique : seul l'agent d'EXÉCUTION (rôle « task ») déplace une
 * carte. Il la met en « En cours » quand son tour démarre, en « Terminé »
 * quand son tour réussit. Les autres rôles la laissent exactement où elle est.
 * Le passage de « Validé » à « Planifié » puis « En cours » au lancement de
 * l'exécution reste le travail de l'ordonnanceur : ces règles ne le doublent
 * pas.
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
 * Les rôles d'agent qui EXÉCUTENT le travail d'une carte, et sont donc les
 * seuls à la déplacer — au démarrage comme à l'arrivée. L'analyse,
 * l'orchestration et la publication regardent la carte sans y toucher.
 */
export const ROLES_QUI_DEPLACENT: AgentRole[] = ['task'];

/** Ancien nom, gardé pour la clôture : c'est la même liste. */
export const ROLES_QUI_CLOTURENT = ROLES_QUI_DEPLACENT;

/**
 * Où va la carte quand un tour d'agent DÉMARRE. Rend `null` s'il n'y a rien à
 * bouger — l'agent n'exécute pas, elle y est déjà, ou sa colonne est une fin de
 * parcours assumée.
 */
export function colonneAuDemarrage(colonne: ColumnKey, role: AgentRole): ColumnKey | null {
  if (!ROLES_QUI_DEPLACENT.includes(role)) return null;
  if (colonne === 'running') return null;
  if (COLONNES_HORS_REPRISE.includes(colonne)) return null;
  return 'running';
}

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
  if (!ROLES_QUI_DEPLACENT.includes(role)) return null;
  if (colonne !== 'running') return null;
  return 'done';
}
