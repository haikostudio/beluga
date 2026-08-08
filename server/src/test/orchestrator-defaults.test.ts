import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineId, ModelInfo } from '@haikodev/shared';
import { orchestratorChoice } from '../engines/catalog.js';

function model(id: string, thinking = ['none', 'medium', 'high']): ModelInfo {
  return ModelInfo.parse({
    id,
    label: id.replaceAll('-', ' '),
    thinking: thinking.map((level) => ({ id: level, label: level })),
    defaultThinking: thinking[0],
  });
}

function choice(engine: EngineId, models: ModelInfo[], wanted?: string, thinking?: string) {
  return orchestratorChoice(engine, models, wanted, thinking);
}

test('un chef Claude choisit Sonnet 5 avec une réflexion moyenne', () => {
  const models = [model('claude-opus-5'), model('claude-sonnet-5-20260801')];
  assert.deepEqual(choice('claude', models), {
    model: 'claude-sonnet-5-20260801',
    thinking: 'medium',
  });
});

test('un chef Codex choisit GPT-5.4 avec une réflexion moyenne', () => {
  const models = [model('gpt-5.6-sol'), model('gpt-5.4')];
  assert.deepEqual(choice('codex', models), { model: 'gpt-5.4', thinking: 'medium' });
});

test('un réglage manuel reste prioritaire sur le défaut du chef', () => {
  const models = [model('gpt-5.4'), model('gpt-5.6-terra')];
  assert.deepEqual(choice('codex', models, 'gpt-5.6-terra', 'high'), {
    model: 'gpt-5.6-terra',
    thinking: 'high',
  });
});

test('un modèle préféré absent se replie sur un modèle réellement disponible', () => {
  const models = [model('gpt-5.1-codex-max'), model('gpt-5.1-codex')];
  const retained = choice('codex', models);
  assert.ok(models.some((entry) => entry.id === retained.model));
  assert.equal(retained.model, 'gpt-5.1-codex-max');
  assert.equal(retained.thinking, 'medium');
});
