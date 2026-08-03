import test from 'node:test';
import assert from 'node:assert/strict';
import { derouleOuvert, rapportAGarder } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Ce qui reste à l'écran une fois la publication finie                */
/* ------------------------------------------------------------------ */

test('sans publication, il n’y a rien à garder', () => {
  assert.equal(rapportAGarder(undefined, 0), false);
  assert.equal(rapportAGarder(undefined, 3), false);
});

test('pendant le travail, le rapport reste, lot en attente ou non', () => {
  assert.equal(rapportAGarder('running', 0), true);
  assert.equal(rapportAGarder('running', 4), true);
});

test('une publication réussie s’efface dès qu’un nouveau lot attend', () => {
  assert.equal(rapportAGarder('success', 2), false);
  assert.equal(rapportAGarder('success', 1), false);
});

test('une publication réussie reste tant que rien de neuf n’attend', () => {
  assert.equal(rapportAGarder('success', 0), true);
});

test('un échec ou un arrêt reste toujours : il porte le motif et le bouton', () => {
  assert.equal(rapportAGarder('failed', 0), true);
  assert.equal(rapportAGarder('failed', 5), true);
  assert.equal(rapportAGarder('stopped', 5), true);
});

test('le déroulé s’ouvre au travail, se referme au succès, reste ouvert à l’échec', () => {
  assert.equal(derouleOuvert('running'), true);
  assert.equal(derouleOuvert('success'), false);
  assert.equal(derouleOuvert('failed'), true);
  assert.equal(derouleOuvert('stopped'), true);
});
