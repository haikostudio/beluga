/**
 * LA COULEUR D'UNE BARRE DIT SON INTENSITÉ.
 *
 * Les barres du tableau de bord étaient toutes du même gris : seule la hauteur
 * (ou la largeur) distinguait un jour très chargé d'un jour calme. On leur donne
 * une couleur qui APPREND quelque chose — un dégradé continu de la couleur
 * « calme » vers la couleur « chargée ».
 *
 * Règle pure, sans base ni disque : elle ne connaît AUCUNE teinte. Elle rend une
 * couleur CSS qui mélange deux JETONS de thème (`--intensite-calme` et
 * `--intensite-chargee`, `web/src/styles.css`), lesquels reprennent eux-mêmes des
 * jetons d'état existants. Les deux thèmes suivent donc tout seuls, et aucun code
 * couleur n'est écrit en dur.
 */

/** Le jeton de la valeur la plus basse. */
export const JETON_CALME = 'hsl(var(--intensite-calme))';
/** Le jeton de la valeur la plus haute. */
export const JETON_CHARGEE = 'hsl(var(--intensite-chargee))';

/**
 * La part d'intensité d'une valeur, entre 0 (le plus calme) et 1 (le maximum
 * observé). Un maximum nul ou négatif ne se divise pas : tout est alors calme.
 */
export function partIntensite(valeur: number, max: number): number {
  if (!Number.isFinite(valeur) || !Number.isFinite(max) || max <= 0) return 0;
  if (valeur <= 0) return 0;
  return Math.min(1, valeur / max);
}

/**
 * La couleur d'une barre, du calme au chargé. Le mélange se fait en `oklab`,
 * le seul espace où un dégradé entre deux teintes ne passe pas par un gris sale.
 */
export function couleurIntensite(valeur: number, max: number): string {
  const part = Math.round(partIntensite(valeur, max) * 100);
  return `color-mix(in oklab, ${JETON_CHARGEE} ${part}%, ${JETON_CALME})`;
}
