/**
 * LA CONNEXION LENTE : à partir de quand une attente se dit.
 *
 * Une zone qui n'a pas encore ses données montre une silhouette (MEM-0417). Tant
 * que cela dure quelques instants, rien à dire ; au-delà d'un seuil, l'écran le
 * DIT — « la connexion est lente » — au lieu de laisser croire à une panne.
 *
 * La règle tient ici, sans écran ni horloge : l'appelant donne l'instant où
 * l'attente a commencé et l'instant présent. Le seuil est UN seul nombre, pour
 * toute l'application.
 */

/** Une attente de silhouette qui dépasse ce délai (ms) passe pour une connexion lente. */
export const SEUIL_CONNEXION_LENTE_MS = 4000;

/**
 * L'attente est-elle assez longue pour se dire ? `attenteDepuis` est l'instant
 * (ms) où la première silhouette est apparue, ou `null` quand plus rien
 * n'attend.
 */
export function connexionEstLente(
  attenteDepuis: number | null,
  maintenant: number,
  seuilMs: number = SEUIL_CONNEXION_LENTE_MS,
): boolean {
  if (attenteDepuis === null) return false;
  return maintenant - attenteDepuis >= seuilMs;
}

/**
 * Combien de millisecondes avant que l'attente en cours devienne « lente » :
 * `0` si elle l'est déjà, `null` si rien n'attend. C'est ce délai que l'écran
 * programme, au lieu de sonder l'horloge toutes les secondes.
 */
export function delaiAvantConnexionLente(
  attenteDepuis: number | null,
  maintenant: number,
  seuilMs: number = SEUIL_CONNEXION_LENTE_MS,
): number | null {
  if (attenteDepuis === null) return null;
  return Math.max(0, seuilMs - (maintenant - attenteDepuis));
}
