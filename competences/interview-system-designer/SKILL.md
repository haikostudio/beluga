---
name: interview-system-designer
description: "Use when designing a hiring loop, competency matrix, scoring rubric or question bank, or checking interviewer calibration. Plans the loop per role with interview_planner.py."
themes: programmation, ressources-humaines, architecture
symptomes: créer un parcours de recrutement, définir une grille d'évaluation, préparer des questions d'entretien, harmoniser les critères de sélection, réduire les biais de recrutement, organiser les étapes d'embauche
resume-fr: À utiliser quand vous devez structurer un processus de recrutement pour un poste spécifique. Cette compétence aide à définir les étapes des entretiens, à créer des grilles d'évaluation standardisées et à garantir la cohérence des décisions entre les recruteurs.
---

# Interview System Designer

Comprehensive interview loop planning and calibration support for role-based hiring systems.

## Overview

Use this skill to create structured interview loops, standardize question quality, and keep hiring signal consistent across interviewers.

## Core Capabilities

- Interview loop planning by role and level
- Round-by-round focus and timing recommendations
- Suggested question sets by round type
- Framework support for scoring and calibration
- Bias-reduction and process consistency guidance

## Quick Start

```bash
# Generate a loop plan for a role and level
python3 scripts/interview_planner.py --role "Senior Software Engineer" --level senior

# JSON output for integration with internal tooling
python3 scripts/interview_planner.py --role "Product Manager" --level mid --json
```

## Recommended Workflow

1. Run `scripts/interview_planner.py` to generate a baseline loop.
2. Align rounds to role-specific competencies.
3. Validate scoring rubric consistency with interview panel leads.
4. Review for bias controls before rollout.
5. Recalibrate quarterly using hiring outcome data.

## References

- `references/interview-frameworks.md`
- `references/bias_mitigation_checklist.md`
- `references/competency_matrix_templates.md`
- `references/debrief_facilitation_guide.md`

## Common Pitfalls

- Overweighting one round while ignoring other competency signals
- Using unstructured interviews without standardized scoring
- Skipping calibration sessions for interviewers
- Changing hiring bar without documenting rationale

## Best Practices

1. Keep round objectives explicit and non-overlapping.
2. Require evidence for each score recommendation.
3. Use the same baseline rubric across comparable roles.
4. Revisit loop design based on quality-of-hire outcomes.
