import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITRES_MONTRES_MAX,
  alerteTravailSansCarte,
  brancheDeTache,
  compteurDeColonne,
  compteurEtListeDAccord,
  descriptionCartePorteuse,
  exclusionsDesBranchesDeCartes,
  libelleCartePorteuse,
  phraseDeColonneVide,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* LE COMPTEUR COMPTE CE QUE LA LISTE MONTRE                            */
/* ------------------------------------------------------------------ */

test('le compteur de la colonne est le nombre de cartes affichées', () => {
  assert.equal(compteurDeColonne(0), 0);
  assert.equal(compteurDeColonne(3), 3);
});

test('le compteur ne descend jamais sous zéro ni ne prend de décimale', () => {
  assert.equal(compteurDeColonne(-2), 0);
  assert.equal(compteurDeColonne(2.7), 2);
});

test('le cas réel : une colonne vide ne peut plus annoncer « 1 »', () => {
  // La capture du 17/08/2026 : « À DÉPLOYER 1 » au-dessus de « Rien à mettre
  // en ligne pour l'instant ». Le 1 venait du travail sans carte, que la liste
  // ne pouvait par définition pas montrer.
  assert.equal(compteurDeColonne(0), 0);
  assert.equal(compteurEtListeDAccord(1, 0), false);
  assert.equal(compteurEtListeDAccord(0, 0), true);
});

test('l’accord se vérifie dans les DEUX sens', () => {
  // Pas de compte sans carte…
  assert.equal(compteurEtListeDAccord(2, 0), false);
  // …et pas de carte affichée qui ne soit comptée.
  assert.equal(compteurEtListeDAccord(0, 2), false);
  assert.equal(compteurEtListeDAccord(2, 2), true);
});

/* ------------------------------------------------------------------ */
/* CE QUI N'A PAS DE CARTE SE DIT EN CLAIR                              */
/* ------------------------------------------------------------------ */

test('sans travail anonyme, aucun encart', () => {
  assert.equal(alerteTravailSansCarte(null), null);
  assert.equal(alerteTravailSansCarte({ nombre: 0, titres: [] }), null);
});

test('l’encart NOMME ce qui a été trouvé et où', () => {
  const alerte = alerteTravailSansCarte({ nombre: 1, titres: ['Corriger le calcul de TVA'] });
  assert.ok(alerte);
  assert.match(alerte.titre, /1 modification sans carte/);
  assert.match(alerte.phrase, /branche principale/);
  assert.match(alerte.phrase, /prochain déploiement/);
  assert.deepEqual(alerte.titres, ['Corriger le calcul de TVA']);
  assert.equal(alerte.tronquee, false);
});

test('le pluriel suit le nombre trouvé', () => {
  const alerte = alerteTravailSansCarte({ nombre: 3, titres: ['a', 'b', 'c'] });
  assert.ok(alerte);
  assert.match(alerte.titre, /3 modifications sans carte pour les porter/);
  assert.match(alerte.phrase, /partiront/);
});

test('la mise en production a son propre mot', () => {
  const alerte = alerteTravailSansCarte({ nombre: 1, titres: ['x'] }, 'publier');
  assert.ok(alerte);
  assert.match(alerte.phrase, /passage en production/);
});

test('au-delà de six titres, l’encart dit qu’il en manque', () => {
  const titres = Array.from({ length: TITRES_MONTRES_MAX + 2 }, (_, i) => `travail ${i}`);
  const alerte = alerteTravailSansCarte({ nombre: titres.length, titres });
  assert.ok(alerte);
  assert.equal(alerte.titres.length, TITRES_MONTRES_MAX);
  assert.equal(alerte.tronquee, true);
});

test('un compte plus grand que la liste de titres est dit tronqué', () => {
  // Le serveur ne renvoie que les six premiers titres : le compte, lui, est entier.
  const alerte = alerteTravailSansCarte({ nombre: 11, titres: ['a', 'b'] });
  assert.ok(alerte);
  assert.equal(alerte.tronquee, true);
});

test('la colonne vide ne dit plus « rien » quand du travail attend', () => {
  assert.equal(phraseDeColonneVide(null), 'Rien à mettre en ligne pour l’instant.');
  assert.equal(phraseDeColonneVide({ nombre: 0, titres: [] }), 'Rien à mettre en ligne pour l’instant.');
  assert.match(phraseDeColonneVide({ nombre: 1, titres: ['x'] }), /attend d’être mise en ligne/);
  assert.match(phraseDeColonneVide({ nombre: 2, titres: ['x', 'y'] }), /attendent d’être mises en ligne/);
});

/* ------------------------------------------------------------------ */
/* …ET ON PEUT LUI DONNER UNE FICHE D'UN CLIC                           */
/* ------------------------------------------------------------------ */

test('le bouton dit ce qu’il crée, au singulier comme au pluriel', () => {
  assert.equal(libelleCartePorteuse(1), 'Créer la carte qui le porte');
  assert.equal(libelleCartePorteuse(3), 'Créer la carte qui les porte');
});

test('la description de la carte porteuse reprend les enregistrements trouvés', () => {
  const texte = descriptionCartePorteuse(
    [
      { sha: 'abcdef1234567', titre: 'Corriger le calcul de TVA' },
      { sha: '9876543210abc', titre: 'Renommer le bouton d’export' },
    ],
    'main',
  );
  assert.match(texte, /sans fiche/);
  assert.match(texte, /- Corriger le calcul de TVA \(abcdef1\)/);
  assert.match(texte, /- Renommer le bouton d’export \(9876543\)/);
});

test('elle dit que le code est DÉJÀ là, et que la supprimer ne le retire pas', () => {
  const texte = descriptionCartePorteuse([{ sha: 'aaa1111', titre: 'x' }], 'main');
  assert.match(texte, /DÉJÀ enregistré sur la branche « main »/);
  assert.match(texte, /rien à exécuter/);
  assert.match(texte, /Supprimer cette carte ne retire pas ce travail/);
});

test('sans branche connue, elle parle quand même de la principale', () => {
  const texte = descriptionCartePorteuse([{ sha: 'aaa1111', titre: 'x' }]);
  assert.match(texte, /la branche principale/);
});

/* ------------------------------------------------------------------ */
/* CE QUI EST PORTÉ PAR UNE BRANCHE DE CARTE N'EST PAS « SANS CARTE »   */
/* ------------------------------------------------------------------ */

test('les branches « tache/… » sont écartées d’un seul motif', () => {
  const args = exclusionsDesBranchesDeCartes([]);
  assert.deepEqual(args, ['--not', '--branches=tache/*']);
});

test('une branche de carte nommée autrement est ajoutée nommément', () => {
  const args = exclusionsDesBranchesDeCartes(['tache/abc', 'correctif-tva', 'tache/def']);
  assert.deepEqual(args, ['--not', '--branches=tache/*', 'correctif-tva']);
  // Le motif couvre déjà les « tache/… » : les répéter n'apporterait rien.
  assert.ok(brancheDeTache('tache/abc'));
});

test('une branche vide ou répétée n’entre pas dans la commande', () => {
  const args = exclusionsDesBranchesDeCartes(['', '  ', 'correctif', 'correctif']);
  assert.deepEqual(args, ['--not', '--branches=tache/*', 'correctif']);
});
