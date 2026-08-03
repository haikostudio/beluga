import assert from 'node:assert/strict';
import test from 'node:test';
import { previsionEpuisement, type ReleveQuota } from '@haikodev/shared';

const MAINTENANT = new Date('2026-08-03T09:00:00+02:00').getTime();
const h = (n: number) => n * 3600_000;
const j = (n: number) => n * 24 * 3600_000;

/** Une suite de relevés réguliers : `pas` points de % par heure, sur `heures`. */
function releves(depart: number, pas: number, heures: number, fin = MAINTENANT): ReleveQuota[] {
  const out: ReleveQuota[] = [];
  for (let i = heures; i >= 0; i--) {
    out.push({ at: fin - h(i), weekly: depart + pas * (heures - i) });
  }
  return out;
}

test('rythme régulier : la prévision tombe avant la remise à zéro', () => {
  // 40 % consommés, 1 % par heure : les 60 % restants partent en 60 h,
  // pour une fenêtre qui ne se remet à zéro que dans 5 jours.
  const prevision = previsionEpuisement(
    releves(20, 1, 20),
    { usedPct: 40, resetsAt: MAINTENANT + j(5) },
    MAINTENANT,
  );
  assert.ok(prevision, 'une prévision est attendue');
  assert.equal(prevision.niveau, 'manque');
  assert.equal(Math.round(prevision.at), MAINTENANT + h(60));
  assert.match(prevision.texte, /^épuisé \S+ vers \d+ h( 30)?$/);
  assert.ok(Math.abs(prevision.parJour - 24) < 0.01, 'environ 24 % par jour');
});

test('la formulation nomme le jour de la semaine', () => {
  const prevision = previsionEpuisement(
    releves(20, 1, 20),
    { usedPct: 40, resetsAt: MAINTENANT + j(5) },
    MAINTENANT,
  );
  // 60 h après un lundi 9 h → le mercredi suivant, vers 21 h.
  assert.equal(prevision?.texte, 'épuisé mercredi vers 21 h');
});

test('rythme nul : rien à annoncer', () => {
  const plat = releves(30, 0, 20);
  assert.equal(previsionEpuisement(plat, { usedPct: 30, resetsAt: MAINTENANT + j(5) }, MAINTENANT), null);
});

test('historique trop court : rien à annoncer', () => {
  const court = [
    { at: MAINTENANT - h(0.5), weekly: 40 },
    { at: MAINTENANT, weekly: 45 },
  ];
  assert.equal(previsionEpuisement(court, { usedPct: 45, resetsAt: MAINTENANT + j(5) }, MAINTENANT), null);
  // Un seul relevé non plus.
  assert.equal(
    previsionEpuisement([{ at: MAINTENANT, weekly: 45 }], { usedPct: 45, resetsAt: MAINTENANT + j(5) }, MAINTENANT),
    null,
  );
});

test('fenêtre déjà épuisée : rien à annoncer', () => {
  const pleine = releves(80, 1, 20);
  assert.equal(previsionEpuisement(pleine, { usedPct: 100, resetsAt: MAINTENANT + j(5) }, MAINTENANT), null);
});

test('épuisement au-delà de la remise à zéro : silence', () => {
  // 0,1 % par heure sur 90 % restants : 900 h, bien après la fin de fenêtre.
  const lent = releves(9, 0.1, 20);
  assert.equal(previsionEpuisement(lent, { usedPct: 10, resetsAt: MAINTENANT + j(5) }, MAINTENANT), null);
});

test('sans heure de remise à zéro connue, on n’invente rien', () => {
  const points = releves(20, 1, 20);
  assert.equal(previsionEpuisement(points, { usedPct: 40 }, MAINTENANT), null);
  assert.equal(previsionEpuisement(points, undefined, MAINTENANT), null);
  // Fenêtre déjà terminée : plus rien à prévoir dessus.
  assert.equal(previsionEpuisement(points, { usedPct: 40, resetsAt: MAINTENANT - h(1) }, MAINTENANT), null);
});

test('épuisement de peu avant la fin : « juste », pas « manque »', () => {
  // 50 % restants à 1 % par heure → 50 h, pour une fenêtre qui finit dans 52 h.
  const prevision = previsionEpuisement(
    releves(30, 1, 20),
    { usedPct: 50, resetsAt: MAINTENANT + h(52) },
    MAINTENANT,
  );
  assert.equal(prevision?.niveau, 'juste');
});

test('une remise à zéro dans l’historique ne fausse pas la pente', () => {
  // Vieille fenêtre montée à 90 %, puis remise à zéro il y a 20 h.
  const vieux: ReleveQuota[] = [
    { at: MAINTENANT - h(40), weekly: 70 },
    { at: MAINTENANT - h(30), weekly: 90 },
  ];
  const prevision = previsionEpuisement(
    [...vieux, ...releves(20, 1, 20)],
    { usedPct: 40, resetsAt: MAINTENANT + j(5) },
    MAINTENANT,
  );
  // Seuls les relevés d'après la remise à zéro comptent : 1 % par heure.
  assert.ok(prevision && Math.abs(prevision.parJour - 24) < 0.01);
});
