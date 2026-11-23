---
name: hand-drawn-diagrams
description: |
  Generate hand-drawn Excalidraw diagrams from a prompt — animated SVG, hosted edit link, and PNG export. Works with Claude Code, Codex, Gemini CLI, and any agent supporting standard skill paths.
triggers:
  - "excalidraw"
  - "hand drawn diagram"
  - "sketch diagram"
  - "whiteboard diagram"
od:
  mode: prototype
  category: diagrams
  upstream: "https://github.com/muthuishere/hand-drawn-diagrams"
symptomes: créer un schéma explicatif, illustrer mon architecture technique, faire un dessin de processus, générer un diagramme style croquis, visualiser le flux de données, besoin d'un schéma rapide
resume-fr: À utiliser quand vous avez besoin de visualiser un concept ou un processus sous forme de schéma. Cette compétence génère automatiquement des diagrammes au style dessiné à la main, exportables en image ou en format vectoriel animé.
---

# hand-drawn-diagrams

> Curated from @muthuishere.

## What it does

Generate hand-drawn Excalidraw diagrams from a prompt — animated SVG, hosted edit link, and PNG export. Works with Claude Code, Codex, Gemini CLI, and any agent supporting standard skill paths.

## Source

- Upstream: https://github.com/muthuishere/hand-drawn-diagrams
- Category: `diagrams`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/muthuishere/hand-drawn-diagrams
```

Then ask the agent to invoke this skill by name (`hand-drawn-diagrams`) or with
one of the trigger phrases listed in this skill's frontmatter.
