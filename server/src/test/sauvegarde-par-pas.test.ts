import test from 'node:test';
import assert from 'node:assert/strict';
import { DUREE_VISEE_D_UN_PAS_MS, PAGES_MAX_PAR_PAS, PAGES_MIN_PAR_PAS, pagesDuPasSuivant } from '@beluga/shared';

test('un pas de sauvegarde se règle sur sa durée : un disque lent fait de petits pas, un disque rapide de grands', () => {
  // Disque par le réseau : 1 000 pages en 3,8 s (mesure du 28/10/2026) → ~13, borné au minimum.
  assert.equal(pagesDuPasSuivant(1_000, 3_800), PAGES_MIN_PAR_PAS);
  // Pile sur la cible : inchangé.
  assert.equal(pagesDuPasSuivant(1_000, DUREE_VISEE_D_UN_PAS_MS), 1_000);
  // Trop lent de moitié : moitié moins.
  assert.equal(pagesDuPasSuivant(1_000, 100), 500);
  // Très rapide : jamais plus du double d'un coup, et jamais au-delà du plafond.
  assert.equal(pagesDuPasSuivant(1_000, 1), 2_000);
  assert.equal(pagesDuPasSuivant(3_000, 1), PAGES_MAX_PAR_PAS);
  // Durée absurde : on avance prudemment.
  assert.equal(pagesDuPasSuivant(100, 0), 200);
  assert.equal(pagesDuPasSuivant(Number.NaN, Number.NaN), PAGES_MIN_PAR_PAS * 2);
});
