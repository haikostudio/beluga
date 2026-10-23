/**
 * L'ONDE D'UN SON, CALCULÉE SANS ÉCRAN.
 *
 * Le lecteur son du fil (voix off, musique, bruitages fabriqués par l'agent)
 * dessine l'onde du fichier sur toute sa largeur : un bâton par tranche du son,
 * haut comme le plus fort échantillon de la tranche. Le navigateur décode le
 * fichier ; ces règles, elles, ne regardent que des nombres : elles se testent
 * seules.
 *
 * - `picsDOnde` : n hauteurs entre 0 et 1, normalisées sur le pic le plus haut
 *   (un son faible se voit quand même), avec un plancher pour que le silence
 *   reste un trait visible.
 * - `ondeDeRepli` : la même forme, inventée mais STABLE pour un même fichier,
 *   quand le son ne peut pas être décodé (trop lourd, format refusé) — le lecteur
 *   garde sa silhouette au lieu d'un trou.
 * - `instantDuPointeur` : l'instant visé par un clic ou un glisser sur l'onde.
 */

/** Le plus petit bâton, en part de la hauteur : un silence reste un trait. */
export const PLANCHER_D_ONDE = 0.08;

/** Au-delà, le fichier ne se décode pas pour son onde (mémoire du téléphone) : on prend `ondeDeRepli`. */
export const POIDS_MAX_POUR_L_ONDE = 25 * 1024 * 1024;

const borner = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function picsDOnde(echantillons: ArrayLike<number>, n: number): number[] {
  const compte = Math.max(0, Math.floor(n));
  if (!compte) return [];
  const longueur = echantillons.length;
  if (!longueur) return Array.from({ length: compte }, () => PLANCHER_D_ONDE);
  const bruts: number[] = [];
  let plusHaut = 0;
  for (let i = 0; i < compte; i += 1) {
    const debut = Math.floor((i * longueur) / compte);
    const fin = Math.max(debut + 1, Math.floor(((i + 1) * longueur) / compte));
    let pic = 0;
    // Un pas d'échantillonnage borne le calcul : 2 000 lectures par bâton au plus.
    const pas = Math.max(1, Math.floor((fin - debut) / 2000));
    for (let j = debut; j < fin && j < longueur; j += pas) {
      const v = Math.abs(echantillons[j] ?? 0);
      if (v > pic) pic = v;
    }
    bruts.push(pic);
    if (pic > plusHaut) plusHaut = pic;
  }
  return bruts.map((pic) => (plusHaut > 0 ? borner(pic / plusHaut, PLANCHER_D_ONDE, 1) : PLANCHER_D_ONDE));
}

/** Une onde inventée, toujours la même pour la même graine (l'identifiant du fichier). */
export function ondeDeRepli(graine: string, n: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < graine.length; i += 1) h = Math.imul(h ^ graine.charCodeAt(i), 16777619);
  const rendu: number[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(n)); i += 1) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const bruit = (h % 1000) / 1000;
    // Une enveloppe douce, plus haute au milieu, pour que la forme ressemble à un son.
    const enveloppe = 0.45 + 0.4 * Math.sin((Math.PI * (i + 0.5)) / Math.max(1, n));
    rendu.push(borner(enveloppe * (0.55 + 0.45 * bruit), PLANCHER_D_ONDE, 1));
  }
  return rendu;
}

/** L'instant (en secondes) sous le pointeur, borné au son. */
export function instantDuPointeur(x: number, largeur: number, duree: number): number {
  if (!(largeur > 0) || !Number.isFinite(duree) || duree <= 0) return 0;
  return borner(x / largeur, 0, 1) * duree;
}
