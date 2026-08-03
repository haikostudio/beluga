/**
 * « Ce projet attend quelque chose de VOUS. »
 *
 * Deux gestes très différents réclament pourtant la même chose — une décision
 * de l'utilisateur : une question posée par un agent, et une carte présentée à
 * valider. Le compteur d'attention les met sur le même pied ; sans quoi une
 * proposition en attente n'allumait rien du tout dans la liste des projets.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */

/** Ce qui peut réclamer une décision de l'utilisateur. */
export type GenreDemande = 'question' | 'validation';

export interface DemandeEnAttente {
  projectId: string;
  genre: GenreDemande;
  /**
   * La demande a-t-elle été tranchée ? Une question qui a sa réponse, une
   * proposition acceptée ou refusée : plus rien à faire, elle ne compte plus.
   */
  reglee?: boolean;
}

/** Une demande pèse-t-elle encore sur l'utilisateur ? */
export function demandeOuverte(demande: DemandeEnAttente): boolean {
  return !demande.reglee;
}

/**
 * Combien de décisions attendues par projet — ce que porte le triangle
 * d'alerte de la liste, et ce qui déclenche sa secousse quand le nombre monte.
 */
export function attentionParProjet(demandes: DemandeEnAttente[]): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const demande of demandes) {
    if (!demandeOuverte(demande)) continue;
    compte[demande.projectId] = (compte[demande.projectId] ?? 0) + 1;
  }
  return compte;
}

/**
 * Le compte d'un groupe replié : la somme de ses projets. Replier un groupe ne
 * doit jamais cacher qu'on y attend une réponse.
 */
export function attentionDuGroupe(membres: string[], parProjet: Record<string, number>): number {
  return membres.reduce((total, id) => total + (parProjet[id] ?? 0), 0);
}

/*
 * La secousse de la ligne ne se décide plus ici : elle obéit AUSSI au travail
 * rendu pas encore consulté. La règle complète vit dans `signal-projet.ts`
 * (`doitSecouerLigne`), qui compare les deux signaux séparément.
 */
