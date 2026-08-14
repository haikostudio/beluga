import type { ColumnKey } from './columns.js';

/**
 * UNE TÂCHE COUPÉE EN VOL NE PASSE JAMAIS POUR TERMINÉE.
 *
 * Deux pannes différentes menaient au même mensonge — une carte qui a l'air
 * faite alors que rien n'a abouti :
 *
 *   1. LE SERVEUR S'ARRÊTE PENDANT LE TRAVAIL. La reprise au démarrage ne
 *      regardait que les agents encore marqués « au travail ». Or un tour se
 *      range en plusieurs temps : l'agent passe en « terminé », PUIS le dépôt
 *      est constaté, PUIS la branche de la carte est fusionnée, PUIS seulement
 *      la carte bouge. Coupé au milieu de cette fenêtre — qui contient la
 *      compression du fil, donc peut durer —, l'agent était déjà « terminé » :
 *      plus personne ne le rattrapait, et la carte, restée en « En cours »,
 *      affichait la coche verte du travail rendu. Le code, lui, dormait sur une
 *      branche jamais fusionnée : l'utilisateur ne voyait aucun résultat.
 *   2. LE DÉPÔT NE RÉPOND PAS À LA FIN DU TOUR. Le constat « le dépôt a-t-il
 *      bougé ? » rendait `true` dès que git refusait de répondre. Une carte
 *      passait donc en « Terminé » sur une observation qu'on n'avait pas pu
 *      faire — exactement ce que la clôture est censée vérifier.
 *
 * D'où la règle, en deux morceaux :
 *
 *   - une MARQUE est posée sur la carte tant qu'un tour d'exécution la tient
 *     (`tourEnVolDepuis`), et retirée seulement quand ce tour a fini de tout
 *     ranger. Au démarrage du démon, aucun moteur ne survit : toute carte qui
 *     porte encore la marque a été coupée en vol, quel que soit l'état de son
 *     agent. Elle est rendue comme interrompue, avec la raison, et repart
 *     d'elle-même ;
 *   - la clôture exige une TRACE VÉRIFIABLE. Trois réponses possibles au
 *     constat, pas deux : oui, non, et « je n'ai pas pu regarder ». Seul « oui »
 *     ferme la carte.
 *
 * Les règles sont pures — ni base, ni disque, ni git : elles se rejouent seules
 * (`server/src/test/carte-interrompue.test.ts`).
 */

/* ------------------------------------------------------------------ */
/* 1. La marque de vol                                                  */
/* ------------------------------------------------------------------ */

/** Ce que la planification d'une carte porte de son tour en cours. */
export interface SuiviDeVol {
  /**
   * L'instant où un tour d'EXÉCUTION a pris la carte en main. Absent : aucun
   * tour ne la tient — soit il n'y en a jamais eu, soit le dernier a fini de
   * ranger.
   */
  tourEnVolDepuis?: number;
}

/**
 * Ce qu'on écrit sur une carte coupée en vol. Elle dit les trois choses qu'on
 * veut savoir en la relisant : ce n'est pas terminé, pourquoi, et que la reprise
 * ne demande aucun geste.
 */
export const RAISON_COUPE_EN_VOL =
  'Tâche interrompue : le serveur s’est arrêté pendant le travail. Rien n’a été clôturé, et la carte repart d’elle-même.';

export interface EtatApresCoupure {
  /**
   * Où poser la carte, ou `null` pour la laisser exactement où elle est. Une
   * carte coupée pendant son travail retombe dans « Planifié », la file d'où
   * l'ordonnanceur la reprendra. Une carte marquée alors qu'elle vivait déjà
   * dans une fin de parcours (« À déployer », « En production », « Archivé »)
   * n'en sort pas : ces colonnes ne s'ouvrent qu'à la main humaine.
   */
  colonne: ColumnKey | null;
  /** La phrase portée par la carte, en toutes lettres. */
  raison: string;
}

/**
 * Cette carte a-t-elle été coupée en vol ? Rend `null` quand il n'y a rien à
 * rattraper — pas de marque, donc pas de tour en cours au moment de l'arrêt.
 *
 * On ne regarde PAS l'état de l'agent : au démarrage du démon, aucun processus
 * de moteur n'a survécu, et c'est justement l'agent déjà passé en « terminé »
 * que l'ancienne reprise laissait filer.
 */
export function etatApresCoupure(carte: {
  column: ColumnKey;
  scheduling?: SuiviDeVol;
}): EtatApresCoupure | null {
  if (!carte.scheduling?.tourEnVolDepuis) return null;
  return {
    colonne: carte.column === 'running' ? 'planned' : null,
    raison: RAISON_COUPE_EN_VOL,
  };
}

/* ------------------------------------------------------------------ */
/* 2. La trace vérifiable                                               */
/* ------------------------------------------------------------------ */

/**
 * Ce que le constat du dépôt peut répondre à la fin d'un tour :
 *
 *   - « oui » : un enregistrement s'est ajouté, ou des fichiers sont modifiés —
 *     et, faute de dépôt git, tout tour rendu compte comme abouti (il n'y a rien
 *     à observer, on ne retient pas une carte sur une observation impossible par
 *     nature) ;
 *   - « non » : le dépôt a été consulté, il n'a pas bougé ;
 *   - « inconnue » : le dépôt EST un dépôt git, mais il n'a pas répondu. Ce
 *     n'est pas une trace, c'est un trou ;
 *   - « ailleurs » : la copie de travail de la carte n'a pas bougé, mais le
 *     DOSSIER PARTAGÉ du projet, lui, a changé pendant le tour. Du travail a
 *     donc bien été fait — simplement pas là où la carte peut le récolter.
 *
 * LE QUATRIÈME CAS EST CELUI QUI MENTAIT. Le constat ne regardait QUE la copie
 * de travail de la carte, alors qu'un agent peut sortir de sa copie en cours de
 * route (`cd` vers le dossier du projet, chemin relatif écrit depuis la racine
 * du projet). Sa copie restait vierge, le dépôt du projet portait pourtant ses
 * fichiers modifiés, et la carte s'entendait dire « aucun fichier n'a changé »
 * — une phrase que l'utilisateur pouvait démentir d'un `git status`.
 */
export type TraceDuTravail = 'oui' | 'non' | 'inconnue' | 'ailleurs';

/**
 * La phrase portée par une carte dont la trace n'a pas pu être constatée. Elle
 * dit les deux choses qu'on veut savoir : la clôture est refusée faute de
 * preuve, et la carte n'est pas restée coincée en « En cours » pour autant.
 */
export const RAISON_TRACE_INCONNUE =
  'Le dépôt n’a pas pu être consulté à la fin du tour : sans trace vérifiable, la carte revient en « Planifié » plutôt que d’être annoncée terminée.';

/**
 * La phrase portée par une carte dont le travail a été fait AILLEURS que dans sa
 * copie. Elle ne dit surtout pas « rien n'a changé » : elle dit ce qui a été vu,
 * et où le chercher.
 */
export const RAISON_TRAVAIL_HORS_COPIE =
  'Des fichiers du projet ont changé pendant ce tour, mais dans le dossier partagé du projet et non dans la copie de travail de cette carte : rien n’a pu être rattaché à sa branche. La carte revient en « Planifié » — le travail est à récupérer dans le dossier du projet.';

/**
 * Le constat qui autorise la clôture. Seul « oui » ferme une carte : c'est la
 * traduction, en un mot, de « pas de trace vérifiable, pas de Terminé ».
 *
 * « ailleurs » n'est pas une clôture : le travail existe, mais il n'est ni
 * enregistré ni sur la branche de la carte, donc rien ne partirait au
 * déploiement. On ne ferme pas une carte sur du code qu'on ne peut pas livrer.
 */
export function traceAcquise(trace: TraceDuTravail): boolean {
  return trace === 'oui';
}
