/**
 * FABLE EST RÉSERVÉ AU CHOIX MANUEL (décision du 30/10/2026, après le
 * bannissement du 06/10/2026) : il revient au catalogue et part quand on le
 * choisit, mais jamais d'office — ni comme défaut, ni par un palier, ni dans un
 * lancement automatique, où il passe à l'Opus courant.
 * La voix « fable » d'OpenAI n'est pas un modèle et n'est pas concernée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  entreeBannie,
  lancementAutomatique,
  migrationDeReglage,
  modeleActuel,
  modeleBanni,
  modeleDuPalierLourd,
  modelePermis,
  ModelInfo,
  reglagesDuNiveau,
  remplacantDUnBanni,
  sansModelesBannis,
} from '@beluga/shared';
import { buildClaudeArgs } from '../engines/claude.js';
import { choixDuCadrage, resolveModel } from '../engines/catalog.js';

const niveaux = [
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];
function modele(id: string, label: string, appetite?: 'light' | 'medium' | 'heavy'): ModelInfo {
  return ModelInfo.parse({ id, label, thinking: niveaux, ...(appetite ? { appetite } : {}) });
}
const sansFable = [
  modele('claude-opus-5-5', 'Opus 5.5', 'heavy'),
  modele('claude-sonnet-5-5', 'Sonnet 5.5', 'medium'),
  modele('claude-haiku-4-5-20251001', 'Haiku 4.5', 'light'),
];
// Le catalogue Claude tel qu'il revient : Fable, le plus récent, en tête.
const catalogue = [modele('claude-fable-5-1', 'Fable 5.1', 'heavy'), ...sansFable];

test('la famille Fable est reconnue par son identifiant comme par son nom', () => {
  assert.equal(modeleBanni('claude-fable-5-1'), true);
  assert.equal(modeleBanni('claude-fable-5'), true);
  assert.equal(modeleBanni('Fable 5.1'), true);
  assert.equal(modeleBanni('claude-opus-5-5'), false);
  assert.equal(modeleBanni('fabled-model'), false);
  assert.equal(modeleBanni(undefined), false);
  assert.equal(entreeBannie({ id: 'x-1', label: 'Fable 5.1' }), true);
});

test('la liste où un palier choisit d’office ne garde aucun Fable', () => {
  assert.deepEqual(
    sansModelesBannis(catalogue).map((m) => m.id),
    sansFable.map((m) => m.id),
  );
});

test('Fable choisi au catalogue reste Fable ; absent, il suit l’Opus le plus récent', () => {
  assert.equal(resolveModel(catalogue, 'claude-fable-5-1'), 'claude-fable-5-1');
  assert.equal(resolveModel(sansFable, 'claude-fable-5-1'), 'claude-opus-5-5');
  assert.equal(remplacantDUnBanni([modele('claude-opus-5', 'Opus 5'), modele('claude-opus-5-5', 'Opus 5.5')]), 'claude-opus-5-5');
  assert.equal(remplacantDUnBanni([]), 'opus');
  assert.equal(resolveModel(catalogue, 'claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(choixDuCadrage(catalogue, 'claude-sonnet-5-5', 'claude-fable-5-1', 'high').model, 'claude-fable-5-1');
});

test('aucun repli ne tombe sur Fable, même en tête du catalogue', () => {
  assert.equal(resolveModel(catalogue, undefined), 'claude-opus-5-5');
  assert.equal(resolveModel(catalogue, 'modele-inconnu'), 'claude-opus-5-5');
  const moteur = { models: catalogue, defaultModel: 'absent', live: true, installed: true };
  assert.equal(modeleActuel(moteur, undefined)?.id, 'claude-opus-5-5');
});

test('les réglages mémorisés sur Fable le gardent quand le catalogue le connaît', () => {
  const moteur = { models: catalogue, defaultModel: 'claude-sonnet-5-5', live: true, installed: true };
  assert.equal(modeleActuel(moteur, 'claude-fable-5-1')?.id, 'claude-fable-5-1');
  const sans = { models: sansFable, defaultModel: 'claude-sonnet-5-5', live: true, installed: true };
  assert.equal(modeleActuel(sans, 'claude-fable-5-1')?.id, 'claude-opus-5-5');
  assert.deepEqual(migrationDeReglage(sans, 'claude-fable-5-1', 'high'), { model: 'claude-opus-5-5', thinking: 'high' });
});

test('le palier approfondi ne choisit jamais Fable, qui reste compté comme lourd', () => {
  const moteur = { models: catalogue, defaultModel: 'claude-opus-5-5' };
  assert.equal(reglagesDuNiveau(moteur as any, 'approfondi').model, 'claude-opus-5-5');
  assert.equal(modeleDuPalierLourd(undefined, 'claude-fable-5-1'), true);
});

test('un lancement est automatique sauf carte posée par l’utilisateur ou conversation ouverte par lui', () => {
  assert.equal(lancementAutomatique({ role: 'task', cardId: 'c', carte: { origin: 'user' } }), false);
  assert.equal(lancementAutomatique({ role: 'cadrage', cardId: 'c', carte: { origin: 'user' } }), false);
  assert.equal(lancementAutomatique({ role: 'task', cardId: 'c', carte: { origin: 'agent' } }), true);
  // Origine inconnue : le défaut prudent.
  assert.equal(lancementAutomatique({ role: 'task', cardId: 'c', carte: null }), true);
  assert.equal(lancementAutomatique({ role: 'task', cardId: 'c', carte: {} }), true);
  // Sans carte : la conversation d'un agent ouverte par l'utilisateur, ou un agent du démon.
  assert.equal(lancementAutomatique({ role: 'task' }), false);
  assert.equal(lancementAutomatique({ role: 'analysis' }), true);
  assert.equal(lancementAutomatique({ role: 'deploy' }), true);
});

test('Fable part sur un lancement manuel, jamais sur un lancement automatique', () => {
  assert.equal(modelePermis('claude-fable-5-1', [], { automatique: false }), 'claude-fable-5-1');
  assert.equal(modelePermis('claude-fable-5-1', [], { automatique: true }), 'opus');
  assert.equal(modelePermis('claude-fable-5-1'), 'opus');
  assert.equal(modelePermis('claude-fable-5-1', catalogue, { automatique: true }), 'claude-opus-5-5');
  assert.equal(modelePermis('claude-sonnet-5-5'), 'claude-sonnet-5-5');

  const auto = buildClaudeArgs({ cwd: '/tmp', prompt: 'essai', model: 'claude-fable-5-1', fullAccess: true, onEvent: () => {} } as any);
  assert.equal(auto[auto.indexOf('--model') + 1], 'opus');
  assert.equal(auto.some((a) => /fable/i.test(a)), false);
  const manuel = buildClaudeArgs({
    cwd: '/tmp',
    prompt: 'essai',
    model: 'claude-fable-5-1',
    lancementAutomatique: false,
    fullAccess: true,
    onEvent: () => {},
  } as any);
  assert.equal(manuel[manuel.indexOf('--model') + 1], 'claude-fable-5-1');
  const normal = buildClaudeArgs({ cwd: '/tmp', prompt: 'essai', model: 'claude-sonnet-5-5', fullAccess: true, onEvent: () => {} } as any);
  assert.equal(normal[normal.indexOf('--model') + 1], 'claude-sonnet-5-5');
});
