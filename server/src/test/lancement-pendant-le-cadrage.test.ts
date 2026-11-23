/**
 * AUCUN LANCEMENT TANT QUE LE CADRAGE N'EST PAS FINI (carte Wogo 4d0aeccc,
 * 01/11/2026).
 *
 * Un lancement reçu pendant que le cadrage posait ses questions faisait partir
 * un second agent à côté de lui ; le travail était livré avant les réponses.
 * Ici : une question du cadrage encore ouverte refuse tout lancement (la garde
 * passe par `decisionOuverteSurLaCarte`, que `startCard` consulte pour TOUS les
 * chemins) ; répondue, le lancement redevient libre ; une carte sans agent de
 * cadrage n'est pas concernée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'lancement-cadrage-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { createCard } = await import('../tools.js');
const { decisionOuverteSurLaCarte, startCard } = await import('../scheduler.js');

function projet() {
  return store.saveProject({ id: store.newId(), name: 'Garde', path: bacASable, createdAt: store.now(), updatedAt: store.now() } as any);
}

function cadrage(projectId: string, cardId: string) {
  return store.saveAgent({
    id: store.newId(),
    projectId,
    cardId,
    role: 'cadrage',
    title: 'Cadrage',
    run: { engine: 'claude' },
    status: 'idle',
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

function messageAvecQuestion(agentId: string, reponse?: string) {
  return store.saveMessage({
    id: store.newId(),
    agentId,
    role: 'assistant',
    content: '',
    questions: [
      {
        id: 'q1',
        question: 'Comment regrouper les lieux ?',
        kind: 'single',
        options: [{ id: 'o0', label: 'Par ville' }, { id: 'o1', label: 'Par zone' }],
        ...(reponse ? { answer: reponse } : {}),
      },
    ],
    createdAt: store.now(),
  } as any);
}

test('une question du cadrage encore ouverte refuse le lancement, par tous les chemins', async () => {
  const p = projet();
  const carte = createCard(p.id, { title: 'Compteur sur la carte', origin: 'user' });
  const agent = cadrage(p.id, carte.id);
  const message = messageAvecQuestion(agent.id);

  assert.match(decisionOuverteSurLaCarte(carte.id) ?? '', /le cadrage attend votre réponse à sa question/);
  const lance = await startCard(carte.id);
  assert.equal(lance.ok, false);
  assert.match(lance.error ?? '', /^Lancement refusé : le cadrage attend votre réponse/);
  assert.equal(store.getCard(carte.id)?.column, 'planned', 'la carte ne bouge pas');
  assert.equal(store.getLastAgentByCard(carte.id)?.id, agent.id, 'aucun second agent n’est né');

  /* Répondue, la question ne retient plus rien. */
  store.saveMessage({ ...message, questions: [{ ...message.questions[0], answer: 'Par zone' }] } as any);
  assert.equal(decisionOuverteSurLaCarte(carte.id), null);
});

test('une carte sans agent de cadrage (chef, saisie à la main) n’est pas retenue', () => {
  const p = projet();
  const carte = createCard(p.id, { title: 'Écrite à la main', origin: 'user' });
  assert.equal(decisionOuverteSurLaCarte(carte.id), null);
});
