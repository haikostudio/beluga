import { COLUMN_LABELS, ColumnKey } from './columns.js';
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
 * QUI demande la reprise. La règle n'est pas la même selon la main qui pousse :
 *
 *   - « automatique » : un tour d'agent, une réponse dans la conversation,
 *     l'ordonnanceur. Ceux-là ne ressortent JAMAIS une carte d'une fin de
 *     parcours — c'était le but de la règle d'origine, il ne change pas ;
 *   - « humain » : un clic ou un glissement de l'utilisateur. Une carte peut
 *     être allée dans « Archivé » à tort (travail annoncé fait alors que rien
 *     n'avait bougé) : il faut pouvoir l'en sortir, sinon il ne reste que
 *     l'écriture directe en base.
 */
export type Demandeur = 'humain' | 'automatique';

export interface DecisionReprise {
  possible: boolean;
  /** Pourquoi c'est refusé, dit en toutes lettres. */
  raison?: string;
}

/** La phrase rendue à un agent qui essaie de reprendre une carte rangée. */
export function raisonRepriseRefusee(colonne: ColumnKey): string {
  return `« ${COLUMN_LABELS[colonne]} » est une fin de parcours : seul un geste de l'utilisateur peut en ressortir une carte.`;
}

/**
 * Peut-on reprendre une carte posée dans cette colonne ? Tout est permis
 * ailleurs ; les deux fins de parcours ne s'ouvrent qu'à la main humaine.
 */
export function repriseAutorisee(colonne: ColumnKey, demandeur: Demandeur): DecisionReprise {
  if (!COLONNES_HORS_REPRISE.includes(colonne)) return { possible: true };
  if (demandeur === 'humain') return { possible: true };
  return { possible: false, raison: raisonRepriseRefusee(colonne) };
}

/**
 * Où retombe une carte qu'on sort d'une fin de parcours, d'un seul geste.
 *
 *   - « Archivé » → « À faire » : elle repassera par la validation, donc
 *     personne ne rouvre une dépense sans le savoir ;
 *   - « À déployer » → « Terminé » : elle sort du lot à publier et revient à
 *     l'étape juste avant, celle d'où l'on décide de publier.
 *
 * Rend `null` pour toute autre colonne : il n'y a rien à reprendre.
 */
export function colonneDeReprise(colonne: ColumnKey): ColumnKey | null {
  if (colonne === 'archived') return 'todo';
  if (colonne === 'to_deploy') return 'done';
  return null;
}

/**
 * Ce qu'une carte ressortie garde de son passage : la date de son archivage.
 * Rend `null` quand il n'y a rien à dire — carte jamais archivée, ou encore
 * dans « Archivé », où la colonne le dit déjà.
 */
export function mentionArchivage(carte: { column: ColumnKey; archivedAt?: number }): string | null {
  if (!carte.archivedAt) return null;
  if (carte.column === 'archived') return null;
  const jour = new Date(carte.archivedAt).toLocaleDateString('fr-CH');
  return `Archivée le ${jour}, ressortie depuis.`;
}

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
  // Un tour d'agent est une reprise AUTOMATIQUE : les fins de parcours lui
  // restent fermées, quoi qu'il ait répondu.
  if (!repriseAutorisee(colonne, 'automatique').possible) return null;
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

/* ------------------------------------------------------------------ */
/* Ce que vaut un DÉPÔT de carte à la main                              */
/* ------------------------------------------------------------------ */

/**
 * Déplacer une carte à la main sur le tableau ne changeait que sa colonne : il
 * fallait ensuite ouvrir la carte et cliquer sur « Lancer maintenant ». Le
 * geste évident ne faisait donc rien.
 *
 * Désormais le dépôt VAUT le geste que la colonne d'arrivée désigne :
 *   - déposer dans « En cours » = cliquer sur « Lancer maintenant » (le même
 *     chemin de lancement, pas un raccourci parallèle) ;
 *   - sortir de « En cours » vers « Planifié » = suspendre l'agent en travail,
 *     la carte restant en file ;
 *   - tout le reste = un simple rangement.
 */
export type EffetDuDepot = 'lancer' | 'suspendre' | 'ranger';

export function effetDuDepot(depart: ColumnKey, arrivee: ColumnKey): EffetDuDepot {
  if (depart === arrivee) return 'ranger';
  if (arrivee === 'running') return 'lancer';
  if (depart === 'running' && arrivee === 'planned') return 'suspendre';
  return 'ranger';
}

/**
 * La phrase portée par une carte suspendue à la main. Elle dit les deux choses
 * qu'on veut savoir en la relisant : le tour a été arrêté, et plus rien ne
 * repartira tant qu'on ne l'aura pas demandé.
 */
export const RAISON_SUSPENDU =
  'Agent suspendu à la main : la carte attend en file, elle ne repartira que sur votre geste.';

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
