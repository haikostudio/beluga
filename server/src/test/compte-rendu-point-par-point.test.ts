/**
 * LE COMPTE RENDU D'UN TRAVAIL, POINT PAR POINT (demande de l'utilisateur du 06/11/2026) : un titre par point de la
 * demande, un petit texte dessous, et l'image qui le montre. La consigne part au premier tour d'une carte au travail,
 * en bref aux tours suivants, et dans la relance qui fait rendre le message final ; jamais dans une discussion libre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FORME_DU_COMPTE_RENDU, consigneDeRelanceDuRapport, wrapPrompt } from '@beluga/shared';

test('une carte au travail reçoit la forme point par point, avec ses images', () => {
  const premier = wrapPrompt('in_run', 'Corrige le menu et la signature.');
  assert.ok(premier.includes(FORME_DU_COMPTE_RENDU));
  assert.match(premier, /UN TITRE PAR POINT DE LA DEMANDE/);
  assert.match(premier, /!\[légende courte\]\(piece:<identifiant>\)/);
  assert.match(premier, /une par point/);
  // Rien au-dessus du premier titre : ni synthèse ni image ; la synthèse devient le point « Vérifications ».
  assert.match(premier, /le message COMMENCE par le premier titre/);
  assert.match(premier, /### Vérifications/);
  assert.doesNotMatch(premier, /après une ou deux phrases de synthèse|la synthèse d'abord/);
  const rappel = wrapPrompt('in_run', 'Et la marge aussi.', undefined, { rappel: true });
  assert.match(rappel, /un titre « ### » par point de la demande/);
  assert.match(rappel, /RIEN au-dessus du premier titre/);
  assert.ok(!rappel.includes(FORME_DU_COMPTE_RENDU), 'le rappel reste court');
});

test('une discussion libre et un chiffrage ne la reçoivent pas ; la relance finale, si', () => {
  assert.ok(!wrapPrompt('free', 'Pourquoi ce bouton est gris ?').includes(FORME_DU_COMPTE_RENDU));
  assert.ok(!wrapPrompt('pre_run', 'Chiffre la refonte.').includes(FORME_DU_COMPTE_RENDU));
  assert.ok(consigneDeRelanceDuRapport({ taches: [] }).includes(FORME_DU_COMPTE_RENDU));
});

test('le compte rendu nomme chaque étape d’une découpe, même non faite (carte 5e10116a)', async () => {
  const { FORME_DU_COMPTE_RENDU_EN_BREF } = await import('@beluga/shared');
  assert.match(FORME_DU_COMPTE_RENDU, /CHAQUE étape a son point/);
  assert.match(FORME_DU_COMPTE_RENDU, /Pas fait :/);
  assert.match(FORME_DU_COMPTE_RENDU_EN_BREF, /Pas fait :/);
});
