/**
 * « UNE CONVERSATION OUVERTE N'EST LUE QUE SI QUELQU'UN LA REGARDE. »
 *
 * Ouvrir une carte vaut consultation : c'est un geste. Mais la conversation
 * marquait AUSSI la carte lue toute seule, à la fin de chaque tour, dès lors
 * que son tiroir était monté — sur un ordinateur resté ouvert sur cette carte,
 * dans un onglet caché, sur un téléphone en veille qui se reconnecte. La date
 * de lecture passait alors devant la fin du tour, et tout ce qui en dépend
 * s'éteignait sans que personne ait rien vu : la pastille « rendu non
 * consulté », le geste attendu (`gesteEnAttente`), donc la cloche, le repère
 * du projet et la SECOUSSE de la carte sur « Tableaux de bord ».
 *
 * Une lecture IMPLICITE — celle qui ne vient d'aucun clic — n'a donc lieu que
 * si la page est visible ET au premier plan. Sinon elle attend que l'écran le
 * redevienne : c'est à cet instant que la réponse est réellement sous les yeux.
 *
 * Règle pure : sans navigateur, elle se teste seule.
 */
export interface EtatDeLEcran {
  /** `document.visibilityState` */
  visibilite: string;
  /** `document.hasFocus()` : la fenêtre a-t-elle le clavier ? */
  auPremierPlan: boolean;
}

/** Quelqu'un regarde-t-il cette page en ce moment ? */
export function ecranRegarde(ecran: EtatDeLEcran): boolean {
  return ecran.visibilite === 'visible' && ecran.auPremierPlan;
}
