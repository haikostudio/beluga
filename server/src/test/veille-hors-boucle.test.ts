import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* LE FILET TOURNE HORS DE LA BOUCLE D'ORDONNANCEMENT.                  */
/*                                                                      */
/* `passageDeVeille` est ce qui referme les agents bloqués. Il vivait    */
/* en tête de `tick`, derrière le verrou « un tour à la fois » de la     */
/* boucle : un seul `await` pendu là-dedans et le filet ne repassait     */
/* plus jamais. Ce test vérifie qu'il s'appelle SEUL, sans rien attendre.*/
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'veille-hors-boucle-'));
process.env.HAIKODEV_DATA = bacASable;

const { Agent, Message, Project } = await import('@haikodev/shared');
const store = await import('../store.js');
const { passageDeVeille, startVeille } = await import('../scheduler.js');

function poserAgentFige(id: string): { messageId: string } {
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
      role: 'analysis',
      title: 'Auto-amélioration',
      run: { engine: 'claude' },
      status: 'running',
      startedAt: store.now() - 220 * 60_000,
      createdAt: store.now() - 220 * 60_000,
      updatedAt: store.now() - 220 * 60_000,
    }),
  );
  const message = store.saveMessage(
    Message.parse({
      id: `message-${id}`,
      agentId: id,
      role: 'assistant',
      content: '',
      streaming: true,
      createdAt: store.now(),
    }),
  );
  return { messageId: message.id };
}

test('LE CAS DU 17/08 : la veille referme seule un agent d’auto-amélioration figé 220 minutes', () => {
  const { messageId } = poserAgentFige('analyse-de-la-nuit');

  // Aucun tour de boucle n'est lancé : c'est tout l'objet du changement.
  passageDeVeille();

  const agent = store.getAgent('analyse-de-la-nuit')!;
  assert.notEqual(agent.status, 'running', 'l’agent ne doit plus être « au travail »');
  assert.ok(agent.endedAt, 'son tour est daté');

  const dernier = store.getMessage(messageId)!;
  assert.equal(dernier.streaming, false, 'plus rien ne s’écrit à l’écran');
});

test('la veille repasse sans rien casser quand il n’y a plus rien à refermer', () => {
  assert.doesNotThrow(() => passageDeVeille());
  assert.doesNotThrow(() => passageDeVeille());
});

test('la veille a son PROPRE minuteur, distinct de l’ordonnanceur', () => {
  const minuteur = startVeille();
  assert.ok(minuteur, 'un minuteur à elle seule');
  clearInterval(minuteur);
});
