import test from 'node:test';
import assert from 'node:assert/strict';
import { finDuTourDuMessage, rangerLesSuggestions } from '@beluga/shared';

const passages = [
  { ancre: 'point-demande', debut: 100 },
  { ancre: 'point-comprehension', debut: 200 },
  { ancre: 'point-plan' },
  { ancre: 'point-travail', debut: 400 },
];

test('un groupe se range sous le dernier passage commencé avant lui', () => {
  const rangees = rangerLesSuggestions(passages, [
    { at: 250, n: 'a' },
    { at: 450, n: 'b' },
    { at: 400, n: 'c' },
  ]);
  assert.deepEqual(rangees.get('point-comprehension')?.map((g) => g.n), ['a']);
  assert.deepEqual(rangees.get('point-travail')?.map((g) => g.n), ['b', 'c']);
  assert.equal(rangees.get('point-plan'), undefined);
});

test('un groupe plus ancien que tout passage va sous le premier', () => {
  assert.deepEqual(rangerLesSuggestions(passages, [{ at: 10 }]).get('point-demande')?.length, 1);
});

test('sans passage, rien ne se range', () => {
  assert.equal(rangerLesSuggestions([], [{ at: 10 }]).size, 0);
});


test('une carte proposée pendant le cadrage se range sous la compréhension du tour, pas sous la demande', () => {
  // Le tour commence à 110 (juste après la demande), rend sa compréhension à 200 et finit à 260.
  const message = { createdAt: 110, durationMs: 150 };
  const rangees = rangerLesSuggestions(passages.slice(0, 2), [{ at: finDuTourDuMessage(message) }]);
  assert.equal(rangees.get('point-comprehension')?.length, 1);
  assert.equal(rangees.get('point-demande'), undefined);
});

test('un tour encore en cours range sa carte sous le dernier passage, sans durée sous le début', () => {
  assert.equal(finDuTourDuMessage({ createdAt: 110, durationMs: 50, streaming: true }), Number.POSITIVE_INFINITY);
  assert.equal(finDuTourDuMessage({ createdAt: 110 }), 110);
  const rangees = rangerLesSuggestions(passages, [{ at: finDuTourDuMessage({ createdAt: 110, streaming: true }) }]);
  assert.equal(rangees.get('point-travail')?.length, 1);
});
