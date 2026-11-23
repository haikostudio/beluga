import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composerLeDernierEtat,
  listeAvecOuSans,
  listeBasculee,
  listeDIdentifiants,
  lireLeDernierEtat,
  peutEcrireLaColonne,
  reglagesDeLaColonne,
} from '@beluga/shared';

/*
 * Ce qui est ouvert dans la colonne de gauche reste ouvert
 * (`shared/src/liste-de-la-colonne.ts`, demande du 01/11/2026).
 */
test('ajouter un projet déjà déplié ne réécrit rien, l’ajouter garde tous les autres', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.equal(listeAvecOuSans(six, 'c', true), null);
  assert.deepEqual(listeAvecOuSans(six, 'g', true), [...six, 'g']);
  assert.deepEqual(listeAvecOuSans(six, 'c', false), ['a', 'b', 'd', 'e', 'f']);
  assert.equal(listeAvecOuSans(six, 'z', false), null);
});

test('la bascule part de la valeur donnée et ne perd aucun voisin', () => {
  assert.deepEqual(listeBasculee(['a', 'b'], 'b'), ['a']);
  assert.deepEqual(listeBasculee(['a', 'b'], 'c'), ['a', 'b', 'c']);
  // deux gestes enchaînés depuis la DERNIÈRE valeur : aucun ne défait l'autre
  assert.deepEqual(listeBasculee(listeBasculee(['a'], 'b'), 'c'), ['a', 'b', 'c']);
});

test('une valeur illisible se lit comme une liste vide, sans doublon ni intrus', () => {
  assert.deepEqual(listeDIdentifiants(undefined), []);
  assert.deepEqual(listeDIdentifiants('a'), []);
  assert.deepEqual(listeDIdentifiants(['a', 'a', 3, null, '', 'b']), ['a', 'b']);
});

test('aucune écriture avant les réglages du serveur, ni pendant la copie locale', () => {
  assert.equal(peutEcrireLaColonne({ pret: false, copieLocale: false }), false);
  assert.equal(peutEcrireLaColonne({ pret: false, copieLocale: true }), false);
  assert.equal(peutEcrireLaColonne({ pret: true, copieLocale: true }), false);
  assert.equal(peutEcrireLaColonne({ pret: true, copieLocale: false }), true);
});

test('la copie locale emporte les réglages de la colonne, et eux seuls', () => {
  const prefs = { 'sidebar.projetsDeplies': ['a', 'b'], 'sidebar.collapsed': [], 'draft.x': 'bonjour', theme: 'sombre' };
  assert.deepEqual(reglagesDeLaColonne(prefs), { 'sidebar.projetsDeplies': ['a', 'b'], 'sidebar.collapsed': [] });
  const copie = composerLeDernierEtat({
    protocole: 1,
    maintenant: 1000,
    projects: [{ id: 'p' }],
    groups: [],
    activeProjectId: null,
    cards: {},
    totaux: {},
    prefs: reglagesDeLaColonne(prefs),
  });
  const relue = lireLeDernierEtat(JSON.stringify(copie), 1, 2000);
  assert.deepEqual(relue?.prefs, { 'sidebar.projetsDeplies': ['a', 'b'], 'sidebar.collapsed': [] });
  // une copie d'avant (sans réglages) reste lisible
  const ancienne = { ...copie, prefs: undefined };
  assert.ok(lireLeDernierEtat(JSON.stringify(ancienne), 1, 2000));
});
