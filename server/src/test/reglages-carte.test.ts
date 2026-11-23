import test from 'node:test';
import assert from 'node:assert/strict';
import { reglagesDeLaCarte } from '@beluga/shared';

const PREVU = { engine: 'claude', model: 'claude-opus-5', thinking: 'high' };
const SERVI = { engine: 'codex', model: 'gpt-5.1-codex-max', thinking: 'xhigh', compte: 'codex-2' };

test('une carte à faire montre ce qui est prévu, et se laisse modifier', () => {
  const vu = reglagesDeLaCarte({ colonne: 'planned', carte: PREVU });
  assert.equal(vu.modifiable, true);
  assert.equal(vu.source, 'prevu');
  assert.equal(vu.engine, 'claude');
  assert.equal(vu.model, 'claude-opus-5');
  assert.equal(vu.thinking, 'high');
  // Le compte n'est choisi qu'au lancement : rien à montrer avant.
  assert.equal(vu.compte, undefined);
  assert.equal(vu.raison, undefined);
});

test('une carte planifiée se laisse encore modifier', () => {
  for (const colonne of ['planned'] as const) {
    const vu = reglagesDeLaCarte({ colonne, carte: PREVU });
    assert.equal(vu.modifiable, true, colonne);
    assert.equal(vu.compte, undefined, colonne);
  }
});

test('une carte en cours ou terminée fige ses réglages', () => {
  for (const colonne of ['running', 'to_deploy', 'archived'] as const) {
    const vu = reglagesDeLaCarte({ colonne, carte: PREVU });
    assert.equal(vu.modifiable, false, colonne);
    assert.match(vu.raison ?? '', /démarré/);
  }
});

test("ce qui a servi prime sur ce qui était prévu, compte compris", () => {
  const vu = reglagesDeLaCarte({ colonne: 'to_deploy', carte: PREVU, agent: SERVI });
  assert.equal(vu.source, 'reel');
  assert.equal(vu.engine, 'codex');
  assert.equal(vu.model, 'gpt-5.1-codex-max');
  assert.equal(vu.thinking, 'xhigh');
  assert.equal(vu.compte, 'codex-2');
  assert.match(vu.raison ?? '', /réellement servi/);
});

test("un agent déjà passé fige la carte même revenue en arrière", () => {
  const vu = reglagesDeLaCarte({ colonne: 'planned', carte: PREVU, agent: SERVI });
  assert.equal(vu.modifiable, false);
  assert.equal(vu.source, 'reel');
  assert.equal(vu.engine, 'codex');
});

test("sans agent retrouvé, le compte mesuré prend le relais", () => {
  const vu = reglagesDeLaCarte({ colonne: 'to_deploy', carte: PREVU, compteMesure: 'claude-1' });
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

test('les réglages restent modifiables pendant le cadrage, et se figent à la validation de la compréhension', async () => {
  const { RAISON_REGLAGES_VALIDES } = await import('@beluga/shared');
  // Demande, compréhension rendue mais pas validée : on peut encore changer de modèle.
  assert.equal(
    reglagesDeLaCarte({ colonne: 'planned', carte: PREVU, decisionValidee: false }).modifiable,
    true,
    'planned',
  );
  const valide = reglagesDeLaCarte({ colonne: 'planned', carte: PREVU, decisionValidee: true });
  assert.equal(valide.modifiable, false);
  assert.equal(valide.source, 'prevu');
  assert.equal(valide.raison, RAISON_REGLAGES_VALIDES);
  // Parti, il reste figé, validé ou non.
  assert.equal(reglagesDeLaCarte({ colonne: 'running', carte: PREVU, decisionValidee: true }).modifiable, false);

  // Le démon garde la même règle sur `card.update`, et l'écran ne fige plus au premier envoi.
  const fs = await import('node:fs');
  const ws = fs.readFileSync(new URL('../../src/ws.ts', import.meta.url), 'utf8');
  const maj = ws.split("case 'card.update': {")[1].split("case 'card.move'")[0];
  assert.ok(maj.includes('comprehensionValideePourLaVersionCourante(card.parcours)') && maj.includes('reglagesDeLaCarte('));
  assert.ok(maj.indexOf('reglagesDeLaCarte(') < maj.indexOf('store.saveCard('), 'refusé avant tout écrit');
  const chat = fs.readFileSync(new URL('../../../web/src/components/chat.tsx', import.meta.url), 'utf8');
  assert.ok(chat.includes('decisionValidee: comprehensionValideePourLaVersionCourante(card.parcours)'));
  // Le raccourci vit au bout de la rangée d'action de la carte, plus dans la barre d'écriture.
  const parcours = fs.readFileSync(new URL('../../../web/src/components/parcours-carte.tsx', import.meta.url), 'utf8');
  assert.ok(parcours.includes('data-raccourci-reglages'), 'le raccourci vers la configuration existe dans la rangée d’action');
  assert.ok(!chat.includes('data-raccourci-reglages='), 'la barre d’écriture d’une carte ne pose plus de raccourci');
  assert.ok(chat.includes('data-tiroir-reglages="modifiable"'), 'le tiroir écrit tant que ce n’est pas figé');
});
