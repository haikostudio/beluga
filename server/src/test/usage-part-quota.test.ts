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

/* ------------------------------------------------------------------ */
/* La VUE D'ENSEMBLE : usageByCard remonte les deux parts, et classe    */
/* sur la part de SEMAINE                                               */
/* ------------------------------------------------------------------ */

test('usageByCard somme les deux parts de quota et classe sur la semaine', () => {
  // Une carte peu gourmande en jetons mais lourde sur la semaine, et l'inverse :
  // le classement doit suivre la SEMAINE, pas les jetons.
  store.recordUsage({
    cardId: 'carte-semaine-lourde',
    account: 'compte-a',
    engine: 'claude',
    tokens: 500,
    quota5h: partQuotaConsommee(1, 1.5),
    quotaSemaine: partQuotaConsommee(20, 28),
    seconds: 10,
  });
  store.recordUsage({
    cardId: 'carte-jetons-lourds',
    account: 'compte-a',
    engine: 'claude',
    tokens: 900000,
    quota5h: partQuotaConsommee(1, 4),
    quotaSemaine: partQuotaConsommee(20, 21),
    seconds: 900,
  });

  const lignes = store.usageByCard();
  const parId = new Map(lignes.map((l) => [l.cardId, l]));

  // Les sommes des deux colonnes remontent bien, carte par carte.
  const lourde = parId.get('carte-semaine-lourde')!;
  assert.ok(Math.abs(lourde.quotaSemaine - 8) < 1e-6, 'la part de semaine sommée est attendue');
  assert.ok(Math.abs(lourde.quota5h - 0.5) < 1e-6, 'la part de 5 h sommée est attendue');

  // La carte des deux tours du premier test totalise les mêmes chiffres que
  // `usageQuotaByCard` : une seule vérité, deux lectures.
  const parCarte = store.usageQuotaByCard('carte-essai-1');
  const dansLaVue = parId.get('carte-essai-1')!;
  assert.ok(Math.abs(dansLaVue.quota5h - parCarte.quota5h) < 1e-6);
  assert.ok(Math.abs(dansLaVue.quotaSemaine - parCarte.quotaSemaine) < 1e-6);

  // Le classement : la plus gourmande de la SEMAINE d'abord, même si une autre
  // carte a brûlé mille fois plus de jetons.
  const rangs = lignes.map((l) => l.cardId);
  assert.ok(
    rangs.indexOf('carte-semaine-lourde') < rangs.indexOf('carte-jetons-lourds'),
    'la carte la plus lourde sur la semaine passe devant celle qui a le plus de jetons',
  );
  // Et la liste est bien décroissante sur la part de semaine.
  for (let i = 1; i < lignes.length; i++) {
    assert.ok(lignes[i - 1].quotaSemaine >= lignes[i].quotaSemaine, 'liste décroissante sur la part de semaine');
  }
});
