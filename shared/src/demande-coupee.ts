/*
 * UNE DEMANDE COUPÉE PAR UN ARRÊT AVANT LE MOTEUR REPART AU DÉMARRAGE (04/11/2026).
 *
 * La bulle d'une demande humaine s'écrit AU DÉBUT de la préparation du tour,
 * avant le choix du compte et bien avant le moteur. Un arrêt du serveur dans
 * cette fenêtre (redémarrage forcé, signal impossible à retenir, panne) laissait
 * la bulle à l'écran, sans réponse et sans contexte envoyé — et plus rien en
 * base pour la renvoyer : la demande avait déjà quitté la file. L'utilisateur
 * devait la recopier à la main.
 *
 * Au démarrage, pour un agent qui était en train de partir, on regarde donc son
 * DERNIER échange : si c'est une bulle humaine qui n'a jamais atteint le moteur,
 * elle est remise en tête de file AVEC son identifiant, pour repartir sans
 * seconde bulle (le chemin des demandes retombées faute de quota).
 */

/** Ce que la règle lit d'un message — rien de plus. */
export interface MessageVuAuDemarrage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  createdAt: number;
  /** Posé quand le moteur a réellement reçu la demande. */
  sentContext?: unknown;
  error?: string;
  /** La décision d'un tour tombé : un « Relancer » en cours porte la demande qu'il renvoyait. */
  erreurDeTour?: { choix?: string; demandeARejouer?: string };
}

/**
 * Au-delà, une bulle restée sans réponse est trop vieille pour repartir seule :
 * un serveur resté éteint longtemps ne doit pas relancer un travail que
 * personne n'attend plus.
 */
export const AGE_MAX_DEMANDE_COUPEE_MS = 30 * 60_000;

/**
 * La bulle à relancer, ou `null`. `messages` va du plus récent au plus ancien
 * (l'ordre de `listMessages`). Les messages système (annonces du serveur) ne
 * comptent pas comme une réponse ; une réponse de l'agent ou d'un outil, si :
 * le moteur a alors bien démarré, et la reprise d'un tour coupé est une autre
 * affaire. `dejaEnFile` dit les bulles qu'une demande en file porte déjà — la
 * même ne se remet jamais deux fois.
 */
export function demandeCoupeeAvantLeMoteur(
  messages: MessageVuAuDemarrage[],
  maintenant: number,
  dejaEnFile: ReadonlySet<string> = new Set(),
): MessageVuAuDemarrage | null {
  let dernier = messages.find((m) => m.role !== 'system');
  /*
   * UN « RELANCER » COUPÉ À SON TOUR (15/11/2026). Le dernier message est alors
   * l'échec précédent, dont on a choisi de RENVOYER la demande : c'est elle qui
   * était en route, et elle qui repart — pas la réponse d'échec.
   */
  const rejouee = dernier?.role === 'assistant' && dernier.erreurDeTour?.choix === 'relancer'
    ? dernier.erreurDeTour.demandeARejouer
    : undefined;
  if (rejouee) dernier = messages.find((m) => m.id === rejouee);
  if (!dernier || dernier.role !== 'user') return null;
  if (dernier.sentContext || dernier.error) return null;
  if (maintenant - dernier.createdAt > AGE_MAX_DEMANDE_COUPEE_MS) return null;
  if (dejaEnFile.has(dernier.id)) return null;
  return dernier;
}
