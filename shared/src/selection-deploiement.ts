/**
 * LA SÉLECTION DES TÂCHES À DÉPLOYER.
 *
 * Le bouton « Tout déployer » embarquait TOUT le lot de « À déployer », sans
 * qu'on puisse en retenir une partie pour la prochaine fois. L'écran de
 * sélection permet de décocher des tâches avant de cliquer : seules celles
 * retenues sont fusionnées et envoyées, les autres restent dans « À
 * déployer », disponibles pour la fois suivante.
 *
 * La sélection porte sur des TÂCHES, jamais sur des fichiers isolés : chaque
 * carte lancée a déjà sa propre branche de travail (`dossier-de-carte.ts`),
 * ce qui rend le choix fiable — retenir une carte, c'est retenir sa branche
 * en entier.
 *
 * Règles PURES : ni base, ni disque, ni git — l'appelant apporte les fichiers
 * touchés par chaque carte, déjà lus sur le dépôt.
 */

export type CarteASelectionner = { id: string; title: string; files: string[] };

/** Les cartes retenues, dans le même ordre que la liste d'origine. */
export function cartesRetenues(toutes: CarteASelectionner[], selection: Set<string>): CarteASelectionner[] {
  return toutes.filter((carte) => selection.has(carte.id));
}

/** Les cartes laissées de côté, dans le même ordre que la liste d'origine. */
export function cartesEcartees(toutes: CarteASelectionner[], selection: Set<string>): CarteASelectionner[] {
  return toutes.filter((carte) => !selection.has(carte.id));
}

export type AvertissementSelection = {
  /** La carte RETENUE qui porte l'avertissement. */
  cardId: string;
  /** La phrase à afficher, en français. */
  message: string;
};

/** Combien de fichiers communs sont nommés dans un avertissement. */
const FICHIERS_NOMMES_MAX = 3;

/**
 * CE QUI COINCERAIT avec CETTE sélection : une tâche retenue qui touche les
 * mêmes fichiers qu'une tâche laissée de côté.
 *
 * Ce n'est pas un refus — la publication peut partir quand même — mais un
 * signal : la carte écartée était peut-être un PRÉREQUIS de la carte retenue,
 * ou les deux vont se heurter à la fusion suivante. On le dit avant de
 * cliquer plutôt que de laisser la fusion le découvrir seule.
 */
export function avertissementsSelection(
  toutes: CarteASelectionner[],
  selection: Set<string>,
): AvertissementSelection[] {
  const retenues = cartesRetenues(toutes, selection);
  const ecartees = cartesEcartees(toutes, selection);
  const avertissements: AvertissementSelection[] = [];
  for (const retenue of retenues) {
    for (const ecartee of ecartees) {
      const communs = retenue.files.filter((fichier) => ecartee.files.includes(fichier));
      if (!communs.length) continue;
      const noms = communs.slice(0, FICHIERS_NOMMES_MAX).join(', ');
      const reste = communs.length - FICHIERS_NOMMES_MAX;
      avertissements.push({
        cardId: retenue.id,
        message: `« ${retenue.title} » touche les mêmes fichiers que « ${ecartee.title} », laissée de côté (${noms}${
          reste > 0 ? `, +${reste}` : ''
        }) : un conflit est possible à la prochaine fusion.`,
      });
    }
  }
  return avertissements;
}
