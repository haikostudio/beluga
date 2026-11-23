import test from 'node:test';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* LE TÉMOIN « RÉFLEXION EN COURS » : l'agent fait foi, pas le message. */
/* ------------------------------------------------------------------ */

const { temoinDeTravail, ecritureOrpheline, agentTientSonTour, cadrageAReponduCeTour, agentAuTravailALEcran } = await import('@beluga/shared');

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

/* ------------------------------------------------------------------ */
/* LE FILET : l'écran ne peut plus contredire un rapport qu'il montre. */
/* Cas réel du 09.09.2026 — « la carte est terminée, pourtant elle     */
/* tourne toujours depuis 47 minutes ».                                */
/* ------------------------------------------------------------------ */

const { PLAFOND_FERMETURE_MS } = await import('@beluga/shared');
const MAINTENANT = 10_000_000;

test('un compte rendu rendu depuis plus que le plafond éteint le témoin', () => {
  assert.equal(
    temoinDeTravail({
      statut: 'running',
      tourVivantDepuis: MAINTENANT - 47 * 60_000,
      reponseRendueA: MAINTENANT - 21 * 60_000,
      maintenant: MAINTENANT,
    }),
    false,
    'un rapport lu depuis 21 minutes ne décrit plus un travail en cours',
  );
});

test('le rangement d’après-réponse, lui, garde son témoin', () => {
  // Deux minutes après la réponse : constat du dépôt, fusion de la branche,
  // compression du fil. C'est un VRAI travail, et il reste visible.
  assert.equal(
    temoinDeTravail({
      statut: 'done',
      tourVivantDepuis: MAINTENANT - 30 * 60_000,
      reponseRendueA: MAINTENANT - 2 * 60_000,
      maintenant: MAINTENANT,
    }),
    true,
  );
  assert.ok(PLAFOND_FERMETURE_MS > 2 * 60_000);
});

test('le compte rendu du tour PRÉCÉDENT n’éteint jamais le tour qui démarre', () => {
  // Le nouveau tour vient de partir ; le dernier texte affiché est celui
  // d'hier. Sans cette garde, le témoin s'éteindrait sur un tour bien vivant.
  assert.equal(
    temoinDeTravail({
      statut: 'running',
      tourVivantDepuis: MAINTENANT - 5_000,
      reponseRendueA: MAINTENANT - 24 * 3_600_000,
      maintenant: MAINTENANT,
    }),
    true,
  );
});

test('sans tour vivant, le filet ne change rien à la règle d’avant', () => {
  assert.equal(
    temoinDeTravail({ statut: 'running', reponseRendueA: MAINTENANT - 60 * 60_000, maintenant: MAINTENANT }),
    true,
  );
});

/* ------------------------------------------------------------------ */
/* UN CADRAGE QUI A RÉPONDU NE TRAVAILLE PLUS, VU D'UN RÉSUMÉ.         */
/* ------------------------------------------------------------------ */

test('un cadrage dont la réponse est rendue n’est plus au travail à l’écran, tour vivant ou pas', () => {
  // Carte c4bc7c2f : tour lancé à 05:23, réponse rendue à 05:40, rangement après.
  const agent = { role: 'cadrage', status: 'done', tourVivantDepuis: 1_000, endedAt: 2_000 };
  assert.equal(agentTientSonTour(agent), true, 'le tour vit toujours (MEM-0392) : rien n’y change');
  assert.equal(cadrageAReponduCeTour(agent), true);
  assert.equal(agentAuTravailALEcran(agent), false);
});

test('un agent de tâche qui range son tour reste au travail à l’écran', () => {
  const agent = { role: 'task', status: 'done', tourVivantDepuis: 1_000, endedAt: 2_000 };
  assert.equal(cadrageAReponduCeTour(agent), false);
  assert.equal(agentAuTravailALEcran(agent), true);
});

test('la fin du tour PRÉCÉDENT n’éteint jamais un cadrage qui repart', () => {
  // Nouveau message : le tour repart à 3 000, la dernière fin date de 2 000.
  assert.equal(agentAuTravailALEcran({ role: 'cadrage', status: 'done', tourVivantDepuis: 3_000, endedAt: 2_000 }), true);
  assert.equal(agentAuTravailALEcran({ role: 'cadrage', status: 'running', tourVivantDepuis: 3_000, endedAt: 2_000 }), true);
});

test('un cadrage en pleine réflexion reste au travail à l’écran', () => {
  assert.equal(agentAuTravailALEcran({ role: 'cadrage', status: 'running', tourVivantDepuis: 1_000 }), true);
  assert.equal(agentAuTravailALEcran({ role: 'cadrage', status: 'starting' }), true);
  assert.equal(agentAuTravailALEcran({ role: 'cadrage', status: 'done', endedAt: 2_000 }), false);
});

test('les vues résumées lisent le prédicat d’écran, pas le seul tour tenu', async () => {
  const { readFile } = await import('node:fs/promises');
  const racine = new URL('../../../', import.meta.url);
  const lire = (chemin: string) => readFile(new URL(chemin, racine), 'utf8');
  /* La liste des agents (projet ET « Tableaux de bord ») lit le même prédicat (30/10/2026). */
  const liste = await lire('web/src/components/liste-des-agents.tsx');
  assert.match(liste, /if \(agentAuTravailALEcran\(agent\)\) \{[\s\S]{0,200}auTravail\.add\(agent\.cardId\)/);
  const tableau = await lire('web/src/components/board.tsx');
  assert.match(tableau, /a\.cardId === card\.id && agentAuTravailALEcran\(a\)/);
});
