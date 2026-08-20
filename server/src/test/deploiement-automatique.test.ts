import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELAI_DE_CALME_MS,
  decisionDeDeploiementAutomatique,
  type EtatDuDeploiementAutomatique,
} from '@haikodev/shared';

const MAINTENANT = 1_800_000_000_000;

/** Un projet au calme, interrupteur allumé, une carte prête à partir. */
function pret(patch: Partial<EtatDuDeploiementAutomatique> = {}): EtatDuDeploiementAutomatique {
  return {
    actif: true,
    cartesTerminees: 1,
    cartesEnAttenteDeDecision: 0,
    cartesEnCours: 0,
    cartesQuiVontPartir: 0,
    agentsAuTravail: 0,
    publicationEnCours: false,
    procedureEnPlace: true,
    dernierTravailRenduA: MAINTENANT - DELAI_DE_CALME_MS,
    ...patch,
  };
}

/* ------------------------------------------------------------------ */
/* L'interrupteur commande TOUT                                        */
/* ------------------------------------------------------------------ */

test('éteint, rien ne part — même quand tout est prêt', () => {
  const decision = decisionDeDeploiementAutomatique(pret({ actif: false }), MAINTENANT);
  assert.equal(decision.partir, false);
  assert.match(decision.raison, /éteint/);
});

test('allumé et tout au calme, le lot part', () => {
  const decision = decisionDeDeploiementAutomatique(pret(), MAINTENANT);
  assert.equal(decision.partir, true);
});

/* ------------------------------------------------------------------ */
/* Ce qui retient le lot                                               */
/* ------------------------------------------------------------------ */

test('un agent au travail retient le lot : le dossier est partagé', () => {
  const decision = decisionDeDeploiementAutomatique(pret({ agentsAuTravail: 2 }), MAINTENANT);
  assert.equal(decision.partir, false);
  assert.match(decision.raison, /travaillent encore/);
});

test('une carte encore en cours retient le lot', () => {
  const decision = decisionDeDeploiementAutomatique(pret({ cartesEnCours: 1 }), MAINTENANT);
  assert.equal(decision.partir, false);
  assert.match(decision.raison, /encore en cours/);
});

test('une carte sur le point de repartir retient le lot', () => {
  const decision = decisionDeDeploiementAutomatique(pret({ cartesQuiVontPartir: 1 }), MAINTENANT);
  assert.equal(decision.partir, false);
  assert.match(decision.raison, /repartir/);
});

test('une publication déjà en cours retient le lot', () => {
  const decision = decisionDeDeploiementAutomatique(pret({ publicationEnCours: true }), MAINTENANT);
  assert.equal(decision.partir, false);
});

test('sans procédure de déploiement, rien ne part', () => {
  const decision = decisionDeDeploiementAutomatique(pret({ procedureEnPlace: false }), MAINTENANT);
  assert.equal(decision.partir, false);
  assert.match(decision.raison, /procédure/);
});

test('une colonne « Terminé » vide ne déclenche aucune publication', () => {
  const decision = decisionDeDeploiementAutomatique(pret({ cartesTerminees: 0 }), MAINTENANT);
  assert.equal(decision.partir, false);
  assert.match(decision.raison, /rien à déployer/);
});

test('une carte terminée qui attend une décision ne fait jamais partir le lot à elle seule', () => {
  const decision = decisionDeDeploiementAutomatique(
    pret({ cartesTerminees: 0, cartesEnAttenteDeDecision: 1 }),
    MAINTENANT,
  );
  assert.equal(decision.partir, false);
  assert.match(decision.raison, /décision/);
});

test('une carte qui attend une décision ne bloque pas les AUTRES cartes prêtes', () => {
  const decision = decisionDeDeploiementAutomatique(
    pret({ cartesTerminees: 1, cartesEnAttenteDeDecision: 1 }),
    MAINTENANT,
  );
  assert.equal(decision.partir, true);
});

/* ------------------------------------------------------------------ */
/* Le calme : on ne publie pas une fois par carte                      */
/* ------------------------------------------------------------------ */

test('un travail rendu à l’instant fait attendre le lot', () => {
  const decision = decisionDeDeploiementAutomatique(
    pret({ dernierTravailRenduA: MAINTENANT - 1_000 }),
    MAINTENANT,
  );
  assert.equal(decision.partir, false);
  assert.match(decision.raison, /rendu/);
});

test('passé le délai de calme, le lot part', () => {
  const decision = decisionDeDeploiementAutomatique(
    pret({ dernierTravailRenduA: MAINTENANT - DELAI_DE_CALME_MS - 1 }),
    MAINTENANT,
  );
  assert.equal(decision.partir, true);
});

test('sans date de dernier travail connue, le calme ne bloque pas', () => {
  const decision = decisionDeDeploiementAutomatique(
    pret({ dernierTravailRenduA: undefined }),
    MAINTENANT,
  );
  assert.equal(decision.partir, true);
});

/* ------------------------------------------------------------------ */
/* L'ordre des refus : ce qui est NOMMÉ en premier                     */
/* ------------------------------------------------------------------ */

test('l’interrupteur éteint passe avant tout autre motif', () => {
  const decision = decisionDeDeploiementAutomatique(
    pret({ actif: false, agentsAuTravail: 3, cartesTerminees: 0 }),
    MAINTENANT,
  );
  assert.match(decision.raison, /éteint/);
});
