/**
 * UNE COURBE ARRONDIE QUI NE MENT PAS (demande du 28/09/2026).
 *
 * Les graphiques des Statistiques reliaient leurs points par des segments :
 * un angle net à chaque jour. Un lissage ordinaire (spline « naturelle » ou de
 * Catmull-Rom) arrondit, mais DÉPASSE : entre un jour à 0 et un jour à 12, la
 * courbe plonge sous zéro ou monte au-dessus du pic, et le graphique affiche
 * des visites qui n'ont pas eu lieu.
 *
 * On trace donc une cubique MONOTONE (tangentes de Steffen) : entre deux
 * points, la courbe ne sort jamais de l'intervalle de leurs deux valeurs. Elle
 * ne passe donc jamais sous le plus bas ni au-dessus du plus haut, et un
 * palier (deux jours égaux) reste plat.
 *
 * Rend le chemin SVG (`M … C …`) ; les abscisses doivent croître.
 */
export function cheminLisse(points: { x: number; y: number }[], decimales = 2): string {
  const n = points.length;
  if (!n) return '';
  const f = (v: number) => v.toFixed(decimales);
  if (n === 1) return `M${f(points[0]!.x)},${f(points[0]!.y)}`;

  const pentes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = points[i + 1]!.x - points[i]!.x;
    pentes.push(h ? (points[i + 1]!.y - points[i]!.y) / h : 0);
  }
  const tangentes = points.map((_, i) => {
    // Aux deux bouts, la pente du seul segment voisin : jamais de dépassement.
    if (i === 0) return pentes[0]!;
    if (i === n - 1) return pentes[n - 2]!;
    const s0 = pentes[i - 1]!;
    const s1 = pentes[i]!;
    const h0 = points[i]!.x - points[i - 1]!.x;
    const h1 = points[i + 1]!.x - points[i]!.x;
    const p = h0 + h1 ? (s0 * h1 + s1 * h0) / (h0 + h1) : 0;
    // Un sommet ou un creux (pentes de signes contraires) : tangente plate.
    return (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p));
  });

  let chemin = `M${f(points[0]!.x)},${f(points[0]!.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const tiers = (b.x - a.x) / 3;
    chemin += ` C${f(a.x + tiers)},${f(a.y + tangentes[i]! * tiers)} ${f(b.x - tiers)},${f(b.y - tangentes[i + 1]! * tiers)} ${f(b.x)},${f(b.y)}`;
  }
  return chemin;
}
