---
name: design-md
description: |
  Create and manage DESIGN.md files. Useful for capturing design direction, tokens, and visual rules in a single source of truth.
triggers:
  - "design.md"
  - "design doc"
  - "design tokens doc"
  - "visual rules doc"
od:
  mode: design-system
  category: design-systems
  upstream: "https://github.com/google-labs-code/skills"
symptomes: créer un fichier de design, documenter les règles graphiques, gérer les jetons de style, centraliser les choix visuels, créer une source de vérité design, organiser les directives visuelles
resume-fr: À utiliser quand vous devez centraliser les règles visuelles et les composants graphiques d'un projet. Cette compétence permet de créer et de maintenir un fichier de référence unique pour documenter les choix de design et les jetons de style.
---

# design-md

> Curated from Google Labs (Stitch).

## What it does

Create and manage DESIGN.md files. Useful for capturing design direction, tokens, and visual rules in a single source of truth.

## Source

- Upstream: https://github.com/google-labs-code/skills
- Category: `design-systems`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/google-labs-code/skills
```

Then ask the agent to invoke this skill by name (`design-md`) or with
one of the trigger phrases listed in this skill's frontmatter.
