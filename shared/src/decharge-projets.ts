/**
 * LES CARTES D'UN PROJET QU'ON NE CONSULTE PLUS SE DÉCHARGENT — APRÈS QUINZE
 * MINUTES, PAS AVANT.
 *
 * Le navigateur gardait en mémoire les cartes de TOUS les projets ouverts
 * depuis le début de la session : ouvrir cinq projets, c'était garder cinq
 * tableaux entiers, et payer leur poids à chaque changement d'état. Elles ne
 * servaient pourtant plus à rien — le tableau n'affiche qu'un projet à la fois.
 *
 * On ne décharge pas pour autant à la seconde où l'on change de projet : faire
 * l'aller-retour entre deux projets est un geste courant, et recharger à chaque
 * fois ferait clignoter le tableau pour rien. Un projet quitté garde donc ses
 * cartes un quart d'heure ; passé ce délai sans être consulté, elles sont
 * oubliées et redemandées au serveur à la prochaine ouverture (le serveur les
 * renvoie entières, c'est déjà ce qu'il fait à chaque `project.open`).
 *
 * Le projet AFFICHÉ n'est jamais déchargé, quel que soit le temps écoulé.
 *
 * Règle pure : ni base, ni disque, ni navigateur — elle se teste seule.
 */

/** Le délai au bout duquel un projet laissé de côté rend ses cartes. */
export const DELAI_DECHARGEMENT_MS = 15 * 60 * 1000;

/** Ce qu'il faut savoir pour décider ce qu'on décharge. */
export interface EtatDesConsultations {
  /**
   * La dernière fois que chaque projet a été consulté (quitté ou ouvert),
   * en millisecondes.
   */
  vuA: Record<string, number>;
  /** Le projet affiché en ce moment : jamais déchargé. */
  projetAffiche?: string | null;
  /** L'heure qu'il est. */
  maintenant: number;
}

/**
 * Les projets dont les cartes peuvent être oubliées : consultés il y a plus de
 * quinze minutes, et qui ne sont pas celui qu'on regarde.
 */
export function projetsADecharger(etat: EtatDesConsultations): string[] {
  return Object.entries(etat.vuA)
    .filter(([id, vu]) => id !== etat.projetAffiche && etat.maintenant - vu >= DELAI_DECHARGEMENT_MS)
    .map(([id]) => id)
    .sort();
}

/**
 * Faut-il redemander les cartes de ce projet au serveur ?
 *
 * Oui tant qu'on n'en a aucune en mémoire : soit on ne l'a jamais ouvert, soit
 * il a été déchargé. Le serveur reste la source, on ne devine rien.
 */
export function cartesARecharger(projetId: string, cartesEnMemoire: readonly { projectId: string }[]): boolean {
  return !cartesEnMemoire.some((carte) => carte.projectId === projetId);
}
