import test from 'node:test';
import assert from 'node:assert/strict';
import { choixDejaFerme, erreurDeTourAPoser } from '@haikodev/shared';

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

test('un choix déjà posé ferme la décision', () => {
  assert.equal(choixDejaFerme('relancer'), true);
  assert.equal(choixDejaFerme('ignorer'), true);
  assert.equal(choixDejaFerme('arreter'), true);
  assert.equal(choixDejaFerme(undefined), false);
});
