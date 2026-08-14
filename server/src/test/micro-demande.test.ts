import test from 'node:test';
import assert from 'node:assert/strict';
import { fermetureExigee, microAutorise } from '@haikodev/shared';

/*
 * LE MICRO NE S'OUVRE QUE SI ON L'A DEMANDÉ. Sur téléphone, le repère orange du
 * système s'allumait pendant une simple navigation : un interrupteur d'écoute
 * allumé une fois ailleurs était retrouvé au chargement et rouvrait le micro
 * tout seul. La règle tient en deux conditions, jamais une seule.
 */

test('un réglage allumé mais retrouvé au chargement n’ouvre AUCUN micro', () => {
  assert.equal(microAutorise({ reglage: true, gesteDeCettePage: false }), false);
});

test('un geste de cette page, réglage éteint : rien ne s’ouvre non plus', () => {
  assert.equal(microAutorise({ reglage: false, gesteDeCettePage: true }), false);
});

test('les deux ensemble — et seulement là — ouvrent le micro', () => {
  assert.equal(microAutorise({ reglage: true, gesteDeCettePage: true }), true);
});

test('rien de demandé, rien d’ouvert', () => {
  assert.equal(microAutorise({ reglage: false, gesteDeCettePage: false }), false);
});

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
