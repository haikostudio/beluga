---
name: docx-open-design-skills
description: |
  Create, edit, and analyze Word documents with tracked changes, comments, and formatting. Useful for design briefs, copy docs, and review-ready deliverables.
triggers:
  - "docx"
  - "word document"
  - "tracked changes"
  - "design brief doc"
  - "copy doc"
od:
  mode: prototype
  category: documents
  upstream: "https://github.com/anthropics/skills/tree/main/skills/docx"
symptomes: créer un brief de design, relire un document avec des commentaires, intégrer des modifications suivies, mettre en forme un rapport, analyser un document Word, préparer un livrable final
resume-fr: À utiliser quand vous devez créer, modifier ou analyser un document Word. Cette compétence permet de gérer le suivi des modifications, les commentaires et la mise en forme pour vos documents de travail ou livrables.
---

# docx

> Curated from Anthropic's official skills repository.

## What it does

Create, edit, and analyze Word documents with tracked changes, comments, and formatting. Useful for design briefs, copy docs, and review-ready deliverables.

## Source

- Upstream: https://github.com/anthropics/skills/tree/main/skills/docx
- Category: `documents`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/anthropics/skills/tree/main/skills/docx
```

Then ask the agent to invoke this skill by name (`docx`) or with
one of the trigger phrases listed in this skill's frontmatter.
