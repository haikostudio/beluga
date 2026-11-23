import test from 'node:test';
import assert from 'node:assert/strict';
import { estUneRedite, racinesSignificatives, recouvrementLexical } from '@beluga/shared';

const connu = racinesSignificatives(
  "L'état ouvert ou fermé de l'aperçu se retient en base avec cleApercuOuvert ; le réglage usePref garde overscroll-behavior sur la liste.",
);

test('une reformulation a un fort recouvrement', () => {
  const r = "L'aperçu ouvert ou fermé se retient en base via cleApercuOuvert et usePref.";
  assert.ok(recouvrementLexical(r, connu) >= 0.7);
  assert.ok(estUneRedite(r, connu));
});

test('un fait neuf (fichier, contrôle) n’est pas une redite', () => {
  const r = "Le contrôle scripts/verif-apercu.mjs vérifie aussi l'aperçu ouvert dans fichiers.ts.";
  assert.ok(!estUneRedite(r, connu));
});

test('un paragraphe sans mot significatif n’est jamais une redite', () => {
  assert.equal(recouvrementLexical('le la de et', connu), 0);
  assert.ok(!estUneRedite('', connu));
});
