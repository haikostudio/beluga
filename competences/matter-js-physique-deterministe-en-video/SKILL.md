---
name: matter-js-physique-deterministe-en-video
description: À utiliser quand une vidéo rendue image par image montre de la physique 2D avec Matter.js (MIT) — objets qui tombent, s'empilent, rebondissent, logos qui se bousculent : « fais tomber les mots », « physique dans la vidéo », « Matter.js dans HyperFrames », « la chute n'est pas la même à chaque export ». Complète la fiche « matterjs » (interactif) pour le cas du rendu.
etat: active
themes: video, animation, motion, physique
symptomes: physique 2D en vidéo, chute différente à chaque export, objets qui traversent le sol, matter.js dans hyperframes
---

# matter-js-physique-deterministe-en-video

## Symptôme

Une scène Matter.js filmée image par image donne une chute différente à chaque export, ou des objets qui traversent le sol.

## Cause

`Matter.Runner` fait avancer le monde au rythme de requestAnimationFrame avec un pas variable ; un rendu qui impose le temps ne le rejoue pas, et un pas variable change le résultat.

## Procédure

1. Charger la copie locale `matter.min.js` (global `Matter`). JAMAIS `Runner.run` ni `Render.run`.
2. Monde à pas FIXE : `const pas = 1000 / 60` ; une fonction `avancerJusqua(t)` qui appelle `Engine.update(moteur, pas)` autant de fois qu'il faut pour atteindre t (en ms), en partant de l'état courant ; si t recule (seek en arrière), recréer le monde depuis zéro et rejouer.
3. Placer les objets au départ avec des valeurs fixes (ou un générateur à graine), jamais `Math.random()` libre.
4. Dessiner soi-même : lire `corps.position` et `corps.angle` et poser un élément DOM (`transform`) ou dessiner sur un canevas.
5. Dans HyperFrames : `onUpdate` de la chronologie GSAP en pause → `avancerJusqua(tl.time() * 1000)` → dessiner.
6. Sol et murs `isStatic: true`, assez épais (≥ 60 px) pour qu'un corps rapide ne passe pas au travers.

## Vérification

Deux rendus donnent les mêmes positions (images identiques au même instant) ; un `snapshot` à 3 s puis à 1 s puis à 3 s rend deux fois la même image à 3 s (le retour en arrière rejoue bien depuis zéro).

## Pièges

- `Engine.update` avec un pas plus grand que 16,7 ms rend la simulation instable.
- `positionIterations` / `velocityIterations` plus hauts évitent les traversées sur les piles serrées.
- Un rendu commence parfois à un instant au milieu : la fonction doit savoir rejouer depuis zéro.

## Ce qui ne marche pas

Brancher `Runner.run(moteur)` « parce que ça marche dans le navigateur » : la vidéo suit la vitesse de capture.
