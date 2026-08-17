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
  const { model, thinking: cran } = orchestratorChoice(engine, models, wanted, thinking);
  return { model, thinking: cran };
}

/** Le choix ENTIER, avec ce qui a été ramené sous le plafond du chef. */
function choixComplet(engine: EngineId, models: ModelInfo[], wanted?: string, thinking?: string) {
  return orchestratorChoice(engine, models, wanted, thinking);
}

/*
 * Le chef ne fait plus qu'un tri : rédiger une carte courte et choisir le niveau
 * de l'agent qui l'exécutera. Payer un modèle de raisonnement pour ce geste-là
 * revenait à payer une analyse à chaque message — d'où Haiku 4.5.
 */
test('un chef Claude choisit Haiku 4.5, le modèle économe', () => {
  const models = [model('claude-opus-5'), model('claude-sonnet-5-20260801'), model('claude-haiku-4-5-20251001')];
  assert.deepEqual(choice('claude', models), {
    model: 'claude-haiku-4-5-20251001',
    thinking: 'medium',
  });
});

test('sans Haiku au catalogue, le chef Claude se replie sur un modèle réel', () => {
  const models = [model('claude-opus-5'), model('claude-sonnet-5-20260801')];
  const retenu = choice('claude', models);
  assert.ok(models.some((entry) => entry.id === retenu.model), `modèle inventé : ${retenu.model}`);
});

test('un chef Codex choisit GPT-5.4 avec une réflexion moyenne', () => {
  const models = [model('gpt-5.6-sol'), model('gpt-5.4')];
  assert.deepEqual(choice('codex', models), { model: 'gpt-5.4', thinking: 'medium' });
});

/*
 * UN CHOIX MANUEL ÉCONOME EST RESPECTÉ — mais la RÉFLEXION reste plafonnée.
 * Un chef qui ne fait que trier n'a jamais besoin du cran le plus poussé, et
 * c'est ce cran, retenu une fois à l'écran, qui pesait 25 % du quota du serveur
 * (relevé du 17/08/2026).
 */
test('un réglage manuel garde son modèle, mais sa réflexion redescend', () => {
  const models = [model('gpt-5.4'), model('gpt-5.6-terra')];
  assert.deepEqual(choice('codex', models, 'gpt-5.6-terra', 'high'), {
    model: 'gpt-5.6-terra',
    thinking: 'medium',
  });
});

test('un modèle GOURMAND retenu à l’écran est ramené sur l’épinglé, et c’est DIT', () => {
  const opus = ModelInfo.parse({
    id: 'claude-opus-5',
    label: 'claude opus 5',
    thinking: [{ id: 'high', label: 'high' }, { id: 'medium', label: 'medium' }],
    appetite: 'heavy',
  });
  const models = [opus, model('claude-haiku-4-5-20251001')];
  const retenu = choixComplet('claude', models, 'claude-opus-5', 'high');
  assert.equal(retenu.model, 'claude-haiku-4-5-20251001');
  assert.equal(retenu.thinking, 'medium');
  assert.match(retenu.ramene ?? '', /trop gourmand/);
});

test('un modèle économe choisi à la main ne fait l’objet d’aucun rappel', () => {
  const models = [model('claude-opus-5'), model('claude-sonnet-5-20260801')];
  const retenu = choixComplet('claude', models, 'claude-sonnet-5-20260801', 'medium');
  assert.equal(retenu.model, 'claude-sonnet-5-20260801');
  assert.equal(retenu.ramene, undefined);
});

test('un modèle préféré absent se replie sur un modèle réellement disponible', () => {
  const models = [model('gpt-5.1-codex-max'), model('gpt-5.1-codex')];
  const retained = choice('codex', models);
  assert.ok(models.some((entry) => entry.id === retained.model));
  assert.equal(retained.model, 'gpt-5.1-codex-max');
  assert.equal(retained.thinking, 'medium');
});
