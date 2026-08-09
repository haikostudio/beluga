import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coutDuTour, coutEnClair, tarifDuModele } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* L'HISTORIQUE DES TOURS D'UN AGENT                                    */
/*                                                                      */
/* Une ligne par tour réellement parti, dans l'ordre du temps, avec ce   */
/* qui est parti, ce qui est revenu, et un coût SEULEMENT quand le tarif */
/* du modèle est connu.                                                 */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'historique-tours-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');

/* La règle pure : aucun coût inventé. */
test('un modèle sans tarif connu ne reçoit aucun coût', () => {
  assert.equal(tarifDuModele('gpt-5.4'), undefined);
  assert.equal(tarifDuModele(undefined), undefined);
  assert.equal(
    coutDuTour({ inputTokens: 1_000_000, outputTokens: 1_000_000, model: 'gpt-5.4' }),
    undefined,
  );
  assert.equal(coutEnClair({ inputTokens: 500, outputTokens: 100, model: 'moteur-inconnu' }), 'indisponible');
});

test('un tarif connu chiffre le tour, entrée, cache et sortie séparés', () => {
  // Sonnet : 3 $ l'entrée, 0.30 $ le cache, 15 $ la sortie, par million.
  const cout = coutDuTour({
    inputTokens: 1_000_000,
    cachedTokens: 1_000_000,
    outputTokens: 1_000_000,
    model: 'claude-sonnet-5',
  });
  assert.ok(cout !== undefined);
  // (3 + 0.30 + 15) dollars, convertis en francs.
  assert.ok(Math.abs((cout as number) - 18.3 * 0.8) < 1e-9);

  // Opus coûte plus cher que Sonnet pour exactement la même mesure.
  const opus = coutDuTour({ inputTokens: 1_000_000, outputTokens: 1_000_000, model: 'claude-opus-5' });
  const sonnet = coutDuTour({ inputTokens: 1_000_000, outputTokens: 1_000_000, model: 'claude-sonnet-5' });
  assert.ok((opus as number) > (sonnet as number));
});

test('sans aucune mesure du moteur, le tour reste sans coût', () => {
  assert.equal(coutDuTour({ model: 'claude-sonnet-5' }), undefined);
  assert.equal(coutDuTour({ inputTokens: 0, cachedTokens: 0, outputTokens: 0, model: 'claude-sonnet-5' }), undefined);
});

test('les tours d’un agent ressortent un par ligne, du plus ancien au plus récent', () => {
  const agent = 'agent-historique';

  store.recordUsage({
    agentId: agent,
    engine: 'claude',
    model: 'claude-sonnet-5',
    tokens: 1300,
    inputTokens: 1000,
    cachedTokens: 200,
    outputTokens: 100,
    seconds: 12,
  });
  store.recordUsage({
    agentId: agent,
    engine: 'claude',
    model: 'claude-sonnet-5',
    tokens: 900,
    inputTokens: 700,
    cachedTokens: 100,
    outputTokens: 100,
    seconds: 8,
  });
  // Un tour d'un AUTRE agent ne doit pas apparaître dans cette liste.
  store.recordUsage({ agentId: 'agent-voisin', tokens: 42, inputTokens: 40, outputTokens: 2 });

  const tours = store.usageByAgent(agent);
  assert.equal(tours.length, 2);
  assert.ok(tours[0].at <= tours[1].at, 'ordre chronologique');
  assert.equal(tours[0].inputTokens, 1000);
  assert.equal(tours[0].cachedTokens, 200);
  assert.equal(tours[0].outputTokens, 100);
  assert.equal(tours[0].model, 'claude-sonnet-5');
  assert.equal(tours[1].inputTokens, 700);

  // Le total du tour, celui que lisent les quotas et la facturation, n'a pas bougé.
  assert.equal(tours[0].tokens, 1300);
});

test('un tour ancien, écrit sans détail, ressort à zéro plutôt qu’inventé', () => {
  const agent = 'agent-ancien';
  store.recordUsage({ agentId: agent, tokens: 5000 });

  const [tour] = store.usageByAgent(agent);
  assert.equal(tour.tokens, 5000);
  assert.equal(tour.inputTokens, 0);
  assert.equal(tour.outputTokens, 0);
  assert.equal(tour.model, undefined);
  // Sans modèle ni détail, l'écran affiche « indisponible ».
  assert.equal(
    coutEnClair({
      inputTokens: tour.inputTokens,
      cachedTokens: tour.cachedTokens,
      outputTokens: tour.outputTokens,
      model: tour.model,
    }),
    'indisponible',
  );
});

test('la limite garde les tours les plus récents, remis dans l’ordre du temps', () => {
  const agent = 'agent-bavard';
  for (let i = 0; i < 5; i += 1) {
    store.recordUsage({ agentId: agent, tokens: 100 + i, inputTokens: 100 + i, outputTokens: 1 });
  }
  const tours = store.usageByAgent(agent, 3);
  assert.equal(tours.length, 3);
  assert.ok(tours[0].at <= tours[2].at);
  // Les trois derniers écrits, pas les trois premiers.
  assert.deepEqual(
    tours.map((tour) => tour.inputTokens),
    [102, 103, 104],
  );
});
