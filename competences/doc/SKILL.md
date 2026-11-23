---
name: doc
description: |
  Read, create, and edit .docx documents with formatting and layout fidelity via OpenAI's document skill.
triggers:
  - "openai doc"
  - "docx fidelity"
  - "word doc edit"
  - "layout doc"
od:
  mode: prototype
  category: documents
  upstream: "https://github.com/openai/skills"
symptomes: créer un nouveau document Word, modifier le contenu d'un fichier docx, extraire le texte d'un document, mettre en forme un rapport, générer un compte rendu de réunion, éditer un document existant
resume-fr: À utiliser quand vous devez générer, modifier ou lire des fichiers texte au format Word. Cette compétence permet de manipuler vos documents tout en préservant leur mise en page et leur structure d'origine.
---

# doc

> Curated from OpenAI's skills repository.

## What it does

Read, create, and edit .docx documents with formatting and layout fidelity via OpenAI's document skill.

## Source

- Upstream: https://github.com/openai/skills
- Category: `documents`

## How to use

This catalogue entry advertises the skill in OpenDesign so the agent
discovers it during planning. To run the full upstream workflow with
its original assets, scripts, and references, install the upstream
bundle into your active agent's skills directory:

```bash
# Inspect the upstream README for exact paths
open https://github.com/openai/skills
```

Then ask the agent to invoke this skill by name (`doc`) or with
one of the trigger phrases listed in this skill's frontmatter.
