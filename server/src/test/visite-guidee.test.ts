/** LA VISITE GUIDÉE : quand elle démarre, et quelle bulle elle montre. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ETAPES_DE_LA_VISITE, VISITE_A_FAIRE, etapeAMontrer, etatDeLaVisite, visiteADemarrer } from '@beluga/shared';

test('elle ne démarre seule que sur une installation sans projet, mise en route refermée', () => {
  const base = { visite: VISITE_A_FAIRE, pret: true, assistantOuvert: false, projets: 0 };
  assert.equal(visiteADemarrer(base), true);
  assert.equal(visiteADemarrer({ ...base, projets: 3 }), false);
  assert.equal(visiteADemarrer({ ...base, assistantOuvert: true }), false);
  assert.equal(visiteADemarrer({ ...base, pret: false }), false);
  assert.equal(visiteADemarrer({ ...base, visite: { statut: 'fermee', rang: 0 } }), false);
});

test('une étape dont le repère manque est sautée ; plus rien à montrer, c’est fini', () => {
  const presents = new Set<string>([ETAPES_DE_LA_VISITE[0].selecteur, ETAPES_DE_LA_VISITE[2].selecteur]);
  const affichee = (s: string) => presents.has(s);
  assert.equal(etapeAMontrer(0, affichee), 0);
  assert.equal(etapeAMontrer(1, affichee), 2);
  assert.equal(etapeAMontrer(3, affichee), null);
});

test('une préférence illisible retombe sur « à faire »', () => {
  assert.deepEqual(etatDeLaVisite(undefined), { statut: 'a-faire', rang: 0 });
  assert.deepEqual(etatDeLaVisite({ statut: 'fermee', rang: 2 }), { statut: 'fermee', rang: 2 });
  assert.deepEqual(etatDeLaVisite({ statut: 'n-importe', rang: -1 }), { statut: 'a-faire', rang: 0 });
});
