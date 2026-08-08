import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cumulerPartsQuota, partQuotaConsommee, poidsDeTour, repartirPartQuota } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Deux tâches qui se CHEVAUCHENT sur le même compte se partagent le    */
/* delta de quota observé, au prorata de leurs jetons — la somme ne     */
/* dépasse jamais ce que le compte a réellement consommé.               */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'repartir-part-quota-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');

test('le poids d’un tour : ses jetons, à défaut sa durée, jamais négatif', () => {
  assert.equal(poidsDeTour(1000, 30), 1000);
  // Pas de jetons comptés : on retombe sur la durée.
  assert.equal(poidsDeTour(0, 30), 30);
  assert.equal(poidsDeTour(undefined, 45), 45);
  // Ni jetons ni durée : aucun poids.
  assert.equal(poidsDeTour(0, 0), 0);
  assert.equal(poidsDeTour(-5, -2), 0);
});

test('deux tours parallèles : la somme des parts vaut le delta, au prorata des jetons', () => {
  // Un delta de quota connu, observé par les deux tours qui voient le même
  // compteur global. Sans partage, chacun s’attribuerait tout le delta.
  const delta5h = 6; // %
  const deltaSemaine = 1.5; // %
  const jetonsA = 1000;
  const jetonsB = 3000;
  const groupe = [jetonsA, jetonsB];

  const partA5h = repartirPartQuota(delta5h, jetonsA, groupe);
  const partB5h = repartirPartQuota(delta5h, jetonsB, groupe);
  const partASemaine = repartirPartQuota(deltaSemaine, jetonsA, groupe);
  const partBSemaine = repartirPartQuota(deltaSemaine, jetonsB, groupe);

  // La somme des parts égale EXACTEMENT le delta — jamais deux fois.
  assert.ok(Math.abs(partA5h + partB5h - delta5h) < 1e-9, 'somme des parts 5 h = delta');
  assert.ok(Math.abs(partASemaine + partBSemaine - deltaSemaine) < 1e-9, 'somme des parts semaine = delta');

  // Chacune au prorata de ses jetons : A pèse 1/4, B pèse 3/4.
  assert.ok(Math.abs(partA5h - delta5h * 0.25) < 1e-9, 'A reçoit un quart du delta 5 h');
  assert.ok(Math.abs(partB5h - delta5h * 0.75) < 1e-9, 'B reçoit trois quarts du delta 5 h');
  // Les deux fenêtres suivent la MÊME répartition.
  assert.ok(Math.abs(partA5h / delta5h - partASemaine / deltaSemaine) < 1e-9, 'même part relative sur les deux fenêtres');
});

test('un tour seul reçoit tout le delta ; sans poids, on partage à égalité', () => {
  assert.equal(repartirPartQuota(4, 500, [500]), 4);
  // Aucun jeton d’aucun côté (deux tours) : moitié-moitié plutôt que division par zéro.
  assert.equal(repartirPartQuota(4, 0, [0, 0]), 2);
  // Delta nul ou négatif : rien à répartir.
  assert.equal(repartirPartQuota(0, 500, [500, 500]), 0);
  assert.equal(repartirPartQuota(-3, 500, [500, 500]), 0);
});

test('deux fins décalées : chaque hausse du compte est comptée une seule fois', () => {
  let tours = [
    { id: 'tour-a', poids: 1000, quota5h: 0, quotaSemaine: 0 },
    { id: 'tour-b', poids: 1000, quota5h: 0, quotaSemaine: 0 },
  ];

  // Les deux tours partent à 0 %. Quand A finit à 82 %, la première hausse
  // est partagée entre A et B.
  tours = cumulerPartsQuota({ session: 0, weekly: 10 }, { session: 82, weekly: 18 }, tours);
  const tourA = tours.find((tour) => tour.id === 'tour-a')!;
  assert.equal(tourA.quota5h, 41);
  assert.equal(tourA.quotaSemaine, 4);

  // A est rangé. B finit à 100 % : seuls les 18 nouveaux points s'ajoutent à
  // sa part déjà cumulée, au lieu de recompter les 100 points depuis le départ.
  tours = cumulerPartsQuota(
    { session: 82, weekly: 18 },
    { session: 100, weekly: 20 },
    tours.filter((tour) => tour.id === 'tour-b'),
  );
  const tourB = tours[0];

  assert.equal(tourB.quota5h, 59);
  assert.equal(tourB.quotaSemaine, 6);
  assert.equal(tourA.quota5h + tourB.quota5h, 100, 'la fenêtre de 5 h totalise la hausse réelle');
  assert.equal(tourA.quotaSemaine + tourB.quotaSemaine, 10, 'la semaine totalise la hausse réelle');

  store.recordUsage({ cardId: 'carte-fin-a', quota5h: tourA.quota5h, quotaSemaine: tourA.quotaSemaine });
  store.recordUsage({ cardId: 'carte-fin-b', quota5h: tourB.quota5h, quotaSemaine: tourB.quotaSemaine });
  const carteA = store.usageQuotaByCard('carte-fin-a');
  const carteB = store.usageQuotaByCard('carte-fin-b');
  assert.equal(carteA.quota5h + carteB.quota5h, 100);
  assert.equal(carteA.quotaSemaine + carteB.quotaSemaine, 10);
});

test('les parts rangées par recordUsage se somment au delta connu', () => {
  const carte = 'carte-parallele-1';
  const delta5h = partQuotaConsommee(10, 16); // 6 %
  const deltaSemaine = partQuotaConsommee(40, 41.5); // 1,5 %
  const groupe = [1000, 3000];

  // Deux tours qui se chevauchent sur le même compte, chacun sa part.
  store.recordUsage({
    cardId: carte,
    account: 'compte-parallele',
    engine: 'claude',
    tokens: 1000,
    quota5h: repartirPartQuota(delta5h, 1000, groupe),
    quotaSemaine: repartirPartQuota(deltaSemaine, 1000, groupe),
    seconds: 30,
  });
  store.recordUsage({
    cardId: carte,
    account: 'compte-parallele',
    engine: 'claude',
    tokens: 3000,
    quota5h: repartirPartQuota(delta5h, 3000, groupe),
    quotaSemaine: repartirPartQuota(deltaSemaine, 3000, groupe),
    seconds: 30,
  });

  const parJour = store.usageQuotaByCardAndDay(carte);
  const total5h = parJour.reduce((somme, ligne) => somme + ligne.quota5h, 0);
  const totalSemaine = parJour.reduce((somme, ligne) => somme + ligne.quotaSemaine, 0);
  // La somme des deux parts ne dépasse pas le delta réel : elle l’égale.
  assert.ok(Math.abs(total5h - delta5h) < 1e-6, 'somme des parts 5 h = delta observé');
  assert.ok(Math.abs(totalSemaine - deltaSemaine) < 1e-6, 'somme des parts semaine = delta observé');
});
