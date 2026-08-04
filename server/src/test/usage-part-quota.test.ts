import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { partQuotaConsommee } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Chaque tâche range, avec sa ligne de consommation, la part de quota   */
/* de 5 h ET la part de quota de la semaine qu'elle a consommée         */
/* ------------------------------------------------------------------ */

/*
 * L'écriture passe par une VRAIE base, posée dans un dossier jetable : le test
 * n'a rien à faire de celle du serveur.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-part-quota-'));
process.env.HAIKODEV_DATA = bacASable;

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

  // Une requête simple sort, pour la carte, les deux chiffres, non nuls.
  const parJour = store.usageQuotaByCardAndDay(carte);
  assert.ok(parJour.length >= 1, 'au moins une journée de consommation attendue');
  const total5h = parJour.reduce((somme, ligne) => somme + ligne.quota5h, 0);
  const totalSemaine = parJour.reduce((somme, ligne) => somme + ligne.quotaSemaine, 0);
  assert.ok(total5h > 0, 'la part de quota 5 h doit être non nulle');
  assert.ok(totalSemaine > 0, 'la part de quota de la semaine doit être non nulle');
  // 2 + 3 sur la fenêtre de 5 h, 0,5 + 0,7 sur la semaine.
  assert.ok(Math.abs(total5h - 5) < 1e-6, 'la somme des parts de 5 h est attendue');
  assert.ok(Math.abs(totalSemaine - 1.2) < 1e-6, 'la somme des parts de semaine est attendue');

  // Le total par carte, en une seule lecture, donne les mêmes sommes.
  const total = store.usageQuotaByCard(carte);
  assert.ok(Math.abs(total.quota5h - 5) < 1e-6, 'le total de 5 h par carte est attendu');
  assert.ok(Math.abs(total.quotaSemaine - 1.2) < 1e-6, 'le total de semaine par carte est attendu');
});

test('une carte sans aucun relevé rend deux zéros, pas un null', () => {
  const total = store.usageQuotaByCard('carte-jamais-vue');
  assert.equal(total.quota5h, 0);
  assert.equal(total.quotaSemaine, 0);
});
