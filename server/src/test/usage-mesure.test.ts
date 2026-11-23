import test from 'node:test';
import assert from 'node:assert/strict';
import { ajouterMois, barreMensuelle, cycleDuMois } from '@beluga/shared';

const H = 3600 * 1000;
const J = 24 * H;
const utc = (a: number, m: number, j: number, h = 0) => Date.UTC(a, m - 1, j, h);

test('ajouter un mois garde le jour, ou le dernier jour du mois trop court', () => {
  assert.equal(ajouterMois(utc(2026, 9, 27), 1), utc(2026, 10, 27));
  assert.equal(ajouterMois(utc(2026, 1, 31), 1), utc(2027 - 1, 2, 28));
  assert.equal(ajouterMois(utc(2026, 12, 15), 1), utc(2027, 1, 15));
  assert.equal(ajouterMois(utc(2026, 1, 15), -1), utc(2025, 12, 15));
});

test('le cycle se retrouve depuis une date de renouvellement passée ou à venir', () => {
  const maintenant = utc(2026, 9, 29, 12);
  assert.deepEqual(cycleDuMois(utc(2026, 10, 27), maintenant), { debut: utc(2026, 9, 27), fin: utc(2026, 10, 27) });
  assert.deepEqual(cycleDuMois(utc(2026, 8, 27), maintenant), { debut: utc(2026, 9, 27), fin: utc(2026, 10, 27) });
  assert.deepEqual(cycleDuMois(utc(2025, 1, 27), maintenant), { debut: utc(2026, 9, 27), fin: utc(2026, 10, 27) });
  // Le jour même du renouvellement, le nouveau cycle a déjà commencé.
  assert.deepEqual(cycleDuMois(utc(2026, 9, 27), utc(2026, 9, 27)), { debut: utc(2026, 9, 27), fin: utc(2026, 10, 27) });
});

test('sans plafond saisi, aucune barre — jamais une barre à 0 %', () => {
  assert.equal(barreMensuelle(undefined, [], utc(2026, 9, 29)), undefined);
  assert.equal(barreMensuelle({ renouvellement: utc(2026, 10, 27) }, [{ at: utc(2026, 9, 28), valeur: 10 }], utc(2026, 9, 29)), undefined);
});

test('le relevé saisi dans le cycle en cours est prolongé par les tours envoyés depuis', () => {
  const maintenant = utc(2026, 9, 29, 12);
  const forfait = {
    plafond: 1000,
    renouvellement: utc(2026, 10, 27),
    consommeAuReleve: 400,
    releveAt: utc(2026, 9, 28),
  };
  const evenements = [
    { at: utc(2026, 9, 27, 2), valeur: 999 }, // avant le relevé : déjà dans les 400
    { at: utc(2026, 9, 28, 6), valeur: 100 },
    { at: utc(2026, 9, 29, 6), valeur: 50 },
  ];
  const barre = barreMensuelle(forfait, evenements, maintenant);
  assert.ok(Math.abs((barre?.usedPct ?? 0) - 55) < 1e-9);
  assert.equal(barre?.resetsAt, utc(2026, 10, 27));
  assert.equal(barre?.durationSeconds, 30 * 24 * 3600);
});

test('un relevé d’un mois révolu est oublié : le cycle repart de zéro, avec les seuls tours mesurés', () => {
  const maintenant = utc(2026, 9, 29, 12);
  const forfait = { plafond: 1000, renouvellement: utc(2026, 8, 27), consommeAuReleve: 900, releveAt: utc(2026, 9, 1) };
  const evenements = [
    { at: utc(2026, 9, 10), valeur: 5000 }, // du cycle précédent
    { at: utc(2026, 9, 28), valeur: 250 },
  ];
  const barre = barreMensuelle(forfait, evenements, maintenant);
  assert.equal(barre?.usedPct, 25);
  assert.equal(barre?.resetsAt, utc(2026, 10, 27));
});

test('au jour du renouvellement la barre retombe à zéro', () => {
  const forfait = { plafond: 1000, renouvellement: utc(2026, 9, 27), consommeAuReleve: 800, releveAt: utc(2026, 9, 20) };
  const barre = barreMensuelle(forfait, [{ at: utc(2026, 9, 25), valeur: 100 }], utc(2026, 9, 27, 3));
  assert.equal(barre?.usedPct, 0);
  assert.equal(barre?.resetsAt, utc(2026, 10, 27));
});

test('la barre ne dépasse jamais 100 %', () => {
  const forfait = { plafond: 100, renouvellement: utc(2026, 10, 27), consommeAuReleve: 90, releveAt: utc(2026, 9, 28) };
  assert.equal(barreMensuelle(forfait, [{ at: utc(2026, 9, 29), valeur: 500 }], utc(2026, 9, 29, 12))?.usedPct, 100);
});

test('sans date de renouvellement, on compte depuis le relevé, ou sur trente jours', () => {
  const maintenant = utc(2026, 9, 29);
  const evenements = [
    { at: maintenant - 40 * J, valeur: 900 },
    { at: maintenant - 10 * J, valeur: 100 },
    { at: maintenant - 1 * J, valeur: 100 },
  ];
  const sansReleve = barreMensuelle({ plafond: 1000 }, evenements, maintenant);
  assert.equal(sansReleve?.usedPct, 20);
  assert.equal(sansReleve?.resetsAt, undefined);
  const avecReleve = barreMensuelle({ plafond: 1000, consommeAuReleve: 300, releveAt: maintenant - 5 * J }, evenements, maintenant);
  assert.equal(avecReleve?.usedPct, 40);
});

test('un forfait épuisé chez Xiaomi (402) remplit la barre, avec ou sans plafond saisi', () => {
  assert.equal(barreMensuelle(undefined, [], utc(2026, 9, 29), true)?.usedPct, 100);
  const avec = barreMensuelle({ plafond: 1000, renouvellement: utc(2026, 10, 27) }, [], utc(2026, 9, 29), true);
  assert.equal(avec?.usedPct, 100);
  assert.equal(avec?.resetsAt, utc(2026, 10, 27));
});
