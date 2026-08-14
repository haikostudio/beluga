import test from 'node:test';
import assert from 'node:assert/strict';
import { ancre, compteAncres, deplacerJointe, insereAncre, jointesApresFrappe, retireAncre } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Les ancres de fichiers dans la barre d'écriture                      */
/* ------------------------------------------------------------------ */

test("l'ancre porte le nom du fichier, tel qu'il partira dans le message", () => {
  assert.equal(ancre('capture.png'), '[fichier: capture.png]');
});

/* -------- Poser l'ancre -------- */

test('sans curseur posé, l’ancre s’ajoute à la fin', () => {
  const r = insereAncre('Regarde ceci', 'capture.png', null);
  assert.equal(r.texte, 'Regarde ceci [fichier: capture.png]');
});

test('un texte vide ne prend pas d’espace de départ', () => {
  assert.equal(insereAncre('', 'a.pdf', null).texte, '[fichier: a.pdf]');
});

test('avec un curseur au milieu, l’ancre se glisse à cet endroit', () => {
  const texte = 'Premier paragraphe.\n\nSecond paragraphe.';
  const r = insereAncre(texte, 'capture.png', 19);
  assert.equal(r.texte, 'Premier paragraphe. [fichier: capture.png]\n\nSecond paragraphe.');
  // Le curseur suit l'ancre : le fichier suivant se pose après, pas avant.
  assert.equal(r.texte.slice(0, r.curseur).endsWith('[fichier: capture.png] '), false);
  assert.equal(r.texte.slice(0, r.curseur).includes('[fichier: capture.png]'), true);
});

test('un curseur hors du texte retombe sur la fin, sans casse', () => {
  assert.equal(insereAncre('court', 'a.png', 999).texte, 'court [fichier: a.png]');
});

/* -------- Retirer l'ancre -------- */

test('retirer un fichier retire son ancre et l’espace devenu inutile', () => {
  const texte = 'Avant [fichier: a.png] après';
  assert.equal(retireAncre(texte, 'a.png'), 'Avant après');
});

test('deux ancres du même fichier : une seule part', () => {
  const texte = '[fichier: a.png] et [fichier: a.png]';
  assert.equal(compteAncres(retireAncre(texte, 'a.png'), 'a.png'), 1);
});

test('un fichier sans ancre laisse le texte intact', () => {
  assert.equal(retireAncre('Rien à voir', 'a.png'), 'Rien à voir');
});

/* -------- Effacer une ancre retire le fichier -------- */

const jointes = [
  { id: '1', name: 'a.png' },
  { id: '2', name: 'b.pdf' },
];

test('effacer une ancre à la main retire sa pièce jointe', () => {
  const avant = '[fichier: a.png] [fichier: b.pdf]';
  const reste = jointesApresFrappe(jointes, avant, '[fichier: b.pdf]');
  assert.deepEqual(
    reste.map((j) => j.id),
    ['2'],
  );
});

test('écrire du texte ordinaire ne retire aucun fichier', () => {
  const avant = '[fichier: a.png] [fichier: b.pdf]';
  const reste = jointesApresFrappe(jointes, avant, `${avant} et une phrase de plus`);
  assert.equal(reste.length, 2);
});

test('tout effacer retire tous les fichiers', () => {
  const avant = '[fichier: a.png] [fichier: b.pdf]';
  assert.equal(jointesApresFrappe(jointes, avant, '').length, 0);
});

test('un fichier joint sans ancre n’est jamais emporté par erreur', () => {
  const reste = jointesApresFrappe(jointes, 'aucune ancre ici', 'aucune ancre ici !');
  assert.equal(reste.length, 2);
});

test('deux fois le même nom : une ancre effacée n’en retire qu’un', () => {
  const deux = [
    { id: '1', name: 'a.png' },
    { id: '2', name: 'a.png' },
  ];
  const avant = '[fichier: a.png] [fichier: a.png]';
  const reste = jointesApresFrappe(deux, avant, '[fichier: a.png]');
  assert.deepEqual(
    reste.map((j) => j.id),
    ['1'],
  );
});

/* -------- Réordonner les pièces jointes par glissement -------- */

test('glisser une étiquette la déplace à la position visée', () => {
  const liste = ['a', 'b', 'c'];
  assert.deepEqual(deplacerJointe(liste, 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(deplacerJointe(liste, 2, 0), ['c', 'a', 'b']);
});

test('déplacer sur soi-même ne change rien', () => {
  const liste = ['a', 'b', 'c'];
  assert.deepEqual(deplacerJointe(liste, 1, 1), liste);
});

test('un index hors de la liste ne casse rien : la liste revient intacte', () => {
  const liste = ['a', 'b'];
  assert.deepEqual(deplacerJointe(liste, 0, 5), liste);
  assert.deepEqual(deplacerJointe(liste, -1, 1), liste);
});

test('la liste d’origine n’est jamais modifiée', () => {
  const liste = ['a', 'b', 'c'];
  deplacerJointe(liste, 0, 2);
  assert.deepEqual(liste, ['a', 'b', 'c']);
});
