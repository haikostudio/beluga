---
name: figma-create-new-file
description: |
  Create a new blank Figma Design or FigJam file. Useful as the first step in scripted design-system or workshop workflows.
triggers:
  - "figma new file"
  - "figjam new"
  - "create figma file"
od:
  mode: design-system
  category: figma
  upstream: "https://github.com/figma/skills"
symptomes: créer un nouveau fichier design, ouvrir un tableau blanc FigJam, lancer un nouveau projet Figma, préparer un espace pour un atelier, démarrer un nouveau document de travail
resume-fr: À utiliser quand vous devez démarrer un nouveau projet de design ou un atelier collaboratif. Cette compétence génère automatiquement un fichier vierge dans Figma ou FigJam pour lancer votre espace de travail.
---

# figma-create-new-file

> Curated from Figma's MCP server guide.

## What it does

Create a new blank Figma Design or FigJam file. Useful as the first step in scripted design-system or workshop workflows.

## Source

- Upstream: https://github.com/figma/skills
- Category: `figma`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/figma/skills
```

Then ask the agent to invoke this skill by name (`figma-create-new-file`) or with
one of the trigger phrases listed in this skill's frontmatter.
