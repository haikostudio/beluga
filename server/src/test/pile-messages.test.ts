import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PILE_DECALAGE,
  PILE_ECART,
  PILE_VISIBLES,
  hauteurDeLaPile,
  heureEtDate,
  placeDansLaPile,
  resteDeLaPile,
} from '@haikodev/shared';

test('pile fermée : le plus récent est devant, entier et opaque', () => {
  const place = placeDansLaPile(0, [40, 40, 40], false);
  assert.equal(place.decalage, 0);
  assert.equal(place.echelle, 1);
  assert.equal(place.opacite, 1);
  assert.equal(place.visible, true);
});

test('pile fermée : chaque message du dessous dépasse de quelques pixels, plus petit et plus pâle', () => {
  const deuxieme = placeDansLaPile(1, [40, 40, 40], false);
  assert.equal(deuxieme.decalage, PILE_DECALAGE);
  assert.ok(deuxieme.echelle < 1);
  assert.ok(deuxieme.opacite < 1);
  const troisieme = placeDansLaPile(2, [40, 40, 40], false);
  assert.equal(troisieme.decalage, 2 * PILE_DECALAGE);
  assert.ok(troisieme.echelle < deuxieme.echelle);
  assert.ok(troisieme.opacite < deuxieme.opacite);
});

test('un message plus court que celui de devant dépasse quand même', () => {
  // Aligné par le BAS, puis poussé : sans cela, un message court disparaissait
  // entièrement derrière un message long.
  const place = placeDansLaPile(1, [60, 20], false);
  assert.equal(place.decalage, 60 - 20 + PILE_DECALAGE);
});

test('au-delà de trois, les messages ne se voient plus : ils sont comptés', () => {
  const place = placeDansLaPile(PILE_VISIBLES, [30, 30, 30, 30], false);
  assert.equal(place.visible, false);
  assert.equal(place.opacite, 0);
  assert.equal(resteDeLaPile(4), '+ 1 autre message');
  assert.equal(resteDeLaPile(6), '+ 3 autres messages');
  assert.equal(resteDeLaPile(3), '');
});

test('la même règle compte les vignettes d’agents, sous leur propre nom', () => {
  assert.equal(resteDeLaPile(4, 'agent'), '+ 1 autre agent');
  assert.equal(resteDeLaPile(6, 'agent'), '+ 3 autres agents');
  assert.equal(resteDeLaPile(3, 'agent'), '');
});

test('le plus récent passe DEVANT les autres', () => {
  const devant = placeDansLaPile(0, [30, 30, 30], false);
  const derriere = placeDansLaPile(2, [30, 30, 30], false);
  assert.ok(devant.profondeur > derriere.profondeur);
});

test('pile ouverte : chacun se pose sous le précédent, en vraie liste', () => {
  const hauteurs = [40, 24, 60];
  assert.equal(placeDansLaPile(0, hauteurs, true).decalage, 0);
  assert.equal(placeDansLaPile(1, hauteurs, true).decalage, 40 + PILE_ECART);
  assert.equal(placeDansLaPile(2, hauteurs, true).decalage, 40 + PILE_ECART + 24 + PILE_ECART);
  for (let i = 0; i < hauteurs.length; i += 1) {
    const place = placeDansLaPile(i, hauteurs, true);
    assert.equal(place.echelle, 1);
    assert.equal(place.opacite, 1);
    assert.equal(place.visible, true);
  }
});

test("la pile fermée n'occupe que la place d'un message", () => {
  const hauteurs = [40, 40, 40, 40];
  assert.equal(hauteurDeLaPile(hauteurs, false), 40 + PILE_DECALAGE * (PILE_VISIBLES - 1));
  assert.equal(hauteurDeLaPile(hauteurs, true), 160 + PILE_ECART * 3);
  assert.equal(hauteurDeLaPile([], false), 0);
});

test("l'heure et la date se lisent en une ligne courte", () => {
  const ligne = heureEtDate(new Date(2026, 7, 4, 14, 32).getTime());
  assert.match(ligne, /^\d{2}:\d{2} · 04\.08\.2026$/);
  assert.equal(heureEtDate(undefined), '');
});
