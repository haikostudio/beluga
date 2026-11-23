import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaDeLOption, repereDuLibelle } from '@beluga/shared';

const VOIX = [
  { id: 'a', name: 'Voix A : « Chris promo SDR » (clonée de ta vidéo), lit le début du texte', mime: 'audio/mpeg' },
  { id: 'b', name: 'Voix B : « Chris Haiko »', mime: 'audio/mpeg' },
  { id: 'img', name: 'Voix C : aperçu', mime: 'image/png' },
  { id: 'v', name: 'Plan 1 — essai', mime: 'video/mp4' },
];

test('le lien posé par l’agent passe avant le nom', () => {
  assert.equal(mediaDeLOption({ label: 'Voix A : x', media: 'b' }, [VOIX])?.id, 'b');
  assert.equal(mediaDeLOption({ label: 'Voix A : x', media: 'img' }, [VOIX]), undefined);
  assert.equal(mediaDeLOption({ label: 'Voix A : x', media: 'inconnu' }, [VOIX]), undefined);
});

test('le rapprochement par le repère du nom, sans casse ni accents', () => {
  assert.equal(mediaDeLOption({ label: 'Voix A : Chris promo SDR (recommandé)' }, [VOIX])?.id, 'a');
  assert.equal(mediaDeLOption({ label: 'VOIX B: Chris Haiko' }, [VOIX])?.id, 'b');
  assert.equal(mediaDeLOption({ label: 'Plan 1 : la vidéo' }, [VOIX])?.id, 'v');
  assert.equal(repereDuLibelle('Écoute : x'), 'ecoute');
});

test('une image, un libellé sans repère ou un repère inconnu : aucun bouton', () => {
  assert.equal(mediaDeLOption({ label: 'Voix C : ancienne' }, [VOIX]), undefined);
  assert.equal(mediaDeLOption({ label: 'Retour à la voix Yosef' }, [VOIX]), undefined);
  assert.equal(mediaDeLOption({ label: 'Voix E : rien' }, [VOIX]), undefined);
});

test('ambigu = rien, et un groupe ambigu ne laisse pas chercher plus loin', () => {
  const doublon = [...VOIX, { id: 'a2', name: 'Voix A : autre prise', mime: 'audio/wav' }];
  assert.equal(mediaDeLOption({ label: 'Voix A : x' }, [doublon]), undefined);
  assert.equal(mediaDeLOption({ label: 'Voix A : x' }, [doublon, VOIX]), undefined);
  // Le message d'abord : un groupe vide laisse la place à l'agent entier.
  assert.equal(mediaDeLOption({ label: 'Voix A : x' }, [[], VOIX])?.id, 'a');
  // « Voix A bis » n'est pas « Voix A ».
  const bis = [...VOIX, { id: 'abis', name: 'Voix A bis : variante', mime: 'audio/mpeg' }];
  assert.equal(mediaDeLOption({ label: 'Voix A : x' }, [bis])?.id, 'a');
});
