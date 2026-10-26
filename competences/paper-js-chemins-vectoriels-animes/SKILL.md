---
name: paper-js-chemins-vectoriels-animes
description: À utiliser quand une vidéo ou une page doit animer des formes vectorielles complexes avec Paper.js (MIT) — tracés qui se dessinent, morphing de formes, opérations booléennes, texte sur un chemin : « dessine le logo trait par trait », « transforme ce cercle en étoile », « paper.js en vidéo ».
etat: active
themes: video, animation, motion, vectoriel
symptomes: logo dessiné trait par trait, morphing de formes, tracé vectoriel animé, paper.js en vidéo
---

# paper-js-chemins-vectoriels-animes

## Symptôme

On veut des tracés vectoriels animés (dessin progressif, déformation) plus riches que ce que le SVG et CSS permettent simplement, et le rendu vidéo doit être exact.

## Cause

Paper.js offre un vrai modèle de chemins (segments, courbes de Bézier, intersections), mais son `view.onFrame` suit l'horloge du navigateur.

## Procédure

1. Charger la copie locale `paper-full.min.js` ; `paper.setup(canvas)`.
2. Ne pas utiliser `view.onFrame` pour une vidéo. Écrire une fonction `poser(t)` qui reconstruit l'état à l'instant t : longueur dessinée `chemin.dashArray = [L*p, L]` ou `chemin.splitAt(L*p)` sur une copie, interpolation de segments pour un morphing (même nombre de segments des deux côtés), puis `paper.view.update()`.
3. Appeler `poser(tl.time())` depuis l'`onUpdate` d'une chronologie GSAP en pause (`window.__timelines[id]` dans HyperFrames).
4. Importer un SVG existant : `paper.project.importSVG(texteSvg)`.
5. Les opérations booléennes (`unite`, `subtract`) se calculent une fois au départ, pas à chaque image.

## Vérification

L'image à mi-parcours montre le tracé à moitié dessiné ; deux rendus du même instant sont identiques ; le contour final est net à 1080 px (pas de flou de mise à l'échelle).

## Pièges

- Le canevas doit avoir sa taille en attributs (`width`/`height`), pas seulement en CSS, sinon tout est flou.
- Le morphing entre deux formes au nombre de segments différent se tord : rééchantillonner (`flatten`) les deux.

## Ce qui ne marche pas

Animer par `onFrame` avec un compteur : la vidéo dépend de la vitesse de la machine.
