/*
 * LE FILTRE DE LA COLONNE DE GAUCHE (la loupe) : ce qui reste affiché pendant une
 * recherche, sans rien écrire. Replis et dépliages enregistrés ne sont pas touchés :
 * tout ce calcul est un état d'affichage, oublié à la fermeture du champ.
 *
 *  - un dossier trouvé garde tous ses projets ;
 *  - un projet trouvé reste visible, avec son dossier et, s'il est membre d'un projet
 *    réuni, le projet réuni ouvert au-dessus de lui ;
 *  - une tâche trouvée fait paraître son projet et ses parents, et ne montre qu'elle.
 *
 * Règle PURE : ni base, ni disque.
 */
import { minusculesSansAccents } from './mots.js';


/** La casse et les accents ne comptent pas ; tous les mots tapés se trouvent dans le nom, dans n'importe quel ordre. */
export function nomCorrespond(nom: string, recherche: string): boolean {
  const mots = minusculesSansAccents(recherche).split(/\s+/).filter(Boolean);
  if (!mots.length) return false;
  const cible = minusculesSansAccents(nom);
  return mots.every((mot) => cible.includes(mot));
}

export interface FiltreDeLaColonne {
  groupes: Set<string>;
  projets: Set<string>;
  /** Les projets réunis ouverts le temps du filtre : un de leurs membres est trouvé. */
  regroupementsOuverts: Set<string>;
  /** Les tâches trouvées, rangées par projet. */
  cartesParProjet: Map<string, string[]>;
}

export function filtrerLaColonne(
  recherche: string,
  groupes: readonly { id: string; name: string }[],
  projets: readonly { id: string; name: string; groupId?: string; regroupementId?: string }[],
  cartes: readonly { id: string; projectId: string }[] = [],
): FiltreDeLaColonne {
  const filtre: FiltreDeLaColonne = {
    groupes: new Set(),
    projets: new Set(),
    regroupementsOuverts: new Set(),
    cartesParProjet: new Map(),
  };
  const parId = new Map(projets.map((projet) => [projet.id, projet]));
  /* Un projet montré emmène ses parents : sans eux, sa ligne n'aurait pas où se poser. */
  const montrer = (projet: { id: string; groupId?: string; regroupementId?: string }, ouvrirLeParent: boolean) => {
    filtre.projets.add(projet.id);
    const parent = projet.regroupementId ? parId.get(projet.regroupementId) : undefined;
    if (parent) {
      if (ouvrirLeParent) filtre.regroupementsOuverts.add(parent.id);
      montrer(parent, ouvrirLeParent);
    }
    if (projet.groupId) filtre.groupes.add(projet.groupId);
  };
  for (const groupe of groupes) {
    if (!nomCorrespond(groupe.name, recherche)) continue;
    filtre.groupes.add(groupe.id);
    for (const projet of projets) if (projet.groupId === groupe.id) montrer(projet, false);
  }
  for (const projet of projets) if (nomCorrespond(projet.name, recherche)) montrer(projet, true);
  for (const carte of cartes) {
    const projet = parId.get(carte.projectId);
    if (!projet) continue;
    montrer(projet, true);
    const liste = filtre.cartesParProjet.get(projet.id);
    if (liste) liste.push(carte.id);
    else filtre.cartesParProjet.set(projet.id, [carte.id]);
  }
  return filtre;
}
