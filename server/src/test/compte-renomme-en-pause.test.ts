import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Le nom d'un compte vient de son relevé de quota. Un compte dont la   */
/* lecture est EN PAUSE (après un refus 429) repousse tel quel son       */
/* dernier relevé mémorisé : renommer un tel compte doit tout de même    */
/* faire remonter le NOUVEAU nom, jamais celui figé dans le relevé.      */
/* ------------------------------------------------------------------ */

// Base jetable AVANT d'importer les modules qui la lisent.
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'compte-renomme-pause-'));
process.env.HAIKODEV_DATA = bacASable;

// Un coffre avec de vrais identifiants : la lecture atteint alors le réseau,
// que l'on remplace par un refus 429 pour mettre le compte en pause.
const coffre = fs.mkdtempSync(path.join(os.tmpdir(), 'compte-renomme-pause-coffre-'));
fs.writeFileSync(
  path.join(coffre, '.credentials.json'),
  JSON.stringify({ claudeAiOauth: { accessToken: 'jeton-de-test', expiresAt: Date.now() + 3_600_000 } }),
);

// Toute lecture de quota répond « trop d'appels » (429) : le compte passe en
// pause et son dernier relevé mémorisé est réutilisé aux tours suivants.
global.fetch = (async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;

const accounts = await import('../accounts.js');
const { saveAccountRecord, renameAccount, refreshQuotas, cachedQuotas } = accounts;

saveAccountRecord({
  id: 'claude-principal',
  engine: 'claude',
  label: 'Claude — compte principal',
  priority: 10,
  configDir: coffre,
});

test('un compte renommé pendant sa pause de lecture affiche le nouveau nom', async () => {
  // Première lecture : le refus 429 met le compte en pause et mémorise un relevé
  // portant l'ANCIEN nom.
  const avant = await refreshQuotas(true);
  assert.equal(avant.find((q) => q.id === 'claude-principal')?.label, 'Claude — compte principal');

  // On renomme.
  const modifie = renameAccount('claude-principal', 'Studio — Max x20');
  assert.equal(modifie?.label, 'Studio — Max x20');

  // Le relevé en cache (rejoué sans nouvelle lecture) porte déjà le nouveau nom.
  assert.equal(
    cachedQuotas().find((q) => q.id === 'claude-principal')?.label,
    'Studio — Max x20',
    'le relevé mémorisé suit le renommage',
  );

  // Seconde lecture : le compte est toujours en pause, son relevé est repoussé —
  // il doit porter le NOUVEAU nom, pas celui figé au premier relevé.
  const apres = await refreshQuotas(true);
  assert.equal(
    apres.find((q) => q.id === 'claude-principal')?.label,
    'Studio — Max x20',
    'le relevé repoussé pendant la pause porte le nouveau nom',
  );
});
