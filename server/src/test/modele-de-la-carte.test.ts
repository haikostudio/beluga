import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelInfo, reglagesDeLaProposition, type MoteurCatalogue } from '@beluga/shared';
import { choixDuCadrage } from '../engines/catalog.js';

/* ------------------------------------------------------------------ */
/* LE MODÈLE CHOISI PAR L'UTILISATEUR NE SE RÉÉCRIT JAMAIS TOUT SEUL    */
/* ------------------------------------------------------------------ */

/*
 * Le défaut du 02/09/2026 : des cartes réglées sur Opus 5 se relançaient sur
 * Haiku. Deux mécanismes s'y mettaient — un PLAFOND qui ramenait tout modèle
 * « gourmand » sur un modèle épinglé bon marché, et un PALIER (léger /
 * standard / approfondi) qui rechoisissait le modèle par-dessus celui affiché
 * en haut de la discussion. Le plafond est supprimé, le palier ne remplit plus
 * que le vide. Ces contrôles verrouillent les deux : ils ne connaissent ni base
 * ni disque, seulement un catalogue.
 */

function model(id: string, thinking = ['none', 'medium', 'high']): ModelInfo {
  return ModelInfo.parse({
    id,
    label: id.replaceAll('-', ' '),
    thinking: thinking.map((level) => ({ id: level, label: level })),
    defaultThinking: thinking[0],
  });
}

const MODELES = [model('claude-opus-5'), model('claude-sonnet-5'), model('claude-haiku-4-5', ['none'])];

test('le modèle retenu par l’utilisateur repart tel quel, sans plafond', () => {
  assert.deepEqual(choixDuCadrage(MODELES, 'claude-sonnet-5', 'claude-opus-5', 'high'), {
    model: 'claude-opus-5',
    thinking: 'high',
  });
});

test('sans rien de mémorisé, le modèle par DÉFAUT du moteur — jamais le moins cher', () => {
  const retenu = choixDuCadrage(MODELES, 'claude-sonnet-5');
  assert.equal(retenu.model, 'claude-sonnet-5');
  assert.notEqual(retenu.model, 'claude-haiku-4-5');
});

test('un modèle mémorisé disparu du catalogue est ramené vers un modèle réel', () => {
  const retenu = choixDuCadrage(MODELES, 'claude-sonnet-5', 'claude-opus-4-6', 'high');
  assert.equal(retenu.model, 'claude-opus-5');
});

test('un cran de réflexion impossible pour ce modèle est ramené, le modèle ne bouge pas', () => {
  const retenu = choixDuCadrage(MODELES, 'claude-sonnet-5', 'claude-haiku-4-5', 'high');
  assert.equal(retenu.model, 'claude-haiku-4-5');
  assert.equal(retenu.thinking, 'none');
});

test('un catalogue vide ne fabrique pas un modèle', () => {
  assert.equal(choixDuCadrage([], undefined).model, undefined);
});

/* ------------------------------------------------------------------ */
/* Le palier ne remplit que le vide                                     */
/* ------------------------------------------------------------------ */

const CLAUDE: MoteurCatalogue = {
  id: 'claude',
  label: 'Claude',
  installed: true,
  comptesDisponibles: 2,
  models: [
    { id: 'claude-opus-5', label: 'Opus 5', thinking: [{ id: 'medium' }, { id: 'high' }], appetite: 'heavy' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5', thinking: [{ id: 'medium' }, { id: 'high' }], appetite: 'medium' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', thinking: [{ id: 'none' }], appetite: 'light' },
  ],
};

test('un palier « léger » ne rabat pas une carte déjà réglée sur Opus', () => {
  const retenu = reglagesDeLaProposition(
    { engine: 'claude', model: 'claude-opus-5', thinking: 'high', niveau: 'leger' },
    [CLAUDE],
  );
  assert.equal(retenu?.model, 'claude-opus-5');
  assert.equal(retenu?.thinking, 'high');
  // Le palier reste LU sur la carte : c'est une ambition, pas un modèle.
  assert.equal(retenu?.niveau, 'leger');
});

test('sans modèle du tout, le palier remplit — c’est son seul emploi', () => {
  const retenu = reglagesDeLaProposition({ engine: 'claude', niveau: 'leger' }, [CLAUDE]);
  assert.equal(retenu?.model, 'claude-haiku-4-5');
});
