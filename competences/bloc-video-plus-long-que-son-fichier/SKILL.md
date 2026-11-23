---
name: bloc-video-plus-long-que-son-fichier
description: À utiliser quand un lecteur de montage web pilote des balises video/audio image par image (saut de currentTime, play/pause dans requestAnimationFrame) et qu'un bloc peut durer plus longtemps que son fichier. Symptômes : « vers la fin la vidéo scintille », « le personnage saute d'un côté à l'autre très vite », « la vidéo repart au début en boucle », alors que le fichier lui-même est sain.
etat: active
themes: video, montage, lecteur
symptomes: vidéo qui clignote en fin de bloc, retour au début en boucle, image qui alterne entre début et fin
---

# bloc-video-plus-long-que-son-fichier

## Symptôme

Passé la fin du fichier, à chaque image, le lecteur alterne entre sa première et sa dernière image. Le fichier extrait image par image avec ffmpeg est pourtant propre.

## Cause

Un lecteur arrivé au bout est « paused » et « ended ». Si la boucle d'images le croit en retard et appelle play(), la norme le fait repartir de 0. Au tour suivant, l'écart est énorme : un saut le renvoie vers la fin (borné à durée − ε), puis play() le relance encore. On obtient une tempête de sauts.

## Procédure

1. Comparer la durée de chaque bloc à celle de son fichier (durée × vitesse + départ dans le fichier).
2. Dans la fonction qui pilote un lecteur, calculer le temps voulu dans le fichier et un drapeau `fini = cible >= duree - 0.05` (si la durée est connue).
3. Si `fini` : pause, un seul saut vers durée − 0,05, puis plus rien (une tolérance un peu plus large, 0,1 s, évite de resauter). Ne JAMAIS appeler play().
4. Sinon, le pilotage habituel (saut confirmé par « seeked », play quand le saut est juste).
5. Un son suit la même règle : passé sa fin, il se tait.

## Vérification

Dans un vrai navigateur, lancer la lecture d'un bloc de 4 s posé sur un fichier de 1,5 s, relever `currentTime` à chaque requestAnimationFrame : après 1,5 s, aucune valeur ne doit reculer de plus de 0,2 s, et les dernières valeurs restent près de 1,45. Un test unitaire peut rejouer la fonction de pilotage sur un faux lecteur dont play() remet le temps à 0 quand il est au bout : play() ne doit jamais être appelé.

## Pièges

- `currentTime` relu rend souvent la valeur DEMANDÉE avant la fin du saut : juger sur l'événement « seeked ».
- Un rendu image par image (export) gère souvent la fin à sa façon : vérifier que l'aperçu et l'export montrent la même chose (dernière image tenue).

## Ce qui ne marche pas

- Boucler le fichier (loop) : le personnage revient à sa pose de départ, c'est le même saut.
- Masquer la vidéo à sa fin : le sujet disparaît au milieu du bloc.
