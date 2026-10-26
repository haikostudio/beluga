---
name: ogl-shaders-legers
description: À utiliser quand on veut un effet WebGL léger (fond en dégradé animé, distorsion d'image, bruit, effet liquide) sans le poids de Three.js, avec OGL (Unlicense) — sur un site ou dans une vidéo rendue : « shader de fond », « effet liquide sur l'image », « WebGL minimal », « OGL ».
etat: active
themes: video, animation, 3d, shaders
symptomes: shader de fond animé, effet liquide, webgl léger, ogl
---

# ogl-shaders-legers

## Symptôme

On veut un effet par shader simple, et Three.js est trop lourd ou trop lent (surtout sur un serveur sans carte graphique).

## Cause

OGL ne fait que l'essentiel (Renderer, Program, Mesh, Geometry, Texture) : quelques dizaines de Ko, idéal pour un plein écran par shader.

## Procédure

1. Copie locale des sources ESM (`ogl/src/index.js`), importée en module : `import { Renderer, Program, Mesh, Triangle } from './lib/ogl/src/index.js'`.
2. `const renderer = new Renderer({ width: 1080, height: 1920, dpr: 1 }); hote.appendChild(renderer.gl.canvas);`
3. Plein écran : `new Mesh(gl, { geometry: new Triangle(gl), program: new Program(gl, { vertex, fragment, uniforms: { uTemps: { value: 0 } } }) })`.
4. Vidéo : l'uniforme de temps vient de la chronologie (`program.uniforms.uTemps.value = tl.time(); renderer.render({ scene: mesh })` dans l'`onUpdate`), jamais d'un requestAnimationFrame.
5. Sur un serveur sans carte graphique, garder des shaders courts (peu de boucles, pas de raymarching lourd) : chaque image passe par le rendu logiciel.

## Vérification

L'image à 0 s et l'image à 2 s diffèrent ; deux rendus du même instant sont identiques ; le temps de rendu par seconde de vidéo est noté et reste raisonnable (mesurer avec `time`).

## Pièges

- Aucune licence déclarée par l'API GitHub : la licence est « Unlicense » dans le paquet npm (domaine public).
- `preserveDrawingBuffer: true` peut être nécessaire pour qu'une capture d'écran voie le dessin WebGL.
- Le canevas a besoin de sa taille réelle (attributs), pas seulement en CSS.

## Ce qui ne marche pas

Un raymarching de 100 pas par pixel en 1080×1920 sur rendu logiciel : plusieurs secondes par image.
