import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accrocheAuMot,
  ancre,
  compteAncres,
  deplacerAncre,
  deplacerJointe,
  effacementDeTag,
  insereAncre,
  jointesApresFrappe,
  retireAncre,
  retireOccurrence,
  tagsDuTexte,
} from '@haikodev/shared';

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

test('retirer l’occurrence cliquée ne touche pas l’autre citation du même nom', () => {
  const texte = '[fichier: a.png] puis [fichier: a.png]';
  assert.equal(retireOccurrence(texte, 'a.png', 0), ' puis [fichier: a.png]');
  assert.equal(retireOccurrence(texte, 'a.png', 1), '[fichier: a.png] puis ');
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

/* -------- Glisser une ancre ailleurs dans la phrase -------- */

test('glisser une ancre au début de la phrase', () => {
  const r = deplacerAncre('Regarde [fichier: a.png] ceci', 'a.png', 0, 0);
  assert.equal(r.texte, '[fichier: a.png] Regarde ceci');
});

test('glisser une ancre à la fin de la phrase', () => {
  const texte = 'Regarde [fichier: a.png] ceci';
  const r = deplacerAncre(texte, 'a.png', 0, texte.length);
  assert.equal(r.texte, 'Regarde ceci [fichier: a.png]');
});

test('lâcher une ancre sur elle-même ne change rien', () => {
  const texte = 'Avant [fichier: a.png] après';
  const debut = texte.indexOf('[fichier: a.png]');
  assert.equal(deplacerAncre(texte, 'a.png', 0, debut + 3).texte, texte);
});

test('deux fichiers différents : on déplace celui visé, pas l’autre', () => {
  const texte = 'A [fichier: a.png] B [fichier: b.pdf] C';
  const r = deplacerAncre(texte, 'b.pdf', 0, 0);
  assert.equal(r.texte, '[fichier: b.pdf] A [fichier: a.png] B C');
});

test('deux fois le même nom : on déplace la seconde citation', () => {
  const texte = '[fichier: a.png] milieu [fichier: a.png]';
  const r = deplacerAncre(texte, 'a.png', 1, 0);
  assert.equal(r.texte.startsWith('[fichier: a.png]'), true);
  assert.equal(compteAncres(r.texte, 'a.png'), 2);
  assert.equal(r.texte.includes('milieu'), true);
  assert.notEqual(r.texte, texte);
});

test('lâché sur un mot, le drapeau se colle au bord le plus proche', () => {
  const texte = 'Regarde ceci maintenant';
  assert.equal(accrocheAuMot(texte, texte.indexOf('eci')), texte.indexOf('ceci'));
  assert.equal(accrocheAuMot(texte, texte.indexOf('nant')), texte.indexOf('maintenant') + 'maintenant'.length);
});

test('entre deux mots, l’endroit visé ne bouge pas', () => {
  const texte = 'Bonjour  monde';
  assert.equal(accrocheAuMot(texte, 8), 8);
});

test('un drapeau déjà posé se vise d’un bloc, pas lettre à lettre', () => {
  const texte = 'Avant [fichier: a.png] après';
  const debut = texte.indexOf('[fichier:');
  const fin = debut + '[fichier: a.png]'.length;
  assert.equal(accrocheAuMot(texte, debut + 4), debut);
  assert.equal(accrocheAuMot(texte, fin - 2), fin);
});

test('déplacer une ancre ne retire aucune pièce jointe', () => {
  const avant = 'A [fichier: a.png] B';
  const apres = deplacerAncre(avant, 'a.png', 0, 0).texte;
  assert.deepEqual(
    jointesApresFrappe([{ id: '1', name: 'a.png' }], avant, apres).map((j) => j.id),
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

/* -------- Un tag s'efface d'un BLOC, pas caractère par caractère -------- */

test('le retour arrière au milieu d’un tag emporte le tag entier', () => {
  const texte = 'Regarde [fichier: capture.png] ici';
  // Curseur posé au milieu du nom du fichier.
  const r = effacementDeTag(texte, 22, 22, 'arriere');
  assert.ok(r);
  assert.equal(r.texte, 'Regarde ici');
  assert.equal(r.curseur, 8);
});

test('le retour arrière juste après le crochet fermant emporte le tag', () => {
  const texte = 'Regarde [fichier: capture.png]';
  const r = effacementDeTag(texte, texte.length, texte.length, 'arriere');
  assert.ok(r);
  assert.equal(r.texte, 'Regarde ');
});

test('la suppression avant, curseur au début du tag, emporte le tag', () => {
  const texte = 'Regarde [fichier: capture.png] ici';
  const r = effacementDeTag(texte, 8, 8, 'avant');
  assert.ok(r);
  assert.equal(r.texte, 'Regarde ici');
});

test('une lettre effacée hors de tout tag ne déclenche rien', () => {
  const texte = 'Regarde [fichier: capture.png] ici';
  assert.equal(effacementDeTag(texte, texte.length, texte.length, 'arriere'), null);
  assert.equal(effacementDeTag('aucun tag ici', 5, 5, 'arriere'), null);
});

test('un texte sans tag laisse la touche suivre son chemin normal', () => {
  assert.equal(effacementDeTag('bonjour', 3, 3, 'arriere'), null);
  assert.equal(effacementDeTag('bonjour', 0, 0, 'arriere'), null);
  assert.equal(effacementDeTag('bonjour', 7, 7, 'avant'), null);
});

test('une sélection qui n’entame un tag qu’à moitié l’emporte en entier', () => {
  const texte = 'un [fichier: a.png] deux [fichier: b.png] trois';
  // De « deux » jusqu'au milieu du second tag.
  const r = effacementDeTag(texte, 20, 34, 'arriere');
  assert.ok(r);
  assert.equal(r.texte, 'un [fichier: a.png] trois');
});

test('les tags du texte sont repérés avec leur nom et leurs bornes', () => {
  const tags = tagsDuTexte('un [fichier: a.png] deux [fichier: b.png]');
  assert.equal(tags.length, 2);
  assert.equal(tags[0].nom, 'a.png');
  assert.equal(tags[0].debut, 3);
  assert.equal(tags[1].nom, 'b.png');
});
