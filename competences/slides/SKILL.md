---
name: slides
description: |
  Create and edit .pptx presentation decks with PptxGenJS. Useful for sales decks, kickoff briefs, and design-system showcases.
triggers:
  - "slides"
  - "pptxgenjs"
  - "sales deck"
  - "design showcase deck"
od:
  mode: deck
  category: slides
  upstream: "https://github.com/openai/skills"
  craft:
    requires:
      - typography
symptomes: créer une présentation commerciale, faire un support de réunion, générer un fichier pptx, préparer un diaporama de projet, éditer mes slides de présentation
resume-fr: À utiliser quand vous devez concevoir ou modifier une présentation au format PowerPoint. Cette compétence permet de générer automatiquement des diapositives structurées pour vos supports de vente, vos réunions de lancement ou vos présentations de projets.
---

# slides

> Curated from OpenAI's skills repository.

## What it does

Create and edit .pptx presentation decks with PptxGenJS. Useful for sales decks, kickoff briefs, and design-system showcases.

## Source

- Upstream: https://github.com/openai/skills
- Category: `slides`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/openai/skills
```

Then ask the agent to invoke this skill by name (`slides`) or with
one of the trigger phrases listed in this skill's frontmatter.
