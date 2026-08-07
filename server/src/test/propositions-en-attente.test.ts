import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DESCRIPTION_REPLIEE_MAX,
  descriptionRepliable,
  propositionEnAttente,
  propositionsDuFil,
  propositionsEnAttente,
} from '@haikodev/shared';

/** Une proposition, réduite à ce que le tri regarde. */
const p = (id: string, decision?: 'pending' | 'accepted' | 'refused') => ({ id, decision });

const FIL = [
  { id: 'm1', agentId: 'a1', proposals: [p('p1', 'accepted')] },
  { id: 'm2', agentId: 'a1', proposals: [] },
  { id: 'm3', agentId: 'a2', proposals: [p('p2'), p('p3', 'refused')] },
  { id: 'm4', agentId: 'a2', proposals: [p('p4', 'pending')] },
];

test('une décision absente vaut « en attente » : c’est la valeur de départ', () => {
  assert.equal(propositionEnAttente({}), true);
  assert.equal(propositionEnAttente({ decision: 'pending' }), true);
  assert.equal(propositionEnAttente({ decision: 'accepted' }), false);
  assert.equal(propositionEnAttente({ decision: 'refused' }), false);
});

test('le bandeau prend les propositions en attente, dans l’ordre des messages', () => {
  const attente = propositionsEnAttente(FIL);
  assert.deepEqual(
    attente.map((entree) => entree.proposal.id),
    ['p2', 'p4'],
  );
  // Chacune emporte de quoi être décidée : son message et son agent.
  assert.deepEqual(
    attente.map((entree) => [entree.messageId, entree.agentId]),
    [
      ['m3', 'a2'],
      ['m4', 'a2'],
    ],
  );
});

test('aucune proposition en attente : la liste est vide, le bandeau ne rend rien', () => {
  assert.deepEqual(propositionsEnAttente([{ id: 'm1', proposals: [p('p1', 'refused')] }]), []);
  assert.deepEqual(propositionsEnAttente([]), []);
});

test('une proposition décidée reste dans le fil, jamais les deux à la fois', () => {
  const message = FIL[2];
  assert.deepEqual(
    propositionsDuFil(message.proposals).map((proposal) => proposal.id),
    ['p3'],
  );
  // Rien ne se perd : ce qui sort du fil entre dans le bandeau.
  const dansLeBandeau = propositionsEnAttente([message]).map((entree) => entree.proposal.id);
  const dansLeFil = propositionsDuFil(message.proposals).map((proposal) => proposal.id);
  assert.deepEqual([...dansLeBandeau, ...dansLeFil].sort(), ['p2', 'p3']);
});

test('une description longue est repliée, une courte ne l’est pas', () => {
  assert.equal(descriptionRepliable(undefined), false);
  assert.equal(descriptionRepliable('   '), false);
  assert.equal(descriptionRepliable('x'.repeat(DESCRIPTION_REPLIEE_MAX)), false);
  assert.equal(descriptionRepliable('x'.repeat(DESCRIPTION_REPLIEE_MAX + 1)), true);
});

test('une description de carte en règle (320 signes au moins) est toujours repliée', () => {
  assert.ok(DESCRIPTION_REPLIEE_MAX < 320);
});
