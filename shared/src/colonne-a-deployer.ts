/**
 * LA COLONNE « À DÉPLOYER » NE DOIT RIEN CACHER.
 *
 * Le fait constaté : la tête de colonne annonçait « À DÉPLOYER 1 » pendant que
 * la colonne, juste dessous, écrivait « Rien à mettre en ligne pour l'instant ».
 * Deux phrases, une seule colonne, et la seule chose que l'utilisateur pouvait
 * en conclure était fausse dans les deux sens.
 *
 * La cause est simple : le CHIFFRE et la LISTE ne lisaient pas la même chose.
 * Le chiffre venait du bloc de publication (cartes du lot + travail enregistré
 * sans carte), la liste des cartes réellement posées dans la colonne. Dès
 * qu'un enregistrement attendait sans carte pour le porter, le chiffre le
 * comptait et la liste ne pouvait pas le montrer — il n'y avait aucune carte à
 * afficher.
 *
 * Deux règles en découlent, et elles tiennent ensemble :
 *
 * 1. LE COMPTEUR COMPTE CE QUE LA LISTE MONTRE, toujours — une carte affichée
 *    est comptée, un compte sans carte n'existe pas. Le chiffre du BOUTON, lui,
 *    reste celui du lot qui partira : ce n'est pas le même objet, et il NOMME
 *    déjà ses deux parts (`libelleCompteLot`).
 *
 * 2. CE QUI N'A PAS DE CARTE SE DIT EN CLAIR, dans la colonne. Le travail
 *    enregistré sans carte n'est plus soustrait du compteur pour être oublié :
 *    il est nommé, avec ce qui a été trouvé et où le chercher. Une colonne qui
 *    cache une modification expose à mettre en ligne — ou à oublier — quelque
 *    chose qu'on n'a jamais vu.
 *
 * Règles PURES : ni base, ni disque, ni navigateur — donc rejouables seules.
 */

/** Le travail enregistré sur la branche principale sans carte pour le porter. */
export interface TravailSansCarte {
  nombre: number;
  titres: string[];
}

/** L'avertissement à poser DANS la colonne, au-dessus des cartes. */
export interface AlerteSansCarte {
  /** La première ligne, en gras : combien, et de quoi il s'agit. */
  titre: string;
  /** La phrase qui dit où c'est et ce qui va s'en passer. */
  phrase: string;
  /** Les titres réellement trouvés, tels quels — jamais un résumé inventé. */
  titres: string[];
  /** Vrai quand tous les titres trouvés ne tiennent pas dans la liste. */
  tronquee: boolean;
}

/**
 * LE CHIFFRE DE LA TÊTE DE COLONNE.
 *
 * Il ne connaît qu'une source : le nombre de cartes que la colonne affiche.
 * La fonction est courte au point de paraître inutile — c'est justement son
 * intérêt : elle NOMME l'invariant, et le test qui la couvre interdit qu'on
 * lui rajoute un jour une seconde source « juste pour cette colonne-là ».
 */
export function compteurDeColonne(cartesAffichees: number): number {
  return Math.max(0, Math.trunc(cartesAffichees));
}

/**
 * Le compteur et la liste sont-ils d'accord ? Dans LES DEUX SENS : pas de
 * carte affichée qui ne soit comptée, pas de compte sans carte.
 */
export function compteurEtListeDAccord(compteur: number, cartesAffichees: number): boolean {
  return compteur === compteurDeColonne(cartesAffichees);
}

/** Au plus six titres dans l'encart : au-delà, on dit qu'il y en a d'autres. */
export const TITRES_MONTRES_MAX = 6;

/**
 * L'AVERTISSEMENT « du travail attend sans carte ».
 *
 * Rend `null` quand il n'y a rien à dire — jamais un encart vide qui prendrait
 * la place des cartes. Le verbe de l'étape est passé par l'appelant (déployer /
 * publier) : la règle ne connaît pas les colonnes.
 */
export function alerteTravailSansCarte(
  travail: TravailSansCarte | null | undefined,
  verbe = 'déployer',
): AlerteSansCarte | null {
  const nombre = Math.max(0, Math.trunc(travail?.nombre ?? 0));
  if (!nombre) return null;
  const pluriel = nombre > 1;
  const titres = (travail?.titres ?? []).map((t) => t.trim()).filter(Boolean);
  return {
    titre: `${nombre} modification${pluriel ? 's' : ''} sans carte pour ${pluriel ? 'les' : 'la'} porter`,
    phrase: `${pluriel ? 'Elles sont enregistrées' : 'Elle est enregistrée'} sur la branche principale et ${
      pluriel ? 'partiront' : 'partira'
    } au prochain ${verbe === 'publier' ? 'passage en production' : 'déploiement'}, sans qu’aucune carte ne ${
      pluriel ? 'les' : 'la'
    } montre.`,
    titres: titres.slice(0, TITRES_MONTRES_MAX),
    tronquee: titres.length > TITRES_MONTRES_MAX || nombre > titres.length,
  };
}

/**
 * LE BOUTON DE L'AVERTISSEMENT : donner une fiche à ce travail.
 *
 * Nommer le problème sans offrir de le régler laissait l'utilisateur devant un
 * encart qu'il ne pouvait que subir. Le libellé dit ce qui va se passer — une
 * CARTE, pas une publication — et suit le nombre trouvé.
 */
export function libelleCartePorteuse(nombre: number): string {
  return nombre > 1 ? 'Créer la carte qui les porte' : 'Créer la carte qui le porte';
}

/**
 * La DESCRIPTION de cette carte : d'où elle vient, ce qu'elle embarque, et ce
 * qu'elle ne promet pas.
 *
 * Elle est proche de `descriptionHorsTache` mais ne dit pas la même chose : ce
 * travail-ci n'a pas été fiché automatiquement à la fin d'un tour, il a été
 * TROUVÉ dans la colonne et fiché d'un clic. Rien n'a été déplacé pour autant —
 * la carte le dit, pour qu'on ne croie pas pouvoir l'écarter en la supprimant.
 */
export function descriptionCartePorteuse(
  commits: { sha: string; titre: string }[],
  branche?: string,
): string {
  const lignes = commits.map((commit) => `- ${commit.titre.trim()} (${commit.sha.slice(0, 7)})`);
  const ou = branche ? `la branche « ${branche} »` : 'la branche principale';
  return [
    `Cette carte a été créée depuis la colonne « À déployer » pour porter du travail qui y attendait sans fiche : il était enregistré, prêt à partir en ligne, et aucune carte ne le montrait.`,
    '',
    `Le code est DÉJÀ enregistré sur ${ou} — il n'y a rien à exécuter. Supprimer cette carte ne retire pas ce travail : il faudrait annuler les enregistrements eux-mêmes.`,
    '',
    'Enregistrements repris :',
    ...lignes,
  ].join('\n');
}

/**
 * LA PHRASE D'UNE COLONNE VIDE.
 *
 * « Rien à mettre en ligne pour l'instant » était le mensonge le plus direct :
 * écrit alors même que du travail attendait. Tant qu'il reste quelque chose,
 * la colonne ne dit plus « rien » — elle renvoie à l'avertissement posé
 * au-dessus, qui, lui, nomme ce qui a été trouvé.
 */
export function phraseDeColonneVide(travail: TravailSansCarte | null | undefined): string {
  const nombre = Math.max(0, Math.trunc(travail?.nombre ?? 0));
  if (!nombre) return 'Rien à mettre en ligne pour l’instant.';
  return nombre > 1
    ? 'Aucune carte ici, mais les modifications ci-dessus attendent d’être mises en ligne.'
    : 'Aucune carte ici, mais la modification ci-dessus attend d’être mise en ligne.';
}
