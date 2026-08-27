import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TaskProposal } from '@haikodev/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'fusion-propositions-store-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');

function projet(id: string) {
  return store.saveProject({
    id,
    name: id,
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

function agent(id: string, projectId: string) {
  return store.saveAgent({
    id,
    projectId,
    role: 'cadrage',
    title: 'Chef',
    run: { engine: 'claude', thinking: 'medium', mode: 'direct' },
    status: 'done',
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

function proposition(id: string, title: string, attachment: string): TaskProposal {
  return {
    id,
    title,
    description: [
      `Constat : le fichier \`web/src/${id}.tsx\` traite cette partie.`,
      `Attendu : réaliser ${title.toLowerCase()}.`,
      'Limites : attendre le clic final avant toute carte.',
      `Vérification : contrôler ${id} dans le navigateur.`,
    ].join('\n'),
    labels: ['interface'],
    attachments: [attachment],
    decision: 'pending',
    sourceProposalIds: [],
  };
}

function message(id: string, agentId: string, proposal: TaskProposal) {
  const value = store.saveMessage({
    id,
    agentId,
    role: 'assistant',
    content: 'Proposition',
    proposals: [proposal],
    createdAt: store.now(),
  } as any);
  const projetAgent = store.getAgent(agentId)!;
  store.saveProposal(id, projetAgent.projectId, proposal);
  return value;
}

test('la base fusionne atomiquement, survit à la relecture et ne crée aucune carte', () => {
  const p = projet('projet-a');
  const a = agent('agent-a', p.id);
  const premiere = proposition('prop-a', 'Préparer les données', 'image-a');
  const seconde = proposition('prop-b', 'Afficher les données', 'image-b');
  message('message-a', a.id, premiere);
  message('message-b', a.id, seconde);

  const avant = store.listCards(p.id).length;
  const resultat = store.mergePendingProposals([
    { messageId: 'message-a', proposalId: premiere.id },
    { messageId: 'message-b', proposalId: seconde.id },
  ]);

  assert.equal(store.listCards(p.id).length, avant, 'la fusion ne crée aucune carte');
  assert.equal(resultat.proposal.decision, 'pending');
  assert.deepEqual(resultat.proposal.attachments, ['image-a', 'image-b']);
  assert.equal(store.getMessage('message-a')?.proposals.find((item) => item.id === premiere.id)?.decision, 'merged');
  assert.equal(store.getMessage('message-b')?.proposals.find((item) => item.id === seconde.id)?.decision, 'merged');
  assert.equal(
    store.getMessage('message-a')?.proposals.some((item) => item.id === resultat.proposal.id && item.decision === 'pending'),
    true,
    'la proposition composée est relue depuis le message persistant',
  );

  const rejoue = store.mergePendingProposals([
    { messageId: 'message-a', proposalId: premiere.id },
    { messageId: 'message-b', proposalId: seconde.id },
  ]);
  assert.equal(rejoue.already, true, 'un double clic ne fabrique pas une deuxième fusion');
  assert.equal(rejoue.proposal.id, resultat.proposal.id);
});

test('des propositions de projets différents ou déjà décidées sont refusées sans changement partiel', () => {
  const p1 = projet('projet-b');
  const p2 = projet('projet-c');
  const a1 = agent('agent-b', p1.id);
  const a2 = agent('agent-c', p2.id);
  const une = proposition('prop-c', 'Travail C', 'image-c');
  const deux = proposition('prop-d', 'Travail D', 'image-d');
  message('message-c', a1.id, une);
  message('message-d', a2.id, deux);

  assert.throws(
    () =>
      store.mergePendingProposals([
        { messageId: 'message-c', proposalId: une.id },
        { messageId: 'message-d', proposalId: deux.id },
      ]),
    /même projet/,
  );
  assert.equal(store.getMessage('message-c')?.proposals[0].decision, 'pending');
  assert.equal(store.getMessage('message-d')?.proposals[0].decision, 'pending');
});
