import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type Message,
  differencesDeTexte,
  messagesDePlan,
  numeroDeVersion,
  versionsPrecedentes,
  versionSuivante,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Les versions d'un plan : numérotage, précédentes, suivante.          */
/* ------------------------------------------------------------------ */

function messagePlan(id: string, content: string, createdAt: number): Message {
  return {
    id,
    agentId: 'agent-1',
    role: 'assistant',
    content,
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    streaming: false,
    plan: true,
    texteLibreAnnulee: false,
    createdAt,
  };
}

function messageOrdinaire(id: string, content: string, createdAt: number): Message {
  return { ...messagePlan(id, content, createdAt), plan: false };
}

const conversation: Message[] = [
  messageOrdinaire('u1', 'prépare la refonte', 1),
  messagePlan('p1', 'version 1 du plan', 2),
  messageOrdinaire('u2', 'ajuste ceci', 3),
  messagePlan('p2', 'version 2 du plan', 4),
  messageOrdinaire('u3', 'encore un ajustement', 5),
  messagePlan('p3', 'version 3 du plan', 6),
];

test('messagesDePlan écarte les messages sans plan et les plans vides', () => {
  const plans = messagesDePlan(conversation);
  assert.deepEqual(plans.map((m) => m.id), ['p1', 'p2', 'p3']);
});

test('numeroDeVersion numérote les plans dans l’ordre, 1-based', () => {
  assert.equal(numeroDeVersion(conversation, 'p1'), 1);
  assert.equal(numeroDeVersion(conversation, 'p2'), 2);
  assert.equal(numeroDeVersion(conversation, 'p3'), 3);
});

test('numeroDeVersion rend 0 pour un message qui ne porte pas de plan', () => {
  assert.equal(numeroDeVersion(conversation, 'u2'), 0);
  assert.equal(numeroDeVersion(conversation, 'introuvable'), 0);
});

test('versionsPrecedentes rend les versions antérieures, la plus récente d’abord', () => {
  assert.deepEqual(versionsPrecedentes(conversation, 'p3').map((m) => m.id), ['p2', 'p1']);
  assert.deepEqual(versionsPrecedentes(conversation, 'p1'), []);
});

test('versionSuivante retrouve la version qui suit, undefined pour la dernière', () => {
  assert.equal(versionSuivante(conversation, 'p1')?.id, 'p2');
  assert.equal(versionSuivante(conversation, 'p2')?.id, 'p3');
  assert.equal(versionSuivante(conversation, 'p3'), undefined);
});

/* ------------------------------------------------------------------ */
/* La différence ligne à ligne entre deux versions.                     */
/* ------------------------------------------------------------------ */

test('differencesDeTexte : un texte identique ne rend que des lignes égales', () => {
  const diff = differencesDeTexte('a\nb\nc', 'a\nb\nc');
  assert.ok(diff.every((l) => l.type === 'egal'));
  assert.equal(diff.length, 3);
});

test('differencesDeTexte : une ligne ajoutée ressort en « ajoute »', () => {
  const diff = differencesDeTexte('a\nb', 'a\nb\nc');
  assert.deepEqual(diff, [
    { type: 'egal', texte: 'a' },
    { type: 'egal', texte: 'b' },
    { type: 'ajoute', texte: 'c' },
  ]);
});

test('differencesDeTexte : une ligne retirée ressort en « retire »', () => {
  const diff = differencesDeTexte('a\nb\nc', 'a\nc');
  assert.deepEqual(diff, [
    { type: 'egal', texte: 'a' },
    { type: 'retire', texte: 'b' },
    { type: 'egal', texte: 'c' },
  ]);
});

test('differencesDeTexte : une ligne changée ressort en retire + ajoute', () => {
  const diff = differencesDeTexte('a\nb\nc', 'a\nB\nc');
  assert.deepEqual(diff, [
    { type: 'egal', texte: 'a' },
    { type: 'retire', texte: 'b' },
    { type: 'ajoute', texte: 'B' },
    { type: 'egal', texte: 'c' },
  ]);
});
