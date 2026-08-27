import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent, ServerEvent, mesurerContexte } from '@haikodev/shared';
import { emitFromCodex } from '../engines/codex.js';
import { EngineEvent } from '../engines/types.js';

test('le pourcentage du contexte garde un vrai zéro et arrondit 49 puis 50 %', () => {
  assert.equal(mesurerContexte(0, 100)?.percentage, 0);
  assert.equal(mesurerContexte(49_000, 100_000)?.percentage, 49);
  assert.equal(mesurerContexte(49_500, 100_000)?.percentage, 50);
  assert.equal(mesurerContexte(120_000, 100_000)?.percentage, 100);
});

test("une donnée absente ne devient jamais un contexte à zéro", () => {
  assert.equal(mesurerContexte(undefined, 100_000), undefined);
  assert.equal(mesurerContexte(0, undefined), undefined);
  assert.equal(mesurerContexte(-1, 100_000), undefined);
  assert.equal(mesurerContexte(1, 0), undefined);
});

test('la mesure voyage entière dans Agent puis dans agent.upsert', () => {
  const mesure = mesurerContexte(49_000, 100_000, 1234);
  const agent = Agent.parse({
    id: 'agent-contexte',
    projectId: 'projet-contexte',
    role: 'cadrage',
    title: 'Chef',
    run: { engine: 'codex', model: 'gpt-5', thinking: 'medium', mode: 'direct' },
    status: 'running',
    contextUsage: mesure,
    createdAt: 1,
    updatedAt: 1,
  });
  const evenement = ServerEvent.parse({ type: 'agent.upsert', agent });
  if (evenement.type !== 'agent.upsert') assert.fail('agent.upsert attendu');

  assert.deepEqual(evenement.agent.contextUsage, {
    usedTokens: 49_000,
    capacityTokens: 100_000,
    percentage: 49,
    measuredAt: 1234,
  });
});

test('une mesure Codex plus basse après compression remplace le cumul ancien', () => {
  const evenements: EngineEvent[] = [];
  const emettre = (total: number) =>
    emitFromCodex(
      {
        id: 'tour',
        msg: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 90_000, output_tokens: 5_000 },
            last_token_usage: { total_tokens: total },
            model_context_window: 100_000,
          },
        },
      },
      (event) => evenements.push(event),
    );

  emettre(50_000);
  emettre(18_000);

  const usages = evenements.filter((event) => event.kind === 'usage').map((event) => event.usage);
  assert.equal(usages[0]?.contextTokens, 50_000);
  assert.equal(usages[1]?.contextTokens, 18_000);
  assert.equal(usages[1]?.contextWindow, 100_000);
});
