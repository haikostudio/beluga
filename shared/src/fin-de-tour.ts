/**
 * LA FIN D'UN TOUR : quand elle est acquise, et quand elle ne vient jamais.
 *
 * Un tour d'agent se referme normalement tout seul : le moteur rend la main, le
 * démon fige le message, remet l'agent au repos et libère la barre d'écriture.
 * Trois choses pouvaient empêcher cette fermeture, et l'agent tournait alors
 * « dans le vide » — réponse écrite à l'écran, compteur qui court, barre
 * d'écriture bloquée :
 *
 *   1. LE PROGRAMME EST FINI MAIS SES TUYAUX RESTENT OUVERTS. On n'attendait que
 *      l'événement « close » de Node, qui exige en plus la fermeture de la
 *      sortie standard — or un petit-fils du moteur (pont d'outils, sous-agent)
 *      peut en hériter et la garder ouverte indéfiniment. « exit » suffit à dire
 *      que le programme est fini : on lui laisse un court délai de vidage, puis
 *      on rend la main.
 *   2. LE TRAVAIL D'APRÈS-RÉPONSE N'AVAIT AUCUN PLAFOND. Compression du fil,
 *      mesure de la session, relance d'un plan incomplet : autant d'appels au
 *      moteur passés APRÈS que la réponse est visible, chacun capable de rester
 *      pendu pour toujours. Ils sont désormais bornés.
 *   3. UNE PANNE INTERNE POUVAIT AVALER LA FERMETURE. Le tour restait alors
 *      marqué « au travail » sans que plus personne ne l'attende.
 *
 * Les seuils et le jugement vivent ici, sans base ni disque : c'est ce qui les
 * rend rejouables.
 */

/** Le temps laissé aux sorties du moteur pour se vider une fois le programme fini. */
export const DELAI_VIDAGE_SORTIE_MS = 2_000;

/**
 * Plafond d'un appel au moteur passé APRÈS la réponse (compression native,
 * mesure de la session, résumé de repli, relance d'un plan incomplet). Aucun de
 * ces appels ne mérite de retenir la barre d'écriture plus d'une minute et
 * demie : passé ce délai, on arrête le processus et on continue sans lui.
 */
export const PLAFOND_APPEL_APRES_REPONSE_MS = 90_000;

/**
 * Au-delà, un tour dont la réponse est DÉJÀ figée n'a plus d'excuse : tout le
 * travail d'après-réponse est borné, sa somme tient largement dessous. On
 * referme donc d'autorité. Le filet, pas la règle.
 */
export const PLAFOND_FERMETURE_MS = 6 * 60_000;

/**
 * Un processus se cherche mal dans la seconde qui suit son lancement (le
 * numéro n'est pas encore posé, le système ne l'a pas encore inscrit). On ne
 * croit donc un moteur disparu qu'après cette minute de grâce.
 */
export const DELAI_AVANT_PROCESSUS_DISPARU_MS = 60_000;

export type StatutDAgent = 'idle' | 'starting' | 'running' | 'stopped' | 'failed' | 'done';

export interface EtatDuTour {
  statut: StatutDAgent;
  /** Le démon attend-il encore ce tour (il figure dans ses tours vivants) ? */
  suivi: boolean;
  /**
   * Le processus du moteur répond-il encore ? `undefined` quand la question ne
   * se pose pas : aucun numéro de processus connu, donc rien à constater.
   */
  processusVivant?: boolean;
  /**
   * Depuis combien de temps la réponse est-elle figée ? `undefined` tant que
   * l'agent écrit encore — un tour long n'est pas un tour bloqué.
   */
  reponseFigeeDepuisMs?: number;
  /** Depuis combien de temps ce tour est-il parti ? */
  partiDepuisMs: number;
}

export interface TourBloque {
  raison: string;
}

/**
 * Ce tour est-il resté « au travail » sans que personne ne l'attende plus ?
 *
 * Trois constats, chacun suffisant. Aucun ne juge la DURÉE d'un tour en cours :
 * un agent qui réfléchit une heure travaille, il ne se bloque pas.
 */
export function tourBloque(etat: EtatDuTour): TourBloque | null {
  if (etat.statut !== 'running' && etat.statut !== 'starting') return null;

  // 1. Le démon ne suit plus ce tour : une panne interne a mangé sa fermeture,
  //    ou le tour appartient à un démon qui n'existe plus. Personne ne le
  //    refermera jamais.
  if (!etat.suivi) {
    return { raison: "Ce tour n'était plus suivi par le serveur : il a été refermé pour libérer l'agent." };
  }

  // 2. Le moteur a disparu sans rendre la main, ALORS QUE LA RÉPONSE S'ÉCRIT
  //    ENCORE. Une réponse déjà figée, elle, relève du cas 3 : le processus du
  //    tour est normalement fini à ce moment-là, c'est le travail d'après qui
  //    court.
  if (
    etat.reponseFigeeDepuisMs === undefined &&
    etat.processusVivant === false &&
    etat.partiDepuisMs > DELAI_AVANT_PROCESSUS_DISPARU_MS
  ) {
    return { raison: "Le moteur s'est arrêté sans rendre la main : le tour a été refermé." };
  }

  // 3. La réponse est rendue depuis trop longtemps et le tour ne s'est toujours
  //    pas refermé.
  if (etat.reponseFigeeDepuisMs !== undefined && etat.reponseFigeeDepuisMs > PLAFOND_FERMETURE_MS) {
    return {
      raison: `La réponse était rendue depuis ${Math.round(
        etat.reponseFigeeDepuisMs / 60_000,
      )} minutes sans que le tour se referme : il a été refermé.`,
    };
  }

  return null;
}

/**
 * Dans quel état laisser un agent qu'on referme d'autorité ? Une réponse
 * rendue, c'est un tour FINI, même si sa fermeture a mal tourné : le marquer en
 * échec afficherait un voyant rouge sur un travail livré. Rien de rendu, en
 * revanche, est bien un échec — et la carte doit pouvoir repartir.
 */
export function statutDeFermetureForcee(input: { reponseRendue: boolean }): 'done' | 'failed' {
  return input.reponseRendue ? 'done' : 'failed';
}
