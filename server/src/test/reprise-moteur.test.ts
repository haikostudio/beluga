import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPTE_INCONNU,
  MODELE_PAR_DEFAUT,
  cleDeSession,
  memeFil,
  memeFilAutreCompte,
  partMoteurDeLaCle,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Reprendre le fil d'un moteur sans se tromper de modèle ni de compte  */
/* ------------------------------------------------------------------ */

const A = 'claude-principal';
const B = 'claude-secondary';

test('sous Claude, le fil appartient au moteur et au compte : le modèle ne change rien', () => {
  assert.equal(cleDeSession('claude', undefined, A), `claude#${A}`);
  assert.equal(cleDeSession('claude', 'claude-opus-5', A), `claude#${A}`);
  assert.equal(cleDeSession('claude', 'claude-sonnet-5', A), `claude#${A}`);
});

test('sous Codex, le fil appartient au triplet moteur + modèle + compte', () => {
  assert.equal(cleDeSession('codex', 'gpt-5.6-sol', A), `codex@gpt-5.6-sol#${A}`);
  assert.notEqual(cleDeSession('codex', 'gpt-5.6-sol', A), cleDeSession('codex', 'gpt-5.6-terra', A));
});

test('changer de modèle sous Codex ouvre un fil neuf au lieu de reprendre celui d un autre modèle', () => {
  // C'est le cas qui rendait « This session was recorded with model X but is
  // resuming with Y » : douze fois dans le journal du chef d'orchestre.
  const fils: Record<string, string> = {};
  fils[cleDeSession('codex', 'gpt-5.6-sol', A)] = 'fil-sol';

  assert.equal(fils[cleDeSession('codex', 'gpt-5.6-terra', A)], undefined);
  assert.equal(fils[cleDeSession('codex', 'gpt-5.6-sol', A)], 'fil-sol');
});

test('CHANGER DE COMPTE ouvre un fil neuf : la conversation est restée dans l autre coffre', () => {
  // Le vrai défaut de la reprise après limite atteinte : le tour repartait avec
  // l'identifiant du fil du compte à sec, que le coffre du compte choisi n'a
  // jamais vu — le moteur refusait, et le travail en cours était perdu.
  const fils: Record<string, string> = {};
  fils[cleDeSession('claude', 'claude-opus-5', A)] = 'fil-du-compte-a';

  assert.equal(fils[cleDeSession('claude', 'claude-opus-5', B)], undefined);
  assert.equal(fils[cleDeSession('claude', 'claude-opus-5', A)], 'fil-du-compte-a');
});

test('le fil de l autre compte se retrouve : il n est pas reprenable, mais il prouve qu un travail est en cours', () => {
  const partMoteur = partMoteurDeLaCle('claude', 'claude-opus-5');
  assert.equal(memeFilAutreCompte(cleDeSession('claude', 'claude-opus-5', A), partMoteur), true);
  assert.equal(memeFilAutreCompte(cleDeSession('claude', 'claude-opus-5', B), partMoteur), true);
  // Un autre moteur, lui, ne raconte rien du travail en cours sous celui-ci.
  assert.equal(memeFilAutreCompte(cleDeSession('codex', 'gpt-5.6-sol', A), partMoteur), false);
});

test('sans modèle imposé, la clé est stable d un tour à l autre', () => {
  assert.equal(cleDeSession('codex', undefined, A), `codex@${MODELE_PAR_DEFAUT}#${A}`);
  assert.equal(cleDeSession('codex', '', A), cleDeSession('codex', null, A));
  assert.equal(cleDeSession('codex', '  ', A), cleDeSession('codex', undefined, A));
});

test('deux moteurs ne se partagent jamais un fil', () => {
  assert.notEqual(cleDeSession('claude', 'gpt-5.6-sol', A), cleDeSession('codex', 'gpt-5.6-sol', A));
});

test('un moteur absent ou abîmé retombe sur Claude, jamais sur une clé vide', () => {
  assert.equal(cleDeSession(undefined, undefined, A), `claude#${A}`);
  assert.equal(cleDeSession(null, undefined, A), `claude#${A}`);
  assert.equal(cleDeSession('  ', undefined, A), `claude#${A}`);
});

test('un compte inconnu est NOMMÉ dans la clé, jamais laissé vide', () => {
  // Une clé sans compte se confondrait avec celle d'un compte réel : le fil
  // d'un ancien tour serait repris dans le mauvais coffre.
  assert.equal(cleDeSession('claude'), `claude#${COMPTE_INCONNU}`);
  assert.notEqual(cleDeSession('claude'), cleDeSession('claude', undefined, A));
});

test('memeFil dit en clair pourquoi un tour repart d une conversation neuve', () => {
  assert.equal(memeFil({ engine: 'codex', model: 'a', compte: A }, { engine: 'codex', model: 'a', compte: A }), true);
  assert.equal(memeFil({ engine: 'codex', model: 'a', compte: A }, { engine: 'codex', model: 'b', compte: A }), false);
  assert.equal(memeFil({ engine: 'claude', model: 'a', compte: A }, { engine: 'claude', model: 'b', compte: A }), true);
  assert.equal(memeFil({ engine: 'claude', compte: A }, { engine: 'codex', compte: A }), false);
  assert.equal(memeFil({ engine: 'claude', compte: A }, { engine: 'claude', compte: B }), false);
});
