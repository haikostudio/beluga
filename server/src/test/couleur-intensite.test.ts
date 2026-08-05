import test from 'node:test';
import assert from 'node:assert/strict';
import { JETON_CALME, JETON_CHARGEE, couleurIntensite, partIntensite } from '@haikodev/shared';

test('la part va de 0 (rien) à 1 (le maximum observé)', () => {
  assert.equal(partIntensite(0, 100), 0);
  assert.equal(partIntensite(50, 100), 0.5);
  assert.equal(partIntensite(100, 100), 1);
});

test('un maximum absent, nul ou absurde ne fait pas exploser le calcul', () => {
  assert.equal(partIntensite(10, 0), 0);
  assert.equal(partIntensite(10, -5), 0);
  assert.equal(partIntensite(Number.NaN, 100), 0);
  // Une valeur au-dessus du maximum reste bornée : jamais de mélange à 140 %.
  assert.equal(partIntensite(140, 100), 1);
});

test('deux consommations différentes donnent deux couleurs différentes', () => {
  assert.notEqual(couleurIntensite(20, 100), couleurIntensite(80, 100));
});

test('la couleur ne cite que des JETONS de thème, jamais une teinte écrite en dur', () => {
  const couleur = couleurIntensite(60, 100);
  assert.ok(couleur.includes(JETON_CALME), couleur);
  assert.ok(couleur.includes(JETON_CHARGEE), couleur);
  // Aucun code couleur en dur : ni #rrggbb, ni rgb(), ni hsl() chiffré.
  assert.doesNotMatch(couleur, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(couleur, /\brgba?\(/i);
  assert.doesNotMatch(couleur, /hsl\(\s*\d/i);
});

test('le plus calme est la couleur calme pure, le plus chargé la couleur chargée pure', () => {
  assert.equal(couleurIntensite(0, 100), `color-mix(in oklab, ${JETON_CHARGEE} 0%, ${JETON_CALME})`);
  assert.equal(couleurIntensite(100, 100), `color-mix(in oklab, ${JETON_CHARGEE} 100%, ${JETON_CALME})`);
});
