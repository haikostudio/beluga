---
name: synchronisation-labiale-et-voix-chez-fal
description: À utiliser dès qu'il faut doubler une vidéo dans une autre langue ou recaler les lèvres d'un visage sur une nouvelle voix par fal.ai (sync-lipsync, LatentSync, VEED), ou générer une voix multilingue chez fal : quels modèles existent, comment vérifier qu'ils sont actifs sans clé, comment envoyer un fichier local, comment lire le résultat et le prix.
etat: active
themes: video, voix, multilingue, fal
symptomes: fal demande une adresse de vidéo et je n'ai qu'un fichier local, l'API de prix fal répond 401, quel modèle de lipsync choisir, le résultat fal n'a pas d'images, une voix fal ne parle pas la bonne langue
---

# synchronisation-labiale-et-voix-chez-fal

## Symptôme

Un projet veut décliner une vidéo dans une autre langue sans la refaire : nouvelle voix, puis lèvres recalées sur l'image d'origine.

## Cause

fal.ai attend des ADRESSES de fichiers (`video_url`, `audio_url`), pas des fichiers ; ses prix ne se lisent qu'avec une clé ; et ses résultats ne rangent pas le fichier au même endroit selon le genre (`images[0].url`, `video.url`, `audio.url`).

## Procédure

1. Lister les modèles actifs SANS clé : `curl 'https://api.fal.ai/v1/models?q=lipsync&status=active'` ou `?category=text-to-speech` ; un modèle précis : `?endpoint_id=fal-ai/sync-lipsync/v3`.
2. Lire son schéma : `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>` (composants `…Input` / `…Output`).
3. Modèles relevés le 24/10/2026 — synchro : `fal-ai/sync-lipsync/v3` (meilleur), `fal-ai/sync-lipsync/v2` (`model` lipsync-2 ou lipsync-2-pro), `veed/lipsync/v2`, `fal-ai/latentsync` (économique) ; entrées `video_url` + `audio_url`, `sync_mode` (cut_off, loop, bounce, silence, remap) chez sync. Voix : `elevenlabs/tts/eleven-v4` (`text`, `voice`, `language_code`), `fal-ai/minimax/speech-2.8-hd` (`prompt`, `voice_setting.voice_id`, `language_boost` en nom anglais de langue, `output_format: 'url'`). Doublage complet : `fal-ai/elevenlabs/dubbing`.
4. Envoyer un fichier local : `POST https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3` (en-tête `Authorization: Key <clé>`, corps `{content_type, file_name}`) → `{upload_url, file_url}` ; puis `PUT upload_url` avec le fichier et son `Content-Type` ; passer `file_url` au modèle. Un seul morceau jusqu'à 90 Mo (au-delà, envoi en plusieurs parts du client fal-js).
5. Lancer en file : `POST https://queue.fal.run/<id>`, suivre `status_url` jusqu'à `COMPLETED`, lire `response_url` : `video.url` ou `audio.url`.
6. Prix : `GET https://api.fal.ai/v1/models/pricing?endpoint_id=<id>` AVEC clé ; unités vues : minute, seconde, 1000 caractères.

## Vérification

`curl -s 'https://api.fal.ai/v1/models?endpoint_id=<id>'` rend `status: active` ; un test à faux réseau prouve que le corps envoyé est `{video_url, audio_url, …}` avec les `file_url` rendus par l'envoi, et que rien ne part avant l'accord (Beluga : `server/src/test/methodes-creatives.test.ts`).

## Pièges

- `/v1/models` est public mais limité en débit (429 après une dizaine d'appels rapprochés) : espacer.
- `/v1/models/pricing` répond 401 sans clé : ne jamais deviner un prix, demander l'accord quand on ne l'a pas.
- Le dépôt du fichier est gratuit mais rend le fichier joignable : ne le faire qu'au moment de l'appel accordé.
- Tarifs vus sur les pages le 24/10/2026 : sync-3 8 $/min, Lipsync 2.0 3 $/min (pro 5 $), LatentSync 0,20 $ jusqu'à 40 s puis 0,005 $/s, Eleven v4 0,08 $ et MiniMax 2.8 HD 0,10 $ les 1000 caractères — à relire, ils bougent.

## Ce qui ne marche pas

- Passer un chemin local ou une adresse privée au modèle : fal ne peut pas la lire.
- Lire le résultat dans `images[0].url` pour une vidéo ou une voix : il est vide.
