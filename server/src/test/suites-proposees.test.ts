import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUITES_MAX_APRES_AJOUTS,
  TITRE_MAX_D_UNE_SUITE,
  ajouterDesSuites,
  demandeDeSuitesEnPlus,
  lireLesSuites,
  lireLesSuitesDuModele,
} from '@beluga/shared';

test('deux ou trois suites, chacune titrée et décrite', () => {
  const bon = lireLesSuites([
    { titre: 'Ajouter un réglage', description: 'Choisir la longueur des messages par projet.' },
    { titre: 'Expliquer davantage', description: 'Un bouton qui demande un message de développement.' },
  ]);
  assert.equal(bon.ok, true);
  assert.equal(lireLesSuites([{ titre: 'Seule', description: 'x' }]).ok, false);
  assert.equal(lireLesSuites([{ titre: 'A' }, { titre: 'B' }]).ok, false, 'sans description');
  const doublon = lireLesSuites([
    { titre: 'Même', description: 'a' },
    { titre: 'même', description: 'b' },
  ]);
  assert.equal(doublon.ok, false, 'un doublon ne compte qu’une fois');
  assert.equal(lireLesSuites([{ titre: 'x'.repeat(61), description: 'a' }, { titre: 'B', description: 'b' }]).ok, false);
});

test('« D’autres idées » : la demande au moteur nomme les suites déjà vues et exige du JSON', () => {
  const demande = demandeDeSuitesEnPlus({
    titreDeLaCarte: 'Bouton plus rapide',
    reponse: 'Le bouton répond tout de suite.',
    dejaVues: [{ titre: 'Ajouter un réglage', description: 'x' }],
  });
  assert.match(demande, /Bouton plus rapide/);
  assert.match(demande, /Le bouton répond tout de suite/);
  assert.match(demande, /- Ajouter un réglage/);
  assert.match(demande, /tableau JSON/);
});

test('la sortie du moteur se relit avec tolérance', () => {
  const texte = 'Voici :\n```json\n[{"titre":"Essayer sur téléphone","description":"Vérifier l’écran étroit."},{"titre":"essayer sur  téléphone","description":"doublon"},{"titre":"Sans phrase"},{"titre":"' + 'mot '.repeat(30) + '","description":"Long."}]\n```';
  const lues = lireLesSuitesDuModele(texte);
  assert.equal(lues.length, 2, 'doublon et suite sans description écartés');
  assert.equal(lues[0].titre, 'Essayer sur téléphone');
  assert.ok(lues[1].titre.length <= TITRE_MAX_D_UNE_SUITE, 'titre trop long coupé');
  assert.ok(lues[1].titre.endsWith('…'));
  assert.deepEqual(lireLesSuitesDuModele('pas de JSON ici'), []);
  assert.deepEqual(lireLesSuitesDuModele('[{"titre": cassé'), []);
});

test('les suites ajoutées se posent SOUS les existantes, sans doublon, total borné', () => {
  const existantes = [
    { titre: 'Ajouter un réglage', description: 'a' },
    { titre: 'Expliquer davantage', description: 'b' },
  ];
  const { suites, ajoutees } = ajouterDesSuites(existantes, [
    { titre: 'ajouter un RÉGLAGE', description: 'doublon' },
    { titre: 'Essayer sur téléphone', description: 'c' },
  ]);
  assert.deepEqual(suites.map((s) => s.titre), ['Ajouter un réglage', 'Expliquer davantage', 'Essayer sur téléphone']);
  assert.equal(ajoutees.length, 1);
  const pleines = Array.from({ length: SUITES_MAX_APRES_AJOUTS }, (_, i) => ({ titre: `Suite ${i}`, description: 'x' }));
  assert.equal(ajouterDesSuites(pleines, [{ titre: 'Une de plus', description: 'y' }]).ajoutees.length, 0);
});
