---
name: rapier-collisions-3d-a-pas-fixe
description: À utiliser quand une scène 3D (Three.js, OGL) doit avoir une vraie physique — objets qui tombent, collisions, empilements, véhicules — avec Rapier (Apache-2.0), surtout pour une vidéo rendue image par image : « physique 3D », « Rapier dans la scène », « les cubes ne tombent pas pareil à chaque rendu ».
etat: active
themes: video, animation, 3d, physique
symptomes: physique 3d en vidéo, rapier ne se charge pas, collisions 3d non reproductibles, cubes qui tombent différemment
---

# rapier-collisions-3d-a-pas-fixe

## Symptôme

Une scène 3D physique n'est pas reproductible d'un export à l'autre, ou le moteur physique ne se charge pas dans la page de rendu.

## Cause

Rapier est compilé en WebAssembly : il faut l'initialiser (`await RAPIER.init()`) avant tout, et il ne donne un résultat identique que si on l'avance à pas fixe, toujours depuis le même état.

## Procédure

1. Prendre `@dimforge/rapier3d-compat` (le WebAssembly est EMBARQUÉ dans le fichier : aucun `.wasm` à servir) ; copie locale `rapier.mjs`, importée en module : `import RAPIER from './lib/rapier/rapier.mjs'; await RAPIER.init();`.
2. Monde : `new RAPIER.World({ x: 0, y: -9.81, z: 0 })`, `world.timestep = 1/60`.
3. Corps : `world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z))`, forme : `world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), corps)`.
4. Avancer à pas fixe jusqu'au temps de la chronologie : `while (pasFaits < Math.floor(t * 60)) { world.step(); pasFaits++; }` ; en arrière, recréer le monde et rejouer.
5. Copier positions et rotations vers les objets Three.js (`mesh.position.copy(corps.translation())`, `mesh.quaternion.copy(corps.rotation())`), puis rendre.
6. Attendre l'initialisation avant de déclarer la composition prête (HyperFrames : poser la chronologie après `await RAPIER.init()`).

## Vérification

La même image ressort à 2 s sur deux rendus ; la console de `hyperframes validate` ne montre aucune erreur de chargement du module ; les cubes reposent sur le sol à la fin (aucun ne traverse).

## Pièges

- Le paquet non « compat » demande de servir un `.wasm` à part : la page de rendu le refuse souvent.
- Rapier est déterministe sur une même machine et une même version : épingler la version.
- Le fichier pèse ≈ 2 Mo : ne le copier que dans les compositions qui s'en servent.

## Ce qui ne marche pas

Avancer avec `world.step()` dans un requestAnimationFrame : la vidéo dépend de la vitesse de capture.
