import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MEMORY_STEP_ID, Message } from '@haikodev/shared';
import { EngineEvent, normalizeTodos } from '../engines/types.js';
import { emitFromClaude } from '../engines/claude.js';
import { emitFromCodex } from '../engines/codex.js';
import { appendMemory, memorySummary } from '../memory.js';
import { ORCHESTRATOR_ALLOWED_NATIVE, ORCHESTRATOR_DENIED_NATIVE } from '../tools.js';

/* ------------------------------------------------------------------ */
/* Le déroulé visible dans la conversation (PLAN §26)                  */
/* ------------------------------------------------------------------ */

test('la mémoire relue se résume en un nombre de faits et son texte', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-memoire-'));
  try {
    assert.deepEqual(memorySummary(dossier), { facts: 0, text: '' });

    appendMemory(dossier, 'Le démon est la source de vérité.');
    appendMemory(dossier, 'Une carte naît toujours dans « À faire ».');

    const resume = memorySummary(dossier);
    assert.equal(resume.facts, 2);
    assert.match(resume.text, /source de vérité/);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('l\'étape de mémoire garde un identifiant réservé, que l\'interface sait isoler', () => {
  const message = Message.parse({
    id: 'm1',
    agentId: 'a1',
    role: 'assistant',
    steps: [
      { id: MEMORY_STEP_ID, label: 'Lecture de la mémoire du projet — 2 faits retenus', state: 'done' },
      { id: 'outil-1', label: 'Lecture de un/fichier.ts', state: 'done' },
    ],
    createdAt: Date.now(),
  });
  const memoire = message.steps.find((step) => step.id === MEMORY_STEP_ID);
  assert.ok(memoire, 'la mémoire doit être retrouvable en tête');
  assert.equal(message.steps.filter((step) => step.id !== MEMORY_STEP_ID).length, 1);
});

test('un message enregistré avant cette version reste lisible, sans liste de tâches', () => {
  // Règle du protocole : jamais de champ obligatoire ajouté.
  const ancien = Message.parse({ id: 'm2', agentId: 'a1', role: 'assistant', createdAt: Date.now() });
  assert.deepEqual(ancien.todos, []);
});

test('la liste de tâches de Claude est traduite dans le format unique', () => {
  const todos = normalizeTodos([
    { content: 'Lire le code du chat', status: 'completed', activeForm: 'Lecture du code' },
    { content: 'Ajouter la liste de tâches', status: 'in_progress' },
    { content: 'Lancer les tests', status: 'pending' },
  ]);
  assert.deepEqual(todos, [
    { label: 'Lire le code du chat', state: 'done' },
    { label: 'Ajouter la liste de tâches', state: 'running' },
    { label: 'Lancer les tests', state: 'todo' },
  ]);
});

test('le plan de Codex donne exactement la même liste', () => {
  const todos = normalizeTodos([
    { step: 'Lire le code du chat', completed: true },
    { step: 'Ajouter la liste de tâches', completed: false },
  ]);
  assert.deepEqual(todos, [
    { label: 'Lire le code du chat', state: 'done' },
    { label: 'Ajouter la liste de tâches', state: 'todo' },
  ]);
});

test('une liste absente ou vide ne casse rien', () => {
  assert.deepEqual(normalizeTodos(undefined), []);
  assert.deepEqual(normalizeTodos([{ status: 'pending' }, '', null]), []);
});

test('le flux de Claude sort une liste de tâches, pas une étape de plus', () => {
  const events: EngineEvent[] = [];
  emitFromClaude(
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'TodoWrite',
            input: { todos: [{ content: 'Lire le chat', status: 'in_progress' }] },
          },
        ],
      },
    },
    (event) => events.push(event),
    new Map(),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'todo');
  assert.deepEqual(events[0].todos, [{ label: 'Lire le chat', state: 'running' }]);
});

test('le flux de Codex sort la même liste, dans le même format', () => {
  const events: EngineEvent[] = [];
  emitFromCodex(
    {
      type: 'item.updated',
      item: { id: 'plan-1', type: 'todo_list', items: [{ text: 'Lire le chat', completed: true }] },
    },
    (event) => events.push(event),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'todo');
  assert.deepEqual(events[0].todos, [{ label: 'Lire le chat', state: 'done' }]);
});

test('le chef d\'orchestre peut annoncer sa liste de tâches, qui ne touche à rien', () => {
  assert.ok(ORCHESTRATOR_ALLOWED_NATIVE.includes('TodoWrite'));
  assert.equal(ORCHESTRATOR_DENIED_NATIVE.includes('TodoWrite'), false);
});
