/**
 * Quel projet ouvrir au démarrage ?
 *
 * Le dernier projet consulté est retenu dans la table des préférences (côté
 * serveur, jamais dans le navigateur) : on retrouve le même tableau d'un
 * appareil à l'autre. Si ce projet a été archivé ou supprimé entre-temps, on
 * revient sans bruit sur le premier de la liste.
 *
 * La décision vit ici, dans un module sans réseau ni base : elle se teste seule.
 */

/** Clé du réglage dans la table des préférences. */
export const CLE_PROJET_ACTIF = 'project.active';

/** Le strict minimum dont la décision a besoin. */
export interface ProjetOuvrable {
  id: string;
  archived?: boolean;
}

export interface ChoixProjet {
  /** Projet à ouvrir, ou null si le serveur n'en propose aucun. */
  id: string | null;
  /** Vrai quand le réglage enregistré ne correspond plus : il faut le corriger. */
  aCorriger: boolean;
}

/**
 * @param projets    Les projets envoyés par le serveur à la connexion.
 * @param memorise   L'identifiant retenu dans les préférences (s'il y en a un).
 * @param encours    Le projet déjà affiché, dans le cas d'une simple reconnexion.
 */
export function choisirProjetAOuvrir(
  projets: ProjetOuvrable[],
  memorise: unknown,
  encours?: string | null,
): ChoixProjet {
  const ouvrables = projets.filter((projet) => !projet.archived);
  const existe = (id: unknown): id is string =>
    typeof id === 'string' && ouvrables.some((projet) => projet.id === id);

  // Une reconnexion ne doit jamais déplacer l'utilisateur : ce qu'il regarde
  // l'emporte sur ce qui est enregistré.
  if (existe(encours)) return { id: encours, aCorriger: memorise !== encours };

  if (existe(memorise)) return { id: memorise, aCorriger: false };

  // Projet mémorisé archivé, supprimé, ou aucun réglage : premier de la liste.
  const premier = ouvrables[0]?.id ?? null;
  return { id: premier, aCorriger: premier !== null && premier !== memorise };
}
