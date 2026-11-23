---
name: frontend-slides
description: |
  Generate animation-rich HTML presentations with visual style previews. Useful for online keynotes, embedded talks, and interactive briefs.
triggers:
  - "html slides"
  - "animation slides"
  - "interactive deck"
  - "web ppt"
  - "reveal slides"
od:
  mode: deck
  category: slides
  upstream: "https://github.com/zarazhangrui/frontend-slides"
  craft:
    requires:
      - typography
symptomes: créer une présentation animée, faire un support de conférence, préparer un diaporama interactif, générer des slides en HTML, concevoir un support visuel dynamique, présenter un projet avec des animations
resume-fr: À utiliser quand vous devez concevoir une présentation dynamique et visuelle pour un exposé ou un compte-rendu. Cette compétence génère des diapositives HTML animées avec un aperçu du style graphique.
---

# frontend-slides

> Curated from @zarazhangrui.

## What it does

Generate animation-rich HTML presentations with visual style previews. Useful for online keynotes, embedded talks, and interactive briefs.

## Source

- Upstream: https://github.com/zarazhangrui/frontend-slides
- Category: `slides`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/zarazhangrui/frontend-slides
```

Then ask the agent to invoke this skill by name (`frontend-slides`) or with
one of the trigger phrases listed in this skill's frontmatter.
