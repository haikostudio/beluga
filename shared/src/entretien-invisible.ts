/**
 * L'ENTRETIEN INVISIBLE DE LA VERSION LIBRE (décision de l'utilisateur, 30/10/2026).
 *
 * Constat : une installation de la version libre voyait des cartes qu'elle
 * n'avait jamais demandées — le ménage de nuit des compétences (MEM-0448 : « rien
 * ne tourne sans se voir ») posait sa carte dans le premier projet ouvert de
 * l'utilisateur. Rien ne fuyait : la carte naissait sur place.
 *
 * Règle : une routine d'ENTRETIEN — lancée sans geste de l'utilisateur ET qui
 * n'attend aucune décision humaine — tourne en SILENCE hors de la machine de
 * l'auteur : sa carte porte `LABEL_ENTRETIEN_INVISIBLE`, son agent
 * `entretienInvisible`, et ni l'une ni l'autre ne paraît nulle part (tableau,
 * compteurs, recherche, archives, cloche, pastilles, notifications, ligne du
 * projet). Sur la machine de l'auteur, tout reste visible, pour repérer une panne.
 *
 * Une routine qui PROPOSE (examen de nuit, veille des sources de compétences)
 * reste visible partout : la cacher la rendrait inutile. Ce que l'utilisateur
 * lance lui-même (rattrapage des compétences, sauvegarde, surveillance) aussi.
 */

/** L'étiquette qui retire une carte de tout ce que l'écran montre ou compte. */
export const LABEL_ENTRETIEN_INVISIBLE = 'entretien invisible';

/**
 * - `entretien` : lancée sans geste, n'attend aucune décision (ménage de nuit des compétences) ;
 * - `proposition` : elle pose des cartes à décider (examen de nuit, veille des sources) ;
 * - `demandee` : un geste de l'utilisateur l'a lancée (rattrapage, sauvegarde, surveillance).
 */
export type GenreDeRoutine = 'entretien' | 'proposition' | 'demandee';

/** Cette routine doit-elle tourner sans rien montrer, sur cette machine ? */
export function routineInvisible(genre: GenreDeRoutine, machineDeLAuteur: boolean): boolean {
  return genre === 'entretien' && !machineDeLAuteur;
}

/** La carte d'une routine d'entretien invisible : jamais montrée, jamais comptée. */
export function carteDEntretienInvisible(carte: { labels?: readonly string[] | null } | null | undefined): boolean {
  return !!carte?.labels?.includes(LABEL_ENTRETIEN_INVISIBLE);
}

/** L'agent d'une routine d'entretien invisible. */
export function agentDEntretienInvisible(agent: { entretienInvisible?: boolean } | null | undefined): boolean {
  return agent?.entretienInvisible === true;
}

/**
 * LA DERNIÈRE PORTE VERS L'ÉCRAN, en règle pure : un événement qui PARLE d'une
 * routine invisible (sa carte, son agent, un message de son fil) est retiré
 * (`null`) ; une LISTE qui la contient (`agents`, `cards`) part sans elle. Les
 * deux juges disent si un identifiant est invisible — le démon les tient en
 * mémoire (`store.carteInvisible`, `store.agentInvisible`).
 */
export function evenementSansEntretienInvisible<T extends object>(
  event: T,
  invisible: { carte: (id: string | undefined) => boolean; agent: (id: string | undefined) => boolean },
): T | null {
  const brut = event as Record<string, unknown>;
  const texte = (valeur: unknown) => (typeof valeur === 'string' ? valeur : undefined);
  const objet = (valeur: unknown) => (valeur && typeof valeur === 'object' ? (valeur as Record<string, unknown>) : undefined);
  const message = objet(brut.message);
  if (
    invisible.agent(texte(objet(brut.agent)?.id) ?? texte(brut.agentId) ?? texte(message?.agentId)) ||
    invisible.carte(texte(objet(brut.card)?.id) ?? texte(brut.cardId) ?? texte(message?.cardId))
  ) {
    return null;
  }
  if (!Array.isArray(brut.agents) && !Array.isArray(brut.cards)) return event;
  const copie: Record<string, unknown> = { ...brut };
  const filtrer = (cle: 'agents' | 'cards', juge: (id: string | undefined) => boolean) => {
    const liste = copie[cle];
    if (Array.isArray(liste)) copie[cle] = liste.filter((element) => !juge(texte(objet(element)?.id) ?? texte(element)));
  };
  filtrer('agents', invisible.agent);
  filtrer('cards', invisible.carte);
  return copie as T;
}
