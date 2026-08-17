import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decisionDArret,
  seDitAuTravail,
  tourACouper,
  arretAAchever,
  MESSAGE_ARRET_COUPE,
  MESSAGE_ARRET_SECOURS,
  MESSAGE_ARRET_INACTIF,
  MESSAGE_ARRET_SERVICE,
  DELAI_CONFIRMATION_ARRET_MS,
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

/* ------------------------------------------------------------------ */
/* Le cas du chef qui « refuse de s'arrêter »                          */
/* ------------------------------------------------------------------ */

test("un tour vivant dont le moteur est mort se referme, il ne se « coupe » pas", () => {
  const decision = decisionDArret({ statut: 'running', tourVivant: true, moteurVivant: false });
  assert.equal(decision.geste, 'secours');
  assert.equal(decision.message, MESSAGE_ARRET_SECOURS);
  assert.equal(decision.travaillait, true);
});

test("un tour dont la réponse est déjà figée ne fait plus que du service : on le referme", () => {
  const decision = decisionDArret({
    statut: 'running',
    tourVivant: true,
    moteurVivant: true,
    reponseFigee: true,
  });
  assert.equal(decision.geste, 'secours');
});

test("un moteur dont on ignore le numéro est SUPPOSÉ vivant : on ne referme pas un travail au hasard", () => {
  const decision = decisionDArret({ statut: 'running', tourVivant: true, moteurVivant: undefined });
  assert.equal(decision.geste, 'coupe');
});

test('« y a-t-il quelque chose à couper ? » se juge sur le moteur et sur la réponse', () => {
  assert.equal(tourACouper({ statut: 'running', tourVivant: true }), true);
  assert.equal(tourACouper({ statut: 'running', tourVivant: false }), false);
  assert.equal(tourACouper({ statut: 'running', tourVivant: true, moteurVivant: false }), false);
  assert.equal(tourACouper({ statut: 'running', tourVivant: true, reponseFigee: true }), false);
});

test("un agent au repos dont un moteur de SERVICE tourne encore : le clic coupe, et le dit", () => {
  const decision = decisionDArret({ statut: 'done', tourVivant: false, moteursDeService: 1 });
  assert.equal(decision.geste, 'secours');
  assert.equal(decision.message, MESSAGE_ARRET_SERVICE);
  // Il ne travaillait pas au sens du tableau : rien à compter comme interrompu.
  assert.equal(decision.travaillait, false);
});

test('sans moteur de service, un agent au repos reste « inactif »', () => {
  const decision = decisionDArret({ statut: 'done', tourVivant: false, moteursDeService: 0 });
  assert.equal(decision.geste, 'inactif');
  assert.equal(decision.message, MESSAGE_ARRET_INACTIF);
});

test("un tour au travail garde son message de secours, moteur de service ou non", () => {
  const decision = decisionDArret({ statut: 'running', tourVivant: false, moteursDeService: 2 });
  assert.equal(decision.message, MESSAGE_ARRET_SECOURS);
});

test("on n'achève l'arrêt que si le MÊME tour est encore là", () => {
  assert.equal(arretAAchever({ memeTourEncoreVivant: true }), true);
  // Le tour s'est refermé tout seul, ou un autre a démarré depuis : on ne
  // coupe jamais un travail que personne n'a demandé d'arrêter.
  assert.equal(arretAAchever({ memeTourEncoreVivant: false }), false);
});

test("le délai de confirmation laisse passer le coup de grâce du signal (4 s)", () => {
  assert.ok(DELAI_CONFIRMATION_ARRET_MS > 4_000);
  // …sans faire attendre l'utilisateur devant un écran immobile.
  assert.ok(DELAI_CONFIRMATION_ARRET_MS <= 10_000);
});
