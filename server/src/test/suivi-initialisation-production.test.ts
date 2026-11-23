import test from 'node:test';
import assert from 'node:assert/strict';

/* LE SUIVI DE L'INITIALISATION DE LA MISE EN PRODUCTION : le bandeau du bas et
   la vignette spéciale de « En cours » lisent la même règle. */
const { etatDeLInitialisation, etatDeLaVignetteDInitialisation, vignetteDInitialisationVisible, BANDE_GARDE_UN_FINI_MS } =
  await import('@beluga/shared');

const projet = { miseEnProduction: { agentId: 'config' } };
const T = 1_000_000;

test('sans agent retenu, ou pour un autre agent, rien à suivre', () => {
  assert.equal(etatDeLInitialisation({}, { id: 'config', status: 'running' }, T), null);
  assert.equal(etatDeLInitialisation(projet, { id: 'autre', status: 'running' }, T), null);
  assert.equal(etatDeLInitialisation(projet, undefined, T), null);
});

test('au travail, au démarrage, puis en attente de réponse', () => {
  assert.equal(etatDeLInitialisation(projet, { id: 'config', status: 'starting' }, T), 'demarre');
  assert.equal(etatDeLInitialisation(projet, { id: 'config', status: 'running' }, T), 'travail');
  assert.equal(etatDeLInitialisation(projet, { id: 'config', status: 'idle', attendReponse: true }, T), 'question');
});

test('fini depuis moins d’une minute : le bandeau le dit, la vignette disparaît', () => {
  const fini = etatDeLInitialisation(projet, { id: 'config', status: 'idle', endedAt: T - 5_000 }, T);
  assert.equal(fini, 'fini');
  assert.equal(vignetteDInitialisationVisible(fini), false);
  assert.equal(
    etatDeLInitialisation(projet, { id: 'config', status: 'idle', endedAt: T - BANDE_GARDE_UN_FINI_MS - 1 }, T),
    null,
  );
  assert.equal(etatDeLInitialisation(projet, { id: 'config', status: 'failed', endedAt: T - 999_999 }, T), null);
});

test('la vignette ne paraît que pendant le travail ou la question', () => {
  assert.equal(vignetteDInitialisationVisible('demarre'), true);
  assert.equal(vignetteDInitialisationVisible('travail'), true);
  assert.equal(vignetteDInitialisationVisible('question'), true);
  assert.equal(vignetteDInitialisationVisible(null), false);
});

test('la VIGNETTE dit « fini » 24 heures, le bandeau oublie au bout d’une minute', () => {
  const vieux = { id: 'config', status: 'idle', endedAt: T - BANDE_GARDE_UN_FINI_MS - 1 };
  // Le bandeau n'a plus rien à dire…
  assert.equal(etatDeLInitialisation(projet, vieux, T), null);
  // …la vignette, elle, dit « fini » 24 heures, même après un échec.
  assert.equal(etatDeLaVignetteDInitialisation(projet, vieux, T), 'fini');
  assert.equal(etatDeLaVignetteDInitialisation(projet, { ...vieux, status: 'failed' }, T), 'fini');
  // Finie depuis plus de 24 heures : elle s'efface.
  assert.equal(etatDeLaVignetteDInitialisation(projet, { ...vieux, endedAt: T - 24 * 60 * 60 * 1000 }, T), null);
  // Au travail ou en attente, elle suit l'état du bandeau.
  assert.equal(etatDeLaVignetteDInitialisation(projet, { id: 'config', status: 'running' }, T), 'travail');
  assert.equal(
    etatDeLaVignetteDInitialisation(projet, { id: 'config', status: 'idle', attendReponse: true }, T),
    'question',
  );
  // Un autre agent que celui retenu n'a pas de vignette.
  assert.equal(etatDeLaVignetteDInitialisation(projet, { ...vieux, id: 'autre' }, T), null);
});
