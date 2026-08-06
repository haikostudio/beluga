import test from 'node:test';
import assert from 'node:assert/strict';
import { derouleOuvert, rapportAGarder } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Ce qui reste à l'écran une fois la publication finie                */
/* ------------------------------------------------------------------ */

test('sans publication, il n’y a rien à garder', () => {
  assert.equal(rapportAGarder(undefined), false);
});

test('pendant le travail, le rapport reste', () => {
  assert.equal(rapportAGarder('running'), true);
});

test('une publication réussie s’efface toujours, lot en attente ou non', () => {
  assert.equal(rapportAGarder('success'), false);
});

test('un échec ou un arrêt reste toujours : il porte le motif et le bouton', () => {
  assert.equal(rapportAGarder('failed'), true);
  assert.equal(rapportAGarder('stopped'), true);
});

test('le déroulé s’ouvre au travail, se referme au succès, reste ouvert à l’échec', () => {
  assert.equal(derouleOuvert('running'), true);
  assert.equal(derouleOuvert('success'), false);
  assert.equal(derouleOuvert('failed'), true);
  assert.equal(derouleOuvert('stopped'), true);
});
