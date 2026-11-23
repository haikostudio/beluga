import assert from 'node:assert/strict';
import test from 'node:test';
import { CARTE_DU_PAQUET, ECART_ETALE, hauteurDuPaquet, largeurEtalee, placesDuPaquet } from '@beluga/shared';

/* LE PAQUET D'IMAGES DU FIL (cartes « Images groupées dans le fil » puis « Images du fil en grand format ») : pile de
   trois cartes visibles ; étalées, les images gardent leur taille pleine et la rangée défile si elle dépasse. */

test('en pile, trois cartes se voient, la première devant, sans rotation', () => {
  const places = placesDuPaquet(5, false);
  assert.equal(places.filter((p) => p.visible).length, 3);
  assert.deepEqual([places[0]!.x, places[0]!.y, places[0]!.angle], [0, 0, 0]);
  assert.ok(places[0]!.plan > places[1]!.plan);
  assert.ok(places[1]!.x > 0 && places[1]!.angle !== 0);
});

test('étalées, les images gardent leur taille pleine, à pas constant, sans se chevaucher', () => {
  for (const nombre of [2, 5, 12]) {
    const places = placesDuPaquet(nombre, true);
    assert.ok(places.every((p) => p.visible && p.angle === 0 && p.echelle === 1), `${nombre} images à l’échelle 1`);
    places.forEach((p, rang) => assert.equal(p.x, rang * (CARTE_DU_PAQUET.largeur + ECART_ETALE)));
    assert.ok(places[0]!.plan > places[1]!.plan);
  }
});

test('la rangée étalée mesure ses cartes pleines et leurs écarts, et finit sur la dernière', () => {
  assert.equal(largeurEtalee(0), 0);
  assert.equal(largeurEtalee(1), CARTE_DU_PAQUET.largeur);
  assert.equal(largeurEtalee(12), 12 * 224 + 11 * 8);
  for (const nombre of [2, 7, 12]) {
    const derniere = placesDuPaquet(nombre, true).at(-1)!;
    assert.equal(derniere.x + CARTE_DU_PAQUET.largeur, largeurEtalee(nombre));
  }
});

test('la hauteur ne change pas entre la pile et l’étalement', () => {
  const h = hauteurDuPaquet();
  for (const p of placesDuPaquet(6, true)) assert.ok(p.y >= 0 && p.y + CARTE_DU_PAQUET.hauteur <= h);
  for (const p of placesDuPaquet(6, false)) assert.ok(p.y + CARTE_DU_PAQUET.hauteur <= h);
});
