import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELE_PAR_DEFAUT, cleDeSession, memeFil } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Reprendre le fil d'un moteur sans se tromper de modèle               */
/* ------------------------------------------------------------------ */

test('sous Claude, le fil appartient au moteur seul : le modèle ne change rien', () => {
  assert.equal(cleDeSession('claude'), 'claude');
  assert.equal(cleDeSession('claude', 'claude-opus-5'), 'claude');
  assert.equal(cleDeSession('claude', 'claude-sonnet-5'), 'claude');
});

test('sous Codex, le fil appartient au couple moteur + modèle', () => {
  assert.equal(cleDeSession('codex', 'gpt-5.6-sol'), 'codex@gpt-5.6-sol');
  assert.notEqual(cleDeSession('codex', 'gpt-5.6-sol'), cleDeSession('codex', 'gpt-5.6-terra'));
});

test('changer de modèle sous Codex ouvre un fil neuf au lieu de reprendre celui d un autre modèle', () => {
  // C'est le cas qui rendait « This session was recorded with model X but is
  // resuming with Y » : douze fois dans le journal du chef d'orchestre.
  const fils: Record<string, string> = {};
  fils[cleDeSession('codex', 'gpt-5.6-sol')] = 'fil-sol';

  assert.equal(fils[cleDeSession('codex', 'gpt-5.6-terra')], undefined);
  assert.equal(fils[cleDeSession('codex', 'gpt-5.6-sol')], 'fil-sol');
});

test('sans modèle imposé, la clé est stable d un tour à l autre', () => {
  assert.equal(cleDeSession('codex'), `codex@${MODELE_PAR_DEFAUT}`);
  assert.equal(cleDeSession('codex', ''), cleDeSession('codex', null));
  assert.equal(cleDeSession('codex', '  '), cleDeSession('codex'));
});

test('deux moteurs ne se partagent jamais un fil', () => {
  assert.notEqual(cleDeSession('claude', 'gpt-5.6-sol'), cleDeSession('codex', 'gpt-5.6-sol'));
});

test('un moteur absent ou abîmé retombe sur Claude, jamais sur une clé vide', () => {
  assert.equal(cleDeSession(undefined), 'claude');
  assert.equal(cleDeSession(null), 'claude');
  assert.equal(cleDeSession('  '), 'claude');
});

test('memeFil dit en clair pourquoi un tour repart d une conversation neuve', () => {
  assert.equal(memeFil({ engine: 'codex', model: 'a' }, { engine: 'codex', model: 'a' }), true);
  assert.equal(memeFil({ engine: 'codex', model: 'a' }, { engine: 'codex', model: 'b' }), false);
  assert.equal(memeFil({ engine: 'claude', model: 'a' }, { engine: 'claude', model: 'b' }), true);
  assert.equal(memeFil({ engine: 'claude' }, { engine: 'codex' }), false);
});
