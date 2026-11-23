---
name: video-sans-piste-son-refusee-par-hyperframes
description: À utiliser dès qu'un rendu HyperFrames échoue en phase de compilation avec « composition asset(s) do not match their authored media element type (expected: audio) », ou avant d'écrire data-has-audio sur une vidéo depuis un réglage de volume. Dit comment reconnaître une vidéo muette et comment lire le vrai motif d'un rendu raté.
etat: active
themes: vidéo, rendu, hyperframes, son
symptomes: do not match their authored media element type, expected: audio, Render failed sans raison, export refusé avec une vidéo détourée, le fichier exporté a perdu son son
---

# video-sans-piste-son-refusee-par-hyperframes

## Symptôme

Tout le rendu échoue dès la compilation, sans une image produite. La fin de la sortie n'est qu'un bloc JSON de diagnostics suivi de « Render failed ».

## Cause

Une balise vidéo porte data-has-audio="true" alors que son fichier n'a aucune piste son (cas courant : WebM détouré). HyperFrames 0.8.134 compare la balise au fichier et refuse la composition entière. Un réglage de volume ne prouve pas qu'un fichier a du son.

## Procédure

1. Au moment du rendu, sonder chaque vidéo avec ffprobe (flux de type audio), et garder le résultat par chemin + taille + date.
2. N'écrire data-has-audio que si le volume est positif ET que le fichier a du son ; sinon écrire muted.
3. Appliquer la MÊME règle au contrôle fait après le rendu : une vidéo muette ne fait pas attendre de son dans le fichier final.
4. Si le sondage échoue, garder la conduite d'avant (son présumé) et ne pas retenir ce résultat.
5. Pour la raison affichée, lire d'abord les lignes qui suivent le « ✗ », puis le champ error de la ligne « Failure summary », et garder la sortie entière dans le journal.

## Vérification

Rendre une composition avec une vidéo sans piste son et un volume de 1, plus une voix : le rendu aboutit, ffprobe montre image et son, à la bonne durée. Puis une composition dont le seul « son » est cette vidéo : le rendu aboutit sans réclamer de son. Preuve : carte « Export vidéo du Studio en échec » de Beluga, branche tache/export-video-du-studio-d74fd3.

## Pièges

Corriger seulement la balise déplace la panne : le rendu passe, puis le contrôle final refuse le fichier faute de son. Couper la fin de la sortie (slice) ne donne que du JSON : le motif est écrit avant et répété dans le bloc de fin. En aperçu navigateur, ne rien changer tant que le fichier n'a pas été sondé.

## Ce qui ne marche pas

Mettre le volume à zéro à la main contourne le refus mais laisse le piège à chaque nouvelle vidéo muette. Déduire le son de l'extension ou du format ne marche pas : un WebM peut avoir du son ou non.
