import test from 'node:test';
import assert from 'node:assert/strict';
import { SEUIL_COMPRESSION_OCTETS, choisirEncodage, encodageAccepte, typeCompressible } from '@beluga/shared';

test('Brotli passe avant gzip quand le navigateur sait lire les deux', () => {
  assert.equal(encodageAccepte('gzip, deflate, br'), 'br');
  assert.equal(encodageAccepte('gzip, deflate'), 'gzip');
  assert.equal(encodageAccepte('deflate'), null);
  assert.equal(encodageAccepte(undefined), null);
});

test('un q=0 est un refus, et le joker « * » ouvre ce qui n’est pas nommé', () => {
  assert.equal(encodageAccepte('br;q=0, gzip'), 'gzip');
  assert.equal(encodageAccepte('*'), 'br');
  assert.equal(encodageAccepte('*;q=0, gzip;q=0.5'), 'gzip');
});

test('seul le texte se compresse : une image ou une police restent telles quelles', () => {
  assert.equal(typeCompressible('application/json; charset=utf-8'), true);
  assert.equal(typeCompressible('text/javascript; charset=utf-8'), true);
  assert.equal(typeCompressible('image/svg+xml'), true);
  assert.equal(typeCompressible('image/png'), false);
  assert.equal(typeCompressible('font/woff2'), false);
  assert.equal(typeCompressible('audio/wav'), false);
  assert.equal(typeCompressible(undefined), false);
});

test('une petite réponse part sans compression, une grosse part compressée', () => {
  const base = { acceptEncoding: 'gzip, br', contentType: 'application/json' };
  assert.equal(choisirEncodage({ ...base, taille: SEUIL_COMPRESSION_OCTETS - 1 }), null);
  assert.equal(choisirEncodage({ ...base, taille: SEUIL_COMPRESSION_OCTETS }), 'br');
  // Taille inconnue (un fichier servi au fil de l'eau) : on compresse.
  assert.equal(choisirEncodage(base), 'br');
  assert.equal(choisirEncodage({ ...base, contentType: 'image/png' }), null);
});
