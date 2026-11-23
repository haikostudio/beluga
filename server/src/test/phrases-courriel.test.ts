/**
 * LES PHRASES DES COURRIELS : UN NOMBRE ACCORDÉ, UN CHANGEMENT LISIBLE.
 *
 * Ce que ces essais verrouillent : plus aucun « (s) », plus aucune clé interne
 * de colonne (« a-faire », « termine ») ni d'étape (« demarree ») dans ce que
 * lit un humain — y compris pour les lignes DÉJÀ en base, traduites à la lecture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { accord, dateAmicale, enumeration, estUnPredicat, nombre, phraseDeChangement } from '@beluga/shared';

test('le nombre s’accorde, sans parenthèses', () => {
  assert.equal(nombre(0, 'demande'), '0 demande');
  assert.equal(nombre(1, 'demande'), '1 demande');
  assert.equal(nombre(3, 'demande'), '3 demandes');
  assert.equal(nombre(2, 'nouveau message', 'nouveaux messages'), '2 nouveaux messages');
  assert.equal(accord(2, 't’attend', 't’attendent'), 't’attendent');
});

test('une énumération se lit comme on l’écrit', () => {
  assert.equal(enumeration([]), '');
  assert.equal(enumeration(['a']), 'a');
  assert.equal(enumeration(['a', '', 'b', 'c']), 'a, b et c');
});

test('un déplacement nomme la colonne par son titre, jamais par sa clé', () => {
  assert.equal(phraseDeChangement('deplacement', 'a-faire'), 'a déplacé la demande dans « À faire »');
  assert.equal(phraseDeChangement('deplacement', 'en-cours'), 'a déplacé la demande dans « En cours »');
  assert.match(phraseDeChangement('deplacement', 'termine'), /terminée/);
  assert.match(phraseDeChangement('deplacement', 'valide'), /validé/);
  for (const cle of ['a-faire', 'en-cours', 'termine', 'valide']) {
    assert.equal(phraseDeChangement('deplacement', cle).includes(cle), false, cle);
  }
});

test('les étapes de la carte liée deviennent des phrases entières', () => {
  assert.match(phraseDeChangement('avancement', 'demarree'), /^Le travail a commencé/);
  assert.match(phraseDeChangement('avancement', 'en-ligne'), /en ligne/);
  assert.equal(estUnPredicat(phraseDeChangement('avancement', 'terminee')), false);
});

test('la formule vague « a enregistré la fiche » devient humaine, le reste passe', () => {
  assert.equal(phraseDeChangement('modification', 'a enregistré la fiche'), 'a mis la fiche à jour');
  assert.equal(phraseDeChangement('modification', 'a changé le titre'), 'a changé le titre');
  assert.equal(estUnPredicat('a changé le titre'), true);
  assert.equal(estUnPredicat('Importance passée à Haute'), false);
  assert.equal(estUnPredicat('🎉 fête'), false);
});

test('la date se dit comme à l’oral', () => {
  assert.equal(dateAmicale(new Date(2026, 8, 7, 9, 5).getTime()), 'lun. 7 sept. à 09:05');
});
