import assert from 'node:assert/strict';
import test from 'node:test';
import { heureDeRemiseAZero, tempsRestant } from '@haikodev/shared';

const MAINTENANT = new Date('2026-08-03T08:59:00+02:00').getTime();
const min = (n: number) => n * 60_000;

test('sans heure connue, on n’invente rien', () => {
  assert.equal(tempsRestant(undefined, MAINTENANT), null);
  assert.equal(heureDeRemiseAZero(undefined, MAINTENANT), null);
});

test('le cas vécu : 8 h 59 pour une fenêtre finissant à 12 h 59', () => {
  const fin = new Date('2026-08-03T12:59:59+02:00').getTime();
  assert.equal(tempsRestant(fin, MAINTENANT), 'reste 4 h');
});

test('les minutes seules sous l’heure', () => {
  assert.equal(tempsRestant(MAINTENANT + min(12), MAINTENANT), 'reste 12 min');
  assert.equal(tempsRestant(MAINTENANT + 20_000, MAINTENANT), 'reste moins d’une minute');
});

test('les minutes se lisent sur deux chiffres derrière l’heure', () => {
  assert.equal(tempsRestant(MAINTENANT + min(187), MAINTENANT), 'reste 3 h 07');
  assert.equal(tempsRestant(MAINTENANT + min(120), MAINTENANT), 'reste 2 h');
});

test('au-delà d’un jour, on dit les jours', () => {
  assert.equal(tempsRestant(MAINTENANT + min(60 * 52), MAINTENANT), 'reste 2 j 4 h');
  assert.equal(tempsRestant(MAINTENANT + min(60 * 48), MAINTENANT), 'reste 2 j');
});

test('une échéance dépassée ne montre pas un nombre négatif', () => {
  assert.equal(tempsRestant(MAINTENANT - min(3), MAINTENANT), 'remise à zéro imminente');
});

test('l’heure exacte reste disponible pour l’infobulle', () => {
  const fin = new Date('2026-08-03T12:59:00+02:00').getTime();
  assert.match(heureDeRemiseAZero(fin, MAINTENANT) ?? '', /^Remise à zéro à 12:59$/);
  const demain = new Date('2026-08-05T09:00:00+02:00').getTime();
  assert.match(heureDeRemiseAZero(demain, MAINTENANT) ?? '', /^Remise à zéro le 05\.08 à 09:00$/);
});
