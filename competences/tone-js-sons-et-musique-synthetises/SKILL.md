---
name: tone-js-sons-et-musique-synthetises
description: À utiliser quand une vidéo a besoin de bruitages ou d'une petite musique fabriqués sans service payant ni fichier sous licence, avec Tone.js (MIT) : « ajoute un whoosh à la transition », « un petit jingle », « bip quand le chiffre arrive », « musique d'ambiance synthétisée », ou quand un son généré dans la page ne s'entend pas dans l'export.
etat: active
themes: audio, video, motion
symptomes: bruitage de transition, jingle synthétisé, son absent de l'export vidéo, musique sans licence
---

# tone-js-sons-et-musique-synthetises

## Symptôme

On veut des sons calés sur l'animation sans payer une génération, ou un son joué en direct dans la page de rendu n'apparaît pas dans le MP4.

## Cause

Un moteur de rendu vidéo capture des images ; il n'enregistre pas le son joué en temps réel par la page. Il faut fabriquer le son en FICHIER avant, puis le poser comme piste.

## Procédure

1. Copie locale `Tone.js` (global `Tone`), dans une page à part ouverte par un vrai Chrome (Playwright) — pas la page de rendu.
2. Rendu hors temps réel : `const tampon = await Tone.Offline(({ transport }) => { const s = new Tone.MembraneSynth().toDestination(); s.triggerAttackRelease('C2', '8n', 0.5); /* … */ }, duree)` ; whoosh : bruit blanc (`Tone.Noise`) filtré (`Tone.AutoFilter` ou enveloppe sur un `Filter`) ; jingle : `Tone.PolySynth` avec quelques notes aux temps des événements de l'animation.
3. Convertir le `ToneAudioBuffer` en WAV (`tampon.get()` → AudioBuffer → en-tête RIFF 16 bits écrit à la main), le rendre à Node (base64 via `page.evaluate`) et l'écrire sur disque.
4. Le poser dans la composition : `<audio id="bruitages" class="clip" data-start="0" data-duration="…" data-track-index="5" src="medias/bruitages.wav">` (HyperFrames).
5. Caler les sons sur les temps de la chronologie (mêmes valeurs que les `data-start` des scènes).
6. Normaliser le mixage final au montage (ffmpeg `loudnorm`).

## Vérification

Le WAV dure la durée prévue (`ffprobe`), on l'entend ; le MP4 final a une piste son (`ffprobe` : flux audio présent) et le bruit tombe à l'instant de la transition (vérifier à l'oreille ou sur une forme d'onde).

## Pièges

- `Tone.start()` n'est pas nécessaire en `Offline`, mais l'est en direct (geste de l'utilisateur).
- Un son joué en direct pendant le rendu n'est jamais capturé.
- Garder des niveaux bas (−12 dB) : plusieurs synthés additionnés saturent.

## Ce qui ne marche pas

Jouer Tone.js en temps réel dans la page rendue et espérer l'entendre dans le MP4 : la piste son reste vide.
