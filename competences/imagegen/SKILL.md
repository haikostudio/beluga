---
name: imagegen
description: |
  Generate and edit images using OpenAI's Image API for project assets — UI mockups, icons, illustrations, social cards, and visual references.
triggers:
  - "generate image"
  - "create image"
  - "image gen"
  - "openai image"
  - "icon design"
  - "mockup"
od:
  mode: image
  category: image-generation
  upstream: "https://github.com/openai/skills"
symptomes: créer une icône pour mon application, générer une illustration pour un article, concevoir une maquette d'interface utilisateur, créer un visuel pour les réseaux sociaux, besoin d'une image de référence, générer des assets graphiques pour mon projet
resume-fr: À utiliser quand vous avez besoin de créer ou de modifier des visuels pour vos projets. Cette compétence génère des images sur mesure comme des maquettes d'interface, des icônes, des illustrations ou des visuels pour les réseaux sociaux.
---

# imagegen

> Curated from OpenAI's skills repository.

## What it does

Generate and edit images using OpenAI's Image API for project assets — UI mockups, icons, illustrations, social cards, and visual references.

## Source

- Upstream: https://github.com/openai/skills
- Category: `image-generation`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/openai/skills
```

Then ask the agent to invoke this skill by name (`imagegen`) or with
one of the trigger phrases listed in this skill's frontmatter.
