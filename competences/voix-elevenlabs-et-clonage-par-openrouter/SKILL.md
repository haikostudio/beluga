---
name: voix-elevenlabs-et-clonage-par-openrouter
description: À utiliser dès qu'une application fait dire un texte par une voix ElevenLabs ou clone une voix d'après un enregistrement en passant par OpenRouter (/api/v1/audio/speech) : « Unknown voice », « No endpoints supporting voice cloning found for this model », choix du modèle qui clone, prix au caractère, ou repli quand un revendeur (kie.ai) d'ElevenLabs tombe en panne.
etat: active
themes: voix, audio, openrouter, integrations
symptomes: Unknown voice avec un identifiant ElevenLabs, No endpoints supporting voice cloning, clonage annoncé mais refusé, voix ElevenLabs en Internal Error chez un revendeur
---

# voix-elevenlabs-et-clonage-par-openrouter

## Symptôme

La voix ElevenLabs part chez OpenRouter avec son identifiant (« FGY2WhTYpPnrIDTdsKH5 ») et revient « Unknown voice » ; ou un clonage envoyé à un modèle qui l'annonce (Voxtral) revient en 404 « No endpoints supporting voice cloning found for this model ».

## Cause

OpenRouter nomme les voix ElevenLabs par leur NOM (« laura », sans casse), et seulement les voix « premade » listées dans `supported_voices` du modèle (`GET /api/v1/models?output_modalities=speech`). Le clonage (`input_references`) n'est routé qu'aux fournisseurs dont l'endpoint porte `supports_voice_cloning: true` (`GET /api/v1/models/<id>/endpoints`) — la description du modèle ne suffit pas, un fournisseur peut être retiré par le filtre de surcoût régional.

## Procédure

1. Lire la liste : `GET https://openrouter.ai/api/v1/models?output_modalities=speech` (clé en Bearer) → pour chaque modèle `supported_voices` et `pricing.prompt` (au caractère pour ElevenLabs : 0,00008 $ le 31/10/2026 sur eleven-multilingual-v2).
2. Voix ElevenLabs : `POST /api/v1/audio/speech` `{ model: 'elevenlabs/eleven-multilingual-v2', input, voice: 'Laura', response_format: 'mp3' }` ; la langue suit le texte. Coût réel : en-tête `x-generation-id` puis `GET /api/v1/generation?id=…` (`total_cost`).
3. Clonage : chercher les endpoints qui clonent (boucle sur `/models/<id>/endpoints`, champ `supports_voice_cloning`) — le 31/10/2026 : fish-audio/s2.1-pro, fish-audio/drama-3, heygen/heygen-voice-1 (pcm seulement), bytedance-seed/seed-audio-1-0. Corps : `{ model: 'fish-audio/s2.1-pro', input, response_format: 'mp3', input_references: [{ type: 'input_audio', input_audio: { data: <base64>, format: 'wav' }, transcript: '<texte dit dans l’enregistrement, facultatif>' }] }`. Écrire le corps dans un fichier (`--data @corps.json`) : en argument de commande, le base64 dépasse la limite du shell.
4. Demander l'accord de la personne dont la voix est clonée, et un enregistrement de 10 à 30 s au calme.

## Vérification

Le 31/10/2026 (Beluga, Studio) : 20 voix ElevenLabs fabriquées par nom, 0,0068 $ l'extrait de 84 caractères ; un identifiant ElevenLabs → 400 « Unknown voice » ; Voxtral avec `input_references` → 404 ; Fish Audio S2.1 Pro avec le même corps → 200 audio/mpeg, 47 Ko, voix clonée en français.

## Pièges

Les noms acceptés changent avec la liste du fournisseur : relire `supported_voices` plutôt que figer une liste ailleurs. HeyGen voice refuse tout format autre que « pcm ». Le prix d'un clonage n'est pas celui de la voix ordinaire : relire `pricing.prompt` du modèle cloneur.

## Ce qui ne marche pas

Envoyer l'identifiant ElevenLabs comme `voice`. Se fier à la description d'un modèle (« supports zero-shot voice cloning ») sans regarder ses endpoints. Passer le JSON en argument de `python3`/`curl -d` avec un enregistrement en base64 (« Argument list too long »).
