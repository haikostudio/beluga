import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFUS_A_COMPLETER,
  SUGGESTIONS_DE_PLAN,
  SUGGESTIONS_MONTREES,
  suggestionsPourLePlan,
  texteApresInsertion,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Les suggestions d'optimisation posées sous un plan.                  */
/* ------------------------------------------------------------------ */

const PLAN_NU = [
  '## Faisabilité',
  "C'est faisable.",
  '## Chemin à suivre',
  'On commence par le tableau.',
  '## Conséquences',
  'Le tableau change de forme.',
  '## Améliorations apportées',
  'On lit plus vite.',
].join('\n');

test('un plan quelconque reçoit des suggestions, plafonnées', () => {
  const vues = suggestionsPourLePlan(PLAN_NU);
  assert.ok(vues.length > 0, 'un plan sans angle mort doit quand même pouvoir rebondir');
  assert.ok(vues.length <= SUGGESTIONS_MONTREES);
  // Les deux premières du catalogue valent pour n'importe quel plan.
  assert.equal(vues[0].id, 'simplifier');
  assert.equal(vues[1].id, 'autre-approche');
});

test('un plan encore vide ne propose rien', () => {
  assert.deepEqual(suggestionsPourLePlan(''), []);
  assert.deepEqual(suggestionsPourLePlan('   \n  '), []);
});

test('ce que le plan traite déjà ne lui est pas proposé', () => {
  const avecChiffres = `${PLAN_NU}\nPremière étape : 30 min. Seconde étape : 2 heures.`;
  assert.ok(!suggestionsPourLePlan(avecChiffres).some((s) => s.id === 'effort'));

  const avecRisques = `${PLAN_NU}\nRisques : la migration ne se défait pas.`;
  assert.ok(!suggestionsPourLePlan(avecRisques).some((s) => s.id === 'risques'));

  const avecTelephone = `${PLAN_NU}\nSur téléphone, les boutons s'empilent.`;
  assert.ok(!suggestionsPourLePlan(avecTelephone).some((s) => s.id === 'telephone'));
});

test("un plan qui couvre tout laisse quand même de quoi relancer", () => {
  const complet = [
    PLAN_NU,
    'Première étape : 30 min, vérifiée dans le navigateur.',
    'Risques : rien de définitif, on revient en arrière.',
    'Sur téléphone, la mise en colonne suffit.',
  ].join('\n');
  const vues = suggestionsPourLePlan(complet);
  assert.deepEqual(
    vues.map((s) => s.id),
    ['simplifier', 'autre-approche'],
  );
});

test('chaque suggestion porte un identifiant unique et un texte utile', () => {
  const ids = new Set(SUGGESTIONS_DE_PLAN.map((s) => s.id));
  assert.equal(ids.size, SUGGESTIONS_DE_PLAN.length);
  for (const suggestion of SUGGESTIONS_DE_PLAN) {
    assert.ok(suggestion.libelle.trim().length > 0, suggestion.id);
    assert.ok(suggestion.texte.trim().length > 20, suggestion.id);
  }
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
