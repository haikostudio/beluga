import test from 'node:test';
import assert from 'node:assert/strict';
import { reglagesDuNiveau } from '@beluga/shared';
import { claudeCatalogAvec, resolveModel } from '../engines/catalog.js';
import { catalogueMimoDepuisIds } from '../engines/mimo.js';

/*
 * LE MENU MONTRE TOUS LES MODÈLES DE CHAQUE MOTEUR (carte « Branches et choix
 * des modèles ») : les anciennes versions d'une famille restent choisissables,
 * Fable reste exclu, et les défauts comme les paliers visent toujours la
 * version la PLUS RÉCENTE — jamais un ancien modèle désormais présent.
 */

const ENTREES = [
  { id: 'claude-opus-5', display_name: 'Claude Opus 5', created_at: '2026-03-01T00:00:00Z' },
  { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-08-01T00:00:00Z' },
  { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', created_at: '2026-02-01T00:00:00Z' },
  { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-07-01T00:00:00Z' },
  { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-06-01T00:00:00Z' },
  { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z' },
  { id: 'claude-fable-5-1', display_name: 'Claude Fable 5.1', created_at: '2026-09-01T00:00:00Z' },
];

async function catalogueClaude() {
  const avant = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: ENTREES }), { status: 200 })) as typeof fetch;
  try {
    return await claudeCatalogAvec('jeton-d-essai');
  } finally {
    globalThis.fetch = avant;
  }
}

test('Claude : toutes les versions de chaque famille, Fable compris (choix manuel), du plus récent au plus ancien', async () => {
  const { models, live } = await catalogueClaude();
  assert.equal(live, true);
  assert.deepEqual(
    models.map((m) => m.id).filter((id) => !/fable/.test(id)),
    ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  );
  // Fable revient au catalogue (30/10/2026) : il se choisit, il n'est jamais pris d'office.
  assert.ok(models.some((m) => m.id === 'claude-fable-5-1'));
});

test('le défaut et les raccourcis visent la version la plus récente de la famille', async () => {
  const { models } = await catalogueClaude();
  assert.equal(resolveModel(models, 'sonnet'), 'claude-sonnet-5-5');
  assert.equal(resolveModel(models, 'opus'), 'claude-opus-5-5');
  assert.equal(resolveModel(models, 'claude-opus-5'), 'claude-opus-5', 'un ancien modèle choisi reste choisi (DEC-213)');
  assert.equal(resolveModel(models, 'claude-fable-5-1'), 'claude-fable-5-1', 'Fable choisi reste choisi : seul un lancement automatique le remplace');
  assert.equal(resolveModel(models, undefined), 'claude-opus-5-5', 'le défaut n’est jamais Fable');
});

test('les paliers léger / standard / approfondi restent sur la version la plus récente', async () => {
  const { models } = await catalogueClaude();
  const moteur = { id: 'claude' as const, label: 'Claude', installed: true, models, defaultModel: 'claude-sonnet-5-5', comptesDisponibles: 1 };
  assert.equal(reglagesDuNiveau(moteur, 'leger').model, 'claude-haiku-5-5');
  assert.equal(reglagesDuNiveau(moteur, 'standard').model, 'claude-sonnet-5-5');
  assert.equal(reglagesDuNiveau(moteur, 'approfondi').model, 'claude-opus-5-5');
});

test('MiMo garde aussi toutes ses versions', () => {
  const ids = catalogueMimoDepuisIds(['mimo-v2.5-pro', 'mimo-v2.6-pro', 'mimo-v2.6-flash']).map((m) => m.id);
  assert.deepEqual(ids, ['mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.5-pro']);
});

test('le menu : dix d’abord, le choisi toujours visible, la recherche sur la liste entière', async () => {
  const { modelesAffiches } = await import('@beluga/shared');
  const liste = Array.from({ length: 14 }, (_, i) => ({ id: `modele-${i}`, label: `Modèle ${i}` }));
  const debut = modelesAffiches(liste, {});
  assert.equal(debut.visibles.length, 10);
  assert.equal(debut.caches, 4);
  const avecChoisi = modelesAffiches(liste, { choisi: 'modele-12' });
  assert.equal(avecChoisi.visibles.at(-1)?.id, 'modele-12');
  assert.equal(avecChoisi.caches, 3);
  assert.equal(modelesAffiches(liste, { tout: true }).visibles.length, 14);
  assert.deepEqual(modelesAffiches(liste, { recherche: 'modele 13' }).visibles.map((m) => m.id), ['modele-13']);
  assert.equal(modelesAffiches(liste, { recherche: 'introuvable' }).visibles.length, 0);
});
