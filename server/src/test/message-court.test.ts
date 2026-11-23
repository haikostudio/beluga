import test from 'node:test';
import assert from 'node:assert/strict';
import { FORME_D_UN_MESSAGE, checkTemplate, sansBlocDeChiffrage } from '@beluga/shared';

test('un message n’a plus de plafond : sa longueur suit la demande (25/10/2026)', () => {
  assert.doesNotMatch(FORME_D_UN_MESSAGE, /600|signes au plus|3 à 5 phrases/);
  assert.match(FORME_D_UN_MESSAGE, /COMPLÈTE/);
  // Plus de synthèse au-dessus : un résultat se range en points, le sommaire est posé par l'écran (06/11/2026).
  assert.match(FORME_D_UN_MESSAGE, /rangée en points/);
  assert.match(FORME_D_UN_MESSAGE, /RIEN au-dessus du premier titre/);
  assert.doesNotMatch(FORME_D_UN_MESSAGE, /s'ouvre sur sa synthèse/);
  // Un long compte rendu n'est plus jugé hors forme, donc jamais relancé pour sa longueur.
  assert.equal(checkTemplate('in_run', 'x '.repeat(3000)).ok, true);
  assert.equal(checkTemplate('free', 'x '.repeat(3000)).ok, true);
});

test('le bloc json du chiffrage ne s’affiche jamais, un autre bloc json reste', () => {
  const chiffrage = '```json\n{"machineSeconds": 600, "seniorHours": 0.5}\n```';
  assert.equal(sansBlocDeChiffrage(`C’est fait.\n\n${chiffrage}`), 'C’est fait.');
  assert.equal(sansBlocDeChiffrage(`C’est fait.\n${chiffrage}\n`), 'C’est fait.');
  const autre = 'Voici :\n```json\n{"nom": "essai"}\n```';
  assert.equal(sansBlocDeChiffrage(autre), autre);
  assert.equal(sansBlocDeChiffrage('Rien à retirer.'), 'Rien à retirer.');
});

test('pendant l’écriture, un chiffrage encore ouvert est déjà masqué', () => {
  assert.equal(sansBlocDeChiffrage('C’est fait.\n\n```json'), 'C’est fait.');
  assert.equal(sansBlocDeChiffrage('C’est fait.\n\n```json\n{"machi'), 'C’est fait.');
  assert.equal(sansBlocDeChiffrage('C’est fait.\n\n```json\n{"machineSeconds": 600, "proj'), 'C’est fait.');
  const autre = 'Voici :\n```json\n{"nom": "es';
  assert.equal(sansBlocDeChiffrage(autre), autre);
});
