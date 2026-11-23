import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent, Message } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* UNE REPRISE SE CONSOMME UNE FOIS, ET NE SE REJOUE JAMAIS             */
/*                                                                     */
/* La demande « REPRISE APRÈS ÉPUISEMENT DU QUOTA » attend en file      */
/* comme toute demande écrite pendant qu'un agent travaille. Rejouée   */
/* vers un tour déjà terminé — après un redémarrage, ou parce que deux  */
/* relèves s'étaient empilées —, elle ouvrait un tour de plus sur un    */
/* travail déjà rendu (quatre fois de suite le 06.09.2026).             */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'reprise-consommee-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const runtime = await import('../runtime.js');

const AGENT = 'agent-reprise';
const now = Date.now();
store.saveAgent(
  Agent.parse({
    id: AGENT,
    projectId: 'p',
    title: 'essai',
    role: 'task',
    status: 'idle',
    run: { engine: 'claude' },
    createdAt: now,
    updatedAt: now,
  }),
);

function tourCoupe(id: string, patch: Record<string, unknown> = {}): Message {
  return store.saveMessage(
    Message.parse({
      id,
      agentId: AGENT,
      role: 'assistant',
      content: 'Fable 5.1 requires usage credits.',
      createdAt: now,
      repriseCompte: {
        engine: 'claude',
        compteEpuise: 'claude-pro',
        compteEpuiseLabel: 'Claude Pro',
        motif: 'texte-de-limite',
        choisi: 'claude-max20',
        choisiLabel: 'Claude Max x20',
        choisiA: now,
        automatique: true,
        at: now,
        ...patch,
      },
    }),
  );
}

test('la reprise que porte une demande traverse la file, en base', () => {
  tourCoupe('coupe-1');
  store.enqueuePrompt(AGENT, 'REPRISE APRÈS ÉPUISEMENT DU QUOTA.', [], undefined, {
    silencieuse: true,
    compteImpose: 'claude-max20',
    repriseDe: 'coupe-1',
  });
  const [enFile] = store.listQueue(AGENT);
  assert.equal(enFile.repriseDe, 'coupe-1');
  store.clearQueue(AGENT);
});

test('une reprise CONSOMMÉE est jetée de la file par le filet de veille, sans chercher de compte', async () => {
  tourCoupe('coupe-2', { consommeeA: now + 1 });
  store.enqueuePrompt(AGENT, 'REPRISE APRÈS ÉPUISEMENT DU QUOTA.', [], undefined, {
    silencieuse: true,
    compteImpose: 'claude-max20',
    repriseDe: 'coupe-2',
  });
  // Une demande ordinaire derrière elle n'est pas touchée.
  store.enqueuePrompt(AGENT, 'Et maintenant, ajoute un bouton.', []);
  await runtime.reprendreLesFilesEnAttente();
  const restantes = store.listQueue(AGENT);
  assert.equal(restantes.length, 1, 'seule la reprise morte est partie');
  assert.equal(restantes[0].text, 'Et maintenant, ajoute un bouton.');
  store.clearQueue(AGENT);
});

test('une reprise ABANDONNÉE est jetée elle aussi ; une reprise vivante reste', async () => {
  tourCoupe('coupe-3', { choisi: undefined, choisiLabel: undefined, choisiA: undefined, automatique: undefined, abandonnee: true, abandonneeA: now });
  tourCoupe('coupe-4');
  store.enqueuePrompt(AGENT, 'reprise morte', [], undefined, { silencieuse: true, repriseDe: 'coupe-3' });
  store.enqueuePrompt(AGENT, 'reprise vivante', [], undefined, { silencieuse: true, compteImpose: 'claude-max20', repriseDe: 'coupe-4' });
  await runtime.reprendreLesFilesEnAttente();
  const restantes = store.listQueue(AGENT);
  assert.deepEqual(
    restantes.map((d) => d.text),
    ['reprise vivante'],
  );
  store.clearQueue(AGENT);
});

test('une reprise consommée ne compte plus comme décision en attente', () => {
  tourCoupe('coupe-5', { choisi: undefined, choisiLabel: undefined, choisiA: undefined, automatique: undefined, consommeeA: now });
  assert.ok(!store.reprisesDeCompteEnAttente().some((a) => a.messageId === 'coupe-5'));
});
