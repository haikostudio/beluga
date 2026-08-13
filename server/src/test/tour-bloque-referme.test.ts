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

/* ------------------------------------------------------------------ */
/* L'ÉCRITURE ORPHELINE : un message resté « en cours d'écriture »      */
/* alors que son agent est au repos depuis. C'est ce qui laissait le    */
/* bandeau « réflexion en cours » allumé indéfiniment.                  */
/* ------------------------------------------------------------------ */

test('la veille éteint un message resté en écriture sur un agent en échec', () => {
  const message = poserAgent('agent-ecriture-orpheline', 'Une réponse à moitié écrite.');
  // Le tour s'est refermé en échec APRÈS la naissance du message, et une
  // dernière bribe a rallumé la marque derrière la fermeture.
  const agent = store.getAgent('agent-ecriture-orpheline')!;
  store.saveAgent({ ...agent, status: 'failed', endedAt: message.createdAt + 1_000 });
  store.saveMessage({ ...store.getMessage(message.id)!, streaming: true });

  veilleDesToursBloques();

  assert.equal(store.getMessage(message.id)!.streaming, false, 'la marque d’écriture est éteinte');
  assert.equal(store.getAgent('agent-ecriture-orpheline')!.status, 'failed', 'le verdict du tour ne change pas');
});

test('un message du tour qui démarre n’est jamais pris pour un orphelin', () => {
  const message = poserAgent('agent-qui-demarre', '');
  // L'agent n'est pas encore passé « au travail » : le message vient de naître,
  // il est plus récent que la fin du tour précédent.
  const agent = store.getAgent('agent-qui-demarre')!;
  store.saveAgent({ ...agent, status: 'idle', endedAt: message.createdAt - 1_000 });

  veilleDesToursBloques();

  assert.equal(store.getMessage(message.id)!.streaming, true, 'le tour qui démarre garde sa marque');
});
