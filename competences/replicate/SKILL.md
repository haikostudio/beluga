---
name: replicate
description: |
  Discover, compare, and run AI models using Replicate's API. Strong fit for image, audio, and video generation pipelines that swap models frequently.
triggers:
  - "replicate"
  - "run ai model"
  - "model comparison"
  - "replicate api"
od:
  mode: image
  category: image-generation
  upstream: "https://github.com/replicate/skills"
symptomes: générer une image par IA, créer une vidéo à partir de texte, transformer un audio avec un modèle, tester différents modèles de génération, automatiser la création de visuels, comparer des résultats de modèles IA
resume-fr: À utiliser quand vous avez besoin de générer des contenus visuels, sonores ou vidéo. Cette compétence permet d'explorer, de comparer et d'exécuter divers modèles d'intelligence artificielle pour automatiser vos créations multimédias.
---

# replicate

> Curated from Replicate.

## What it does

Discover, compare, and run AI models using Replicate's API. Strong fit for image, audio, and video generation pipelines that swap models frequently.

## Source

- Upstream: https://github.com/replicate/skills
- Category: `image-generation`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/replicate/skills
```

Then ask the agent to invoke this skill by name (`replicate`) or with
one of the trigger phrases listed in this skill's frontmatter.
