import test from 'node:test';
import assert from 'node:assert/strict';
import { CLE_PROJET_ACTIF, choisirProjetAOuvrir } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* À l'ouverture, on retrouve le dernier projet consulté               */
/* ------------------------------------------------------------------ */

const projets = [{ id: 'alpha' }, { id: 'beta' }, { id: 'gamma' }];

test('la clé du réglage ne change pas : un renommage perdrait le projet retenu', () => {
  assert.equal(CLE_PROJET_ACTIF, 'project.active');
});

test('sans rien de mémorisé, on ouvre le premier projet', () => {
  const choix = choisirProjetAOuvrir(projets, undefined, null);
  assert.equal(choix.id, 'alpha');
  assert.equal(choix.aCorriger, true, 'le réglage doit être posé pour la prochaine fois');
});

test('le projet mémorisé est rouvert, même quand ce n est pas le premier', () => {
  const choix = choisirProjetAOuvrir(projets, 'gamma', null);
  assert.equal(choix.id, 'gamma');
  assert.equal(choix.aCorriger, false);
});

test('un projet mémorisé puis supprimé ramène sans bruit au premier', () => {
  const choix = choisirProjetAOuvrir(projets, 'disparu', null);
  assert.equal(choix.id, 'alpha');
  assert.equal(choix.aCorriger, true, 'le réglage périmé doit être corrigé');
});

test('un projet mémorisé puis archivé ramène sans bruit au premier', () => {
  const choix = choisirProjetAOuvrir([{ id: 'alpha' }, { id: 'beta', archived: true }], 'beta', null);
  assert.equal(choix.id, 'alpha');
  assert.equal(choix.aCorriger, true);
});

test('un projet archivé ne peut jamais être choisi comme premier', () => {
  const choix = choisirProjetAOuvrir([{ id: 'range', archived: true }, { id: 'beta' }], undefined, null);
  assert.equal(choix.id, 'beta');
});

test('une reconnexion ne déplace pas l utilisateur : ce qu il regarde l emporte', () => {
  const choix = choisirProjetAOuvrir(projets, 'gamma', 'beta');
  assert.equal(choix.id, 'beta');
  assert.equal(choix.aCorriger, true, 'le réglage suit le projet réellement affiché');
});

test('sans aucun projet, rien n est ouvert et rien n est enregistré', () => {
  const choix = choisirProjetAOuvrir([], 'alpha', null);
  assert.equal(choix.id, null);
  assert.equal(choix.aCorriger, false);
});

test('un réglage abîmé (nombre, objet) est ignoré sans casser l ouverture', () => {
  for (const abime of [42, {}, [], true, null]) {
    const choix = choisirProjetAOuvrir(projets, abime, null);
    assert.equal(choix.id, 'alpha');
  }
});
