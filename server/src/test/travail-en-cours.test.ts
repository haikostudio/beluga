import test from 'node:test';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* LE TÉMOIN « RÉFLEXION EN COURS » : l'agent fait foi, pas le message. */
/* ------------------------------------------------------------------ */

const { temoinDeTravail, ecritureOrpheline } = await import('@haikodev/shared');

test('un agent au travail allume le témoin, message ou pas', () => {
  assert.equal(temoinDeTravail({ statut: 'running' }), true);
  assert.equal(temoinDeTravail({ statut: 'starting' }), true);
});

test('rien en écriture, agent au repos : le témoin est éteint', () => {
  assert.equal(temoinDeTravail({ statut: 'done', finDuTour: 1_000 }), false);
});

test('un message né APRÈS la dernière fin de tour est le tour qui démarre', () => {
  // Le message est créé avant que l'agent passe « au travail » : sans cette
  // nuance, le témoin clignoterait pendant la préparation du tour.
  assert.equal(temoinDeTravail({ statut: 'idle', finDuTour: 1_000, messageEnEcritureA: 2_000 }), true);
});

test('un message en écriture plus vieux que la fin du tour est orphelin', () => {
  const etat = { statut: 'failed' as const, finDuTour: 5_000, messageEnEcritureA: 1_000 };
  assert.equal(temoinDeTravail(etat), false, 'le tour est fini depuis : plus personne n’écrit');
  assert.equal(ecritureOrpheline(etat), true);
});

test('sans fin de tour connue, le témoin reste allumé : mieux vaut trop montrer', () => {
  assert.equal(temoinDeTravail({ statut: 'idle', messageEnEcritureA: 1_000 }), true);
  assert.equal(ecritureOrpheline({ statut: 'idle', messageEnEcritureA: 1_000 }), false);
});

test('sans message en écriture, il n’y a rien d’orphelin à éteindre', () => {
  assert.equal(ecritureOrpheline({ statut: 'failed', finDuTour: 5_000 }), false);
});
