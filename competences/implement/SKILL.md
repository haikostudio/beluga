---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
symptomes: coder cette nouvelle fonctionnalité, implémenter le ticket numéro 42, développer selon le cahier des charges, réaliser les tâches du sprint, écrire le code pour ce ticket, finaliser le développement de la fonctionnalité
resume-fr: À utiliser quand vous avez une spécification ou des tickets techniques à transformer en code fonctionnel. Cette compétence automatise le développement, l'exécution des tests, la vérification du typage et la soumission de votre travail pour une relecture.
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, call the Skill tool with "code-review" to review the work.

Commit your work to the current branch.
