import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sonGeminiEnWav,
  texteDeVoixFinale,
} from '@beluga/shared';

/**
 * LES VOIX GEMINI — troisième moteur, à côté de Piper et Kokoro. Ce qui est
 * jugé ici se décide sans réseau : quelles voix sont reconnues, comment le
 * débit est dit à Google, et que le son rendu est toujours un vrai WAV.
 */

test('un PCM brut reçoit son entête WAV, un WAV passe tel quel', () => {
  const pcm = new Uint8Array([1, 2, 3, 4]);
  const wav = sonGeminiEnWav(pcm, 'audio/L16;codec=pcm;rate=24000');
  const vue = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(vue.getUint32(24, true), 24000);
  assert.equal(vue.getUint32(40, true), 4);
  assert.equal(wav.length, 48);
  assert.equal(sonGeminiEnWav(wav, 'audio/wav'), wav);
});

test('la voix finale du Studio porte la balise d’accent de France, entre crochets (suivie, jamais prononcée)', () => {
  assert.equal(texteDeVoixFinale('Bonjour.\n\nÀ bientôt.'), '[French from France] Bonjour.\n\nÀ bientôt.');
});
