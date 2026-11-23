/**
 * LES IMAGES QU'UN AGENT JOINT DEPUIS LE DOSSIER DES MÉDIAS FABRIQUÉS SE SERVENT PENDANT SON TOUR.
 *
 * Constat du 03/11/2026 : un chef de marque rangeait ses visuels sous `PATHS.medias` (disque de stockage) et les
 * joignait à sa réponse ; `/api/capture` ne comptait pas cette racine et chaque vignette de « Ce que l'agent a vu »
 * restait cassée jusqu'au rangement de fin de tour. Ce que ces essais verrouillent : la racine est servie, et la
 * garde de chemin (`imageDEtape`) refuse toujours ce qui vise ailleurs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PATHS } from '../config.js';
import { racinesDesImagesDEtape } from '../copies-de-cartes.js';
import { imageDEtape } from '../files.js';

test('les médias fabriqués comptent parmi les racines des images d’étape', () => {
  const racines = racinesDesImagesDEtape('/un/projet');
  assert.ok(racines.includes(PATHS.medias), 'PATHS.medias doit être servi');
  assert.ok(racines.includes('/un/projet'));
});

test('une image sous une racine se sert, une image ailleurs ou un fichier non image non', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'racines-images-'));
  const medias = path.join(dossier, 'beluga-medias', 'marque', 'visuels');
  fs.mkdirSync(medias, { recursive: true });
  const image = path.join(medias, 'post-01.png');
  fs.writeFileSync(image, 'x');
  fs.writeFileSync(path.join(medias, 'notes.txt'), 'x');
  const racines = [path.join(dossier, 'beluga-medias')];
  assert.equal(imageDEtape(image, racines)?.file, image);
  assert.equal(imageDEtape(path.join(medias, 'notes.txt'), racines), null);
  assert.equal(imageDEtape(path.join(medias, '..', '..', '..', 'ailleurs.png'), racines), null);
  assert.equal(imageDEtape('/etc/passwd.png', racines), null);
  fs.rmSync(dossier, { recursive: true, force: true });
});
