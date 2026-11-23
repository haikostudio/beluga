---
name: slack-gif-creator
description: |
  Create animated GIFs optimized for Slack with validators for size constraints and composable animation primitives.
triggers:
  - "slack gif"
  - "animated gif"
  - "reaction gif"
  - "tiny gif"
od:
  mode: image
  category: image-generation
  upstream: "https://github.com/anthropics/skills/tree/main/skills/slack-gif-creator"
symptomes: créer un gif pour slack, faire une animation légère, compresser une image animée, générer un gif compatible, animer une image pour le chat
resume-fr: À utiliser quand vous avez besoin de créer des animations légères adaptées aux échanges sur Slack. Cette compétence génère des fichiers GIF optimisés en respectant les contraintes de taille imposées par la plateforme.
---

# slack-gif-creator

> Curated from Anthropic's official skills repository.

## What it does

Create animated GIFs optimized for Slack with validators for size constraints and composable animation primitives.

## Source

- Upstream: https://github.com/anthropics/skills/tree/main/skills/slack-gif-creator
- Category: `image-generation`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/anthropics/skills/tree/main/skills/slack-gif-creator
```

Then ask the agent to invoke this skill by name (`slack-gif-creator`) or with
one of the trigger phrases listed in this skill's frontmatter.
