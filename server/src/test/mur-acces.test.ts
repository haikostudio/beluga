import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decisionDuMur,
  tempsRestantEnClair,
  MUR_ESSAIS_MAX,
  MUR_DELAI_MS,
} from '@haikodev/shared';

const MINUTE = 60 * 1000;
const maintenant = 1_000_000_000_000;

test('trois essais ratés d\'affilée bloquent l\'adresse', () => {
  // Trois refus espacés du délai, le dernier vieux d'un peu plus de 5 min.
  const essais = [maintenant - 16 * MINUTE, maintenant - 11 * MINUTE, maintenant - 6 * MINUTE];
  assert.equal(essais.length, MUR_ESSAIS_MAX);
  const d = decisionDuMur(essais, maintenant);
  assert.equal(d.autorise, false);
  assert.equal(d.raison, 'trop-d-essais');
  assert.match(d.message ?? '', /Trop de tentatives/);
});

test('un essai relancé avant 5 minutes est refusé avec le temps restant', () => {
  const dernierRate = maintenant - 2 * MINUTE; // il y a 2 min, un seul raté
  const d = decisionDuMur([dernierRate], maintenant);
  assert.equal(d.autorise, false);
  assert.equal(d.raison, 'attente');
  // Il reste 3 minutes à patienter.
  assert.equal(d.attenteMs, MUR_DELAI_MS - 2 * MINUTE);
  assert.match(d.message ?? '', /3 minutes/);
});

test('un bon mot de passe passe sans attente (aucun essai raté)', () => {
  const d = decisionDuMur([], maintenant);
  assert.equal(d.autorise, true);
  assert.equal(d.message, undefined);
});

test('un unique essai raté vieux de plus de 5 minutes n\'attend plus', () => {
  const d = decisionDuMur([maintenant - 6 * MINUTE], maintenant);
  assert.equal(d.autorise, true);
});

test('les essais hors fenêtre ne comptent pas dans le blocage', () => {
  // Trois refus, mais tous vieux de plus de 20 min : oubliés.
  const vieux = [maintenant - 40 * MINUTE, maintenant - 35 * MINUTE, maintenant - 30 * MINUTE];
  const d = decisionDuMur(vieux, maintenant);
  assert.equal(d.autorise, true);
});

test('le temps restant se dit en français simple', () => {
  assert.equal(tempsRestantEnClair(3 * MINUTE), '3 minutes');
  assert.equal(tempsRestantEnClair(MINUTE), '1 minute');
  assert.equal(tempsRestantEnClair(90 * 1000), '1 min 30 s');
  assert.equal(tempsRestantEnClair(30 * 1000), '30 secondes');
});
