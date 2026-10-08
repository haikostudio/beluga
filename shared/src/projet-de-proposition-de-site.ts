/**
 * OÙ NAÎT UNE CARTE PROPOSÉE PAR L'AGENT D'UN SITE SURVEILLÉ.
 *
 * La conversation de l'agent d'un site vit presque toujours chez Beluga Build
 * (`SiteSurveille.projectId`). Une carte acceptée naissait donc chez Beluga
 * Build : aucune branche du dépôt du site ne portait ensuite la modification
 * (cartes InVia du 07.10.2026). Elle naît désormais dans LE PROJET DU SITE
 * (`SiteSurveille.projetRattache`, choisi à la main ou deviné d'après
 * l'adresse) — et un site relié à rien ne propose aucune carte tant que
 * l'utilisateur n'a pas dit lequel.
 *
 * Seul l'agent INSCRIT sur la fiche d'un site (`agentId`) est concerné : le
 * chef, l'analyse de nuit, le cadrage ou l'agent d'une source de bibliothèque
 * gardent le projet de leur conversation.
 */

export interface SiteDeLAgent {
  id: string;
  nom: string;
  agentId?: string;
  projetRattache?: string;
}

export type ProjetDeProposition =
  /** L'agent ne suit aucun site : la carte naît dans le projet de sa conversation. */
  | { genre: 'conversation'; projectId: string }
  /** L'agent suit un site relié : la carte naît dans le projet du site. */
  | { genre: 'site'; projectId: string; sites: string[] }
  /** Au moins un site suivi n'est relié à aucun projet existant. */
  | { genre: 'non-relie'; sites: SiteDeLAgent[] }
  /** Les sites suivis sont reliés à des projets différents : aucun choix sûr. */
  | { genre: 'plusieurs'; projets: string[]; sites: string[] };

export function projetDeProposition(entree: {
  agentId: string;
  agentProjectId: string;
  sites: readonly SiteDeLAgent[];
  projetExiste: (projectId: string) => boolean;
}): ProjetDeProposition {
  const suivis = entree.sites.filter((site) => site.agentId === entree.agentId);
  if (!suivis.length) return { genre: 'conversation', projectId: entree.agentProjectId };
  const nonRelies = suivis.filter((site) => !site.projetRattache || !entree.projetExiste(site.projetRattache));
  if (nonRelies.length) return { genre: 'non-relie', sites: nonRelies };
  const projets = [...new Set(suivis.map((site) => site.projetRattache as string))];
  const noms = suivis.map((site) => site.nom);
  if (projets.length > 1) return { genre: 'plusieurs', projets, sites: noms };
  return { genre: 'site', projectId: projets[0], sites: noms };
}

/**
 * LE REFUS RENDU À L'AGENT, qui dit la marche à suivre au lieu de le laisser
 * réessayer la même proposition en boucle.
 */
export function refusDeProposition(
  verdict: ProjetDeProposition,
  nomDuProjet: (projectId: string) => string,
): string | null {
  if (verdict.genre === 'non-relie') {
    const sites = verdict.sites.map((site) => `« ${site.nom} » (identifiant ${site.id})`).join(', ');
    return (
      `Proposition NON affichée : ${sites} n'est relié à aucun projet, et une carte d'un site naît dans le projet du site, ` +
      'jamais chez Beluga Build. Demande d’abord à l’utilisateur avec « ask_user » quel projet sert ce site ' +
      '(« project_manage » liste les projets ; mets en tête celui que son adresse suggère), puis relie-le avec ' +
      '« surveillance_recette » : { id: <identifiant du site>, projet: <nom ou identifiant du projet> }. ' +
      'Repropose ensuite la carte, telle quelle.'
    );
  }
  if (verdict.genre === 'plusieurs') {
    return (
      `Proposition NON affichée : cette conversation suit plusieurs sites (${verdict.sites.join(', ')}) reliés à des projets ` +
      `différents (${verdict.projets.map(nomDuProjet).join(', ')}), et une carte ne naît que dans un seul. ` +
      'Dis-le à l’utilisateur : la carte se propose depuis la conversation du projet concerné.'
    );
  }
  return null;
}
