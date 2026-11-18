/**
 * LE REPÈRE « N CARTES SUGGÉRÉES ICI » DANS LE FIL D'UNE CARTE (demande du
 * 23/10/2026). Les cartes proposées vivent dans la rangée du pied
 * (`SuggestionsDeCarte`), qu'une croix peut fermer : le fil garde, à l'endroit
 * où elles sont nées, une ligne qui le dit et rouvre la rangée sur elles.
 *
 * Le fil d'une carte n'est pas une liste de messages mais une suite de
 * PASSAGES (`PointDuParcours`). Chaque groupe de suggestions se range sous le
 * DERNIER passage commencé avant lui ; plus tôt que tout passage, sous le
 * premier.
 */
export interface GroupeDeSuggestions {
  /** Le message qui porte les propositions. */
  messageId: string;
  /** La fin du tour qui porte le message (`finDuTourDuMessage`). */
  at: number;
  /** Les propositions ni refusées ni réunies, dans l'ordre. */
  ids: string[];
}

export function rangerLesSuggestions<G extends { at: number }>(
  passages: readonly { ancre: string; debut?: number }[],
  groupes: readonly G[],
): Map<string, G[]> {
  const rangees = new Map<string, G[]>();
  if (!passages.length) return rangees;
  for (const groupe of groupes) {
    let cible = passages[0].ancre;
    for (const passage of passages) {
      if (passage.debut !== undefined && passage.debut <= groupe.at) cible = passage.ancre;
    }
    const liste = rangees.get(cible) ?? [];
    liste.push(groupe);
    rangees.set(cible, liste);
  }
  return rangees;
}


/**
 * LA FIN DU TOUR D'UN MESSAGE QUI PORTE DES PROPOSITIONS (15/11/2026).
 *
 * Le message d'un tour est daté de son DÉBUT : un groupe rangé à cette date
 * tombait sous le passage « Demande », au-dessus de la question et de la
 * compréhension qui annonçaient pourtant la carte « plus bas » — l'utilisateur
 * ne la voyait jamais. Le groupe se range donc à la FIN du tour : début plus
 * durée pour un tour fini, l'infini (le dernier passage) tant qu'il s'écrit.
 */
export function finDuTourDuMessage(message: { createdAt: number; durationMs?: number; streaming?: boolean }): number {
  if (message.streaming) return Number.POSITIVE_INFINITY;
  return message.createdAt + Math.max(0, message.durationMs ?? 0);
}
