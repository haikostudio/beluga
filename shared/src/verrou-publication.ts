/**
 * UNE CARTE EN COURS DE PUBLICATION NE REÇOIT PLUS DE MESSAGE.
 *
 * Un message humain posé sur une carte que le lot est en train de fusionner,
 * d'enregistrer et de pousser relançait son agent PENDANT la publication : il
 * réécrivait la branche qu'on mettait en ligne, et la carte ressortait de
 * « À déployer » (constaté le 25.09.2026, publication figée à 20 %). Le verrou
 * vit côté SERVEUR (`agent.prompt` dans `ws.ts`, `sendPrompt` dans
 * `runtime.ts`) ; la barre d'écriture le lit aussi pour se griser. Il ne vise
 * que les messages HUMAINS : le fil du conducteur de publication (rôle
 * `deploy`) et les demandes silencieuses du démon restent ouverts, sinon la
 * publication elle-même se figerait. Il tombe de lui-même dès que la
 * publication n'est plus `running` — réussite, échec ou arrêt.
 */
export function carteEnPublication(
  publication: { state: string; cardIds?: readonly string[] } | null | undefined,
  cardId: string | null | undefined,
): boolean {
  if (!publication || !cardId) return false;
  return publication.state === 'running' && (publication.cardIds ?? []).includes(cardId);
}

/** Ce que dit le refus, côté serveur comme dans la barre d'écriture. */
export const TEXTE_CARTE_EN_PUBLICATION =
  'Publication en cours : cette carte est en train d’être mise en ligne. Vous pourrez y écrire dès la fin de la publication.';
