import type { SchedulingState } from './models.js';

/**
 * METTRE EN PAUSE, ET REPRENDRE OÙ L'ON S'EST ARRÊTÉ.
 *
 * La suspension existait déjà, mais sans bouton : il fallait faire glisser la
 * carte de « En cours » vers « Planifié » sur le tableau pour l'obtenir
 * (`effetDuDepot`, suivi-colonne.ts). Rien ne la disait dans le tiroir, et rien
 * ne promettait que le travail reprendrait là où il en était.
 *
 * On ne fabrique donc PAS un second mécanisme : la pause pose exactement la
 * même marque que la suspension par glissement — `scheduling.suspendu`, la
 * marque que l'ordonnanceur regarde pour ne rien relancer tout seul, et que
 * seul un geste humain efface. Le bouton lui donne simplement un chemin de
 * plus, et une phrase qui dit ce qu'elle promet.
 *
 * Les règles vivent ici, sans base ni moteur : elles se rejouent seules.
 */

/** La phrase portée par une carte mise en pause depuis sa conversation. */
export const RAISON_EN_PAUSE =
  'Travail en pause : le tour est arrêté, le fil est gardé. Il ne repartira que sur votre geste, et il reprendra où il s’est arrêté.';

/** La même chose en court, pour la bande posée en haut de la conversation. */
export const MENTION_EN_PAUSE = 'Travail en pause — il reprendra où il s’est arrêté.';

/** Ce qu'un tour arrêté à la main écrit sous le message, au lieu d'une erreur. */
export const MENTION_TOUR_EN_PAUSE = 'Tour mis en pause : rien n’est perdu, la reprise repart d’ici.';
export const MENTION_TOUR_ARRETE = 'Tour arrêté à la main.';

/**
 * Le geste que porte le bouton, à l'instant où on le regarde. Un seul bouton,
 * deux visages : on met en pause ce qui tourne, on reprend ce qui est en pause.
 */
export type GestePause = 'pause' | 'reprendre' | 'aucun';

export interface ContextePause {
  /** Un agent d'exécution a-t-il déjà travaillé sur cette carte ? */
  agentLance: boolean;
  /** Un tour est-il en train d'écrire en ce moment ? */
  travailleMaintenant: boolean;
  /** La carte porte-t-elle la marque de suspension ? */
  enPause: boolean;
}

export function gestePause(ctx: ContextePause): GestePause {
  // La marque prime : une carte marquée en pause se reprend, quoi qu'il arrive
  // par ailleurs — c'est le geste attendu, et c'est le seul qui efface la marque.
  if (ctx.enPause && ctx.agentLance) return 'reprendre';
  if (ctx.travailleMaintenant) return 'pause';
  return 'aucun';
}

/* ------------------------------------------------------------------ */
/* La marque, posée et retirée d'un seul endroit                       */
/* ------------------------------------------------------------------ */

const NEUF: SchedulingState = { asap: false, attempts: 0, restarts: 0 };

/**
 * Poser la pause. La raison est écrite sur la carte : c'est elle qui s'affiche
 * sur le tableau et dans le tiroir, sans qu'on ait à inventer un second champ.
 */
export function marquerPause(
  scheduling: SchedulingState | undefined,
  raison: string = RAISON_EN_PAUSE,
): SchedulingState {
  return { ...(scheduling ?? NEUF), suspendu: true, waitingReason: raison };
}

/**
 * Retirer la pause. C'est le geste humain, et lui seul : départ, reprise, dépôt
 * dans « En cours ». L'attente affichée s'en va avec elle — la carte repart, il
 * n'y a plus rien à attendre.
 */
export function effacerPause(scheduling: SchedulingState | undefined): SchedulingState {
  return { ...(scheduling ?? NEUF), suspendu: false, waitingReason: undefined };
}

/** Cette carte est-elle en pause ? Une seule lecture, partout la même. */
export function estEnPause(carte: { scheduling?: SchedulingState }): boolean {
  return !!carte.scheduling?.suspendu;
}

/* ------------------------------------------------------------------ */
/* La demande de reprise                                               */
/* ------------------------------------------------------------------ */

/**
 * Ce qu'on dit à l'agent qui repart. Il retrouve son fil et sa liste de tâches
 * — c'est le MÊME agent, donc la même session de moteur : on lui demande de
 * continuer, jamais de recommencer.
 */
export function promptDeReprise(carte: { titre: string; branche?: string | null }): string {
  return `Reprends cette tâche là où elle s'est arrêtée.

TITRE : ${carte.titre}${carte.branche ? `\nTu travailles sur la branche « ${carte.branche} ».` : ''}

Ton tour précédent a été mis en pause à la main. Le fil ci-dessus et ta liste de tâches sont ton POINT DE DÉPART : reprends à la première ligne non terminée, ne refais pas ce qui est déjà fait, et vérifie l'état réel du dossier avant de continuer.

Va au bout : lis ce qu'il faut, modifie, teste, puis enregistre et sauvegarde (commit + push). Ne publie pas.`;
}
