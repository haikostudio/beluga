/**
 * LA COULEUR QUE LE REPÈRE DE L'HEURE DONNE À L'IPHONE : le mélange des fonds réellement empilés en haut de l'écran.
 * Sans navigateur ni base : testée seule (`server/src/test/couleur-de-la-barre.test.ts`), appelée par
 * `web/src/lib/barre-de-l-heure.ts`.
 */
export type Rgba = readonly [number, number, number, number];

/** Lit un fond calculé (`rgb(…)`, `rgba(…)`, virgules ou espaces). Tout autre format rend `null`. */
export function lireRgba(couleur: string): Rgba | null {
  const m = couleur.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
}

/**
 * Compose les couches, LA PLUS HAUTE D'ABORD, jusqu'à la première opaque, et rend un `#rrggbb` toujours opaque.
 * `fond` est ce qui reste dessous quand aucune couche n'est opaque (le fond de la page), blanc à défaut.
 */
export function composerLaCouleurDeLaBarre(couches: readonly Rgba[], fond: Rgba | null): string {
  const pile: Rgba[] = [];
  for (const couche of couches) {
    if (couche[3] <= 0) continue;
    pile.push(couche);
    if (couche[3] >= 0.99) break;
  }
  const dernier = pile[pile.length - 1];
  const base = dernier && dernier[3] >= 0.99 ? pile.pop()! : fond && fond[3] >= 0.99 ? fond : ([255, 255, 255, 1] as const);
  let rvb: [number, number, number] = [base[0], base[1], base[2]];
  for (let i = pile.length - 1; i >= 0; i -= 1) {
    const [r, v, b, a] = pile[i]!;
    rvb = [r * a + rvb[0] * (1 - a), v * a + rvb[1] * (1 - a), b * a + rvb[2] * (1 - a)];
  }
  return `#${rvb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}
