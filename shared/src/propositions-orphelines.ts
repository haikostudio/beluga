/*
 * LES PROPOSITIONS DE CARTE RESTÉES EN SUSPENS SE RETIRENT QUAND LE TRAVAIL EST RENDU (carte « Icônes, contrastes et
 * artefacts », 15/11/2026, capture #9022). La « Remise à plat des services » était rangée en « À déployer », travail
 * fait, mais gardait le cadre orange « à vous » : son cadrage avait proposé deux suites d'étapes que personne n'avait
 * tranchées, et que le travail avait pourtant couvertes dans la carte elle-même.
 *
 * Quand une carte rend son travail (rangée en « À déployer » ou en « Archivé »), une proposition encore EN ATTENTE
 * posée dans la conversation de SES agents et qui vise LE MÊME PROJET est retirée (refusée, marquée `retireeAuRendu`,
 * avec une ligne dans le fil). Une proposition qui vise UN AUTRE PROJET reste : ce travail-là reste à faire ailleurs.
 * Une proposition dont le projet d'accueil ne se lit pas (`null`) reste aussi : on ne retire rien dans le doute.
 *
 * Règle pure ; le va-et-vient vit dans `server/src/propositions-orphelines.ts`.
 */

/** Ce que la règle lit d'une proposition. */
export interface PropositionAuRendu {
  id: string;
  decision: string;
  /** Le projet où la carte naîtrait si on l'acceptait ; `null` s'il ne se lit pas. */
  projetDAccueil: string | null;
}

/** Les colonnes où une carte a RENDU son travail. */
export const COLONNES_D_UN_TRAVAIL_RENDU = ['to_deploy', 'archived'] as const;

export function travailRendu(colonne: string): boolean {
  return (COLONNES_D_UN_TRAVAIL_RENDU as readonly string[]).includes(colonne);
}

/** Les identifiants des propositions à retirer, dans l'ordre reçu. */
export function propositionsARetirerAuRendu(propositions: readonly PropositionAuRendu[], projetDeLaCarte: string): string[] {
  return propositions
    .filter((p) => p.decision === 'pending' && p.projetDAccueil !== null && p.projetDAccueil === projetDeLaCarte)
    .map((p) => p.id);
}

/** La ligne posée dans le fil de l'agent qui portait la proposition. */
export const LIGNE_PROPOSITION_RETIREE = 'Proposition retirée : le travail a été rendu dans cette carte.';
