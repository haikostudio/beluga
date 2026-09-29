/**
 * LE GROUPE « LOCAL » : la maison de l'espace de développement.
 *
 * Le projet posé sur le dossier de Beluga Build (marque `isSelf`) vit toujours
 * dans un groupe de la colonne de gauche, nommé « Local » à sa naissance. Ce
 * groupe n'a AUCUNE colonne à lui en base : c'est tout simplement le groupe
 * où se trouve le projet `isSelf`. Renommé, recoloré, replié, il reste le sien.
 *
 * Trois règles, pures et testées (`server/src/test/groupe-local.test.ts`) :
 *  - au démarrage, le démon garantit ce groupe : il garde celui où Beluga est
 *    déjà, sinon il reprend un groupe nommé « Local » (sans doubler celui qu'on
 *    aurait créé à la main), sinon il en crée un, en tête de colonne ;
 *  - ce groupe ne se supprime pas ;
 *  - Beluga n'en sort pas : ni par le glisser, ni par l'outil des agents.
 */

export const NOM_GROUPE_LOCAL = 'Local';

export const REFUS_SUPPRESSION_GROUPE_LOCAL =
  "Refusé : le groupe « Local » abrite l'espace de développement de Beluga, il ne se supprime pas. " +
  'On peut le renommer, changer sa couleur, le replier ou y glisser d’autres projets.';

export const REFUS_SORTIE_GROUPE_LOCAL =
  "Refusé : l'espace de développement de Beluga reste fixé en tête de son groupe « Local » — il ne se déplace pas.";

type GroupeMin = { id: string; name: string; rank: number };
type ProjetMin = { isSelf?: boolean; archived?: boolean; groupId?: string };

/** L'identifiant du groupe « Local » : celui où vit le projet `isSelf`. */
export function idDuGroupeLocal(projets: readonly ProjetMin[], groupes: readonly GroupeMin[]): string | undefined {
  const soi = projets.find((p) => p.isSelf && !p.archived) ?? projets.find((p) => p.isSelf);
  if (!soi?.groupId) return undefined;
  return groupes.some((g) => g.id === soi.groupId) ? soi.groupId : undefined;
}

export type ChoixGroupeLocal =
  | { geste: 'garder'; id: string }
  | { geste: 'reprendre'; id: string }
  | { geste: 'creer'; nom: string; rang: number };

/**
 * Ce que le démarrage fait pour garantir le groupe « Local » : garder le
 * groupe actuel de Beluga, reprendre un groupe déjà nommé « Local » (casse et
 * espaces ignorés — le premier par rang), ou en créer un AVANT tous les autres.
 */
export function choisirGroupeLocal(
  groupeActuelDeSoi: string | undefined,
  groupes: readonly GroupeMin[],
  rangsDeLaColonne: readonly number[],
): ChoixGroupeLocal {
  if (groupeActuelDeSoi && groupes.some((g) => g.id === groupeActuelDeSoi)) {
    return { geste: 'garder', id: groupeActuelDeSoi };
  }
  const homonyme = [...groupes]
    .sort((a, b) => a.rank - b.rank)
    .find((g) => g.name.trim().toLowerCase() === NOM_GROUPE_LOCAL.toLowerCase());
  if (homonyme) return { geste: 'reprendre', id: homonyme.id };
  const plusPetit = rangsDeLaColonne.length ? Math.min(...rangsDeLaColonne) : 10;
  return { geste: 'creer', nom: NOM_GROUPE_LOCAL, rang: plusPetit - 10 };
}
