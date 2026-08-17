import test from 'node:test';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* LE FILET NE DÉPEND PLUS DE CE QU'IL SURVEILLE.                       */
/*                                                                      */
/* Le 17/08/2026, le démon n'a plus rien refermé de 03 h 10 à 07 h 36 : */
/* la veille vivait DANS la boucle d'ordonnancement, dont le verrou      */
/* « un tour à la fois » n'avait jamais été rendu. Deux agents figés,    */
/* et seul un redémarrage a libéré les conversations.                   */
/* ------------------------------------------------------------------ */

const {
  PERIODE_VEILLE_MS,
  PLAFOND_TOUR_DE_BOUCLE_MS,
  decisionDeBoucle,
  travailAbandonne,
} = await import('@haikodev/shared');

test('la boucle libre laisse partir le tour suivant', () => {
  assert.deepEqual(decisionDeBoucle({ enCours: false }), { partir: true });
});

test('un tour en cours retient le suivant : deux tours lanceraient deux fois la même carte', () => {
  const decision = decisionDeBoucle({ enCours: true, depuisMs: 30_000 });
  assert.equal(decision.partir, false);
  assert.equal(decision.abandon, undefined);
});

test('le tour le plus lent qu’on connaisse passe encore sous le plafond', () => {
  // Départs échelonnés, copie de travail réparée, plusieurs comptes interrogés :
  // quelques minutes au pire. Le plafond ne doit pas mordre dessus.
  assert.equal(decisionDeBoucle({ enCours: true, depuisMs: 4 * 60_000 }).partir, false);
});

test('LE CAS DU 17/08 : un tour qui ne rend jamais la main est déclaré perdu, et la boucle repart', () => {
  const decision = decisionDeBoucle({ enCours: true, depuisMs: 4 * 60 * 60_000 });
  assert.equal(decision.partir, true, 'la boucle doit reprendre');
  assert.match(String(decision.abandon), /240 minutes/, 'la durée réelle est dite');
  assert.match(String(decision.abandon), /perdu/, 'et le mot est écrit dans le journal');
});

test('un verrou tout juste au plafond retient encore ; un cheveu au-dessus, non', () => {
  assert.equal(decisionDeBoucle({ enCours: true, depuisMs: PLAFOND_TOUR_DE_BOUCLE_MS }).partir, false);
  assert.equal(decisionDeBoucle({ enCours: true, depuisMs: PLAFOND_TOUR_DE_BOUCLE_MS + 1 }).partir, true);
});

test('une marque de lancement datée ne condamne pas sa carte pour toujours', () => {
  assert.equal(travailAbandonne(10_000), false, 'un lancement normal tient sa carte');
  assert.equal(travailAbandonne(PLAFOND_TOUR_DE_BOUCLE_MS + 1), true, 'un lancement pendu la relâche');
});

test('la veille repasse assez souvent pour qu’un blocage ne dure pas', () => {
  assert.ok(PERIODE_VEILLE_MS > 0 && PERIODE_VEILLE_MS <= 60_000);
});
