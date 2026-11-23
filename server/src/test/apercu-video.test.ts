/**
 * QUELLE IMAGE D'UNE VIDÉO SERT DE VIGNETTE — les règles pures.
 *
 * Ce que ces essais verrouillent : une image entièrement noire, blanche ou d'un
 * seul aplat est REFUSÉE (c'est tout le problème de départ), un vrai plan est
 * accepté même s'il est sombre, les instants sondés couvrent le fichier sans
 * partir chercher très loin dans une vidéo longue, et le choix de la MAIN passe
 * toujours devant la recherche automatique.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ECART_MINIMUM,
  HAUTEUR_SONDE,
  LARGEUR_SONDE,
  SECONDE_DE_REPLI,
  imageEstParlante,
  instantDApercu,
  instantsACandidater,
} from '@beluga/shared';

/** Une image d'un seul ton, comme celle d'un fondu d'ouverture. */
function aplat(ton: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(LARGEUR_SONDE * HAUTEUR_SONDE * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = ton;
    pixels[i + 1] = ton;
    pixels[i + 2] = ton;
    pixels[i + 3] = 255;
  }
  return pixels;
}

/** Une image contrastée : une moitié sombre, une moitié claire. */
function deuxMoities(): Uint8ClampedArray {
  const pixels = aplat(20);
  for (let i = pixels.length / 2; i < pixels.length; i += 4) {
    pixels[i] = 200;
    pixels[i + 1] = 200;
    pixels[i + 2] = 200;
  }
  return pixels;
}

/* ---------------- Ce qui montre quelque chose, et ce qui ne montre rien --------- */

test('une image entièrement noire est refusée — c’est exactement le cas de départ', () => {
  assert.equal(imageEstParlante(aplat(0)), false);
});

test('une image entièrement blanche ou d’un seul aplat est refusée aussi', () => {
  assert.equal(imageEstParlante(aplat(255)), false);
  assert.equal(imageEstParlante(aplat(128)), false);
});

test('un vrai plan est accepté, même sombre', () => {
  assert.equal(imageEstParlante(deuxMoities()), true);
  const sombre = aplat(10);
  // Un plan de nuit : peu lumineux, mais du relief. On juge la VARIÉTÉ, pas la
  // luminosité — sans quoi toute scène nocturne serait écartée.
  for (let i = 0; i < sombre.length; i += 8) sombre[i + 1] = 60;
  assert.equal(imageEstParlante(sombre, 5), true);
});

test('un bruit imperceptible ne suffit pas à sauver une image vide', () => {
  const presqueNoire = aplat(0);
  presqueNoire[4] = 3;
  assert.equal(imageEstParlante(presqueNoire), false);
  assert.ok(ECART_MINIMUM > 0);
});

test('une image trop petite pour être jugée est refusée, jamais devinée', () => {
  assert.equal(imageEstParlante(new Uint8ClampedArray(8)), false);
});

/* ---------------- Les instants qu'on va sonder ---------------- */

test('les instants couvrent le fichier, sans jamais tomber sur le tout début', () => {
  const instants = instantsACandidater(100);
  assert.deepEqual(instants, [10, 25, 50]);
  assert.ok(instants.every((instant) => instant > SECONDE_DE_REPLI));
});

test('une vidéo longue ne fait pas chercher très loin dans le fichier', () => {
  // Une heure : les fractions donneraient 6 min, 15 min et 30 min.
  assert.deepEqual(instantsACandidater(3600), [10, 30, 60]);
});

test('une vidéo très courte ne sort pas de sa durée, et ne se répète pas', () => {
  const instants = instantsACandidater(0.4);
  assert.ok(instants.every((instant) => instant <= 0.35));
  assert.equal(new Set(instants).size, instants.length);
});

test('une durée inconnue ne fait sonder rien du tout', () => {
  assert.deepEqual(instantsACandidater(Number.NaN), []);
  assert.deepEqual(instantsACandidater(0), []);
  assert.deepEqual(instantsACandidater(-3), []);
});

/* ---------------- Qui l'emporte ---------------- */

test('le choix de la main passe devant la recherche automatique', () => {
  assert.equal(instantDApercu({ choisi: 12.5, trouve: 3 }), 12.5);
  assert.equal(instantDApercu({ choisi: 0, trouve: 3 }), 0, 'zéro est un choix, pas une absence');
});

test('sans choix, l’instant trouvé sert ; sans rien, on retombe sur le tout début', () => {
  assert.equal(instantDApercu({ trouve: 7 }), 7);
  assert.equal(instantDApercu({}), SECONDE_DE_REPLI);
  assert.equal(instantDApercu({ choisi: Number.NaN, trouve: null }), SECONDE_DE_REPLI);
});
