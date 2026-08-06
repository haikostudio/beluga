import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTENSION_PAR_DEFAUT,
  FORMATS_ENREGISTREMENT,
  extensionDuType,
  formatDEnregistrement,
} from '@haikodev/shared';

/** Un navigateur qui n'accepte que ce qu'on lui donne dans la liste. */
const navigateur = (acceptes: string[]) => (type: string) => acceptes.includes(type);

test('un navigateur qui sait le webm garde le webm', () => {
  const choisi = formatDEnregistrement(navigateur(['audio/webm;codecs=opus', 'audio/webm']));
  assert.equal(choisi.mimeType, 'audio/webm;codecs=opus');
  assert.equal(choisi.extension, 'webm');
});

test('un navigateur à la Safari, qui refuse le webm, reçoit du mp4', () => {
  const choisi = formatDEnregistrement(navigateur(['audio/mp4', 'audio/aac']));
  assert.equal(choisi.mimeType, 'audio/mp4');
  assert.equal(choisi.extension, 'mp4');
});

test('aucun format commun : on n’impose RIEN et le navigateur choisit', () => {
  const choisi = formatDEnregistrement(navigateur([]));
  assert.equal(choisi.mimeType, undefined);
  assert.equal(choisi.extension, EXTENSION_PAR_DEFAUT);
});

test('un navigateur qui ne sait pas répondre ne se voit rien imposer', () => {
  for (const sansReponse of [undefined, null]) {
    const choisi = formatDEnregistrement(sansReponse);
    assert.equal(choisi.mimeType, undefined);
    assert.equal(choisi.extension, EXTENSION_PAR_DEFAUT);
  }
});

test('un navigateur qui se fâche sur la question ne fait pas tomber le choix', () => {
  const choisi = formatDEnregistrement((type) => {
    if (type.startsWith('audio/webm')) throw new Error('type inconnu');
    return type === 'audio/mp4';
  });
  assert.equal(choisi.mimeType, 'audio/mp4');
});

test('l’ordre de la liste est respecté : le premier accepté gagne', () => {
  // Tout accepté : c'est la tête de liste qui sort.
  const choisi = formatDEnregistrement(() => true);
  assert.equal(choisi.mimeType, FORMATS_ENREGISTREMENT[0]);
});

test('chaque format de la liste porte une extension connue', () => {
  for (const type of FORMATS_ENREGISTREMENT) {
    const extension = extensionDuType(type);
    assert.ok(/^[a-z0-9]{2,4}$/.test(extension), `${type} → « ${extension} »`);
  }
});

test('l’extension suit le type réellement rendu par le navigateur', () => {
  assert.equal(extensionDuType('audio/webm;codecs=opus'), 'webm');
  assert.equal(extensionDuType('audio/mp4'), 'mp4');
  assert.equal(extensionDuType('audio/ogg; codecs=opus'.replace(' ', '')), 'ogg');
  assert.equal(extensionDuType('audio/mpeg'), 'mp3');
  assert.equal(extensionDuType('AUDIO/WEBM'), 'webm');
});

test('un type absent, vide ou inconnu retombe sur l’extension par défaut', () => {
  for (const type of [undefined, null, '', '   ', 'audio/parfaitement-inconnu']) {
    assert.equal(extensionDuType(type), EXTENSION_PAR_DEFAUT);
  }
});
