import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS_CAPITALES, CONSIGNE_DES_ACCORDS, accordRecent, consigneDuChef, estUnRefus, refusSansAccord } from '@beluga/shared';

/*
 * L'ACCORD AVANT CHAQUE ACTION IMPORTANTE (12/11/2026, captures #8adf et #40a2) : cinq gestes passent par une question
 * « ask_user » ; le service refuse un nouveau média sans réponse récente ; un média qui existe se RETOUCHE.
 */

const maintenant = 1_800_000_000_000;

test('cinq actions capitales, dites dans la consigne de l’agent de campagne', () => {
  assert.equal(ACTIONS_CAPITALES.length, 5);
  const consigne = consigneDuChef('campagne');
  for (const a of ACTIONS_CAPITALES) assert.ok(consigne.includes(a), a);
  assert.ok(consigne.includes(CONSIGNE_DES_ACCORDS));
  assert.match(consigne, /« retouche » sur CETTE création/);
  assert.match(consigne, /action « montrer »/);
  assert.match(consigne, /LANCER TOUTE LA SÉRIE EST UNE ACTION IMPORTANTE/);
});

test('un accord : une question tranchée depuis peu, qui n’est pas un refus', () => {
  const q = (answer: string | undefined, ilYa: number, extra: Record<string, unknown> = {}) => ({ questions: [{ answer, answeredAt: answer === undefined ? undefined : maintenant - ilYa, ...extra }] });
  assert.equal(accordRecent([], maintenant), false);
  assert.equal(accordRecent([q(undefined, 0)], maintenant), false, 'une question sans réponse n’est pas un accord');
  assert.equal(accordRecent([q('Oui, crée-la (recommandé)', 60_000)], maintenant), true);
  assert.equal(accordRecent([q('Oui', 2 * 60 * 60_000)], maintenant), false, 'trop ancienne');
  assert.equal(accordRecent([q('Non, retouche plutôt', 60_000)], maintenant), false, 'un non ne vaut pas accord');
  assert.equal(accordRecent([q('Oui', 60_000, { relaiDe: { messageId: 'm', questionId: 'q' } })], maintenant), false, 'un bouton à prix relayé du Studio n’est pas un accord donné à l’agent');
  assert.equal(accordRecent([q('Oui', 60_000, { cancelled: true })], maintenant), false);
  assert.equal(estUnRefus('Annuler'), true);
  assert.equal(estUnRefus('Créer une nouvelle vidéo'), false);
  assert.match(refusSansAccord('créer une nouvelle vidéo', 'Utilise « retouche ».'), /REFUSÉ : « créer une nouvelle vidéo ».*ask_user.*retouche/);
});
