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
 * Second piège, le plus coûteux : un tour d'exécution qui RÉPOND sans rien
 * changer posait quand même la carte en « Terminé ». Une analyse écrite, une
 * question traitée, un tour qui n'a fait que lire suffisaient — la carte partait
 * ensuite dans le lot à publier alors qu'aucune ligne n'avait bougé. D'où la
 * règle : c'est le CONSTAT du dépôt qui clôt une carte, pas le fait que le
 * moteur ait rendu sa réponse.
 *
 * Les règles sont PURES : elles ne connaissent ni la base ni le moteur, elles
 * disent seulement où la carte devrait être. Le démon observe le dépôt (le même
 * repère avant / après que le travail hors tâche) et leur passe le constat ; les
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
 * La phrase affichée sur une carte restée en place faute de code modifié.
 * Elle est écrite pour être lue telle quelle sur le tableau.
 */
export const RAISON_SANS_MODIFICATION =
  "Réponse rendue, mais aucun fichier du projet n'a changé : la carte reste ouverte tant qu'aucun code n'est enregistré.";

/**
 * Où va la carte quand le tour se TERMINE.
 *
 * Un tour réussi d'agent d'EXÉCUTION qui a RÉELLEMENT modifié le dépôt la pose
 * en « Terminé ». Trois cas la laissent où elle est :
 *   - le tour a échoué : le travail n'est pas fait, l'annoncer terminé serait un
 *     mensonge, et la carte doit rester là où on peut la relancer ;
 *   - le rôle n'exécute pas : une étude rendue n'est pas un travail fait ;
 *   - rien n'a changé dans le dépôt : répondre n'est pas travailler.
 *
 * `depotModifie` est un CONSTAT, pas une intention : le démon compare le dépôt
 * d'avant le tour à celui d'après (enregistrements ajoutés, fichiers en cours de
 * modification). Quand rien ne peut être constaté — projet hors git —, il vaut
 * `true` : on ne bloque pas une carte sur une observation qu'on n'a pas pu
 * faire.
 */
export function colonneEnFinDeTour(
  colonne: ColumnKey,
  reussi: boolean,
  role: AgentRole,
  depotModifie: boolean,
): ColumnKey | null {
  if (!reussi) return null;
  if (!ROLES_QUI_DEPLACENT.includes(role)) return null;
  if (colonne !== 'running') return null;
  if (!depotModifie) return null;
  return 'done';
}

/**
 * Pourquoi la carte n'a pas bougé alors que le tour a réussi. Rend `null` quand
 * il n'y a rien à expliquer — carte déplacée, tour en échec (déjà signalé comme
 * tel), rôle qui ne déplace jamais.
 *
 * Seul le cas « l'agent d'exécution a répondu sans rien changer » mérite une
 * phrase : c'est le seul où l'on pourrait croire le travail fait.
 */
export function raisonSansModification(
  colonne: ColumnKey,
  reussi: boolean,
  role: AgentRole,
  depotModifie: boolean,
): string | null {
  if (!reussi || depotModifie) return null;
  if (!ROLES_QUI_DEPLACENT.includes(role)) return null;
  if (colonne !== 'running') return null;
  return RAISON_SANS_MODIFICATION;
}
