/**
 * QUELLE IMAGE D'UNE VIDÉO SERT DE VIGNETTE ?
 *
 * Une vidéo s'affichait toujours à son tout premier instant (`#t=0.1`) : sur la
 * moitié des fichiers, c'est une image NOIRE — un fondu d'ouverture, un capteur
 * qui n'a pas encore ajusté, une transition. La vignette ne disait alors rien du
 * contenu, et dans la galerie carrée de l'espace client elle ne montrait QUE ça.
 *
 * Les règles qui suivent n'ont besoin ni de base, ni de disque, ni de DOM : ce
 * sont des maths sur une durée et sur un tableau de pixels. Elles vivent donc
 * ici, avec leur test (`server/src/test/apercu-video.test.ts`), et le lecteur
 * (`web/src/components/lecteur-video.tsx`) ne fait que les appliquer.
 *
 * AUCUNE IMAGE N'EST FABRIQUÉE NI STOCKÉE : l'aperçu d'une vidéo est un
 * INSTANT, en secondes. Aucun outil de découpe vidéo n'est installé sur la
 * machine, et mémoriser un instant évite d'en installer un, de produire des
 * fichiers en plus et de les tenir à jour.
 */

/** L'instant de repli : le comportement d'avant, gardé quand rien ne convient. */
export const SECONDE_DE_REPLI = 0.1;

/**
 * LE BUDGET TOTAL DE LA RECHERCHE. Au-delà, on abandonne et on retombe sur
 * l'instant de repli : un aperçu plus joli ne vaut pas un écran qui attend.
 */
export const BUDGET_DE_RECHERCHE_MS = 1_500;

/** La sonde est minuscule : on cherche s'il se passe quelque chose, pas à voir. */
export const LARGEUR_SONDE = 32;
export const HAUTEUR_SONDE = 18;

/**
 * L'ÉCART-TYPE DE LUMINANCE en deçà duquel l'image ne montre rien : noir,
 * blanc, ou un aplat d'une seule couleur. Mesuré sur 0–255. Un vrai plan, même
 * sombre, dépasse largement ce seuil.
 */
export const ECART_MINIMUM = 8;

/**
 * LES INSTANTS À SONDER, dans l'ordre où on les essaie.
 *
 * Des FRACTIONS de la durée, pour tomber dans le contenu quelle que soit la
 * longueur, mais PLAFONNÉES en secondes : sur un fichier d'une heure, sauter à
 * la demi-heure demande au navigateur d'aller chercher un morceau très loin
 * dans le fichier, ce qui est plus lent sans être plus parlant.
 */
export function instantsACandidater(duree: number): number[] {
  if (!Number.isFinite(duree) || duree <= 0) return [];
  const plafond = Math.max(0, duree - 0.05);
  const bruts = [Math.min(duree * 0.1, 10), Math.min(duree * 0.25, 30), Math.min(duree * 0.5, 60)];
  const propres = bruts
    .map((instant) => Math.min(Math.max(SECONDE_DE_REPLI, instant), Math.max(SECONDE_DE_REPLI, plafond)))
    .map((instant) => Math.round(instant * 100) / 100);
  return [...new Set(propres)];
}

/**
 * CETTE IMAGE MONTRE-T-ELLE QUELQUE CHOSE ?
 *
 * `pixels` est un tableau RVBA tel que le rend un canvas (4 octets par point).
 * On calcule la luminance de chaque point et son écart-type : une image
 * uniforme — noire, blanche, ou d'une seule couleur — a un écart nul, un vrai
 * plan a du relief. On ne juge donc pas la LUMINOSITÉ (un plan de nuit reste un
 * plan) mais la VARIÉTÉ.
 */
export function imageEstParlante(pixels: ArrayLike<number>, ecartMinimum = ECART_MINIMUM): boolean {
  const points = Math.floor(pixels.length / 4);
  if (points < 4) return false;
  let somme = 0;
  let sommeCarres = 0;
  for (let i = 0; i < points; i += 1) {
    const r = pixels[i * 4] ?? 0;
    const v = pixels[i * 4 + 1] ?? 0;
    const b = pixels[i * 4 + 2] ?? 0;
    const luminance = 0.2126 * r + 0.7152 * v + 0.0722 * b;
    somme += luminance;
    sommeCarres += luminance * luminance;
  }
  const moyenne = somme / points;
  const variance = Math.max(0, sommeCarres / points - moyenne * moyenne);
  return Math.sqrt(variance) >= ecartMinimum;
}

/**
 * L'INSTANT QUI DOIT S'AFFICHER, une fois tout connu.
 *
 * Trois sources, dans cet ordre : le choix de la MAIN (il l'emporte toujours),
 * l'instant déjà trouvé par la recherche automatique, puis le repli. C'est la
 * même règle aux quatre endroits où une vidéo se montre — c'est justement ce
 * qui garantit qu'ils affichent la même image.
 */
export function instantDApercu(source: {
  choisi?: number | null;
  trouve?: number | null;
}): number {
  const { choisi, trouve } = source;
  if (typeof choisi === 'number' && Number.isFinite(choisi) && choisi >= 0) return choisi;
  if (typeof trouve === 'number' && Number.isFinite(trouve) && trouve >= 0) return trouve;
  return SECONDE_DE_REPLI;
}
