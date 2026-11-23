import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cheminDeCapture, humanStep } from '../engines/types.js';
import { imageDEtape } from '../files.js';

/*
 * CE QUE LE SYSTÈME A VU SE REGARDE, IL NE SE LIT PAS.
 *
 * Une capture prise pendant un essai arrivait dans le déroulé comme une ligne
 * de texte de plus (« Lecture de tmp/vue-bord.png ») : on savait qu'une image
 * avait été regardée, jamais ce qu'elle montrait. L'étape porte désormais le
 * CHEMIN de l'image, et l'interface l'affiche sous son point.
 */

test('une lecture d’image devient une capture, une lecture de code non', () => {
  assert.equal(cheminDeCapture('/tmp/vue-bord.png'), '/tmp/vue-bord.png');
  assert.equal(cheminDeCapture('/tmp/VUE.JPEG'), '/tmp/VUE.JPEG');
  assert.equal(cheminDeCapture('/src/index.ts'), undefined);
  assert.equal(cheminDeCapture(undefined), undefined);
});

test('l’étape d’une image porte son fichier, celle d’un fichier texte non', () => {
  const image = humanStep('Read', { file_path: '/tmp/essai/vue-bord.png' });
  assert.equal(image.capture, '/tmp/essai/vue-bord.png');
  assert.match(image.label, /Capture regardée/);

  const code = humanStep('Read', { file_path: '/tmp/essai/index.ts' });
  assert.equal(code.capture, undefined);
  assert.match(code.label, /Lecture de/);

  // Une capture jointe à la réponse compte aussi.
  const jointe = humanStep('mcp__beluga__attach_file', { path: '/tmp/essai/vue.png' });
  assert.equal(jointe.capture, '/tmp/essai/vue.png');
  // L'ancien nom de l'outil est toujours compris.
  const ancien = humanStep('mcp__beluga__attach_screenshot', { path: '/tmp/essai/vue.png' });
  assert.equal(ancien.capture, '/tmp/essai/vue.png');

  /* UN FICHIER JOINT QUI N'EST PAS UNE IMAGE NE PORTE PAS DE CAPTURE, et son
     étape le DIT par son nom — jamais « Capture jointe » sur un PDF. */
  const pdf = humanStep('mcp__beluga__attach_file', { path: '/tmp/essai/rapport.pdf' });
  assert.equal(pdf.capture, undefined);
  assert.match(pdf.label, /Fichier joint/);
  assert.match(pdf.label, /rapport\.pdf/);
});

test('une capture n’est servie que si elle est à sa place', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'captures-'));
  const image = path.join(racine, 'vue.png');
  fs.writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const texte = path.join(racine, 'notes.txt');
  fs.writeFileSync(texte, 'bonjour');

  assert.deepEqual(imageDEtape(image, [racine]), { file: image, mime: 'image/png' });
  // Hors des racines acceptées : rien.
  assert.equal(imageDEtape(image, [path.join(racine, 'ailleurs')]), null);
  // Ce n'est pas une image : rien.
  assert.equal(imageDEtape(texte, [racine]), null);
  // Le fichier n'existe plus : rien, jamais une erreur.
  assert.equal(imageDEtape(path.join(racine, 'disparue.png'), [racine]), null);
  // La remontée par « .. » ne sort pas de la racine.
  assert.equal(imageDEtape(path.join(racine, '..', 'dehors.png'), [racine]), null);

  fs.rmSync(racine, { recursive: true, force: true });
});
