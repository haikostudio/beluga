import test from 'node:test';
import assert from 'node:assert/strict';
import { consigneSeTraduit, traductionNettoyee } from '@beluga/shared';
import { consigneAEnvoyer, traduireConsigneEnAnglais } from '../traduction-des-consignes.js';

test('images, vidéos, musiques et bruitages se traduisent ; ce qu’on fait DIRE jamais', () => {
  for (const c of ['image', 'video', 'musique', 'son']) assert.equal(consigneSeTraduit(c), true, c);
  for (const c of ['voix', 'avatar', 'synchro']) assert.equal(consigneSeTraduit(c), false, c);
});

test('la réponse du traducteur est nettoyée de ses enrobages', () => {
  assert.equal(traductionNettoyee('"A red fox at dawn"'), 'A red fox at dawn');
  assert.equal(traductionNettoyee('```\nA red fox\n```'), 'A red fox');
  assert.equal(traductionNettoyee('Here is the translation: A red fox'), 'A red fox');
  assert.equal(traductionNettoyee('   '), null);
  assert.equal(traductionNettoyee(undefined), null);
});

test('la consigne traduite part, l’originale est gardée', async () => {
  const r = await traduireConsigneEnAnglais('Un renard roux à l’aube', { relayer: async () => 'A red fox at dawn', claude: async () => null });
  assert.deepEqual(r, { ok: true, consigne: 'A red fox at dawn', originale: 'Un renard roux à l’aube' });
});

test('déjà en anglais : rien d’original à garder', async () => {
  const r = await traduireConsigneEnAnglais('A red fox', { relayer: async (t) => t, claude: async () => null });
  assert.deepEqual(r, { ok: true, consigne: 'A red fox', originale: null });
});

test('le relais muet passe la main à un compte Claude', async () => {
  let essais = 0;
  const r = await traduireConsigneEnAnglais('Un renard', {
    relayer: async () => {
      essais++;
      return null;
    },
    claude: async () => 'A fox',
  });
  assert.equal(essais, 2);
  assert.ok(r.ok && r.consigne === 'A fox');
});

test('aucune voie ne répond : échec dit, jamais le français envoyé en silence', async () => {
  const r = await traduireConsigneEnAnglais('Un renard', { relayer: async () => { throw new Error('réseau'); }, claude: async () => null });
  assert.equal(r.ok, false);
});

test('une voix garde son texte, sans appeler le traducteur', async () => {
  const r = await consigneAEnvoyer('voix', 'Bonjour à tous', { relayer: async () => assert.fail('appelé'), claude: async () => assert.fail('appelé') });
  assert.deepEqual(r, { ok: true, consigne: 'Bonjour à tous', originale: null });
});
