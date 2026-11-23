---
name: ffmpeg-livraison-d-une-video
description: À utiliser à la fin de toute fabrication vidéo, pour assembler, régler le son et livrer les formats avec FFmpeg : « assemble les plans », « mets le son au bon niveau », « décline en vertical, carré et horizontal », « la vidéo ne démarre pas tout de suite sur le web », « le son est trop fort ou trop faible », « vérifie que le fichier est bon ».
etat: active
themes: video, audio, livraison
symptomes: assembler des plans vidéo, volume inégal entre plans, vidéo lente à démarrer sur le web, décliner en vertical carré horizontal, vérifier un mp4
---

# ffmpeg-livraison-d-une-video

## Symptôme

Une vidéo assemblée a des sauts de son, un volume qui varie d'un plan à l'autre, ne se lit pas en continu sur le web, ou n'existe que dans un seul format.

## Cause

Les plans viennent de sources différentes (codecs, débits, niveaux sonores) ; sans normalisation ni contrôle, le fichier final hérite de tous leurs défauts.

## Procédure

1. Assembler des plans de MÊME format (taille, images par seconde, codec) : fichier liste `file 'plan1.mp4'` puis `ffmpeg -f concat -safe 0 -i liste.txt -c copy assemble.mp4` ; formats différents : réencoder avec le filtre `concat` (`-filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1"`).
2. Niveau sonore des réseaux : `-af loudnorm=I=-16:TP=-1.5:LRA=11` (−16 LUFS, crête −1,5 dB).
3. Livraison web : `-c:v libx264 -pix_fmt yuv420p -crf 18 -preset medium -c:a aac -b:a 192k -movflags +faststart`.
4. Formats : 9:16 = 1080×1920, 1:1 = 1080×1080, 4:5 = 1080×1350, 16:9 = 1920×1080. Un recadrage simple : `-vf "crop=ih*9/16:ih,scale=1080:1920"` ; mieux, recomposer la scène pour chaque format au lieu de recadrer (textes dans les zones de sécurité).
5. Retirer le son : `-an` ; séparer : `-map 0:a -c copy son.m4a`.
6. Contrôler : `ffprobe -v error -show_entries stream=codec_type,width,height:format=duration -of json fichier.mp4`.

## Vérification

`ffprobe` donne la durée attendue (à 0,5 s près), un flux image à la bonne taille ET un flux son ; `ffmpeg -i f.mp4 -af ebur128 -f null -` annonce une intensité intégrée proche de −16 LUFS ; le fichier démarre sans attendre dans un navigateur (faststart).

## Pièges

- `-c copy` en concat exige des plans strictement identiques en codec et paramètres ; sinon images figées ou désynchronisation.
- `yuv420p` obligatoire pour une lecture sur iPhone et les réseaux.
- `loudnorm` en une passe suffit pour des vidéos courtes ; en deux passes pour un mixage exact.

## Ce qui ne marche pas

Recadrer une vidéo 16:9 en 9:16 au centre sans recomposer : les textes et le sujet sortent du cadre.
