/**
 * LA CADENCE DE MISE À JOUR DES OUTILS DE MOTEUR (Claude, Codex, Cursor).
 *
 * Le 22.09.2026, l'outil Claude installé sur le serveur (2.1.278) refusait le
 * modèle « Opus 5.5 » sorti la veille — l'API le proposait déjà, mais le CLI
 * ne le reconnaissait pas encore. Un `claude update` a suffi. Cette règle dit
 * QUAND repasser cette commande tout seul, pour chaque outil, sans jamais
 * attendre qu'un modèle neuf redevienne injoignable pour s'en apercevoir.
 */

/** Le délai entre deux mises à jour d'un même outil : une fois par jour. */
export const PERIODE_MISE_A_JOUR_MOTEURS_MS = 24 * 60 * 60 * 1000;

/**
 * Cet outil est-il dû pour une mise à jour ? Vrai s'il n'a jamais été passé,
 * ou si la dernière TENTATIVE (réussie ou non) remonte à plus d'un jour — un
 * échec (réseau absent, outil introuvable) ne bloque pas indéfiniment : il
 * retente simplement au prochain jour, jamais en boucle serrée.
 */
export function moteurDoitEtreMisAJour(maintenant: number, derniereTentativeA: number | undefined): boolean {
  return !derniereTentativeA || maintenant - derniereTentativeA >= PERIODE_MISE_A_JOUR_MOTEURS_MS;
}
