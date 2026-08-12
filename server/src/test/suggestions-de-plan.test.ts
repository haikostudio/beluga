import test from 'node:test';
import assert from 'node:assert/strict';
import { REFUS_A_COMPLETER, estTitreDesSuggestions, texteApresInsertion } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Les suggestions d'un plan viennent du PLAN, plus d'un catalogue :    */
/* sa partie « Améliorations apportées » s'affiche cliquable.           */
/* ------------------------------------------------------------------ */

test('la partie « Améliorations apportées » est la section cliquable', () => {
  assert.equal(estTitreDesSuggestions('Améliorations apportées'), true);
  assert.equal(estTitreDesSuggestions('AMÉLIORATIONS APPORTÉES'), true);
  // Le titre voyage numéroté et orné d'une icône : ni l'un ni l'autre ne compte.
  assert.equal(estTitreDesSuggestions('## 4. 🎯 Améliorations apportées'), true);
  assert.equal(estTitreDesSuggestions('4) Ameliorations apportees'), true);
  // La forme courte qu'un moteur emploie parfois.
  assert.equal(estTitreDesSuggestions('Améliorations'), true);
});

test('les autres parties du plan ne se cochent pas', () => {
  for (const titre of ['Faisabilité', 'Chemin à suivre', 'Conséquences', '## 3. 🔁 Conséquences']) {
    assert.equal(estTitreDesSuggestions(titre), false, titre);
  }
});

test("un titre vide ou absent ne rend jamais une section cliquable", () => {
  assert.equal(estTitreDesSuggestions(''), false);
  assert.equal(estTitreDesSuggestions(undefined as unknown as string), false);
});

test("un clic n'écrase jamais ce qui est déjà écrit", () => {
  assert.equal(texteApresInsertion('', 'Plus simple.'), 'Plus simple.');
  assert.equal(texteApresInsertion('Bonjour', 'Plus simple.'), 'Bonjour\nPlus simple.');
  // Deux fois la même suggestion ne se recopie pas.
  assert.equal(texteApresInsertion('Bonjour\nPlus simple.', 'Plus simple.'), 'Bonjour\nPlus simple.');
  // Rien à ajouter : le champ ne bouge pas.
  assert.equal(texteApresInsertion('Bonjour', '   '), 'Bonjour');
});

test('le refus se prépare comme un texte, pas comme un envoi', () => {
  assert.ok(REFUS_A_COMPLETER.length > 10);
  assert.equal(texteApresInsertion('', REFUS_A_COMPLETER), REFUS_A_COMPLETER);
});
