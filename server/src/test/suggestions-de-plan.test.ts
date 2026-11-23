import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estTitreDesSuggestions,
  ideeDejaEnvoyee,
  ligneDeSuggestion,
  ligneEstDansLeTexte,
  texteApresInsertion,
  texteApresRetrait,
} from '@beluga/shared';

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

/*
 * UNE SUGGESTION DÉCOCHÉE REPREND SA LIGNE — À CONDITION QUE PERSONNE NE L'AIT
 * RETOUCHÉE. Les suggestions s'écrivent maintenant DANS le champ de saisie, où
 * elles se complètent : décocher ne doit jamais reprendre la phrase que
 * l'utilisateur a fait sienne.
 */
test('un second clic reprend sa ligne, et seulement la sienne', () => {
  assert.equal(texteApresRetrait('Bonjour\nPlus simple.', 'Plus simple.'), 'Bonjour');
  assert.equal(texteApresRetrait('Plus simple.', 'Plus simple.'), '');
  // La ligne complétée n'est plus la suggestion : elle reste.
  assert.equal(
    texteApresRetrait('Plus simple, et en deux temps.', 'Plus simple.'),
    'Plus simple, et en deux temps.',
  );
  // Rien à retirer : le champ ne bouge pas.
  assert.equal(texteApresRetrait('Bonjour', '   '), 'Bonjour');
  assert.equal(texteApresRetrait('Bonjour', 'Absente'), 'Bonjour');
});

test('cocher puis décocher rend le champ tel qu’il était', () => {
  const depart = 'Ma demande.';
  const apres = texteApresInsertion(depart, 'Ajouter un test.');
  assert.equal(apres, 'Ma demande.\nAjouter un test.');
  assert.equal(texteApresRetrait(apres, 'Ajouter un test.'), depart);
});

/*
 * LA CASE D'UNE IDÉE SE LIT DANS LE CHAMP : elle est cochée quand le retrait
 * de sa ligne CHANGERAIT le texte (`ligneDansLeTexte`,
 * `web/src/lib/texte-du-champ.ts`). Un retrait sans effet doit donc rendre le
 * texte À L'IDENTIQUE, au signe près — pas une version nettoyée de ses espaces,
 * qui cocherait toutes les cases d'un brouillon terminé par un saut de ligne.
 */
test('un retrait sans effet rend le texte au signe près, c’est ce que lit la case à cocher', () => {
  const brouillon = '  Ma demande.  \n\n\n- Une idée retouchée par mes soins\n';
  assert.equal(texteApresRetrait(brouillon, '- Une idée'), brouillon);
  assert.equal(texteApresRetrait(brouillon, '- Une idée retouchée'), brouillon);
  // La ligne exacte, elle, est bien là : les espaces qui l'entourent ne comptent pas.
  assert.notEqual(texteApresRetrait(`${brouillon}  - Une idée  \n`, '- Une idée'), `${brouillon}  - Une idée  \n`);
});

test('une idée est envoyée quand un message parti contient sa ligne, telle que le clic l’a écrite', () => {
  const idee = 'Proposer une capture d’écran de l’aperçu à un appareil donné.';
  const autre = 'Retenir l’appareil par projet plutôt que par compte.';
  const envoye = `${ligneDeSuggestion(idee)}\n${ligneDeSuggestion(autre)}`;
  assert.equal(ideeDejaEnvoyee([envoye], ligneDeSuggestion(idee)), true);
  assert.equal(ideeDejaEnvoyee([envoye], ligneDeSuggestion(autre)), true);
  // Une phrase écrite autour de la ligne ne la fait pas disparaître.
  assert.equal(ideeDejaEnvoyee([`Bonjour\n${ligneDeSuggestion(idee)}\nMerci`], ligneDeSuggestion(idee)), true);
});

test('une idée complétée, ou jamais envoyée, ne compte pas comme envoyée', () => {
  const ligne = ligneDeSuggestion('Ajouter une saisie de dimensions libres.');
  assert.equal(ideeDejaEnvoyee([], ligne), false);
  assert.equal(ideeDejaEnvoyee(['Une autre demande'], ligne), false);
  // La ligne complétée n'est plus la suggestion d'origine : même règle que le retrait.
  assert.equal(ideeDejaEnvoyee([`${ligne} et un aperçu`], ligne), false);
  assert.equal(ideeDejaEnvoyee([ligne], ''), false);
});

test('la case et le retrait lisent la même règle : ligne présente = retirable', () => {
  const ligne = ligneDeSuggestion('Idée A');
  assert.equal(ligneEstDansLeTexte(`${ligne}\nIdée B`, ligne), true);
  assert.equal(ligneEstDansLeTexte('Idée B', ligne), false);
  assert.notEqual(texteApresRetrait(`${ligne}\nIdée B`, ligne), `${ligne}\nIdée B`);
});
