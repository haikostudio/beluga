import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { partQuotaConsommee } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* Chaque tâche range, avec sa ligne de consommation, la part de quota   */
/* de 5 h ET la part de quota de la semaine qu'elle a consommée         */
/* ------------------------------------------------------------------ */

/*
 * L'écriture passe par une VRAIE base, posée dans un dossier jetable : le test
 * n'a rien à faire de celle du serveur.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-part-quota-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');

/* La règle pure : jamais de part négative, jamais de part sans relevé. */
test('la part consommée est la différence après - avant, jamais négative', () => {
  assert.equal(partQuotaConsommee(10, 12.5), 2.5);
  assert.equal(partQuotaConsommee(10, 10), 0);
  // Remise à zéro en cours de tour : « après » sous « avant » → 0, pas un négatif.
  assert.equal(partQuotaConsommee(90, 3), 0);
  // Relevé manquant d'un côté ou de l'autre : rien à attribuer.
  assert.equal(partQuotaConsommee(undefined, 12), 0);
  assert.equal(partQuotaConsommee(10, undefined), 0);
  assert.equal(partQuotaConsommee(undefined, undefined), 0);
});

test('recordUsage range les deux parts de quota, ressortables par carte et par jour', () => {
  const carte = 'carte-essai-1';

  // Deux tours de la même carte, à deux dates différentes.
  store.recordUsage({
    cardId: carte,
    account: 'compte-a',
    engine: 'claude',
    tokens: 1000,
    quota5h: partQuotaConsommee(10, 12),
    quotaSemaine: partQuotaConsommee(40, 40.5),
    seconds: 30,
  });
  store.recordUsage({
    cardId: carte,
    account: 'compte-a',
    engine: 'claude',
    tokens: 2000,
    quota5h: partQuotaConsommee(12, 15),
    quotaSemaine: partQuotaConsommee(40.5, 41.2),
    seconds: 45,
  });

  // Le total par carte, en une seule lecture : 2 + 3 sur la fenêtre de 5 h, 0,5 + 0,7 sur la semaine.
  const total = store.usageQuotaByCard(carte);
  assert.ok(Math.abs(total.quota5h - 5) < 1e-6, 'le total de 5 h par carte est attendu');
  assert.ok(Math.abs(total.quotaSemaine - 1.2) < 1e-6, 'le total de semaine par carte est attendu');
});

test('une carte sans aucun relevé rend deux zéros, pas un null', () => {
  const total = store.usageQuotaByCard('carte-jamais-vue');
  assert.equal(total.quota5h, 0);
  assert.equal(total.quotaSemaine, 0);
});
