import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheminLisse } from '@beluga/shared';

/** Échantillonne une cubique de Bézier pour vérifier qu'elle reste dans ses bornes. */
function echantillons(chemin: string): number[] {
  const nombres = chemin.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const ys: number[] = [];
  let y0 = nombres[1]!;
  for (let i = 2; i + 6 <= nombres.length; i += 6) {
    const [, c1y, , c2y, , y1] = nombres.slice(i, i + 6) as number[];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      const u = 1 - t;
      ys.push(u * u * u * y0 + 3 * u * u * t * c1y! + 3 * u * t * t * c2y! + t * t * t * y1!);
    }
    y0 = y1!;
  }
  return ys;
}

test('la courbe arrondie passe par chaque point, en cubiques', () => {
  const chemin = cheminLisse([
    { x: 0, y: 10 },
    { x: 50, y: 20 },
    { x: 100, y: 5 },
  ]);
  assert.match(chemin, /^M0\.00,10\.00 C.* 50\.00,20\.00 C.* 100\.00,5\.00$/);
});

test('elle ne dépasse jamais les vraies valeurs : ni sous le plus bas, ni au-dessus du plus haut', () => {
  // Une pointe isolée entre deux jours à zéro : un lissage ordinaire plonge sous zéro.
  const valeurs = [0, 0, 12, 0, 0, 3, 3, 40, 0];
  const H = 40;
  const points = valeurs.map((v, i) => ({ x: i * 10, y: H - v }));
  const ys = echantillons(cheminLisse(points));
  assert.ok(Math.max(...ys) <= H + 1e-6, 'jamais sous zéro');
  assert.ok(Math.min(...ys) >= 0 - 1e-6, 'jamais au-dessus du pic');
});

test('un palier reste plat', () => {
  const ys = echantillons(cheminLisse([{ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 20, y: 5 }]));
  assert.ok(ys.every((y) => Math.abs(y - 5) < 1e-9));
});

test('zéro ou un seul point ne trace rien de courbe', () => {
  assert.equal(cheminLisse([]), '');
  assert.equal(cheminLisse([{ x: 50, y: 3 }]), 'M50.00,3.00');
});
