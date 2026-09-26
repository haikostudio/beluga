/**
 * LE FILET NE PEUT PAS DÉPENDRE DE CE QU'IL SURVEILLE.
 *
 * `veilleDesToursBloques` est ce qui referme un agent resté « au travail » quand
 * plus rien ne l'attend : sans elle, la barre d'écriture reste prise, le
 * compteur tourne dans le vide et seul un redémarrage du serveur libère la
 * conversation. Or elle ne tournait qu'au DÉBUT de la boucle d'ordonnancement —
 * une boucle qui, elle, attend des choses longues : lecture de quota chez le
 * fournisseur, ouverture d'une copie de travail, commandes git.
 *
 * Cette boucle porte un verrou de non-réentrance (« un tour à la fois »). Le
 * verrou est posé au départ et rendu à l'arrivée. Un seul de ces `await` qui ne
 * revient jamais — un `git` dont un petit-fils garde la sortie ouverte, un appel
 * réseau sans fin — et le verrou n'est JAMAIS rendu : tous les tours suivants
 * repartent aussitôt sans rien faire, et la veille avec eux. Le filet meurt
 * exactement au moment où il devient utile, et il ne revient qu'au redémarrage.
 *
 * Constaté le 17/08/2026 : le démon n'a plus rien refermé entre 03 h 10 et
 * 07 h 36, deux agents figés — l'auto-amélioration de la nuit et une carte —,
 * pendant que le reste du démon (sauvegarde, backups)
 * continuait de tourner normalement. La boucle, elle seule, était morte.
 *
 * Deux règles, ici, sans base ni disque :
 *
 *   1. LA VEILLE A SA PROPRE HORLOGE (`PERIODE_VEILLE_MS`), séparée de la
 *      boucle. Elle est entièrement synchrone : rien ne peut la retenir.
 *   2. UN TOUR DE BOUCLE QUI NE REND PAS LA MAIN EST DÉCLARÉ PERDU
 *      (`PLAFOND_TOUR_DE_BOUCLE_MS`). Le verrou est rendu, la boucle repart. Le
 *      tour perdu continue peut-être quelque part, mais il ne bloque plus rien.
 */

/** La veille repasse à ce rythme, indépendamment de la boucle d'ordonnancement. */
export const PERIODE_VEILLE_MS = 15_000;

/**
 * Au-delà, un tour de boucle est tenu pour perdu.
 *
 * Un tour ordinaire dure quelques secondes ; le plus lent — une copie de travail
 * à réparer, plusieurs comptes à interroger, des départs échelonnés de trois
 * secondes — reste très en dessous. CINQ minutes laissent tout cela passer
 * largement, et ne retiennent que ce qui ne reviendra jamais.
 */
export const PLAFOND_TOUR_DE_BOUCLE_MS = 5 * 60_000;

export interface EtatDeLaBoucle {
  /** Un tour est-il déjà en cours ? */
  enCours: boolean;
  /** Depuis combien de temps ce tour est-il parti ? */
  depuisMs?: number;
}

export interface DecisionDeBoucle {
  /** Ce tour peut-il partir ? */
  partir: boolean;
  /**
   * Renseigné quand le tour précédent est déclaré perdu : la phrase à
   * journaliser, pour qu'un blocage de la boucle laisse une trace au lieu de
   * passer inaperçu pendant des heures.
   */
  abandon?: string;
}

/**
 * Ce tour de boucle peut-il partir ?
 *
 * Le verrou de non-réentrance reste la règle : deux tours en même temps
 * lanceraient deux fois la même carte. Mais il n'est plus éternel — passé le
 * plafond, le tour en cours est tenu pour perdu et la boucle reprend son cours.
 */
export function decisionDeBoucle(etat: EtatDeLaBoucle): DecisionDeBoucle {
  if (!etat.enCours) return { partir: true };
  const depuis = etat.depuisMs ?? 0;
  if (depuis <= PLAFOND_TOUR_DE_BOUCLE_MS) return { partir: false };
  return {
    partir: true,
    abandon: `Le tour d'ordonnancement parti depuis ${Math.round(
      depuis / 60_000,
    )} minutes n'a jamais rendu la main : il est tenu pour perdu, la boucle repart sans lui.`,
  };
}

/**
 * Un travail engagé depuis trop longtemps est-il abandonné ? Même plafond que la
 * boucle : il sert aussi à ne pas garder pour toujours la marque « cette carte
 * est en train de démarrer », posée le temps d'un lancement.
 */
export function travailAbandonne(depuisMs: number, plafondMs = PLAFOND_TOUR_DE_BOUCLE_MS): boolean {
  return depuisMs > plafondMs;
}
