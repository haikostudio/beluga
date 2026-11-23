import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ClientCommand, TaskProposal, messageDIntegration, propositionsEnAttente } from '@beluga/shared';

/**
 * « INTÉGRER À CETTE CARTE » : une suggestion faite dans la conversation d'une
 * carte part en MESSAGE à l'agent de cette carte, au lieu de devenir une carte.
 * Elle passe alors en « integrated » et ne réclame plus de clic.
 */

test('le message d’intégration porte le titre puis la description', () => {
  assert.equal(
    messageDIntegration('  Bouton Fusionner ', 'Rendre la sélection multiple.'),
    'Intègre cette suggestion à ton travail sur cette carte : Bouton Fusionner\n\nRendre la sélection multiple.',
  );
  assert.equal(messageDIntegration('Titre seul', '  '), 'Intègre cette suggestion à ton travail sur cette carte : Titre seul');
});

test('une suggestion intégrée n’attend plus de décision', () => {
  const integree = TaskProposal.parse({ id: 'p1', title: 'A', description: 'a', decision: 'integrated' });
  const attente = TaskProposal.parse({ id: 'p2', title: 'B', description: 'b' });
  const restantes = propositionsEnAttente([{ id: 'm1', proposals: [integree, attente] }]);
  assert.deepEqual(restantes.map((entree) => entree.proposal.id), ['p2']);
});

test('la commande « proposal.integrate » est reconnue par le protocole', () => {
  const lue = ClientCommand.safeParse({ type: 'proposal.integrate', messageId: 'm1', proposalId: 'p1', title: 'T' });
  assert.ok(lue.success);
});

test('le serveur passe par la barre d’écriture et réserve la proposition contre le double clic', () => {
  const source = readFileSync(new URL('../../src/ws.ts', import.meta.url), 'utf8');
  const bloc = source.slice(source.indexOf("case 'proposal.integrate'"), source.indexOf("case 'proposal.merge'"));
  assert.match(bloc, /decisionsEnCours\.has\(proposal\.id\)/);
  assert.match(bloc, /type: 'agent\.prompt'/);
  // Le message part AVANT que la proposition soit marquée : un refus la laisse en attente.
  assert.ok(bloc.indexOf("type: 'agent.prompt'") < bloc.indexOf("decideProposal(proposal.id, 'integrated')"));
});

test('« Intégrer à cette carte » répond sous quelques secondes, et un refus tardif remet la suggestion en attente', () => {
  const source = readFileSync(new URL('../../src/ws.ts', import.meta.url), 'utf8');
  const bloc = source.slice(source.indexOf("case 'proposal.integrate'"), source.indexOf("case 'proposal.merge'"));
  assert.match(source, /const DELAI_D_INTEGRATION_MS = \d{4};/);
  assert.match(bloc, /Promise\.race/);
  assert.match(bloc, /marquer\('pending'\)/);
  // La réservation anti double clic tient jusqu'à la fin RÉELLE de l'envoi.
  assert.match(bloc, /\.finally\(\(\) => decisionsEnCours\.delete\(proposal\.id\)\)/);
});
