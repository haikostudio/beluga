import test from 'node:test';
import assert from 'node:assert/strict';
import { fermetureExigee } from '@beluga/shared';

/*
 * QUITTER L'ÉCRAN REFERME LE MICRO. Sur téléphone, le repère orange du système
 * restait allumé après qu'on avait quitté la page : la règle dit quand tout
 * refermer.
 */

test('quitter la page referme toujours, écoute voulue ou non', () => {
  for (const evenement of ['pagehide', 'beforeunload']) {
    assert.equal(fermetureExigee({ evenement, ecouteVoulue: false }), true);
    assert.equal(fermetureExigee({ evenement, ecouteVoulue: true }), true);
  }
});

test('passer en arrière-plan referme une dictée, mais pas une écoute voulue', () => {
  assert.equal(
    fermetureExigee({ evenement: 'visibilitychange', visible: false, ecouteVoulue: false }),
    true,
  );
  assert.equal(
    fermetureExigee({ evenement: 'visibilitychange', visible: false, ecouteVoulue: true }),
    false,
  );
});

test('une page qui revient au premier plan ne referme rien', () => {
  assert.equal(fermetureExigee({ evenement: 'visibilitychange', visible: true }), false);
});

test('un événement quelconque ne referme rien', () => {
  assert.equal(fermetureExigee({ evenement: 'resize', visible: true }), false);
});
