/**
 * LES APPAREILS ABONNÉS AUX NOTIFICATIONS.
 *
 * Verrouillé ici : le nom d'un appareil se lit dans son navigateur ; la liste
 * d'un compte ne montre QUE ses appareils (jamais l'adresse d'abonnement, et
 * jamais ceux d'un autre) ; retirer l'appareil d'un autre ne fait rien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'appareils-notifications-'));
process.env.BELUGA_DATA = bacASable;

const { nomDAppareil } = await import('@beluga/shared');
const { getDb } = await import('../db.js');
const { subscribe, appareilsDuCompte, retirerAppareilDuCompte } = await import('../push.js');

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';

test('le nom d’un appareil dit le système puis le navigateur', () => {
  assert.equal(nomDAppareil(IPHONE), 'iPhone · Safari');
  assert.equal(nomDAppareil(ANDROID), 'Android · Chrome');
  assert.equal(nomDAppareil(MAC_CHROME), 'Mac · Chrome');
  assert.equal(nomDAppareil(WINDOWS_EDGE), 'Windows · Edge');
  assert.equal(nomDAppareil(''), 'Appareil inconnu');
  assert.equal(nomDAppareil(undefined), 'Appareil inconnu');
  assert.equal(nomDAppareil('curl/8.0'), 'Appareil inconnu');
});

test('la liste d’un compte ne montre que ses appareils, sans adresse d’abonnement', () => {
  getDb().exec('DELETE FROM push_subs');
  subscribe({ endpoint: 'https://push.exemple/a1', keys: {} }, 'ana', IPHONE);
  subscribe({ endpoint: 'https://push.exemple/a2', keys: {} }, 'ana', MAC_CHROME);
  subscribe({ endpoint: 'https://push.exemple/b1', keys: {} }, 'ben', ANDROID);

  const { appareils, courantId } = appareilsDuCompte('ana', 'https://push.exemple/a1');
  assert.equal(appareils.length, 2);
  assert.deepEqual(appareils.map((a) => a.nom).sort(), ['Mac · Chrome', 'iPhone · Safari']);
  assert.ok(courantId && appareils.some((a) => a.id === courantId), 'l’appareil qui regarde est repéré');
  assert.ok(!JSON.stringify(appareils).includes('push.exemple'), 'l’adresse d’abonnement ne sort jamais');
  assert.equal(appareilsDuCompte('ben').appareils.length, 1);
});

test('un compte ne retire que ses propres appareils', () => {
  getDb().exec('DELETE FROM push_subs');
  subscribe({ endpoint: 'https://push.exemple/a1', keys: {} }, 'ana', IPHONE);
  subscribe({ endpoint: 'https://push.exemple/b1', keys: {} }, 'ben', ANDROID);
  const idDeBen = appareilsDuCompte('ben').appareils[0].id;

  assert.equal(retirerAppareilDuCompte('ana', idDeBen), false, 'l’appareil d’un autre reste');
  assert.equal(appareilsDuCompte('ben').appareils.length, 1);
  assert.equal(retirerAppareilDuCompte('ben', idDeBen), true);
  assert.equal(appareilsDuCompte('ben').appareils.length, 0);
  assert.equal(appareilsDuCompte('ana').appareils.length, 1);
});

test('se réabonner garde le nom de l’appareil quand le navigateur n’en dit rien', () => {
  getDb().exec('DELETE FROM push_subs');
  subscribe({ endpoint: 'https://push.exemple/a1', keys: {} }, 'ana', IPHONE);
  subscribe({ endpoint: 'https://push.exemple/a1', keys: {} }, 'ana');
  assert.equal(appareilsDuCompte('ana').appareils[0].nom, 'iPhone · Safari');
});

test('un abonnement ancien, sans nom, s’affiche « Appareil inconnu » et reste servi', () => {
  getDb().exec('DELETE FROM push_subs');
  getDb()
    .prepare('INSERT INTO push_subs (endpoint, data, created_at, user_id) VALUES (?, ?, ?, ?)')
    .run('https://push.exemple/vieux', '{}', 1, 'ana');
  assert.equal(appareilsDuCompte('ana').appareils[0].nom, 'Appareil inconnu');
});
