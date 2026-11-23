import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entetesDeSecurite, requeteEnHttps, POLITIQUE_DES_SOURCES, constatsDEntetes } from '@beluga/shared';

test('les cinq protections sont posées, HSTS seulement en HTTPS', () => {
  const https = entetesDeSecurite(true);
  assert.equal(https['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  assert.equal(https['x-content-type-options'], 'nosniff');
  assert.equal(https['x-frame-options'], 'SAMEORIGIN');
  assert.equal(https['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(https['content-security-policy']!, /frame-ancestors 'self'/);
  assert.equal(entetesDeSecurite(false)['strict-transport-security'], undefined);
});

test('la requête est en HTTPS quand le relais le dit', () => {
  assert.equal(requeteEnHttps('https'), true);
  assert.equal(requeteEnHttps('https, http'), true);
  assert.equal(requeteEnHttps('http'), false);
  assert.equal(requeteEnHttps(undefined), false);
  assert.equal(requeteEnHttps(undefined, true), true);
});

test('la politique ferme les scripts des autres sites et les objets', () => {
  assert.match(POLITIQUE_DES_SOURCES, /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:(;|$)/);
  assert.doesNotMatch(POLITIQUE_DES_SOURCES, /script-src[^;]*https:/);
  assert.match(POLITIQUE_DES_SOURCES, /object-src 'none'/);
  assert.match(POLITIQUE_DES_SOURCES, /base-uri 'self'/);
});

test('le contrôle de sécurité ne relève plus aucun des cinq entêtes manquants', () => {
  const constats = constatsDEntetes({ adresse: 'https://beluga.exemple.com/', statut: 200, entetes: entetesDeSecurite(true), redirigeVersHttps: true });
  const ids = constats.map((c) => c.id);
  for (const id of ['entete-hsts', 'entete-csp', 'entete-cadre', 'entete-nosniff', 'entete-referrer']) assert.ok(!ids.includes(id), id);
});
