import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avertissementsSelection,
  cartesEcartees,
  cartesRetenues,
  selectionVide,
  type CarteASelectionner,
} from '@haikodev/shared';

/*
 * LA SÉLECTION DES TÂCHES À DÉPLOYER (`shared/src/selection-deploiement.ts`).
 *
 * Le bouton « Tout déployer » ouvre un écran de sélection : les cartes du lot
 * sont toutes cochées d'avance, et seules les retenues partent.
 */

const CARTES: CarteASelectionner[] = [
  { id: 'a', title: 'Carte A', files: ['web/src/a.tsx'] },
  { id: 'b', title: 'Carte B', files: ['web/src/a.tsx', 'server/src/b.ts'] },
  { id: 'c', title: 'Carte C', files: ['docs/c.md'] },
];

/* ------------------------------------------------------------------ */
/* Retenues / écartées                                                  */
/* ------------------------------------------------------------------ */

test('tout coché retient toutes les cartes, dans l’ordre d’origine', () => {
  const selection = new Set(['a', 'b', 'c']);
  assert.deepEqual(cartesRetenues(CARTES, selection).map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(cartesEcartees(CARTES, selection), []);
});

test('décocher une carte la laisse dans les écartées, jamais dans les retenues', () => {
  const selection = new Set(['a', 'c']);
  assert.deepEqual(cartesRetenues(CARTES, selection).map((c) => c.id), ['a', 'c']);
  assert.deepEqual(cartesEcartees(CARTES, selection).map((c) => c.id), ['b']);
});

test('une sélection vide n’est pas une publication', () => {
  assert.equal(selectionVide(new Set()), true);
  assert.equal(selectionVide(new Set(['a'])), false);
});

/* ------------------------------------------------------------------ */
/* Avertissements : fichiers communs entre retenue et écartée           */
/* ------------------------------------------------------------------ */

test('aucun avertissement quand tout le lot est retenu', () => {
  const avertissements = avertissementsSelection(CARTES, new Set(['a', 'b', 'c']));
  assert.deepEqual(avertissements, []);
});

test('un avertissement quand la carte retenue partage un fichier avec la carte écartée', () => {
  // B (retenue) partage web/src/a.tsx avec A (écartée).
  const avertissements = avertissementsSelection(CARTES, new Set(['b', 'c']));
  assert.equal(avertissements.length, 1);
  assert.equal(avertissements[0].cardId, 'b');
  assert.match(avertissements[0].message, /Carte A/);
  assert.match(avertissements[0].message, /web\/src\/a\.tsx/);
});

test('aucun avertissement quand les fichiers touchés ne se recoupent pas', () => {
  // C (retenue) ne partage aucun fichier avec A ou B (écartées).
  const avertissements = avertissementsSelection(CARTES, new Set(['c']));
  assert.deepEqual(avertissements, []);
});

test('une carte écartée qui partage des fichiers avec PLUSIEURS retenues produit un avertissement par retenue', () => {
  const cartes: CarteASelectionner[] = [
    { id: 'x', title: 'X', files: ['f.ts'] },
    { id: 'y', title: 'Y', files: ['f.ts'] },
    { id: 'z', title: 'Z (écartée)', files: ['f.ts'] },
  ];
  const avertissements = avertissementsSelection(cartes, new Set(['x', 'y']));
  assert.equal(avertissements.length, 2);
  assert.deepEqual(
    avertissements.map((a) => a.cardId).sort(),
    ['x', 'y'],
  );
});
