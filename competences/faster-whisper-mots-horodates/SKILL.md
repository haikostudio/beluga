---
name: faster-whisper-mots-horodates
description: À utiliser quand il faut les temps de chaque mot d'une voix (sous-titres mot à mot, mot surligné au moment où il est dit, recalage d'une animation sur la voix) sans service payant, avec faster-whisper (MIT) sur le serveur : « sous-titres calés sur la voix », « horodatage au mot », « transcrire cette voix off », « les sous-titres arrivent en retard ».
etat: active
themes: audio, video, sous-titres
symptomes: sous-titres décalés de la voix, horodatage au mot, transcrire une voix sans clé, mot surligné quand il est dit
---

# faster-whisper-mots-horodates

## Symptôme

Les sous-titres d'une vidéo tombent à côté des mots, ou il faut transcrire un enregistrement sans clé d'un service de transcription.

## Cause

Un horodatage par phrase ne suffit pas pour un sous-titre au mot ; la reconnaissance, elle, se trompe parfois de mot.

## Procédure

1. Environnement Python dédié avec `faster-whisper` (CTranslate2, tourne sur processeur) ; modèle `base` (≈ 150 Mo) : 10 s de voix en ≈ 2 s sur 4 cœurs.
2. `WhisperModel('base', device='cpu', compute_type='int8').transcribe(fichier, word_timestamps=True, language='fr')` → pour chaque segment, `seg.words` avec `word`, `start`, `end`.
3. Quand le TEXTE est connu (voix de synthèse d'un script), ne garder de la reconnaissance que les TEMPS : aligner le texte connu sur les mots reconnus (distance d'édition), interpoler les mots non trouvés entre leurs voisins.
4. Sous-titres : deux mots au plus à l'écran, le mot courant en couleur d'accent, chaque mot affiché de `start` à `end`.
5. Sans reconnaissance possible : répartir les temps au prorata de la longueur des mots sur la durée réelle du son (repli, à dire).

## Vérification

Pour trois mots pris au hasard, le sous-titre apparaît à moins de 0,15 s de l'instant où le mot est dit (vérifier sur l'export) ; la durée totale des mots ne dépasse pas celle du fichier.

## Pièges

- Le premier appel télécharge le modèle : le poser à l'avance dans un dossier connu (variable d'environnement) pour qu'un rendu ne dépende pas du réseau.
- `int8` sur processeur ; `float16` exige une carte graphique.
- Les chiffres reconnus s'écrivent parfois en lettres : l'alignement sur le texte connu règle ce cas.

## Ce qui ne marche pas

Afficher le texte reconnu tel quel : « voie » à la place de « voix », et la marque mal orthographiée à l'écran.
