/**
 * NOMMER : un titre ramené à un nom sans accent, sans majuscule, sans
 * ponctuation.
 *
 * Ces règles servaient l'ancien arbre de mémoire en fichiers ; elles restent
 * utiles pour comparer des titres (`regles.ts`, la mesure des classeurs).
 */

/**
 * Un nom de fichier : sans accent, sans majuscule, sans ponctuation. C'est ce
 * qui rend le chemin tapable de mémoire, et identique sur tous les systèmes.
 */
export function slug(texte: string): string {
  return slugEntier(texte).slice(0, 40).replace(/-+$/g, '');
}

/**
 * Le même nettoyage, SANS la coupe à quarante signes : pour comparer un titre
 * de règle ou le texte d'une carte, où le mot cherché peut être loin du début.
 * Un nom de fichier, lui, garde `slug`.
 */
export function slugEntier(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
