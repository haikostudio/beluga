import test from 'node:test';
import assert from 'node:assert/strict';
import { erreurAgentDisparu, phraseDeLancementImpossible, PHRASE_CARTE_SUPPRIMEE } from '@beluga/shared';

test('un agent disparu en plein tour se dit en une phrase claire', () => {
  assert.equal(phraseDeLancementImpossible(erreurAgentDisparu('a1')), PHRASE_CARTE_SUPPRIMEE);
});

test('une erreur de validation brute n’est jamais montrée', () => {
  const brut = new Error('[\n  {\n    "code": "invalid_type",\n    "expected": "string",\n    "path": ["id"],\n    "message": "Required"\n  }\n]');
  const phrase = phraseDeLancementImpossible(brut);
  assert.doesNotMatch(phrase, /invalid_type|\[|Required/);
  const zod = Object.assign(new Error('x'), { name: 'ZodError' });
  assert.doesNotMatch(phraseDeLancementImpossible(zod), /ZodError/);
});

test('une erreur lisible garde son texte', () => {
  assert.equal(phraseDeLancementImpossible(new Error('projet introuvable')), 'Lancement impossible : projet introuvable');
});
