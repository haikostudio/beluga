import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decisionDArret,
  seDitAuTravail,
  MESSAGE_ARRET_COUPE,
  MESSAGE_ARRET_SECOURS,
  MESSAGE_ARRET_INACTIF,
} from '@haikodev/shared';

test('un moteur en marche se coupe, comme avant', () => {
  const decision = decisionDArret({ statut: 'running', tourVivant: true });
  assert.equal(decision.geste, 'coupe');
  assert.equal(decision.message, MESSAGE_ARRET_COUPE);
  assert.equal(decision.travaillait, true);
});

test("un agent qui se dit au travail sans tour vivant est refermé d'autorité", () => {
  const decision = decisionDArret({ statut: 'running', tourVivant: false });
  assert.equal(decision.geste, 'secours');
  assert.equal(decision.message, MESSAGE_ARRET_SECOURS);
  assert.equal(decision.travaillait, true);
});

test('une préparation coincée en « starting » est arrêtable elle aussi', () => {
  const decision = decisionDArret({ statut: 'starting', tourVivant: false, enPreparation: true });
  assert.equal(decision.geste, 'secours');
});

test("une préparation partie sur un agent au statut ancien reste arrêtable", () => {
  const decision = decisionDArret({ statut: 'idle', tourVivant: false, enPreparation: true });
  assert.equal(decision.geste, 'secours');
});

test('un agent déjà au repos le DIT, au lieu de laisser le clic sans réponse', () => {
  for (const statut of ['idle', 'stopped', 'failed', 'done'] as const) {
    const decision = decisionDArret({ statut, tourVivant: false });
    assert.equal(decision.geste, 'inactif');
    assert.equal(decision.message, MESSAGE_ARRET_INACTIF);
    assert.equal(decision.travaillait, false);
  }
});

test('seuls « running » et « starting » se disent au travail', () => {
  assert.equal(seDitAuTravail('running'), true);
  assert.equal(seDitAuTravail('starting'), true);
  assert.equal(seDitAuTravail('idle'), false);
  assert.equal(seDitAuTravail('done'), false);
});
