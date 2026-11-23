import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abonnementApnsDe, corpsApns, endpointApns, hoteApns, jetonMort } from '@beluga/shared';

/* LES NOTIFICATIONS DE L'APPLICATION IPHONE (16/11/2026) : un abonnement comme un autre, servi par APNs. */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'notifications-iphone-'));
process.env.BELUGA_DATA = bacASable;
const { subscribe, appareilsDuCompte } = await import('../push.js');
const { jetonDAutorisation } = await import('../apns.js');

const JETON = 'ab'.repeat(32);

test('l’abonnement iPhone : un jeton hexadécimal et un environnement connus, sinon refusé', () => {
  assert.equal(endpointApns(JETON, 'production'), `apns:production:${JETON}`);
  assert.equal(endpointApns(JETON.toUpperCase(), 'sandbox'), `apns:sandbox:${JETON}`);
  assert.equal(endpointApns('pas-un-jeton', 'production'), null);
  assert.equal(endpointApns(JETON, 'ailleurs'), null);
  assert.deepEqual(abonnementApnsDe(`apns:production:${JETON}`), { jeton: JETON, environnement: 'production' });
  assert.equal(abonnementApnsDe('https://web.push.apple.com/abc'), null);
  assert.equal(hoteApns('production'), 'https://api.push.apple.com');
  assert.equal(hoteApns('sandbox'), 'https://api.sandbox.push.apple.com');
});

test('le corps APNs reprend le titre, le texte, le regroupement, le chiffre et l’ancre', () => {
  const corps = corpsApns({ title: 'Tâche terminée', body: 'Export des factures', tag: 'carte-1', nonLues: 3 }, '/#projet/p/c');
  assert.deepEqual(corps, {
    aps: { alert: { title: 'Tâche terminée', body: 'Export des factures' }, sound: 'default', 'thread-id': 'carte-1', badge: 3 },
    ancre: '/#projet/p/c',
  });
  assert.ok(jetonMort(410));
  assert.ok(jetonMort(400, 'BadDeviceToken'));
  assert.ok(!jetonMort(429, 'TooManyRequests'));
});

test('l’iPhone s’inscrit au nom du compte et paraît dans ses appareils ; un faux « apns: » web est refusé', () => {
  assert.equal(subscribe({ apns: { jeton: JETON, environnement: 'production' } }, 'compte-1', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) BelugaApp/1.0.0'), true);
  assert.equal(subscribe({ apns: { jeton: 'zz', environnement: 'production' } }, 'compte-1'), false);
  assert.equal(subscribe({ endpoint: `apns:production:${'cd'.repeat(32)}` }, 'compte-1'), false);
  const { appareils } = appareilsDuCompte('compte-1');
  assert.equal(appareils.length, 1);
});

test('le jeton d’autorisation est un JWT ES256 vérifiable avec la clé publique', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const cle = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwt = jetonDAutorisation({ cle, keyId: 'CLE1234567', teamId: 'EQUIPE1234' }, 1_800_000_000_000);
  const [entete, charge, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(entete, 'base64url').toString()), { alg: 'ES256', kid: 'CLE1234567' });
  assert.deepEqual(JSON.parse(Buffer.from(charge, 'base64url').toString()), { iss: 'EQUIPE1234', iat: 1_800_000_000 });
  const valide = crypto.verify('sha256', Buffer.from(`${entete}.${charge}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
  assert.ok(valide);
});
