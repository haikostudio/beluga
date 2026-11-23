---
name: runbook-generator
description: "Use when a service needs runbooks for deploy, incident response, maintenance or rollback, before launch. Generates them per environment with runbook_generator.py."
themes: programmation, serveur, documents
symptomes: créer une procédure de déploiement, standardiser nos documents techniques, rédiger un guide pour les astreintes, générer une documentation pour mon service, harmoniser les manuels d'exploitation, préparer le runbook d'un nouveau projet
resume-fr: À utiliser quand vous devez créer ou uniformiser la documentation opérationnelle d'un service. Cette compétence génère automatiquement une structure standardisée pour vos procédures de déploiement, de maintenance et de gestion d'incidents.
---

# Runbook Generator

**Tier:** POWERFUL  
**Category:** Engineering  
**Domain:** DevOps / Site Reliability Engineering

---

## Overview

Generate operational runbooks quickly from a service name, then customize for deployment, incident response, maintenance, and rollback workflows.

## Core Capabilities

- Runbook skeleton generation from a CLI
- Standard sections for start/stop/health/rollback
- Structured escalation and incident handling placeholders
- Reference templates for deployment and incident playbooks

---

## When to Use

- A service has no runbook and needs a baseline immediately
- Existing runbooks are inconsistent across teams
- On-call onboarding requires standardized operations docs
- You need repeatable runbook scaffolding for new services

---

## Quick Start

```bash
# Print runbook to stdout
python3 scripts/runbook_generator.py payments-api

# Write runbook file
python3 scripts/runbook_generator.py payments-api --owner platform --output docs/runbooks/payments-api.md
```

---

## Recommended Workflow

1. Generate the initial skeleton with `scripts/runbook_generator.py`.
2. Fill in service-specific commands and URLs.
3. Add verification checks and rollback triggers.
4. Dry-run in staging.
5. Store runbook in version control near service code.

---

## Reference Docs

- `references/runbook-templates.md`

---

## Common Pitfalls

- Missing rollback triggers or rollback commands
- Steps without expected output checks
- Stale ownership/escalation contacts
- Runbooks never tested outside of incidents

## Best Practices

1. Keep every command copy-pasteable.
2. Include health checks after every critical step.
3. Validate runbooks on a fixed review cadence.
4. Update runbook content after incidents and postmortems.
