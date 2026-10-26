---
name: anime-js-chronologie-pour-une-video
description: À utiliser quand une animation écrite avec Anime.js (v4, MIT) doit être rendue en vidéo image par image (HyperFrames, capture Playwright) ou rejouée à l'identique : « anime ce texte avec anime.js », « l'export vidéo saute des images », « l'animation n'est pas la même à chaque rendu ». Dit comment la piloter par le temps de la chronologie au lieu de son horloge.
etat: active
themes: video, animation, motion
symptomes: animation anime.js saccadée en vidéo, export différent à chaque rendu, anime.js dans hyperframes
---

# anime-js-chronologie-pour-une-video

## Symptôme

Une animation Anime.js est juste dans le navigateur mais saute, accélère ou change d'un export vidéo à l'autre.

## Cause

Anime.js avance seul sur requestAnimationFrame (son « engine »). Un moteur de rendu image par image déplace le temps lui-même : l'horloge propre d'Anime.js n'est pas rejouée.

## Procédure

1. Charger la copie locale épinglée (`anime.umd.min.js`, global `anime`), jamais un CDN pendant un rendu.
2. Créer chaque animation EN PAUSE : `const a = anime.animate(cible, { x: 200, duration: 800, autoplay: false })` ou une `anime.createTimeline({ autoplay: false })`.
3. Piloter par le temps de la chronologie maîtresse : dans HyperFrames, poser une chronologie GSAP en pause sur `window.__timelines[id]` et, dans son `onUpdate`, appeler `a.seek(tl.time() * 1000)` (Anime.js compte en millisecondes).
4. Ou couper l'horloge interne : `anime.engine.pauseOnDocumentHidden = false` et ne jamais laisser l'engine jouer (`autoplay: false` partout).
5. Un tirage au hasard passe par une graine fixe (`anime.utils.random` n'en a pas : utiliser un petit générateur à graine maison).
6. Pour un site (pas une vidéo), Anime.js peut jouer librement : ces règles ne valent que pour un rendu image par image.

## Vérification

Deux rendus du même dossier donnent des images identiques aux mêmes instants (`hyperframes snapshot --at 1,2.5` puis comparaison des PNG, par exemple `cmp` ou une somme md5). L'image à t = 0,4 s montre l'objet au milieu de son trajet calculé, pas au départ.

## Pièges

- v4 a changé l'API : `anime.animate`, `anime.createTimeline`, `anime.utils` — les exemples `anime({ targets })` sont de la v3.
- Les durées sont en millisecondes, GSAP et HyperFrames comptent en secondes.
- `loop: true` sans seek piloté donne une boucle qui dérive.

## Ce qui ne marche pas

Laisser `autoplay` par défaut et compter sur la vitesse de capture : les images sortent au rythme de la machine, pas du film.
