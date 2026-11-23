---
name: modele-3d-anime-filme-sans-carte-graphique
description: À utiliser dès qu'il faut transformer un modèle 3D animé (GLB/glTF, personnage rigué, mascotte) en vidéo SANS FOND sur un serveur sans carte graphique, ou fabriquer ce personnage d'après une image par un service payé à l'usage (Meshy) : « filme ce personnage 3D », « une mascotte qui marche sur la vidéo », « rendu Three.js côté serveur », « WebGL indisponible en headless », « la vidéo n'a pas de transparence », « l'animation saute des images ».
etat: active
themes: 3d, video, rendu, medias
symptomes: WebGL indisponible dans Chrome sans écran, vidéo 3D avec fond noir, transparence perdue à l'assemblage, images sautées sur une machine lente, personnage qui sort du cadre en marchant, personnage qui change d'une image à l'autre
---

# modele-3d-anime-filme-sans-carte-graphique

## Symptôme

On veut poser un personnage 3D animé sur une vidéo, mais le serveur n'a pas de GPU : le rendu en temps réel saute des images, le fond reste noir, ou le navigateur sans écran n'a pas de WebGL. Fabriquer l'animation par une suite d'images générées donne un personnage qui change d'une image à l'autre.

## Cause

Une capture d'écran en temps réel dépend de la vitesse de la machine ; un canevas WebGL n'est transparent que si le rendu ET l'encodeur gardent l'alpha ; Chrome sans écran coupe WebGL sans rendu logiciel explicite.

## Procédure

1. Le modèle : Meshy (API REST, `Authorization: Bearer msy_…`, tâches asynchrones à sonder) — `POST /openapi/v1/image-to-3d` (`image_url` accepte une data URI ; `should_texture: true`, `should_remesh: true`, `target_polycount: 30000`, `pose_mode: "a-pose"` ; 30 crédits) → `POST /openapi/v1/rigging` (`input_task_id`, 5 crédits, humanoïde seulement ; rend aussi `basic_animations.walking_glb_url` et `running_glb_url` sans frais) → `POST /openapi/v1/animations` (`rig_task_id`, `action_ids` 1 à 10, 3 crédits chacun, un GLB avec un clip par action dans l'ordre). Catalogue public sans clé : `GET https://api.meshy.ai/web/public/animations/resources` (`result.list[]` : id, name, category). Coût réel : `consumed_credits` de chaque tâche. Fichiers gardés 3 jours : les rapatrier aussitôt.
2. La page : Three.js servi par `page.route` sur une origine factice (import map `three` → `build/three.module.js`, `three/addons/` → `examples/jsm/`), `WebGLRenderer({ alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false })`, `setClearColor(0, 0)`, `GLTFLoader`, `AnimationMixer` sur `gltf.animations[i]`. Cadrer sur `Box3.setFromObject(racine, true)` et suivre l'os du bassin (`/hip|pelvis/i`) pour qu'une marche reste dans le cadre.
3. Le navigateur : playwright `chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] })`.
4. Le temps : jamais l'horloge — pour chaque image `i`, `mixer.setTime(i / fps)`, rendre, puis `canvas.toDataURL('image/png')`.
5. L'assemblage : les PNG en flux vers `ffmpeg -f image2pipe -framerate 30 -c:v png -i - -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 -deadline realtime -cpu-used 8 -row-mt 1 -auto-alt-ref 0 sortie.webm`.
6. Un seul rendu lourd à la fois sur la machine (file d'attente), durée et taille bornées (720×960, 10 s au plus).

## Vérification

`ffprobe -show_streams sortie.webm` montre `codec_name=vp9` et `TAG:alpha_mode=1` ; `ffmpeg -c:v libvpx-vp9 -i sortie.webm -frames:v 1 cadre.png` donne une image RGBA dont un coin vaut (0,0,0,0) ; superposée sur un aplat coloré, le personnage apparaît sans fond. Mesuré sur un serveur sans GPU : 60 images en 720×960 en ≈ 4 s (modèle CesiumMan des glTF-Sample-Assets).

## Pièges

Décoder une WebM alpha avec le décodeur VP9 natif de ffmpeg PERD la transparence : forcer `-c:v libvpx-vp9` en entrée. `require.resolve('three/package.json')` échoue (le paquet ne l'exporte pas) : remonter de deux dossiers depuis `require.resolve('three')`. Dans un fichier TypeScript côté serveur, le code passé à `page.evaluate` ne voit pas `window` au typage : passer par `globalThis`. Le squelette Meshy refuse un objet non humanoïde (422) : le dire avant de chiffrer. Le prix d'un crédit Meshy n'est pas lisible par l'API : afficher crédits ET estimation.

## Ce qui ne marche pas

Animer par une vingtaine d'images générées l'une après l'autre : le personnage change d'une image à l'autre. Filmer en temps réel (enregistrement d'écran) : images sautées sur une machine lente, résultat différent à chaque rendu. Un modèle 3D « gratuit » fabriqué sur le serveur : sans GPU, impossible en temps raisonnable. OpenRouter ne fait pas de 3D.
