import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Card, CardComment } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* DES NOTES LIBRES SUR UNE CARTE, chacune avec ses pièces jointes       */
/*                                                                      */
/* Une ligne par commentaire, jamais réécrite en bloc (contrairement aux */
/* étiquettes et aux pièces jointes de la carte elle-même) : ce qui      */
/* compte, c'est qu'un ajout n'efface pas les autres, qu'une suppression */
/* ne touche que sa ligne, et qu'une carte effacée emporte ses notes.    */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'commentaires-de-carte-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { getDb } = await import('../db.js');

function projetDEssai() {
  return store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

function carteDEssai(projectId: string) {
  return store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId,
      title: 'Une carte à commenter',
      column: 'planned',
      position: 1,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
}

test('une carte neuve n’a aucun commentaire', () => {
  const projet = projetDEssai();
  const carte = carteDEssai(projet.id);
  assert.deepEqual(store.listCardComments(carte.id), []);
});

test('un commentaire ajouté se relit, avec ses pièces jointes', () => {
  const projet = projetDEssai();
  const carte = carteDEssai(projet.id);
  const comment = store.addCardComment(
    CardComment.parse({
      id: store.newId(),
      cardId: carte.id,
      projectId: projet.id,
      text: 'Penser à vérifier le cas des fichiers vides.',
      attachmentIds: ['piece-1', 'piece-2'],
      createdAt: store.now(),
    }),
  );
  const relus = store.listCardComments(carte.id);
  assert.equal(relus.length, 1);
  assert.deepEqual(relus[0], comment);
  assert.deepEqual(relus[0].attachmentIds, ['piece-1', 'piece-2']);
});

test('plusieurs commentaires se relisent dans leur ordre d’écriture', () => {
  const projet = projetDEssai();
  const carte = carteDEssai(projet.id);
  const premier = store.addCardComment(
    CardComment.parse({ id: store.newId(), cardId: carte.id, projectId: projet.id, text: 'Premier', createdAt: 1 }),
  );
  const second = store.addCardComment(
    CardComment.parse({ id: store.newId(), cardId: carte.id, projectId: projet.id, text: 'Second', createdAt: 2 }),
  );
  const relus = store.listCardComments(carte.id);
  assert.deepEqual(relus.map((c) => c.id), [premier.id, second.id]);
});

test('un commentaire effacé ne laisse aucune ligne derrière lui', () => {
  const projet = projetDEssai();
  const carte = carteDEssai(projet.id);
  const comment = store.addCardComment(
    CardComment.parse({ id: store.newId(), cardId: carte.id, projectId: projet.id, text: 'À retirer', createdAt: 1 }),
  );
  store.deleteCardComment(comment.id);
  assert.deepEqual(store.listCardComments(carte.id), []);
});

test('une carte effacée emporte ses commentaires (clé étrangère en cascade)', () => {
  const projet = projetDEssai();
  const carte = carteDEssai(projet.id);
  store.addCardComment(
    CardComment.parse({ id: store.newId(), cardId: carte.id, projectId: projet.id, text: 'Une note', createdAt: 1 }),
  );
  store.deleteCard(carte.id);
  const restants = getDb()
    .prepare('SELECT COUNT(*) AS n FROM card_comments WHERE card_id = ?')
    .get(carte.id) as { n: number };
  assert.equal(restants.n, 0);
});
