---
name: venice-image-generate
description: |
  Image generation endpoints and available styles via the Venice.ai API.
triggers:
  - "venice image"
  - "venice generate"
  - "venice ai image"
od:
  mode: image
  category: image-generation
  upstream: "https://github.com/veniceai/skills"
symptomes: générer une image pour mon article, créer un visuel pour les réseaux sociaux, illustrer mon idée avec une image, besoin d'une image personnalisée, créer un logo rapidement, générer une image de paysage
resume-fr: À utiliser quand vous avez besoin de créer des visuels originaux à partir d'une description textuelle. Cette compétence permet de générer des images personnalisées en utilisant les styles et les outils de l'API Venice.
---

# venice-image-generate

> Curated from the Venice.ai team.

## What it does

Image generation endpoints and available styles via the Venice.ai API.

## Source

- Upstream: https://github.com/veniceai/skills
- Category: `image-generation`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/veniceai/skills
```

Then ask the agent to invoke this skill by name (`venice-image-generate`) or with
one of the trigger phrases listed in this skill's frontmatter.
