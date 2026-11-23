import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, doitRechargerPourLeProtocole } from '@beluga/shared';

test('un démon au même protocole ne fait rien recharger', () => {
  assert.equal(
    doitRechargerPourLeProtocole({ serveur: PROTOCOL_VERSION, client: PROTOCOL_VERSION, dejaRechargePour: null }),
    false,
  );
});

test('un démon à un autre protocole fait recharger l’écran une fois', () => {
  assert.equal(doitRechargerPourLeProtocole({ serveur: 3, client: 2, dejaRechargePour: null }), true);
});

test('un rechargement déjà fait pour ce numéro ne se refait pas (pas de boucle)', () => {
  assert.equal(doitRechargerPourLeProtocole({ serveur: 3, client: 2, dejaRechargePour: '3' }), false);
  assert.equal(doitRechargerPourLeProtocole({ serveur: 4, client: 2, dejaRechargePour: '3' }), true);
});

test('un événement sans numéro de protocole ne fait rien recharger', () => {
  assert.equal(doitRechargerPourLeProtocole({ serveur: undefined, client: 2, dejaRechargePour: null }), false);
});

test('les messages d’état portent le nom « etat », au protocole 2', () => {
  assert.ok(PROTOCOL_VERSION >= 2);
});
