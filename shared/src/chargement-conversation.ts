/**
 * LE FIL D'UNE CARTE SE REDEMANDE TANT QU'IL N'EST PAS ARRIVÉ — PUIS IL LE DIT.
 *
 * L'écran réclame la conversation d'une carte par la commande
 * `card.conversation`, sans accusé : la réponse arrive comme un événement du
 * même nom. Une demande partie juste avant une coupure du canal (serveur
 * bloqué plusieurs secondes, battement sans réponse, réseau qui bascule) ne
 * reçoit donc JAMAIS de réponse — et rien ne la rejouait, sinon un `ready`
 * qui n'arrive qu'une fois le socket réellement refermé. Le tiroir levait bien
 * sa propre silhouette au bout de douze secondes (le bouton « Valider le plan »
 * s'affichait), mais la conversation, elle, restait sur la sienne pour
 * toujours : « chargement » n'avait aucune issue.
 *
 * La règle : une demande sans réponse après `DELAI_CONVERSATION_MS` est
 * REJOUÉE ; après `ESSAIS_CONVERSATION` essais ratés, la silhouette laisse
 * place à un message et à un bouton « Réessayer ». Une réponse arrivée même
 * tard efface l'échec : le fil s'affiche dès qu'il est là.
 *
 * Règle pure : ni base, ni disque, ni navigateur — elle se teste seule.
 */

/** Le délai au bout duquel une demande de conversation est tenue pour perdue. */
export const DELAI_CONVERSATION_MS = 8_000;

/** Le nombre d'essais ratés (demande d'origine comprise) avant d'abandonner la silhouette. */
export const ESSAIS_CONVERSATION = 2;

/**
 * Que faire d'une demande restée sans réponse ? `essaisRates` compte les
 * demandes déjà parties et restées muettes, celle qui vient d'expirer comprise.
 */
export function suiteDuChargementRate(essaisRates: number): 'rejouer' | 'echec' {
  return essaisRates >= ESSAIS_CONVERSATION ? 'echec' : 'rejouer';
}
