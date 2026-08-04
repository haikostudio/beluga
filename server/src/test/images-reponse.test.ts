import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentQuestion, estImage, reponsePrete, texteDeReponse, triImages } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Joindre une image à la réponse d'une question posée par un agent    */
/* ------------------------------------------------------------------ */

test('une image se reconnaît à son type, sinon à son nom', () => {
  assert.equal(estImage({ name: 'capture.png', mime: 'image/png' }), true);
  // Certains dépôts arrivent sans type déclaré : le nom prend le relais.
  assert.equal(estImage({ name: 'capture.PNG', mime: '' }), true);
  assert.equal(estImage({ name: 'photo.heic', mime: 'application/octet-stream' }), true);
  assert.equal(estImage({ name: 'notes.txt', mime: 'text/plain' }), false);
  assert.equal(estImage({ name: 'archive.zip' }), false);
});

test('le tri garde les images et rend les refus, pour qu’on puisse les dire', () => {
  const { gardees, refusees } = triImages([
    { name: 'a.png', mime: 'image/png' },
    { name: 'b.pdf', mime: 'application/pdf' },
    { name: 'c.jpg', mime: 'image/jpeg' },
  ]);
  assert.deepEqual(gardees.map((f) => f.name), ['a.png', 'c.jpg']);
  assert.deepEqual(refusees.map((f) => f.name), ['b.pdf']);
});

test("l'image s'AJOUTE au choix et à la précision, elle ne les remplace pas", () => {
  assert.equal(texteDeReponse(['Bleu'], 'plutôt clair', 1), 'Bleu — plutôt clair — 1 image jointe');
  assert.equal(texteDeReponse(['Bleu', 'Vert'], '', 0), 'Bleu, Vert');
  assert.equal(texteDeReponse(['Bleu'], '', 2), 'Bleu — 2 images jointes');
});

test('une image seule suffit à répondre, rien du tout ne suffit pas', () => {
  assert.equal(texteDeReponse([], '', 1), '1 image jointe');
  assert.equal(reponsePrete([], '', 1), true);
  assert.equal(reponsePrete([], '   ', 0), false);
  assert.equal(reponsePrete(['Oui'], '', 0), true);
});

test('une question retient les images de sa réponse, et vaut sans elles', () => {
  const sans = AgentQuestion.parse({ id: 'q1', question: 'Quelle couleur ?' });
  assert.deepEqual(sans.answerAttachments, []);
  const avec = AgentQuestion.parse({
    id: 'q2',
    question: 'Que voyez-vous ?',
    answer: '1 image jointe',
    answerAttachments: ['att-1'],
  });
  assert.deepEqual(avec.answerAttachments, ['att-1']);
});
