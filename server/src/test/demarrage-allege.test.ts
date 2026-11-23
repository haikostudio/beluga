import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PEREMPTION_DU_MARQUEUR_MS,
  adresseDePastille,
  demarrageApresCoupure,
  messageAvecContexteRepris,
} from '@beluga/shared';

/*
 * L'APPLICATION ROUVRE TOUJOURS (26/10/2026) : sur iPhone, la page tuée deux
 * fois pendant son démarrage affichait « Un problème récurrent est survenu ».
 */

test('un marqueur de démarrage encore là dit que la page précédente est morte en route', () => {
  const maintenant = 10_000_000;
  assert.equal(demarrageApresCoupure(String(maintenant - 3_000), maintenant), true);
  assert.equal(demarrageApresCoupure(null, maintenant), false, 'aucun marqueur : démarrage normal');
  assert.equal(demarrageApresCoupure('abîmé', maintenant), false);
  assert.equal(demarrageApresCoupure(String(maintenant - PEREMPTION_DU_MARQUEUR_MS - 1), maintenant), false, 'trop vieux');
  assert.equal(demarrageApresCoupure(String(maintenant + 60_000), maintenant), false, 'horloge revenue en arrière');
});

test('la pastille demande une miniature à sa taille, jamais l’image entière', () => {
  assert.equal(adresseDePastille('/api/favicon?project=p1&t=5', 15), '/api/favicon?project=p1&t=5&w=64');
  assert.equal(adresseDePastille('/api/favicon?project=p1', 40), '/api/favicon?project=p1&w=120');
  assert.equal(adresseDePastille('/api/favicon?project=p1&w=80', 15), '/api/favicon?project=p1&w=80', 'déjà dimensionnée');
  assert.equal(adresseDePastille('https://ailleurs.example/icone.png', 15), 'https://ailleurs.example/icone.png');
});

test('un contexte dit inchangé reprend celui déjà connu, sans jamais en inventer', () => {
  type M = { id: string; sentContext?: { demande: string } };
  const precedent: M = { id: 'm', sentContext: { demande: 'x' } };
  const recu: M = { id: 'm' };
  assert.deepEqual(messageAvecContexteRepris(recu, precedent, true).sentContext, { demande: 'x' });
  assert.equal(messageAvecContexteRepris(recu, precedent, false).sentContext, undefined, 'sans le signal, rien n’est repris');
  assert.equal(messageAvecContexteRepris(recu, undefined, true).sentContext, undefined);
  const neuf: M = { id: 'm', sentContext: { demande: 'y' } };
  assert.deepEqual(messageAvecContexteRepris(neuf, precedent, true).sentContext, { demande: 'y' }, 'un contexte reçu fait foi');
});
