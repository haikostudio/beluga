import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleNouveauDepart,
  comptePrecedents,
  libellePrecedents,
  messagesDepuis,
  peutRepartir,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Repartir de zéro dans la conversation du chef d'orchestre           */
/* ------------------------------------------------------------------ */

const fil = [
  { createdAt: 100 },
  { createdAt: 200 },
  { createdAt: 300 },
  { createdAt: 400 },
];

test('la clé du repère ne change pas, et chaque agent a la sienne', () => {
  assert.equal(cleNouveauDepart('a1'), 'chat.depart.a1');
  assert.notEqual(cleNouveauDepart('a1'), cleNouveauDepart('a2'));
});

/* -------- Quand le bouton peut agir -------- */

test('on ne coupe pas le fil sous un agent qui travaille', () => {
  const verdict = peutRepartir({ status: 'running' }, fil);
  assert.equal(verdict.ok, false);
  assert.match(verdict.raison, /travaille/);
});

test("une réponse encore en train d'arriver bloque aussi le bouton", () => {
  const verdict = peutRepartir({ status: 'idle' }, [{ createdAt: 100, streaming: true }]);
  assert.equal(verdict.ok, false);
});

test('une conversation déjà neuve ne se remet pas à zéro', () => {
  assert.equal(peutRepartir({ status: 'idle' }, []).ok, false);
});

test('un agent au repos avec des échanges : le bouton agit', () => {
  const verdict = peutRepartir({ status: 'idle' }, fil);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.raison, '');
});

test("sans agent, rien à remettre à zéro", () => {
  assert.equal(peutRepartir(null, fil).ok, false);
});

/* -------- Ce qui reste visible -------- */

test('le repère ne montre que les échanges qui suivent', () => {
  assert.deepEqual(messagesDepuis(fil, 300), [{ createdAt: 300 }, { createdAt: 400 }]);
});

test('un message posé à la seconde même du départ appartient au nouveau fil', () => {
  assert.equal(messagesDepuis([{ createdAt: 250 }], 250).length, 1);
});

test('sans repère, tout le fil reste visible', () => {
  assert.equal(messagesDepuis(fil, 0).length, 4);
  assert.equal(messagesDepuis(fil, undefined).length, 4);
});

test('un repère farfelu ne fait jamais disparaître une conversation', () => {
  assert.equal(messagesDepuis(fil, 'hier').length, 4);
  assert.equal(messagesDepuis(fil, Number.NaN).length, 4);
  assert.equal(messagesDepuis(fil, -5).length, 4);
});

test('rien n’est supprimé : ce qui sort de la vue est compté', () => {
  assert.equal(comptePrecedents(fil, 300), 2);
  assert.equal(comptePrecedents(fil, 0), 0);
});

/* -------- Ce que dit le lien -------- */

test('le lien se dit au singulier comme au pluriel, et se tait à zéro', () => {
  assert.equal(libellePrecedents(0), '');
  assert.equal(libellePrecedents(1), 'Voir le message précédent');
  assert.equal(libellePrecedents(7), 'Voir les 7 messages précédents');
});
