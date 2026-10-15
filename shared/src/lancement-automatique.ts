/*
 * LE LANCEMENT AUTOMATIQUE D'UNE CARTE, À LA FIN DE SA COMPRÉHENSION.
 *
 * Un interrupteur à droite de « Valider et lancer » (`parcours-carte.tsx`),
 * mémorisé SUR LA CARTE (`parcours.lancementAutomatique`), éteint à la
 * naissance. Allumé, le démon fait lui-même le geste « Valider et lancer » dès
 * qu'un tour de cadrage s'est refermé sur une compréhension prête — ni plus
 * tôt, ni contre une décision qui attend. C'est un geste de l'utilisateur
 * donné d'avance : rien ne part sans qu'il ait allumé l'interrupteur.
 */

export interface EtatPourLeLancementAutomatique {
  actif: boolean;
  /** Le tour de cadrage s'est fini sans échec ni arrêt. */
  tourReussi: boolean;
  /** La carte porte une compréhension non vide. */
  comprehensionAt?: number;
  /** Une question de l'agent attend encore sa réponse. */
  questionEnAttente: boolean;
  /** Le cahier des charges est allumé : il faut alors un plan rendu APRÈS la compréhension. */
  planSouhaite: boolean;
  /** Un plan est encore en cours d'écriture. */
  planDemande: boolean;
  /** Les instants des plans rendus. */
  plansRendusA: number[];
}

/** Rend la raison d'attendre, ou `null` quand le lancement peut partir. */
export function raisonDAttendreLeLancement(etat: EtatPourLeLancementAutomatique): string | null {
  if (!etat.actif) return 'interrupteur éteint';
  if (!etat.tourReussi) return 'le tour de cadrage ne s’est pas fini normalement';
  if (!etat.comprehensionAt) return 'aucune compréhension rendue';
  if (etat.questionEnAttente) return 'une question attend votre réponse';
  if (etat.planDemande) return 'le plan est encore en cours d’écriture';
  if (etat.planSouhaite && !etat.plansRendusA.some((at) => at >= etat.comprehensionAt!)) {
    return 'le cahier des charges attend son plan';
  }
  return null;
}
