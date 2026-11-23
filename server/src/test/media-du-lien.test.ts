/**
 * UN MÉDIA D'UNE RÉPONSE D'AGENT S'OUVRE DANS L'APERÇU, UN SITE GARDE L'ONGLET (`shared/src/media-du-lien.ts`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaDuLien, mimeDuGenre } from '@beluga/shared';

const ICI = 'https://beluga.exemple';

test('une pièce jointe, par son lien ou par piece:, est un média', () => {
  assert.equal(mediaDuLien('/api/attachment?id=abc', ICI)?.piece, 'abc');
  assert.equal(mediaDuLien('piece:abc', ICI)?.adresse, '/api/attachment?id=abc');
  assert.equal(mediaDuLien(`${ICI}/api/attachment?id=abc`, ICI)?.piece, 'abc');
});

test('une image d’étape et un fichier cité sont des médias, avec le genre de leur chemin', () => {
  const capture = mediaDuLien('/api/capture?project=p&path=%2Fmnt%2Fm%2Fpost-01.png', ICI);
  assert.equal(capture?.genre, 'image');
  assert.equal(capture?.nom, 'post-01.png');
  assert.equal(mediaDuLien('/api/fichier-cite?project=p&path=docs%2Frapport.pdf', ICI)?.genre, 'pdf');
});

test('une image, une vidéo ou un son d’un autre site s’ouvre sur place, un PDF lointain garde l’onglet', () => {
  assert.equal(mediaDuLien('https://cdn.exemple/visuel.JPG', ICI)?.genre, 'image');
  assert.equal(mediaDuLien('https://cdn.exemple/film.mp4?v=2', ICI)?.genre, 'video');
  assert.equal(mediaDuLien('https://cdn.exemple/voix.mp3', ICI)?.genre, 'son');
  assert.equal(mediaDuLien('https://ailleurs.exemple/notice.pdf', ICI), null);
  assert.equal(mediaDuLien('/docs/notice.pdf', ICI)?.genre, 'pdf');
});

test('un site, une ancre, un courriel ne sont pas des médias', () => {
  assert.equal(mediaDuLien('https://github.com/haikostudio/beluga', ICI), null);
  assert.equal(mediaDuLien('https://exemple.com/page.html', ICI), null);
  assert.equal(mediaDuLien('#section', ICI), null);
  assert.equal(mediaDuLien('mailto:a@b.c', ICI), null);
  assert.equal(mediaDuLien('', ICI), null);
  assert.equal(mediaDuLien('javascript:alert(1)', ICI), null);
});

test('le type supposé suit le genre', () => {
  assert.equal(mimeDuGenre('image', 'a.jpg'), 'image/jpeg');
  assert.equal(mimeDuGenre('video', 'a.webm'), 'video/webm');
  assert.equal(mimeDuGenre('pdf'), 'application/pdf');
});
