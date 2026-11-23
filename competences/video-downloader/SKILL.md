---
name: video-downloader
description: |
  Download videos from YouTube and other platforms for offline viewing, editing, or archival with support for various formats and quality options.
triggers:
  - "download video"
  - "youtube download"
  - "archive video"
  - "offline video"
od:
  mode: video
  category: video-generation
  upstream: "https://github.com/ComposioHQ/awesome-claude-skills/tree/master/video-downloader"
symptomes: télécharger une vidéo YouTube, enregistrer cette vidéo pour plus tard, récupérer une vidéo en haute qualité, sauvegarder une vidéo pour un montage, télécharger une vidéo depuis un site, archiver cette vidéo sur mon ordinateur
resume-fr: À utiliser quand vous souhaitez enregistrer une vidéo en ligne sur votre appareil pour la consulter hors connexion ou la retravailler. Cette compétence permet de télécharger des contenus depuis diverses plateformes en choisissant le format et la qualité souhaités.
---

# video-downloader

> Curated from ComposioHQ awesome-claude-skills.

## What it does

Download videos from YouTube and other platforms for offline viewing, editing, or archival with support for various formats and quality options.

## Source

- Upstream: https://github.com/ComposioHQ/awesome-claude-skills/tree/master/video-downloader
- Category: `video-generation`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/ComposioHQ/awesome-claude-skills/tree/master/video-downloader
```

Then ask the agent to invoke this skill by name (`video-downloader`) or with
one of the trigger phrases listed in this skill's frontmatter.
