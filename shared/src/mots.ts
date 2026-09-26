/**
 * LES MOTS D'UN TEXTE — l'outillage nu, sans moteur de recherche derrière.
 *
 * Ce module est ce qui RESTE de l'ancienne recherche de passages, une fois la
 * recherche par le sens retirée : réduire un texte à ses mots utiles ne sert
 * plus à noter des extraits, seulement à repérer que deux cartes parlent de la
 * même chose (`contradiction-cartes.ts`). Il ne touche ni au disque, ni à la
 * base, ni à aucun modèle.
 */

const MOTS_VIDES = new Set([
  'alors', 'apres', 'aucun', 'aucune', 'aussi', 'autre', 'autres', 'avait', 'avant', 'avec', 'avoir',
  'bien', 'cela', 'celle', 'celui', 'cette', 'ceux', 'chaque', 'comme', 'dans', 'depuis', 'deux',
  'doit', 'donc', 'dont', 'elle', 'elles', 'encore', 'entre', 'etait', 'etre', 'faire', 'fait',
  'jamais', 'leur', 'leurs', 'mais', 'meme', 'moins', 'nest', 'notre', 'nous', 'para', 'parce',
  'pour', 'pourquoi', 'plus', 'quand', 'quelle', 'quelles', 'quels', 'sans', 'sera', 'seulement',
  'sont', 'sous', 'suis', 'tout', 'toute', 'toutes', 'tous', 'trop', 'very', 'vers', 'votre', 'vous',
  'ainsi', 'chez', 'deja', 'faut', 'lors', 'lorsque', 'pendant', 'peut', 'puis', 'selon', 'sinon',
  'toujours', 'quel', 'quels', 'quelque', 'quelques', 'ceci', 'cest', 'etc',
  // Trois lettres, mais partout : les garder rapprochait deux textes parce
  // qu'ils étaient écrits en français, pas parce qu'ils parlaient du même sujet.
  'les', 'des', 'une', 'est', 'que', 'qui', 'par', 'sur', 'aux', 'ses', 'son',
  'ces', 'pas', 'ont', 'the', 'and', 'for', 'are', 'not', 'its',
  'this', 'that', 'with', 'from', 'have', 'been', 'were', 'they', 'their', 'when', 'then', 'than',
]);

/** Le texte réduit à ce qui se compare : minuscules, sans accents ni ponctuation. */
export function normaliserPourRecherche(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9/._-]+/g, ' ')
    .trim();
}

/** Les mots PORTEURS d'un texte : ni les trop courts, ni ceux qu'on écrit partout. */
export function motsDuTexte(texte: string): string[] {
  return normaliserPourRecherche(texte)
    .split(/\s+/)
    .filter((mot) => mot.length > 2 && !MOTS_VIDES.has(mot));
}

/**
 * Minuscules, sans accent, ponctuation effacée : sept copies privées de cette
 * même recette dormaient dans autant de fichiers avant de rejoindre ici.
 * Ni `/`, `.`, `_`, `-` (gardés par `normaliserPourRecherche`) ni la
 * ponctuation ordinaire ne survivent : seuls les lettres et chiffres comptent.
 */
export function aplatiCompact(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Minuscules, accents et apostrophes uniformisés, mais la PONCTUATION gardée
 * — `aplatiCompact` l'efface, celle-ci non : pour comparer des lignes sans se
 * tromper sur une apostrophe ou une majuscule, sans perdre le reste du texte.
 */
export function aplatiLigne(ligne: string): string {
  return ligne
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
