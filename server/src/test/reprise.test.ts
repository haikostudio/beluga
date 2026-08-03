import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLE_ONGLET_MOBILE,
  carteAReprendre,
  cleCarteOuverte,
  cleColonneTableau,
  colonneAReprendre,
  ongletAReprendre,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Retrouver l'endroit quitté : colonne, carte ouverte, onglet          */
/* ------------------------------------------------------------------ */

test('les clés des réglages ne changent pas : un renommage perdrait les repères', () => {
  assert.equal(cleColonneTableau('p1'), 'board.column.p1');
  assert.equal(cleCarteOuverte('p1'), 'card.open.p1');
  assert.equal(CLE_ONGLET_MOBILE, 'mobile.view');
});

test('chaque projet garde SA colonne et SA carte : les clés ne se mélangent pas', () => {
  assert.notEqual(cleColonneTableau('p1'), cleColonneTableau('p2'));
  assert.notEqual(cleCarteOuverte('p1'), cleCarteOuverte('p2'));
});

/* -------- La colonne du tableau -------- */

test('une colonne connue est retrouvée telle quelle', () => {
  assert.equal(colonneAReprendre('running'), 'running');
  assert.equal(colonneAReprendre('notes'), 'notes');
});

test('une colonne inconnue ou un réglage abîmé laisse le comportement habituel', () => {
  for (const abime of ['colonne-disparue', '', 12, {}, null, undefined]) {
    assert.equal(colonneAReprendre(abime), null);
  }
});

/* -------- La carte ouverte -------- */

const cartes = [
  { id: 'c1', projectId: 'p1' },
  { id: 'c2', projectId: 'p2' },
];

test('la carte ouverte du projet affiché se rouvre', () => {
  assert.equal(carteAReprendre('c1', cartes, 'p1'), 'c1');
});

test('une carte supprimée entre-temps laisse le tiroir fermé', () => {
  assert.equal(carteAReprendre('disparue', cartes, 'p1'), null);
});

test('la carte d un autre projet ne s ouvre jamais par erreur', () => {
  assert.equal(carteAReprendre('c2', cartes, 'p1'), null);
});

test('sans souvenir, sans projet ou avec un réglage abîmé, rien ne s ouvre', () => {
  assert.equal(carteAReprendre('', cartes, 'p1'), null);
  assert.equal(carteAReprendre('c1', cartes, null), null);
  assert.equal(carteAReprendre(42, cartes, 'p1'), null);
});

test('les cartes pas encore arrivées ne referment rien : la reprise attend', () => {
  assert.equal(carteAReprendre('c1', [], 'p1'), null);
});

/* -------- L'onglet du téléphone -------- */

const onglets = ['board', 'chat'] as const;

test('l onglet mémorisé est retrouvé à la réouverture', () => {
  assert.equal(ongletAReprendre('chat', onglets, 'board'), 'chat');
});

test('un onglet retiré depuis (la liste des projets) revient au tableau', () => {
  assert.equal(ongletAReprendre('projects', onglets, 'board'), 'board');
});

test('sans souvenir, l application s ouvre sur le tableau', () => {
  for (const rien of [undefined, null, '', 7, {}]) {
    assert.equal(ongletAReprendre(rien, onglets, 'board'), 'board');
  }
});
