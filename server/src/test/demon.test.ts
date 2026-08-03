import assert from 'node:assert/strict';
import test from 'node:test';
import { avertissementRedemarrage, redemarrageNecessaire } from '@haikodev/shared';

const DEMARRE = new Date('2026-08-03T09:00:00+02:00').getTime();

test('sans date de construction connue, on ne réclame rien', () => {
  assert.equal(redemarrageNecessaire({ demarreA: DEMARRE }), false);
});

test('code construit APRÈS le démarrage : le redémarrage est attendu', () => {
  assert.equal(redemarrageNecessaire({ demarreA: DEMARRE, construitA: DEMARRE + 60_000 }), true);
});

test('code construit AVANT le démarrage : rien à faire', () => {
  assert.equal(redemarrageNecessaire({ demarreA: DEMARRE, construitA: DEMARRE - 60_000 }), false);
});

test('une construction juste avant le démarrage ne se réclame pas elle-même', () => {
  // Le démon repart aussitôt après une construction : à 300 ms d'écart, la
  // marge évite qu'il demande un redémarrage dès sa première seconde.
  assert.equal(redemarrageNecessaire({ demarreA: DEMARRE, construitA: DEMARRE + 300 }), false);
});

test('l’avertissement nomme les agents qui seront interrompus', () => {
  assert.match(avertissementRedemarrage({ demarreA: DEMARRE }), /repart tout seul/);
  assert.match(avertissementRedemarrage({ demarreA: DEMARRE, agentsEnCours: 1 }), /^Un agent travaille/);
  assert.match(avertissementRedemarrage({ demarreA: DEMARRE, agentsEnCours: 3 }), /^3 agents travaillent/);
});
