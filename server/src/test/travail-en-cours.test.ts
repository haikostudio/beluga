import test from 'node:test';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* LE TÉMOIN « RÉFLEXION EN COURS » : l'agent fait foi, pas le message. */
/* ------------------------------------------------------------------ */

const { temoinDeTravail, ecritureOrpheline, agentTientSonTour } = await import('@haikodev/shared');

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

/* ------------------------------------------------------------------ */
/* LE TOUR VIVANT PASSE DEVANT : un agent travaille aussi en silence.  */
/* ------------------------------------------------------------------ */

test('un tour vivant allume le témoin, même sans texte ni marque d’écriture', () => {
  // Neuf commandes qui s'enchaînent : le déroulé se remplit, aucun texte
  // n'arrive, le message reste tel quel. Le tour, lui, est bien là.
  assert.equal(temoinDeTravail({ statut: 'running', tourVivantDepuis: 10_000 }), true);
});

test('un tour vivant tient le témoin même quand le statut est déjà retombé', () => {
  // La réponse est rendue et le statut passe à « terminé », mais le démon range
  // encore le tour : compression du contexte, constat du dépôt, fusion de la
  // branche — autant de commandes, et l'agent reste interruptible.
  assert.equal(temoinDeTravail({ statut: 'done', finDuTour: 20_000, tourVivantDepuis: 10_000 }), true);
});

test('le tableau lit la même règle : le personnage pioche tant que le tour vit', () => {
  // Le tableau ne connaît que l'agent — ni message, ni marque d'écriture.
  assert.equal(agentTientSonTour({ status: 'running' }), true);
  assert.equal(agentTientSonTour({ status: 'done', tourVivantDepuis: 10_000 }), true);
  assert.equal(agentTientSonTour({ status: 'done' }), false);
  assert.equal(agentTientSonTour({}), false);
});

test('le tour refermé éteint le témoin : plus aucune marque ne le rallume', () => {
  assert.equal(temoinDeTravail({ statut: 'done', finDuTour: 20_000 }), false);
  // Un message resté en écriture derrière un tour mort reste orphelin : la
  // règle d'avant n'est pas touchée.
  assert.equal(
    ecritureOrpheline({ statut: 'failed', finDuTour: 20_000, messageEnEcritureA: 10_000 }),
    true,
  );
});
