import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Card, metriquesDeSessionLlm, metriquesSessionLlmIndisponibles } from '@haikodev/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'metriques-session-'));
process.env.HAIKODEV_DATA = bacASable;
const store = await import('../store.js');
const { rangerLaCarte } = await import('../deplacement-carte.js');

function carteDeTest(id: string, llmSessionMetrics?: ReturnType<typeof metriquesDeSessionLlm>) {
  return Card.parse({
    id,
    projectId: 'projet',
    title: 'Carte de test',
    description: 'Vérifier les mesures',
    labels: [],
    column: 'done',
    position: 1,
    origin: 'user',
    attachments: [],
    run: { engine: 'codex', thinking: 'medium', mode: 'direct' },
    llmSessionMetrics,
    createdAt: 1,
    updatedAt: 1,
  });
}

test('une session aboutie garde les quatre mesures disponibles', () => {
  const mesure = metriquesDeSessionLlm({
    state: 'completed',
    usage: { inputTokens: 12_345, outputTokens: 678 },
    durationMs: 45_600,
    context: { tokens: 49_500, window: 100_000 },
    recordedAt: 1_234,
  });

  assert.deepEqual(mesure, {
    state: 'completed',
    inputTokens: { status: 'measured', value: 12_345 },
    outputTokens: { status: 'measured', value: 678 },
    durationMs: { status: 'measured', value: 45_600 },
    contextLevel: { status: 'measured', usedTokens: 49_500, capacityTokens: 100_000, percentage: 50 },
    recordedAt: 1_234,
  });
});

test('une session interrompue garde le partiel et dit ce qui manque', () => {
  const mesure = metriquesDeSessionLlm({
    state: 'interrupted',
    usage: { inputTokens: 321 },
    durationMs: 2_000,
    recordedAt: 2_345,
  });

  assert.deepEqual(mesure.inputTokens, { status: 'measured', value: 321 });
  assert.deepEqual(mesure.outputTokens, { status: 'unavailable' });
  assert.deepEqual(mesure.durationMs, { status: 'measured', value: 2_000 });
  assert.deepEqual(mesure.contextLevel, { status: 'unavailable' });
  assert.equal(mesure.state, 'interrupted');
});

test('les quatre mesures restent sur la carte après son passage en déploiement', () => {
  const metrics = metriquesDeSessionLlm({
    state: 'completed',
    usage: { inputTokens: 2_000, outputTokens: 300 },
    durationMs: 4_000,
    context: { tokens: 50_000, window: 100_000 },
    recordedAt: 3_456,
  });

  const rangee = rangerLaCarte(carteDeTest('carte-mesuree', metrics), 'to_deploy');
  assert.equal(rangee.column, 'to_deploy');
  assert.deepEqual(rangee.llmSessionMetrics, metrics);
  assert.deepEqual(store.getCard(rangee.id)?.llmSessionMetrics, metrics);
});

test('une carte sans relevé reçoit quatre absences explicites au passage en déploiement', () => {
  const metrics = metriquesSessionLlmIndisponibles('unavailable', 3_456);
  const rangee = rangerLaCarte(carteDeTest('carte-sans-releve'), 'to_deploy');

  assert.equal(rangee.llmSessionMetrics?.state, metrics.state);
  for (const metric of [
    rangee.llmSessionMetrics?.inputTokens,
    rangee.llmSessionMetrics?.outputTokens,
    rangee.llmSessionMetrics?.durationMs,
    rangee.llmSessionMetrics?.contextLevel,
  ]) {
    assert.equal(metric.status, 'unavailable');
  }
});
