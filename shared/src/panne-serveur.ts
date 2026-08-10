/**
 * « Le serveur ne répond pas » — une phrase à ne dire que quand c'est vrai.
 *
 * Une requête du navigateur attend au plus deux minutes (`call()`,
 * `web/src/lib/client.ts`). Passé ce délai, elle abandonne. Or un lancement de
 * carte ne répond QU'À LA FIN du tour : la requête peut donc expirer alors que
 * tout va bien — le serveur travaille, le canal temps réel est ouvert, les
 * événements continuent d'arriver. Afficher là une alerte rouge « le serveur ne
 * répond pas » est un mensonge, et il tombe précisément au pire moment : quand
 * l'agent vient de démarrer.
 *
 * L'alerte est donc réservée à une indisponibilité RÉELLE et DURABLE. Deux
 * signes, un seul suffit :
 *
 *  - le canal temps réel est COUPÉ depuis plus de quinze secondes (une
 *    reconnexion ordinaire prend moins que ça) ;
 *  - plusieurs requêtes d'affilée restent sans réponse, canal ouvert ou non.
 *
 * Une requête isolée qui expire ne dit rien : elle est RENDUE à l'appelant, qui
 * en fait ce qu'il veut (un lot la compte dans son bilan, une carte la montre
 * sur elle-même), mais elle n'allume plus d'alerte.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */

/** Au-delà, un canal coupé n'est plus une reconnexion : c'est une panne. */
export const DELAI_CANAL_COUPE = 15_000;

/** Deux requêtes de suite sans réponse : ce n'est plus un accident isolé. */
export const ECHECS_AVANT_ALERTE_SERVEUR = 2;

/** Ce que l'interface sait de l'état du lien avec le serveur. */
export interface EtatDuLien {
  /** Le canal temps réel est-il ouvert ? */
  connecte: boolean;
  /** Depuis quand il est coupé, si c'est le cas. */
  coupeDepuis?: number;
  /** Requêtes consécutives restées sans réponse, remise à zéro dès qu'une aboutit. */
  echecsConsecutifs: number;
}

/**
 * Faut-il afficher l'alerte « le serveur ne répond pas » ?
 *
 * Le premier échec, canal ouvert, ne l'affiche jamais : c'est une requête
 * lente, pas une panne.
 */
export function alerteServeurInjoignable(lien: EtatDuLien, maintenant: number): boolean {
  if (lien.echecsConsecutifs >= ECHECS_AVANT_ALERTE_SERVEUR) return true;
  if (lien.connecte) return false;
  if (lien.coupeDepuis == null) return false;
  return maintenant - lien.coupeDepuis >= DELAI_CANAL_COUPE;
}

/**
 * Le message rendu à l'appelant quand une requête expire. Il ne change PAS de
 * texte : le bilan d'un lot le traduit déjà en une phrase compréhensible
 * (`traduireRaison`, `lot-colonne.ts`), et deux formulations pour un même fait
 * se contrediraient.
 */
export const RAISON_SANS_REPONSE = 'le serveur ne répond pas';
