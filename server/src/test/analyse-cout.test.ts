import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avecMesureAnalyse,
  mesureDeContexte,
  totalJetonsMesures,
  totalMesureEnClair,
  type Estimate,
  type TurnMeasurement,
} from '@haikodev/shared';
import { emitFromCodex } from '../engines/codex.js';

const tour: TurnMeasurement = {
  usage: { inputTokens: 700, cachedInputTokens: 300, outputTokens: 120 },
  quota: { quota5h: 0.4, quotaWeekly: 0.1 },
  composition: {
    promptCharacters: 8_000,
    systemPromptCharacters: 2_000,
    cardDescriptionCharacters: 1_200,
    memoryAndInstructionsCharacters: 3_000,
  },
};

test("l'événement d'usage Codex sépare l'entrée du cache avant de calculer", () => {
  const events: any[] = [];
  emitFromCodex(
    {
      type: 'turn.completed',
      usage: { input_tokens: 1_000, cached_input_tokens: 300, output_tokens: 100, reasoning_output_tokens: 20 },
    },
    (event) => events.push(event),
  );
  assert.deepEqual(events[0].usage, { inputTokens: 700, cachedTokens: 300, outputTokens: 120 });
});

test('le total exact additionne entrée hors cache, cache et sortie', () => {
  assert.equal(totalJetonsMesures(tour.usage), 1_120);
  const mesure = mesureDeContexte(tour);
  assert.equal(mesure.totalTokens, 1_120);
  assert.equal(mesure.breakdown.haikoDevInstructions.characters, 5_800);
});

test("un cache absent est nommé indisponible et ne devient pas zéro", () => {
  const sansCache = mesureDeContexte({
    ...tour,
    usage: { inputTokens: 700, outputTokens: 120 },
  });
  assert.equal(sansCache.cachedInputTokens, undefined);
  assert.equal(sansCache.totalTokens, undefined);
  assert.match(totalMesureEnClair(sansCache), /indisponible/);
  assert.equal(sansCache.breakdown.agentReads.status, 'unavailable');
});

test("les chiffres du moteur remplacent toute fausse mesure rédigée par l'agent", () => {
  const redigeParAgent = {
    machineSeconds: 600,
    analysisMeasurement: {
      inputTokens: 999_999,
      outputTokens: 999_999,
    },
    failed: false,
  } as unknown as Estimate;
  const retenu = avecMesureAnalyse(redigeParAgent, tour);
  assert.equal(retenu.analysisMeasurement?.inputTokens, 700);
  assert.equal(retenu.analysisMeasurement?.cachedInputTokens, 300);
  assert.equal(retenu.analysisMeasurement?.totalTokens, 1_120);
});
