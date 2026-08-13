import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* LE FILET : un agent marqué « au travail » que plus personne          */
/* n'attend est refermé par la veille de l'ordonnanceur.                */
/* ------------------------------------------------------------------ */

// La base jetable se pose AVANT d'importer les modules qui la lisent
// (piège connu : un import statique fige le chemin réel).
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-bloque-'));
process.env.HAIKODEV_DATA = bacASable;

const { Agent, Message, Project } = await import('@haikodev/shared');
const store = await import('../store.js');
const { refermerLeTour, veilleDesToursBloques, isRunning } = await import('../runtime.js');

function poserAgent(id: string, contenu: string) {
  const projet = store.saveProject(
    Project.parse({
      id: `projet-${id}`,
      name: `Projet ${id}`,
      path: bacASable,
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  store.saveAgent(
    Agent.parse({
      id,
      projectId: projet.id,
      role: 'orchestrator',
      title: 'Chef d’orchestre',
      run: { engine: 'claude' },
      status: 'running',
      startedAt: store.now() - 3_600_000,
      createdAt: store.now() - 3_600_000,
      updatedAt: store.now() - 3_600_000,
    }),
  );
  return store.saveMessage(
    Message.parse({
      id: `message-${id}`,
      agentId: id,
      role: 'assistant',
      content: contenu,
      streaming: true,
      createdAt: store.now(),
    }),
  );
}

test('un agent « au travail » que le serveur ne suit plus est remis au repos', () => {
  const message = poserAgent('agent-orphelin', 'La réponse était pourtant écrite.');
  assert.equal(isRunning('agent-orphelin'), false, 'le tour n’est plus suivi');

  const refermes = veilleDesToursBloques();
  assert.ok(refermes >= 1);

  const agent = store.getAgent('agent-orphelin')!;
  // La réponse était rendue : c'est un travail fini, pas un échec.
  assert.equal(agent.status, 'done');
  assert.ok(agent.endedAt);

  const fige = store.getMessage(message.id)!;
  assert.equal(fige.streaming, false, 'le message ne s’écrit plus');
  assert.equal(fige.error, undefined, 'une réponse rendue ne porte pas de bandeau rouge');
});

test('un tour coupé sans rien rendre est un échec, et la raison est dite', () => {
  const message = poserAgent('agent-muet', '');
  refermerLeTour('agent-muet', 'Le moteur s’est arrêté sans rendre la main.');

  assert.equal(store.getAgent('agent-muet')!.status, 'failed');
  assert.match(store.getMessage(message.id)!.error ?? '', /sans rendre la main/);
});

test('refermer un agent déjà au repos ne fait rien', () => {
  poserAgent('agent-fini', 'Terminé.');
  refermerLeTour('agent-fini', 'première fermeture');
  assert.equal(refermerLeTour('agent-fini', 'seconde fermeture'), false);
  assert.equal(veilleDesToursBloques(), 0, 'plus rien à refermer');
});

test('un agent inconnu ne fait pas tomber la veille', () => {
  assert.equal(refermerLeTour('agent-qui-n-existe-pas', 'peu importe'), false);
});
