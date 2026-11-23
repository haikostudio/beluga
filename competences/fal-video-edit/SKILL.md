---
name: fal-video-edit
description: |
  Edit existing videos using AI — remix style, upscale, remove background, and add audio via fal.ai's hosted video models.
triggers:
  - "fal video edit"
  - "video upscale"
  - "video style transfer"
  - "remove video bg"
  - "video remix"
od:
  mode: video
  category: video-generation
  upstream: "https://github.com/fal-ai-community/skills"
symptomes: améliorer la qualité d'une vidéo, supprimer le fond d'une vidéo, ajouter une musique sur ma vidéo, changer le style visuel d'une vidéo, agrandir la résolution d'un clip, modifier une vidéo existante
resume-fr: À utiliser quand vous souhaitez modifier une vidéo existante pour en améliorer la qualité ou transformer son contenu. Cette compétence permet d'appliquer des effets de style, d'agrandir la résolution, de supprimer l'arrière-plan ou d'ajouter une piste audio.
---

# fal-video-edit

> Curated from the fal.ai community team.

## What it does

Edit existing videos using AI — remix style, upscale, remove background, and add audio via fal.ai's hosted video models.

## Source

- Upstream: https://github.com/fal-ai-community/skills
- Category: `video-generation`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/fal-ai-community/skills
```

Then ask the agent to invoke this skill by name (`fal-video-edit`) or with
one of the trigger phrases listed in this skill's frontmatter.
