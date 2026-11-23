---
name: figma-generate-library
description: |
  Build or update a professional-grade design system library in Figma from a codebase. Useful for keeping the Figma source of truth in sync with shipped components.
triggers:
  - "figma library"
  - "design system library"
  - "figma from codebase"
  - "sync figma"
od:
  mode: design-system
  category: figma
  upstream: "https://github.com/figma/skills"
symptomes: synchroniser Figma avec mon code, mettre à jour le design system, importer mes composants dans Figma, aligner les maquettes sur le développement, créer une bibliothèque depuis le code, maintenir la cohérence du design system
resume-fr: À utiliser quand vous souhaitez aligner vos maquettes Figma avec le code réel de votre application. Cette compétence génère ou met à jour automatiquement une bibliothèque de composants professionnels pour garantir que votre design system reste parfaitement synchronisé avec le développement.
---

# figma-generate-library

> Curated from Figma's MCP server guide.

## What it does

Build or update a professional-grade design system library in Figma from a codebase. Useful for keeping the Figma source of truth in sync with shipped components.

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

Then ask the agent to invoke this skill by name (`figma-generate-library`) or with
one of the trigger phrases listed in this skill's frontmatter.
