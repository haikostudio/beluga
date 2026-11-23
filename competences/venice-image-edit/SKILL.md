---
name: venice-image-edit
description: |
  Image edits, upscaling, and background removal via the Venice.ai API.
triggers:
  - "venice image edit"
  - "venice upscale"
  - "venice background removal"
od:
  mode: image
  category: image-generation
  upstream: "https://github.com/veniceai/skills"
symptomes: enlever le fond de cette photo, agrandir la résolution de mon image, améliorer la qualité de ce visuel, détourer cet objet sur la photo, retoucher cette image rapidement, supprimer l'arrière-plan de mon fichier
resume-fr: À utiliser quand vous avez besoin de modifier une image existante. Cette compétence permet d'agrandir la résolution, de supprimer un arrière-plan ou d'effectuer des retouches visuelles précises.
---

# venice-image-edit

> Curated from the Venice.ai team.

## What it does

Image edits, upscaling, and background removal via the Venice.ai API.

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

Then ask the agent to invoke this skill by name (`venice-image-edit`) or with
one of the trigger phrases listed in this skill's frontmatter.
