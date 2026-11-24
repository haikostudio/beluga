import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decisionDuMur,
  decisionDeConnexion,
  MUR_ESSAIS_LIBRES,
  tempsRestantEnClair,
  MUR_ESSAIS_MAX,
  MUR_DELAI_MS,
} from '@beluga/shared';

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

/* La connexion : trois ratés libres, puis cinq minutes. */

test('connexion : un ou deux ratés rapprochés laissent réessayer aussitôt', () => {
  assert.equal(MUR_ESSAIS_LIBRES, 3);
  assert.equal(decisionDeConnexion([], maintenant).autorise, true);
  assert.equal(decisionDeConnexion([maintenant - 1000], maintenant).autorise, true);
  assert.equal(decisionDeConnexion([maintenant - 2000, maintenant - 1000], maintenant).autorise, true);
});

test('connexion : au troisième raté, il faut attendre cinq minutes depuis le dernier', () => {
  const d = decisionDeConnexion([maintenant - 3 * MINUTE, maintenant - 2 * MINUTE, maintenant - MINUTE], maintenant);
  assert.equal(d.autorise, false);
  assert.equal(d.raison, 'attente');
  assert.equal(d.attenteMs, MUR_DELAI_MS - MINUTE);
  assert.match(d.message ?? '', /Attendez encore 4 minutes/);
});

test('connexion : l’attente écoulée, on réessaie ; un nouveau raté relance l’attente', () => {
  const trois = [maintenant - 9 * MINUTE, maintenant - 8 * MINUTE, maintenant - 6 * MINUTE];
  assert.equal(decisionDeConnexion(trois, maintenant).autorise, true);
  const quatre = [...trois, maintenant - 30 * 1000];
  const d = decisionDeConnexion(quatre, maintenant);
  assert.equal(d.autorise, false);
  assert.equal(d.attenteMs, MUR_DELAI_MS - 30 * 1000);
});

test('connexion : des ratés hors fenêtre sont oubliés', () => {
  const vieux = [maintenant - 40 * MINUTE, maintenant - 35 * MINUTE, maintenant - 30 * MINUTE];
  assert.equal(decisionDeConnexion(vieux, maintenant).autorise, true);
});
