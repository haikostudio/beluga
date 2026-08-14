import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARTES_PAR_PAQUET,
  cartesDuPaquet,
  paquetSuivant,
  paquetsPourVoir,
  resteDesCartes,
} from '@haikodev/shared';

const cartes = (combien: number) => Array.from({ length: combien }, (_, i) => `c${i}`);

test('un paquet vaut vingt cartes', () => {
  assert.equal(CARTES_PAR_PAQUET, 20);
});

test('une colonne ne pose que son premier paquet', () => {
  const posees = cartesDuPaquet(cartes(400), 1);
  assert.equal(posees.length, 20);
  assert.equal(posees[0], 'c0');
  assert.equal(posees[19], 'c19');
});

test('chaque paquet de plus ajoute vingt cartes', () => {
  assert.equal(cartesDuPaquet(cartes(400), 2).length, 40);
  assert.equal(cartesDuPaquet(cartes(400), 5).length, 100);
});

test('une colonne plus courte que le paquet est posée en entier', () => {
  assert.equal(cartesDuPaquet(cartes(7), 1).length, 7);
  assert.equal(cartesDuPaquet(cartes(0), 1).length, 0);
});

test('un nombre de paquets absurde retombe sur le premier paquet', () => {
  assert.equal(cartesDuPaquet(cartes(100), 0).length, 20);
  assert.equal(cartesDuPaquet(cartes(100), -3).length, 20);
});

test('le reste à charger se dit sur le TOTAL, pas sur ce qui est posé', () => {
  assert.equal(resteDesCartes(400, 1), true);
  assert.equal(resteDesCartes(400, 20), false);
  assert.equal(resteDesCartes(20, 1), false);
  assert.equal(resteDesCartes(21, 1), true);
});

test('le paquet suivant avance d’un seul cran, et s’arrête au bout', () => {
  assert.equal(paquetSuivant(1, 400), 2);
  assert.equal(paquetSuivant(2, 400), 3);
  // Toute la colonne est posée : le compte ne bouge plus, donc aucun rendu de plus.
  assert.equal(paquetSuivant(20, 400), 20);
  assert.equal(paquetSuivant(1, 20), 1);
});

test('une carte cherchée ailleurs que par le défilement reste atteignable', () => {
  assert.equal(paquetsPourVoir(0), 1);
  assert.equal(paquetsPourVoir(19), 1);
  assert.equal(paquetsPourVoir(20), 2);
  assert.equal(paquetsPourVoir(399), 20);
  // Une colonne vide ne demande pas zéro paquet.
  assert.equal(paquetsPourVoir(-1), 1);
});

test('poser toute une colonne de 400 cartes tient en 20 paquets', () => {
  const total = 400;
  const paquets = paquetsPourVoir(total - 1);
  assert.equal(cartesDuPaquet(cartes(total), paquets).length, total);
  assert.equal(resteDesCartes(total, paquets), false);
});
