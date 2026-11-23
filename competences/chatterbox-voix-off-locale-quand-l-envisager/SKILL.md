---
name: chatterbox-voix-off-locale-quand-l-envisager
description: À utiliser quand on envisage une voix off expressive fabriquée sur sa propre machine avec Chatterbox (Resemble AI, MIT) — clonage de voix, émotion réglable — au lieu d'un service payant ou d'une voix de synthèse simple : « voix off locale », « cloner une voix », « Chatterbox », « une voix plus vivante que Piper sans payer ».
etat: active
themes: audio, voix, video
symptomes: voix off locale expressive, cloner une voix, chatterbox, voix plus vivante sans payer
---

# chatterbox-voix-off-locale-quand-l-envisager

## Symptôme

On veut une voix plus expressive que la voix d'essai gratuite, sans payer un service, et on pense à installer un modèle de voix sur le serveur.

## Cause

Chatterbox est un modèle neuronal de plusieurs Go (PyTorch) : rapide sur une carte graphique, très lent et gourmand en mémoire sur un simple processeur.

## Procédure

1. Mesurer la machine d'abord : carte graphique présente ? mémoire libre (≥ 6 Go conseillés) ? Sans carte graphique et avec 2 Go libres, NE PAS l'installer : garder une voix d'essai légère (Piper) puis une voix finale par un service, après accord sur le prix.
2. Sur une machine avec carte graphique : environnement Python dédié, `pip install chatterbox-tts`, `ChatterboxTTS.from_pretrained(device='cuda')`, `model.generate(texte, audio_prompt_path='voix-reference.wav', exaggeration=0.5)` → WAV ; le modèle multilingue gère le français.
3. Cloner une voix exige l'accord écrit de la personne dont c'est la voix.
4. Contrôler l'accent (fiche « mesurer-l-accent-d-une-voix-de-synthese ») et faire la voix d'un seul tenant (fiche « voix-de-synthese-d-un-seul-tenant »).

## Vérification

Avant installation : la mesure de la machine est notée (carte graphique, mémoire libre) et justifie le choix. Après : 10 s de voix se fabriquent en un temps noté, le WAV se lit en entier (`ffprobe`).

## Pièges

- Les sorties portent un filigrane audio imperceptible (Perth) : c'est voulu.
- Le premier lancement télécharge plusieurs Go de poids.

## Ce qui ne marche pas

L'installer sur un serveur de 4 cœurs sans carte graphique et 2 Go libres : la mémoire sature et les autres travaux tombent.
