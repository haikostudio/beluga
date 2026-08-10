import assert from 'node:assert/strict';
import test from 'node:test';
import { doitAlerterFinDeFenetre, fraicheurDuReleve, heureDeRemiseAZero, tempsRestant } from '@haikodev/shared';

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
  assert.equal(tempsRestant(MAINTENANT - 20_000, MAINTENANT), 'remise à zéro imminente');
  assert.equal(tempsRestant(MAINTENANT - min(3), MAINTENANT), 'échéance dépassée — vérification en cours');
});

test('un relevé gardé après un échec annonce clairement son âge', () => {
  assert.equal(fraicheurDuReleve(MAINTENANT - 20_000, MAINTENANT), 'dernier relevé il y a moins d’une minute');
  assert.equal(fraicheurDuReleve(MAINTENANT - min(17), MAINTENANT), 'dernier relevé il y a 17 min');
  assert.equal(fraicheurDuReleve(MAINTENANT - min(60 * 26), MAINTENANT), 'dernier relevé il y a 1 jour');
});

test('l’heure exacte reste disponible pour l’infobulle', () => {
  const fin = new Date('2026-08-03T12:59:00+02:00').getTime();
  assert.match(heureDeRemiseAZero(fin, MAINTENANT) ?? '', /^Remise à zéro à 12:59$/);
  const demain = new Date('2026-08-05T09:00:00+02:00').getTime();
  assert.match(heureDeRemiseAZero(demain, MAINTENANT) ?? '', /^Remise à zéro le 05\.08 à 09:00$/);
});

/* ------------------------------------------------------------------ */
/* L'alerte de fin de fenêtre                                          */
/* ------------------------------------------------------------------ */

test('on prévient sous trente minutes restantes', () => {
  assert.equal(doitAlerterFinDeFenetre({ resetsAt: MAINTENANT + min(28) }, MAINTENANT), true);
});

test('au-dessus du seuil, on ne dit rien', () => {
  assert.equal(doitAlerterFinDeFenetre({ resetsAt: MAINTENANT + min(31) }, MAINTENANT), false);
});

test('une fenêtre déjà finie ne se signale plus', () => {
  assert.equal(doitAlerterFinDeFenetre({ resetsAt: MAINTENANT - min(1) }, MAINTENANT), false);
});

test('on ne prévient qu’une fois par fenêtre', () => {
  const fin = MAINTENANT + min(20);
  assert.equal(doitAlerterFinDeFenetre({ resetsAt: fin, dejaAnnoncee: fin }, MAINTENANT), false);
  // La fenêtre suivante a une AUTRE échéance : elle redonne droit à une alerte.
  assert.equal(doitAlerterFinDeFenetre({ resetsAt: fin + min(300), dejaAnnoncee: fin }, MAINTENANT + min(300)), true);
});

test('une lecture en échec ne déclenche rien', () => {
  assert.equal(
    doitAlerterFinDeFenetre({ resetsAt: MAINTENANT + min(10), lectureEnEchec: true }, MAINTENANT),
    false,
  );
});

test('sans heure de remise à zéro, rien non plus', () => {
  assert.equal(doitAlerterFinDeFenetre({}, MAINTENANT), false);
});
