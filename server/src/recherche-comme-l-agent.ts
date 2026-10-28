import { chercherUnitesMelees, type OptionsDeRecherche, type UniteTrouvee } from './connaissances.js';
import { garderLesPertinents } from './jugement-rapide.js';

/**
 * LA RECHERCHE DE LA MÉMOIRE, TELLE QUE L'AGENT LA FAIT — un seul chemin pour
 * l'outil « memoire » (geste « chercher », `server/src/tools.ts`) et pour la
 * barre de recherche du graphe de l'écran Mémoire (`memoire.chercherCommeLAgent`).
 * L'écran doit allumer EXACTEMENT ce que l'agent recevrait : la même recherche
 * mêlée (mots + sens), les mêmes huit premières, puis le même tri de Jev.
 *
 * Le classement de `chercherUnitesMelees` ne dépend pas de sa limite (les
 * candidats sont bornés à part) : les huit premières d'une recherche à 40 sont
 * celles d'une recherche à 8. L'écran demande donc 40 résultats pour la carte,
 * et marque les huit que l'agent recevrait.
 */

/** Ce que l'outil de l'agent garde de la recherche mêlée, avant le tri de Jev. */
export const UNITES_RECUES_PAR_L_AGENT = 8;

/**
 * LA MÉMOIRE TRIÉE POUR LA DEMANDE. La recherche mêlée remonte aussi des unités
 * voisines par le vocabulaire mais sans rapport avec le travail : Jev écarte
 * celles qu'il juge franchement hors sujet. Une règle P0 ou « À ne jamais
 * supposer » passe toujours ; sans avis (Jev sans clé, en panne, usage éteint),
 * tout passe.
 */
export function garderLesUnitesPertinentes(
  demande: string,
  trouvees: readonly UniteTrouvee[],
  ctx: { cardId?: string; projectId?: string },
): Promise<UniteTrouvee[]> {
  return garderLesPertinents(
    demande,
    trouvees,
    {
      cle: (t) => t.unite.id,
      texte: (t) => `${t.unite.titre} — ${t.unite.resume}`,
      intouchable: (t) => t.unite.importance === 'P0' || t.unite.jamaisSupposer,
    },
    { usage: 'pertinence-memoire', ...ctx },
  );
}

export interface RechercheCommeLAgent {
  /** Les unités trouvées, dans l'ordre du classement (jusqu'à `limite`). */
  trouvees: UniteTrouvee[];
  /** Celles que l'agent recevrait réellement : les huit premières, triées par Jev. */
  recues: UniteTrouvee[];
}

/**
 * Chercher comme l'agent. `projectId` : la recherche d'un agent de ce projet
 * (le projet puis le Global, sans les compétences propres aux autres projets) ;
 * sans projet, toute la mémoire — ce que l'écran montre en vue d'ensemble.
 */
export async function chercherCommeLAgent(
  texte: string,
  o: { projectId?: string | null; limite?: number; types?: OptionsDeRecherche['types']; cardId?: string },
): Promise<RechercheCommeLAgent> {
  const limite = Math.max(UNITES_RECUES_PAR_L_AGENT, o.limite ?? UNITES_RECUES_PAR_L_AGENT);
  const trouvees = await chercherUnitesMelees(texte, o.projectId ? { projectId: o.projectId, types: o.types, limite } : { tous: true, types: o.types, limite });
  const recues = await garderLesUnitesPertinentes(texte, trouvees.slice(0, UNITES_RECUES_PAR_L_AGENT), {
    cardId: o.cardId,
    projectId: o.projectId ?? undefined,
  });
  return { trouvees, recues };
}
