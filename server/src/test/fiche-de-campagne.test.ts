/** LA FICHE D'UNE CAMPAGNE : huit points à trancher, puis une base figée dès le premier média (`shared/src/fiche-de-campagne.ts`). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { POINTS_DE_CAMPAGNE, baseDeCampagneVerrouillee, commandeVisible, datesDeCampagneValides, pointsManquantsDeCampagne, refusFicheIncomplete, type FicheDeCampagne } from '@beluga/shared';

const vide: FicheDeCampagne = { typesMedias: [], quantiteMedias: null, rythme: null, cible: null, reseaux: [], debut: null, fin: null, objectifChiffre: null, message: null, ton: null, appelAction: null };
const complete: FicheDeCampagne = {
  typesMedias: ['video'],
  quantiteMedias: 6,
  rythme: '2 par semaine',
  cible: 'Familles de la région',
  reseaux: ['instagram'],
  debut: '2026-11-10',
  fin: '2026-11-30',
  objectifChiffre: 500,
  message: 'Des lieux insolites à deux pas',
  ton: 'complice',
  appelAction: 'Réserver sa visite',
};

test('une fiche vide manque les huit points, dans l’ordre des questions', () => {
  assert.deepEqual(pointsManquantsDeCampagne(vide), [...POINTS_DE_CAMPAGNE]);
});

test('une fiche complète ne manque de rien', () => {
  assert.deepEqual(pointsManquantsDeCampagne(complete), []);
});

test('un point double veut ses deux moitiés', () => {
  assert.deepEqual(pointsManquantsDeCampagne({ ...complete, rythme: ' ' }), ['quantite']);
  assert.deepEqual(pointsManquantsDeCampagne({ ...complete, fin: null }), ['dates']);
  assert.deepEqual(pointsManquantsDeCampagne({ ...complete, ton: null }), ['message']);
  assert.deepEqual(pointsManquantsDeCampagne({ ...complete, quantiteMedias: 0 }), ['quantite']);
});

test('la base se fige dès le premier média, rattaché ou lié à une publication', () => {
  assert.equal(baseDeCampagneVerrouillee({ mediasRattaches: 0, publicationsAvecMedia: 0 }), false);
  assert.equal(baseDeCampagneVerrouillee({ mediasRattaches: 1, publicationsAvecMedia: 0 }), true);
  assert.equal(baseDeCampagneVerrouillee({ mediasRattaches: 0, publicationsAvecMedia: 1 }), true);
});

test('le refus nomme les points manquants', () => {
  const r = refusFicheIncomplete('Avant-première', ['cible', 'appel']);
  assert.match(r, /Avant-première/);
  assert.match(r, /cible, appel à l’action/);
  assert.match(r, /ask_user/);
});

test('sous le verrou, seuls les dates et l’objectif chiffré restent modifiables', () => {
});

test('un post hors des dates de sa campagne est signalé, jamais un post parti ni sans date', () => {
  assert.equal(datesDeCampagneValides('2026-11-10', '2026-11-09'), false);
  assert.equal(datesDeCampagneValides('2026-11-10', '2026-11-10'), true);
  assert.equal(datesDeCampagneValides(null, '2026-11-10'), true);
});

test('un seul bouton du chef : le plan, puis les canaux, puis la campagne, qui reste', () => {
  const etats = (plan: string, canaux: string) => ({ plan, canaux, campagne: 'disponible' }) as any;
  assert.equal(commandeVisible(etats('non_configure', 'non_configure'), false), 'plan');
  assert.equal(commandeVisible(etats('en_cours', 'disponible'), false), 'plan');
  assert.equal(commandeVisible(etats('disponible', 'a_completer'), false), 'canaux');
  assert.equal(commandeVisible(etats('disponible', 'disponible'), false), 'campagne');
  /* Une fois apparue (ou une campagne existante), « Nouvelle campagne » ne cède plus sa place. */
  assert.equal(commandeVisible(etats('a_completer', 'a_completer'), true), 'campagne');
});
