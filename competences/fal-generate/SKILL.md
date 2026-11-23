---
name: fal-generate
description: |
  Generate images and videos using fal.ai AI models. Production-grade catalogue covering Flux, SDXL, ideogram, and other community-hosted endpoints.
triggers:
  - "fal generate"
  - "fal.ai image"
  - "flux image"
  - "sdxl"
  - "ideogram"
od:
  mode: image
  category: image-generation
  upstream: "https://github.com/fal-ai-community/skills"
symptomes: générer une image pour mon article, créer une illustration originale, produire une vidéo courte, concevoir un visuel publicitaire, créer des images avec flux, générer un contenu visuel
resume-fr: À utiliser quand vous avez besoin de créer des visuels ou des vidéos de haute qualité. Cette compétence permet de générer des contenus graphiques variés en utilisant des modèles d'intelligence artificielle spécialisés.
---

# fal-generate

> Curated from the fal.ai community team.

## What it does

Generate images and videos using fal.ai AI models. Production-grade catalogue covering Flux, SDXL, ideogram, and other community-hosted endpoints.

## Source

- Upstream: https://github.com/fal-ai-community/skills
- Category: `image-generation`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/fal-ai-community/skills
```

Then ask the agent to invoke this skill by name (`fal-generate`) or with
one of the trigger phrases listed in this skill's frontmatter.
