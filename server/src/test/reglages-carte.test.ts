import test from 'node:test';
import assert from 'node:assert/strict';
import { reglagesDeLaCarte } from '@haikodev/shared';

const PREVU = { engine: 'claude', model: 'claude-opus-5', thinking: 'high' };
const SERVI = { engine: 'codex', model: 'gpt-5.1-codex-max', thinking: 'xhigh', compte: 'codex-2' };

test('une carte à faire montre ce qui est prévu, et se laisse modifier', () => {
  const vu = reglagesDeLaCarte({ colonne: 'todo', carte: PREVU });
  assert.equal(vu.modifiable, true);
  assert.equal(vu.source, 'prevu');
  assert.equal(vu.engine, 'claude');
  assert.equal(vu.model, 'claude-opus-5');
  assert.equal(vu.thinking, 'high');
  // Le compte n'est choisi qu'au lancement : rien à montrer avant.
  assert.equal(vu.compte, undefined);
  assert.equal(vu.raison, undefined);
});

test('une carte validée ou planifiée se laisse encore modifier', () => {
  for (const colonne of ['validated', 'planned'] as const) {
    const vu = reglagesDeLaCarte({ colonne, carte: PREVU });
    assert.equal(vu.modifiable, true, colonne);
    assert.equal(vu.compte, undefined, colonne);
  }
});

test('une carte en cours ou terminée fige ses réglages', () => {
  for (const colonne of ['running', 'done', 'to_deploy', 'archived'] as const) {
    const vu = reglagesDeLaCarte({ colonne, carte: PREVU });
    assert.equal(vu.modifiable, false, colonne);
    assert.match(vu.raison ?? '', /démarré/);
  }
});

test("ce qui a servi prime sur ce qui était prévu, compte compris", () => {
  const vu = reglagesDeLaCarte({ colonne: 'done', carte: PREVU, agent: SERVI });
  assert.equal(vu.source, 'reel');
  assert.equal(vu.engine, 'codex');
  assert.equal(vu.model, 'gpt-5.1-codex-max');
  assert.equal(vu.thinking, 'xhigh');
  assert.equal(vu.compte, 'codex-2');
  assert.match(vu.raison ?? '', /réellement servi/);
});

test("un agent déjà passé fige la carte même revenue en arrière", () => {
  const vu = reglagesDeLaCarte({ colonne: 'todo', carte: PREVU, agent: SERVI });
  assert.equal(vu.modifiable, false);
  assert.equal(vu.source, 'reel');
  assert.equal(vu.engine, 'codex');
});

test("sans agent retrouvé, le compte mesuré prend le relais", () => {
  const vu = reglagesDeLaCarte({ colonne: 'done', carte: PREVU, compteMesure: 'claude-1' });
  assert.equal(vu.modifiable, false);
  assert.equal(vu.source, 'prevu');
  assert.equal(vu.compte, 'claude-1');
  assert.equal(vu.engine, 'claude');
});

test("un agent sans modèle connu retombe sur celui de la carte", () => {
  const vu = reglagesDeLaCarte({ colonne: 'running', carte: PREVU, agent: { engine: 'claude' } });
  assert.equal(vu.model, 'claude-opus-5');
  assert.equal(vu.thinking, 'high');
  assert.equal(vu.compte, undefined);
});
