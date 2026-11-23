import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * UNE VIDÉO SANS PISTE SON NE BLOQUE PLUS L'EXPORT (cref16531c824, versions 168 et 174) :
 *  - la page ne l'annonce sonore que si le fichier a du son, l'aperçu ne change pas ;
 *  - le contrôle final ne réclame pas un son qui n'a jamais existé, et garde le son réel ;
 *  - un sondage raté présume le son, ne se retient pas, et un fichier déjà sondé ne se resonde pas ;
 *  - la raison d'un rendu raté se lit, sans JSON.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sans-son-'));
process.env.BELUGA_DATA = bacASable;

const { compositionADuSon, compositionVide, motifDEchecDuRendu, traduireEnPage, videoSonore } = await import('@beluga/shared');
const { sonDuFichier } = await import('../studio-rendu.js');

function compositionAvec(segments: Record<string, unknown>[], genre = 'video'): any {
  const c: any = compositionVide('9:16');
  c.pistes = [{ id: 'p1', genre, segments }];
  return c;
}
const video = (volume: number) => ({ id: 's1', genre: 'video', mediaId: 'm1', debut: 0, duree: 4, debutMedia: 0, volume, ajustement: 'couvrir' });
const voix = { id: 's2', genre: 'voix', mediaId: 'v1', debut: 0, duree: 4, volume: 1 };

function balise(son?: boolean, volume = 1): string {
  const m = { url: 'medias/m1.webm', genre: 'video' as const, ...(son === undefined ? {} : { son }) };
  const page = traduireEnPage(compositionAvec([video(volume)]), { format: '9:16', medias: { m1: m }, gsap: 'gsap.min.js', polices: 'polices/', mode: 'rendu' });
  return /<video\b[^>]*>/.exec(page)![0];
}

test('une vidéo sans piste son est écrite muette, quel que soit son volume', () => {
  const b = balise(false);
  assert.match(b, /\bmuted\b/);
  assert.doesNotMatch(b, /data-has-audio/);
  assert.doesNotMatch(b, /data-volume/);
});

test('une vidéo avec du son, ou non sondée, garde exactement son ancienne sortie', () => {
  assert.equal(balise(true), balise(undefined));
  assert.match(balise(undefined), /data-volume="1" data-has-audio="true"/);
  assert.doesNotMatch(balise(undefined), /\bmuted\b/);
  assert.match(balise(undefined, 0), /\bmuted\b/);
  assert.equal(videoSonore(1, undefined), true);
  assert.equal(videoSonore(0, { son: true }), false);
});

test('le contrôle final ne réclame pas le son d’une vidéo muette, et garde le son réel', () => {
  const seule = compositionAvec([video(1)]);
  assert.equal(compositionADuSon(seule, { m1: { son: false } }), false, 'vidéo muette seule : aucun son attendu');
  assert.equal(compositionADuSon(seule, { m1: { son: true } }), true);
  assert.equal(compositionADuSon(seule, { m1: {} }), true, 'sondage raté : son présumé');
  assert.equal(compositionADuSon(seule), true, 'sans table : son présumé');

  const avecVoix: any = compositionAvec([video(1)]);
  avecVoix.pistes.push({ id: 'p2', genre: 'voix', segments: [voix] });
  assert.equal(compositionADuSon(avecVoix, { m1: { son: false } }), true, 'voix + vidéo muette : le son reste attendu');
});

test('un fichier déjà sondé ne se resonde pas, un sondage raté ne se retient pas', async () => {
  const f = path.join(bacASable, 'video.webm');
  fs.writeFileSync(f, 'a');
  let appels = 0;
  const muet = async () => (appels++, { son: false });
  assert.equal(await sonDuFichier(f, muet), false);
  assert.equal(await sonDuFichier(f, muet), false);
  assert.equal(appels, 1);

  const g = path.join(bacASable, 'autre.webm');
  fs.writeFileSync(g, 'b');
  const panne = async () => {
    appels++;
    throw new Error('ffprobe absent');
  };
  appels = 0;
  assert.equal(await sonDuFichier(g, panne), undefined);
  assert.equal(await sonDuFichier(g, async () => ({ son: true })), true, 'la panne n’a pas été retenue');
  assert.equal(appels, 1);
  assert.equal(await sonDuFichier(path.join(bacASable, 'absent.webm')), undefined);

  // Le fichier change : il se relit.
  fs.writeFileSync(f, 'contenu plus long');
  assert.equal(await sonDuFichier(f, async () => ({ son: true })), true);
});

test('la raison d’un rendu raté se lit : le motif, sans journal ni JSON', () => {
  const motif = '1 composition asset(s) do not match their authored media element type (expected: audio)';
  // La fin réelle de la sortie de HyperFrames 0.8.134.
  const sortie = [
    '[INFO] [Compiler] Embedded local font file: polices/inter.woff2 (47 KB → data URI)',
    `[INFO] [Render:trace] {"phase":"compile","status":"error","message":"${motif}"}`,
    `[INFO] [Render] Failure summary {"failedStage":"Compiling composition","error":"${motif}","observedFailedPhase":"compile","browserConsoleErrors":[]}`,
    '',
    '✗  Render failed',
    '',
    `   ${motif}`,
    '   Try --docker for containerized rendering',
    '',
  ].join('\n');
  assert.equal(motifDEchecDuRendu(sortie), motif);
  // Sans bloc de fin : le résumé d'échec, puis une ligne d'erreur, puis la dernière ligne de texte.
  assert.equal(motifDEchecDuRendu(`[INFO] [Render] Failure summary {"error":"le \\"fichier\\" manque","workers":1}\n✗  Render failed\n`), 'le "fichier" manque');
  assert.equal(motifDEchecDuRendu('préparation\nError: chrome introuvable\n{"a":1}\n'), 'Error: chrome introuvable');
  assert.equal(motifDEchecDuRendu('préparation\nplus rien\n'), 'plus rien');
  assert.equal(motifDEchecDuRendu(''), 'le moteur de rendu n’a donné aucune raison');
  assert.ok(motifDEchecDuRendu(`✗ ${'x'.repeat(900)}`).length <= 280);
});
