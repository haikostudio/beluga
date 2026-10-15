/**
 * LA VEILLE DE L'ÉCRAN — une page que personne ne regarde ne travaille pas.
 *
 * L'application tenait son canal ouvert, ses minuteries et ses relevés en
 * marche même onglet caché ou téléphone verrouillé : tout le travail des
 * agents de tous les projets continuait d'être reçu et redessiné, pour un
 * écran que personne ne voyait. Sur un téléphone, cela suffit à le faire
 * chauffer.
 *
 * La règle : une page cachée depuis `DELAI_AVANT_VEILLE_MS` se met en VEILLE
 * COMPLÈTE — canal fermé, minuteries arrêtées, aucune reconnexion — sauf si
 * quelque chose doit continuer SANS écran : une conversation vocale, une
 * écoute, un enregistrement, une réponse lue à voix haute. Les alertes passent
 * par les notifications du système ; au retour, l'écran se reconnecte et
 * reçoit l'état complet, comme après n'importe quelle coupure.
 *
 * Règles pures, sans page ni réseau : le branchement sur les événements du
 * navigateur vit dans `web/src/lib/veille.ts`.
 */

/**
 * Le temps laissé avant de couper. Basculer une seconde vers une autre fenêtre
 * ne doit pas fermer le canal : seul un départ qui dure met en veille.
 */
export const DELAI_AVANT_VEILLE_MS = 5_000;

/**
 * Tant qu'un garde tient la page éveillée, on revient voir à ce rythme s'il a
 * lâché — un enregistrement fini téléphone en poche doit finir par endormir
 * la page.
 */
export const PAS_DE_REVISION_DE_VEILLE_MS = 10_000;

export interface LectureDeVeille {
  /** Depuis quand la page est cachée ; `null` si elle est à l'écran. */
  cacheDepuis: number | null;
  /** Combien de choses exigent de rester éveillé (voix, micro, enregistrement). */
  gardes: number;
  /** La page vient d'être GELÉE par le système : plus aucune minuterie ne tournera. */
  gelee?: boolean;
}

/** Faut-il dormir, à cet instant ? */
export function doitVeiller(lecture: LectureDeVeille, maintenant: number): boolean {
  if (lecture.cacheDepuis == null) return false;
  if (lecture.gardes > 0) return false;
  if (lecture.gelee) return true;
  return maintenant - lecture.cacheDepuis >= DELAI_AVANT_VEILLE_MS;
}

/**
 * Dans combien de temps reposer la question, page cachée et pas encore en
 * veille ; `null` si elle est à l'écran — rien à surveiller.
 */
export function prochaineRevisionDeVeille(lecture: LectureDeVeille, maintenant: number): number | null {
  if (lecture.cacheDepuis == null) return null;
  if (lecture.gardes > 0) return PAS_DE_REVISION_DE_VEILLE_MS;
  return Math.max(0, DELAI_AVANT_VEILLE_MS - (maintenant - lecture.cacheDepuis));
}

/*
 * UNE PAGE GELÉE SANS PRÉVENIR SE RECONNAÎT À SON HORLOGE.
 *
 * Constaté sur iPhone (demande du 14/10/2026) : l'application ouverte, le
 * téléphone se verrouille, on travaille sur l'ordinateur, on revient — le
 * tableau ne bouge plus, il faut fermer l'application. Le système GÈLE la page
 * sans toujours émettre `visibilitychange`, `pagehide` ni `freeze` : au retour,
 * elle croit n'être jamais partie, ne passe pas par la veille, et garde un canal
 * « ouvert » dont la route est morte. Seul le battement finissait par le
 * déclarer muet — deux pings manqués, une quarantaine de secondes.
 *
 * Une horloge TÉMOIN bat à `PAS_DU_TEMOIN_D_HORLOGE_MS` tant que la page est à
 * l'écran. Un écart réel bien plus long que ce pas ne s'explique que par un
 * gel (ou un ordinateur mis en veille) : la page passe alors par la veille,
 * comme si elle l'avait vue venir — canal refait, état complet redemandé.
 * Le seuil laisse large place à un fil principal simplement occupé.
 */
export const PAS_DU_TEMOIN_D_HORLOGE_MS = 2_000;
export const ECART_DE_GEL_MS = 10_000;

/**
 * La page sort-elle d'un gel ? `dernierBattementA` est le dernier battement du
 * témoin ; `null` quand il ne battait pas (page cachée, veille) : rien à juger.
 */
export function pageSortieDUnGel(dernierBattementA: number | null, maintenant: number): boolean {
  if (dernierBattementA == null) return false;
  return maintenant - dernierBattementA >= ECART_DE_GEL_MS;
}

/*
 * LES REDESSINS EN RAFALE SE REGROUPENT.
 *
 * Chaque événement du serveur prévenait aussitôt tous les composants abonnés :
 * un agent qui écrit sa réponse fragment par fragment faisait redessiner
 * l'écran des dizaines de fois par seconde. L'état, lui, reste posé tout de
 * suite — seul l'AVIS aux composants est regroupé : au plus un tous les
 * `PAS_DES_RAFALES_MS`. Un événement isolé est annoncé sans attendre ; un
 * geste de l'utilisateur ne passe jamais par ce délai.
 */
export const PAS_DES_RAFALES_MS = 100;

/** Combien attendre avant d'annoncer un changement venu du serveur. */
export function attenteAvantAvis(dernierAvisA: number | null, maintenant: number): number {
  if (dernierAvisA == null) return 0;
  const ecoule = maintenant - dernierAvisA;
  if (ecoule < 0) return 0;
  return Math.max(0, PAS_DES_RAFALES_MS - ecoule);
}
