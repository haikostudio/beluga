/**
 * LE VOLET DE COMPRÉHENSION QU'ON RELIT EN REVENANT.
 *
 * Les points d'une compréhension se lisent en volets : le premier ouvert, les
 * autres fermés. Sans souvenir, rouvrir une carte refermait le point qu'on
 * était en train d'étudier, et il fallait le retrouver à chaque aller-retour.
 *
 * LE SOUVENIR VIT SUR L'APPAREIL, pas en base : c'est un geste de lecture, pas
 * un réglage d'affichage. Il se compte en dizaines par carte, il ne vaut rien
 * une fois la carte livrée, et l'écrire en base enverrait un message au serveur
 * à chaque clic sur un chevron. Même patron que `disposition-tableau.ts` : le
 * stockage du navigateur, lu et écrit DÉFENSIVEMENT — une navigation privée ou
 * un quota atteint ne doit jamais empêcher un bloc de s'afficher.
 *
 * LA CLÉ PORTE LA CARTE **ET** LE NUMÉRO de la compréhension : une carte en
 * compte souvent plusieurs, et une clé commune les ferait se marcher dessus.
 */

function cle(cardId: string, numero: number): string {
  return `beluga.comprehension.${cardId}.${numero}`;
}

/** La référence du dernier volet ouvert, ou `null` si rien n'a été retenu. */
export function dernierVoletOuvert(cardId: string, numero: number): string | null {
  try {
    const lu = window.localStorage.getItem(cle(cardId, numero));
    return lu && lu.trim() ? lu : null;
  } catch {
    return null;
  }
}

/** Retient le volet qu'on vient d'ouvrir. Un stockage refusé ne casse rien. */
export function retenirLeVolet(cardId: string, numero: number, reference: string): void {
  try {
    window.localStorage.setItem(cle(cardId, numero), reference);
  } catch {
    /* Stockage refusé (navigation privée, quota) : le choix vaut pour la session. */
  }
}
