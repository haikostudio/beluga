import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAUSE_CONVERSATION_MS,
  SEUIL_PAROLE_CONVERSATION,
  reponseVocaleDeLAgent,
  type MessageLisible,
} from '@haikodev/shared';

const m = (over: Partial<MessageLisible>): MessageLisible => ({
  role: 'assistant',
  content: 'ok',
  createdAt: 100,
  ...over,
});

test('la pause de conversation est plus longue que la coupe du mot de réveil', () => {
  // Deux secondes pour le mot de réveil, trois pour la conversation : on laisse
  // le temps de respirer avant d'envoyer une phrase parlée.
  assert.equal(PAUSE_CONVERSATION_MS, 3000);
  assert.ok(SEUIL_PAROLE_CONVERSATION > 0 && SEUIL_PAROLE_CONVERSATION < 1);
});

test('la réponse lue est le dernier message d’assistant posté après l’envoi', () => {
  const msgs: MessageLisible[] = [
    m({ role: 'user', content: 'ma question', createdAt: 60 }),
    m({ content: 'vieille réponse', createdAt: 90 }),
    m({ content: 'première réponse', createdAt: 110 }),
    m({ content: 'dernière réponse', createdAt: 130 }),
  ];
  assert.equal(reponseVocaleDeLAgent(msgs, 100), 'dernière réponse');
});

test('rien à lire tant qu’aucune réponse d’assistant n’est arrivée après l’envoi', () => {
  const msgs: MessageLisible[] = [
    m({ content: 'réponse d’avant', createdAt: 90 }),
    m({ role: 'user', content: 'ma phrase', createdAt: 120 }),
  ];
  assert.equal(reponseVocaleDeLAgent(msgs, 100), '');
});

test('un message encore en cours d’écriture, vide, ou non-assistant est écarté', () => {
  const msgs: MessageLisible[] = [
    m({ content: 'en cours', createdAt: 130, streaming: true }),
    m({ content: '   ', createdAt: 125 }),
    m({ role: 'system', content: 'note système', createdAt: 128 }),
    m({ role: 'tool', content: 'sortie outil', createdAt: 127 }),
    m({ content: 'la bonne réponse', createdAt: 115 }),
  ];
  assert.equal(reponseVocaleDeLAgent(msgs, 100), 'la bonne réponse');
});
