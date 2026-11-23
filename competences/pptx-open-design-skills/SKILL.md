---
name: pptx-open-design-skills
description: |
  Read, generate, and adjust PowerPoint slides, layouts, and templates. Useful for executive decks, training material, and product reviews.
triggers:
  - "pptx"
  - "powerpoint"
  - "slide deck"
  - "create slides"
  - "edit pptx"
od:
  mode: deck
  category: slides
  upstream: "https://github.com/anthropics/skills/tree/main/skills/pptx"
symptomes: créer une présentation pour une réunion, modifier la mise en page des diapositives, générer un support de formation, ajuster le design d'un diaporama, préparer une revue de projet, créer un modèle de présentation
resume-fr: À utiliser quand vous devez créer ou modifier des présentations PowerPoint. Cette compétence permet de générer des diapositives, d'ajuster les mises en page et de personnaliser des modèles pour vos documents professionnels.
---

# pptx

> Curated from Anthropic's official skills repository.

## What it does

Read, generate, and adjust PowerPoint slides, layouts, and templates. Useful for executive decks, training material, and product reviews.

## Source

- Upstream: https://github.com/anthropics/skills/tree/main/skills/pptx
- Category: `slides`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/anthropics/skills/tree/main/skills/pptx
```

Then ask the agent to invoke this skill by name (`pptx`) or with
one of the trigger phrases listed in this skill's frontmatter.
