import test from 'node:test';
import assert from 'node:assert/strict';
import { blocsARepliers, ordreDOuverture, type BlocDuPied } from '@beluga/shared';

const bloc = (cle: string, depliee: number, repliable = true): BlocDuPied => ({
  cle,
  hauteurDepliee: depliee,
  hauteurRepliee: 40,
  repliable,
});

test('rien ne se replie quand le pied tient dans son budget', () => {
  assert.deepEqual(blocsARepliers([bloc('chemin', 90), bloc('captures', 150)], ['chemin', 'captures'], 400), []);
});

test('le plus ancien se replie d’abord, le dernier ouvert reste déplié', () => {
  const blocs = [bloc('chemin', 90), bloc('captures', 200), bloc('decision', 160, false)];
  assert.deepEqual(blocsARepliers(blocs, ['chemin', 'captures', 'decision'], 400), ['chemin']);
  assert.deepEqual(blocsARepliers(blocs, ['captures', 'chemin', 'decision'], 300), ['captures']);
});

test('le dernier ouvert ne se replie jamais, même quand le budget reste dépassé', () => {
  const blocs = [bloc('chemin', 90), bloc('captures', 300)];
  assert.deepEqual(blocsARepliers(blocs, ['chemin', 'captures'], 100), ['chemin']);
});

test('l’ordre suit l’apparition, et un appui fait passer le bloc en dernier', () => {
  let ordre = ordreDOuverture([], ['chemin']);
  ordre = ordreDOuverture(ordre, ['chemin', 'captures']);
  assert.deepEqual(ordre, ['chemin', 'captures']);
  ordre = ordreDOuverture(ordre, ['chemin', 'captures'], 'chemin');
  assert.deepEqual(ordre, ['captures', 'chemin']);
  assert.deepEqual(ordreDOuverture(ordre, ['chemin']), ['chemin']);
});

test('les étapes du tournage, gardées, ne se replient jamais : « Ce que l’agent a vu » se replie à leur place', () => {
  const chemin: BlocDuPied = { ...bloc('chemin', 220, false), garde: true };
  const blocs = [chemin, bloc('captures', 200), bloc('decision', 160, false)];
  assert.deepEqual(blocsARepliers(blocs, ['chemin', 'captures', 'decision'], 380), ['captures']);
  // Même dernier venu, le bloc repliable cède la place.
  assert.deepEqual(blocsARepliers([chemin, bloc('captures', 300)], ['chemin', 'captures'], 300), ['captures']);
});

test('avec un bloc gardé, seul le bloc rouvert d’un appui reste déplié', () => {
  const chemin: BlocDuPied = { ...bloc('chemin', 220, false), garde: true };
  const blocs = [chemin, bloc('captures', 200), bloc('suggestions', 120), bloc('decision', 160, false)];
  const ordre = ['chemin', 'suggestions', 'decision', 'captures'];
  assert.deepEqual(blocsARepliers(blocs, ordre, 380, 'captures'), ['suggestions']);
  assert.deepEqual(blocsARepliers(blocs, ordre, 380, null), ['suggestions', 'captures']);
});
