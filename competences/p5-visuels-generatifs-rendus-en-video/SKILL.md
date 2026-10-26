---
name: p5-visuels-generatifs-rendus-en-video
description: À utiliser quand on dessine un visuel génératif ou abstrait avec p5.js (LGPL-2.1) — motifs, champs de particules, art algorithmique — et qu'il doit sortir en vidéo ou en image fixe reproductible : « fais un fond génératif », « art abstrait animé », « p5 dans HyperFrames », « mon dessin p5 change à chaque export ».
etat: active
themes: video, animation, motion, generatif
symptomes: fond génératif animé, art abstrait en vidéo, p5 dans hyperframes, dessin p5 différent à chaque export
---

# p5-visuels-generatifs-rendus-en-video

## Symptôme

Un croquis p5.js tourne dans le navigateur mais l'export vidéo est saccadé, différent à chaque fois, ou vide.

## Cause

p5 appelle `draw()` en boucle sur sa propre horloge (`frameCount`, `millis()`) et `random()`/`noise()` changent à chaque lancement sans graine.

## Procédure

1. Charger la copie locale de `p5.min.js`, TELLE QUELLE (LGPL : jamais modifiée ; on la sert comme fichier séparé, on n'en recopie pas le code).
2. Mode instance, boucle coupée : `new p5((s) => { s.setup = () => { s.createCanvas(1080, 1920).parent(hote); s.noLoop(); s.randomSeed(42); s.noiseSeed(42); }; s.draw = () => dessiner(s, tempsCourant); })`.
3. Le temps vient de la chronologie : dans HyperFrames, une chronologie GSAP en pause (`window.__timelines[id]`) dont l'`onUpdate` pose `tempsCourant = tl.time()` puis appelle `s.redraw()`. Tout ce qui bouge est une fonction de `tempsCourant`, jamais de `frameCount` ni `millis()`.
4. Un état qui s'accumule (traînées, particules) se recalcule depuis t = 0 à chaque image, ou par pas fixes rejoués jusqu'à t (déterministe).
5. Image fixe : même croquis, un seul instant.

## Vérification

Deux `snapshot` du même instant donnent des PNG identiques (somme md5) ; l'image à 2 s diffère de l'image à 1 s ; le MP4 dure la durée prévue (`ffprobe`).

## Pièges

- p5 2.x : `setup` peut être asynchrone (chargement) — attendre qu'il ait fini avant le premier rendu.
- `pixelDensity(1)` sinon le canevas double sur un écran à forte densité et le rendu ralentit.
- WEBGL de p5 sans carte graphique passe par le rendu logiciel : lent, garder des scènes simples.

## Ce qui ne marche pas

Laisser `draw()` en boucle et espérer que la capture suive : les images ne correspondent à aucun temps précis.
