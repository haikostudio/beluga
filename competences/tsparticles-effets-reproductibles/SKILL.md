---
name: tsparticles-effets-reproductibles
description: À utiliser quand on pose des particules (confettis, neige, étincelles, liens entre points) avec tsParticles (MIT) sur un site, ou qu'on veut cet effet dans une vidéo rendue : « confettis », « particules de fond », « tsparticles », « les confettis ne sont pas les mêmes à chaque export ».
etat: active
themes: animation, motion, video
symptomes: confettis animés, particules de fond, tsparticles, particules différentes à chaque export
---

# tsparticles-effets-reproductibles

## Symptôme

Un effet tsParticles est joli en direct mais une vidéo rendue montre des particules figées, saccadées ou différentes à chaque export.

## Cause

tsParticles anime sur sa propre horloge et tire ses positions au hasard ; il n'expose pas de « aller à l'instant t ».

## Procédure

1. SITE : copie locale `tsparticles.slim.bundle.min.js` (global `tsParticles`), `await tsParticles.load({ id: 'fond', options: { particles: { number: { value: 60 }, move: { enable: true, speed: 1 } }, fpsLimit: 60, detectRetina: true } })`. Respecter `prefers-reduced-motion` (`pauseOnBlur`, ou ne pas charger).
2. VIDÉO RENDUE : ne pas brancher tsParticles. Recréer l'effet en fonction du temps : chaque particule a des paramètres tirés UNE fois par un générateur à graine (position de départ, vitesse, rotation, couleur), et sa position à l'instant t se calcule (`x = x0 + vx*t`, `y = y0 + vy*t + 0.5*g*t²`) ; dessiner sur un canevas dans l'`onUpdate` de la chronologie.
3. Pour des confettis, 150 à 300 particules suffisent en 1080 px.

## Vérification

Site : l'effet tourne sans faire monter le processeur au-delà de quelques pour cent sur un téléphone. Vidéo : deux rendus du même instant sont identiques et l'image à 1 s diffère de celle à 0,5 s.

## Pièges

- La v3/v4 se charge par paquets (`slim`, `full`) : un effet absent du paquet « slim » ne s'affiche pas sans erreur claire.
- `fullScreen.enable` est vrai par défaut : le canevas recouvre toute la page.

## Ce qui ne marche pas

Brancher tsParticles dans une composition HyperFrames : les particules suivent l'horloge réelle, la vidéo ne se rejoue pas.
