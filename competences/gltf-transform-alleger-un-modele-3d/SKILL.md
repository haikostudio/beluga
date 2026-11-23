---
name: gltf-transform-alleger-un-modele-3d
description: À utiliser avant de poser un modèle 3D (.glb/.gltf) dans une page, une scène Three.js ou une vidéo rendue sur un serveur, avec glTF Transform (MIT) : « le modèle est trop lourd », « la scène 3D met longtemps à charger », « compresse ce .glb », « textures trop grosses », « le rendu manque de mémoire ».
etat: active
themes: 3d, video, performance
symptomes: modèle 3d trop lourd, glb lent à charger, textures trop grosses, rendu 3d à court de mémoire
---

# gltf-transform-alleger-un-modele-3d

## Symptôme

Un modèle 3D de plusieurs dizaines de Mo ralentit la page ou fait tomber un rendu vidéo à court de mémoire.

## Cause

Les modèles exportés gardent des textures 4K, des sommets en double et des données inutiles ; chaque image d'un rendu les recharge dans la mémoire du navigateur.

## Procédure

1. Inspecter : `npx --yes @gltf-transform/cli@4 inspect modele.glb` (poids par texture, nombre de sommets) — pour un usage récurrent, installer la version épinglée plutôt que `npx` à la volée.
2. Alléger : `gltf-transform optimize entree.glb sortie.glb --texture-compress webp --texture-size 1024` (dédoublonne, fusionne, simplifie, compresse).
3. Pour un rendu sur un serveur sans carte graphique : textures 1024 px au plus, pas de compression Draco/Meshopt si le chargeur de la page ne l'a pas (sinon ajouter le décodeur en copie locale).
4. Recharger le modèle dans la scène et comparer à l'œil avec l'original (`snapshot` d'une image).

## Vérification

Le fichier allégé pèse nettement moins (noté avant/après) ; la scène le charge sans erreur ; l'image rendue reste fidèle à l'original.

## Pièges

- `--compress draco` exige le décodeur Draco côté page (`DRACOLoader`), servi en local.
- La simplification trop forte casse les silhouettes fines : régler `--simplify-ratio`.

## Ce qui ne marche pas

Charger un .glb de 80 Mo dans un rendu vidéo sous 2 Go libres : Chrome tombe à court de mémoire en cours de rendu.
