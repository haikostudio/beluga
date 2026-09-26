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

/**
 * Ce qui peut réclamer une décision de l'utilisateur.
 *
 * TROIS GENRES, ET LE TRIANGLE N'EN DIT QUE DEUX. Une question posée et une
 * carte à valider veulent dire la même chose : « quelqu'un vous demande
 * quelque chose ». Un INCIDENT — un tour coupé par la limite d'un compte, une
 * erreur qui a arrêté le travail — n'est pas de cet ordre : personne ne vous a
 * rien demandé, quelque chose s'est mal passé. Les deux empruntaient le même
 * triangle orange, et on ne savait plus lequel des deux on regardait. Un
 * incident reste ATTEIGNABLE — il vit dans la cloche, avec tout le reste — mais
 * il n'allume plus le triangle d'une ligne de projet ni celui d'une carte.
 */
export type GenreDemande = 'question' | 'validation' | 'incident' | 'action';

/*
 * LE QUATRIÈME GENRE : UNE ACTION ATTENDUE DE VOUS. Générer un plan, le
 * valider, lancer une carte prête — personne ne vous a posé de question, et
 * pourtant rien n'avancera sans un clic. C'est une demande au même rang qu'une
 * question : elle allume donc le repère (`demandeAlerte`), avec sa propre
 * icône (`nature-attention.ts`). La règle qui la reconnaît vit dans
 * `attente-de-geste.ts`.
 */

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
 * Cette demande a-t-elle le droit d'ALLUMER UN REPÈRE ? Les trois demandes
 * adressées à l'utilisateur : une question, une carte à valider, une action
 * attendue. Un incident se lit dans la cloche, jamais sur une ligne de projet.
 */
export function demandeAlerte(demande: DemandeEnAttente): boolean {
  return demandeOuverte(demande) && demande.genre !== 'incident';
}

/**
 * Combien de décisions attendues par projet — ce que porte le triangle
 * d'alerte de la liste, et ce qui déclenche sa secousse quand le nombre monte.
 */
export function attentionParProjet(demandes: DemandeEnAttente[]): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const demande of demandes) {
    if (!demandeAlerte(demande)) continue;
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
