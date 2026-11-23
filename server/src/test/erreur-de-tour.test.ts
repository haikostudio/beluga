import test from 'node:test';
import assert from 'node:assert/strict';
import { choixDejaFerme, erreurDeTourAPoser } from '@beluga/shared';

test('un échec ordinaire, sans reprise ni panne ni moteur muet, mérite une décision', () => {
  assert.equal(
    erreurDeTourAPoser({ failed: true, reprise: false, panneDefinitive: false, moteurMuet: false }),
    true,
  );
});

test('un tour réussi ne mérite jamais de décision', () => {
  assert.equal(
    erreurDeTourAPoser({ failed: false, reprise: false, panneDefinitive: false, moteurMuet: false }),
    false,
  );
});

test('une reprise de quota garde sa propre route', () => {
  assert.equal(
    erreurDeTourAPoser({ failed: true, reprise: true, panneDefinitive: false, moteurMuet: false }),
    false,
  );
});

test('une panne passagère du fournisseur garde sa propre route', () => {
  assert.equal(
    erreurDeTourAPoser({ failed: true, reprise: false, panneDefinitive: true, moteurMuet: false }),
    false,
  );
});

test('un moteur jamais joint repart tout seul, sans qu’on demande rien', () => {
  assert.equal(
    erreurDeTourAPoser({ failed: true, reprise: false, panneDefinitive: false, moteurMuet: true }),
    false,
  );
});

test('un arrêt demandé à la main n’est pas une erreur : rien à trancher, le clic « Lancer » reste libre', () => {
  assert.equal(
    erreurDeTourAPoser({ failed: true, reprise: false, panneDefinitive: false, moteurMuet: false, arretDemande: true }),
    false,
  );
});

test('un choix déjà posé ferme la décision', () => {
  assert.equal(choixDejaFerme('relancer'), true);
  assert.equal(choixDejaFerme('ignorer'), true);
  assert.equal(choixDejaFerme('arreter'), true);
  assert.equal(choixDejaFerme(undefined), false);
});

/* ------------------------------------------------------------------ */
/* Le pont épuisé : la seule décision posée sur un tour NON tombé      */
/* ------------------------------------------------------------------ */

/*
 * Un moteur privé de son pont d'outils écrit quand même son compte rendu — il
 * ne sait pas qu'il lui manque quelque chose — et le tour se termine « réussi ».
 * Sans cette porte, la décision n'était jamais posée après trois rejeux : la
 * carte repartait indéfiniment, en brûlant du quota à chaque passage.
 */
test('trois tours sans outils : la décision est posée même si le tour a « réussi »', () => {
  assert.equal(
    erreurDeTourAPoser({
      failed: false,
      reprise: false,
      panneDefinitive: false,
      moteurMuet: false,
      pontEpuise: true,
    }),
    true,
  );
});

test('un pont épuisé ne passe devant aucune autre route déjà prise', () => {
  const base = { failed: false, reprise: false, panneDefinitive: false, moteurMuet: false, pontEpuise: true };
  assert.equal(erreurDeTourAPoser({ ...base, arretDemande: true }), false, 'un arrêt à la main l’emporte');
  assert.equal(erreurDeTourAPoser({ ...base, reprise: true }), false, 'la reprise de compte a sa décision');
  assert.equal(erreurDeTourAPoser({ ...base, panneDefinitive: true }), false, 'la panne du fournisseur aussi');
  assert.equal(erreurDeTourAPoser({ ...base, moteurMuet: true }), false, 'un moteur muet repart tout seul');
});

test('un tour privé d’outils ENCORE dans ses rejeux ne demande rien', () => {
  assert.equal(
    erreurDeTourAPoser({
      failed: false,
      reprise: false,
      panneDefinitive: false,
      moteurMuet: false,
      pontEpuise: false,
    }),
    false,
  );
});
