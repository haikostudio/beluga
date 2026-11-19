/* ------------------------------------------------------------------------- *
 * LE TRI DES LISTES DE CHOIX DE PROJET PAR DERNIÈRE ACTIVITÉ.
 *
 * Réservé aux menus où l'on CHOISIT un projet (« Nouvel artefact », « Pour quel
 * projet ? »…). La colonne de gauche garde son ordre manuel : rien ici ne touche
 * au rang, qui ne sert que de départage.
 * ------------------------------------------------------------------------- */

export interface ProjetClasseParActivite {
  name: string;
  rank?: number;
  derniereActivite?: number;
}

/**
 * Du projet le plus récemment actif au plus ancien. Un projet sans activité
 * connue vient après les autres ; à égalité, rang manuel puis nom. Ne modifie
 * pas la liste reçue.
 */
export function ordonnerParDerniereActivite<T extends ProjetClasseParActivite>(projets: readonly T[]): T[] {
  return projets
    .map((projet, index) => ({ projet, index }))
    .sort(
      (a, b) =>
        (b.projet.derniereActivite ?? 0) - (a.projet.derniereActivite ?? 0) ||
        (a.projet.rank ?? 1000) - (b.projet.rank ?? 1000) ||
        a.projet.name.localeCompare(b.projet.name) ||
        a.index - b.index,
    )
    .map((ligne) => ligne.projet);
}
