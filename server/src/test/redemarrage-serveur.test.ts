import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionDeRedemarrage, suiteDuRedemarrage } from '@haikodev/shared';

/*
 * NE JAMAIS REDÉMARRER PENDANT UNE PUBLICATION.
 *
 * Le serveur porte TOUTES les publications : le redémarrer en coupe une en plein
 * vol. La règle pure tranche — redémarrer, attendre, ou rien — à partir de l'état
 * des publications et des agents.
 */

test('une publication en cours refuse le redémarrage et nomme le projet', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: ['Brain'], agents: 0 });
  assert.equal(decision.action, 'attendre');
  assert.match(decision.raison ?? '', /Brain/);
});

test('plusieurs publications sont toutes nommées', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: ['Brain', 'La Roma'], agents: 0 });
  assert.equal(decision.action, 'attendre');
  assert.match(decision.raison ?? '', /Brain/);
  assert.match(decision.raison ?? '', /La Roma/);
});

test('un agent au travail fait attendre, publication finie', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: [], agents: 2 });
  assert.equal(decision.action, 'attendre');
  assert.match(decision.raison ?? '', /agents/);
});

test('la publication passe AVANT les agents dans la raison', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: ['Brain'], agents: 3 });
  assert.equal(decision.action, 'attendre');
  assert.match(decision.raison ?? '', /Brain/);
});

test('aucune publication et aucun agent : redémarrage immédiat', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: [], agents: 0 });
  assert.equal(decision.action, 'redemarrer');
  assert.equal(decision.raison, undefined);
});

test('sans demande, il n’y a rien à faire', () => {
  const decision = decisionDeRedemarrage({ demande: false, publications: ['Brain'], agents: 5 });
  assert.equal(decision.action, 'rien');
});

test('un nom vide ne compte pas comme une publication', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: ['  '], agents: 0 });
  assert.equal(decision.action, 'redemarrer');
});

test('la dernière publication finie lance le redémarrage une seule fois', () => {
  // Une demande retenue pendant qu'une publication tourne.
  let enAttente = true;
  const enPublication = suiteDuRedemarrage(enAttente, { publications: ['Brain'], agents: 0 });
  assert.equal(enPublication.redemarrer, false);
  assert.equal(enPublication.enAttente, true);
  enAttente = enPublication.enAttente;

  // La publication se termine : le redémarrage part, et la demande retombe.
  const finie = suiteDuRedemarrage(enAttente, { publications: [], agents: 0 });
  assert.equal(finie.redemarrer, true);
  assert.equal(finie.enAttente, false);
  enAttente = finie.enAttente;

  // Un second passage sans demande ne relance rien : une seule fois.
  const encore = suiteDuRedemarrage(enAttente, { publications: [], agents: 0 });
  assert.equal(encore.redemarrer, false);
  assert.equal(encore.enAttente, false);
});
