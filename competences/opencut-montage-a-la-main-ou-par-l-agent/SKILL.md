---
name: opencut-montage-a-la-main-ou-par-l-agent
description: À utiliser quand on se demande s'il faut un logiciel de montage vidéo (OpenCut, MIT, éditeur web libre façon CapCut) pour assembler les plans d'une vidéo fabriquée par un agent, ou intégrer un éditeur dans une application : « il faut un éditeur de montage », « OpenCut », « monter la vidéo à la main », « une ligne de temps dans l'application ».
etat: active
themes: video, montage
symptomes: faut-il un éditeur de montage, opencut, monter la vidéo à la main, ligne de temps dans l'application
---

# opencut-montage-a-la-main-ou-par-l-agent

## Symptôme

On veut ajouter un éditeur de montage complet à une application, alors que l'agent pourrait monter lui-même.

## Cause

Un éditeur à ligne de temps est un gros chantier (pistes, découpe, aperçu, export) à maintenir ; quand l'agent fabrique déjà la vidéo en code, il peut aussi la monter en code, et les retouches se demandent en mots.

## Procédure

1. Pour une vidéo fabriquée par un agent : faire monter l'agent lui-même dans UNE composition (plans en `<video class="clip">`, voix et musique en `<audio class="clip">`, sous-titres au mot, titres), rendue par HyperFrames, puis livrée par ffmpeg (fiche « ffmpeg-livraison-d-une-video »). Une retouche (« coupe le plan 2 plus tôt ») se demande dans la conversation.
2. Pour un utilisateur qui veut monter à la main : lui conseiller OpenCut (opencut.app, ou installé à part) plutôt que de bâtir un éditeur.
3. Intégrer OpenCut dans une application : c'est une application Next.js complète (base, stockage) — à traiter comme un projet à part, jamais copié dans un écran existant.

## Vérification

Le film monté par l'agent se lit en entier (`ffprobe` : durée, image, son) et chaque plan apparaît dans l'ordre prévu ; aucune dépendance à OpenCut dans l'application.

## Pièges

- OpenCut évolue vite (projet jeune) : vérifier son état avant de le conseiller.
- Un éditeur maison à moitié fini coûte plus cher à garder qu'un montage en code.

## Ce qui ne marche pas

Bâtir un éditeur de montage dans l'application pour quelques retouches par an : il n'est plus utilisé et alourdit tout.
