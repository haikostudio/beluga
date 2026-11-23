import test from 'node:test';
import assert from 'node:assert/strict';
import { fillesDeLaMere, sansLesFillesRangees } from '@beluga/shared';

test('une fille dont la mère est listée se range sous elle ; seule, elle reste à plat', () => {
  const mere = { id: 'm', cartesFilles: [{ projectId: 'a', cardId: 'f1' }, { projectId: 'b', cardId: 'f2' }, { projectId: 'b', cardId: 'f2' }] };
  const f1 = { id: 'f1', carteMereId: 'm' };
  const f2 = { id: 'f2', carteMereId: 'm' };
  const seule = { id: 'f3', carteMereId: 'absente' };
  const ordinaire: { id: string; cartesFilles?: { projectId: string; cardId: string }[] } = { id: 'x' };
  assert.deepEqual(sansLesFillesRangees([f1, mere, f2, seule, ordinaire]).map((c) => c.id), ['m', 'f3', 'x']);
  assert.deepEqual(fillesDeLaMere(mere), ['f1', 'f2'], 'une fille par identifiant, dans l’ordre des projets');
  assert.deepEqual(fillesDeLaMere(ordinaire), []);
});
