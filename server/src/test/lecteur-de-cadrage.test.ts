import test from 'node:test';
import assert from 'node:assert/strict';
import { decouperAvantLePlan, planDeCadrageRendu, questionAMontrer } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LE LECTEUR DE L'HISTOIRE : les plans écrits EN CLAIR, avant l'outil  */
/* ------------------------------------------------------------------ */

const PLAN_EN_CLAIR = `Voici ce que j'ai compris.

# Rendre sticky un élément

_Un élément qui reste en haut._

## Faisabilité

Oui.

## Chemin à suivre

1. Repérer.
2. Appliquer.

## Conséquences

Visible.

## Améliorations apportées

- Lisibilité.`;

test('un plan écrit en clair par un cadrage d’avant est reconnu, sans mode plan', () => {
  assert.equal(planDeCadrageRendu({ role: 'assistant', content: PLAN_EN_CLAIR }), true);
  assert.equal(planDeCadrageRendu({ role: 'assistant', content: 'Compris.' }), false);
  // Un tour qui écrit encore n'est pas un plan rendu.
  assert.equal(planDeCadrageRendu({ role: 'assistant', content: PLAN_EN_CLAIR, streaming: true }), false);
  assert.equal(planDeCadrageRendu({ role: 'user', content: PLAN_EN_CLAIR }), false);
  // Le drapeau du mode plan suffit, sans juger le texte deux fois.
  assert.equal(planDeCadrageRendu({ role: 'assistant', content: 'v1', plan: true }), true);
});

test('le plan se coupe à son titre : ce qui le précède reste à part', () => {
  const { avant, plan } = decouperAvantLePlan(PLAN_EN_CLAIR);
  assert.equal(avant, "Voici ce que j'ai compris.");
  assert.ok(plan.startsWith('# Rendre sticky'));
  assert.ok(plan.includes('## Améliorations apportées'));
});

test('un plan de la forme NEUVE se coupe aussi à son titre, bloc des tâches compris', () => {
  const neuf = `Voici ce que j'ai compris.

# Rendre sticky un élément

## Liste des tâches

**Poser la règle**
Ajouter la position collante.

**Vérifier le défilement**
Le parent ne doit pas couper le collage.

## Faisabilité

Oui.

## Chemin à suivre

1. Repérer.
2. Appliquer.

## Conséquences

Visible.

## Améliorations apportées

- Lisibilité.`;
  const { avant, plan } = decouperAvantLePlan(neuf);
  assert.equal(avant, "Voici ce que j'ai compris.");
  assert.ok(plan.startsWith('# Rendre sticky'), plan.slice(0, 60));
  assert.ok(plan.includes('## Liste des tâches'));
  assert.ok(plan.includes('**Poser la règle**'));
});

test('un texte sans plan rend tout dans « avant »', () => {
  const { avant, plan } = decouperAvantLePlan('Juste une phrase.');
  assert.equal(avant, 'Juste une phrase.');
  assert.equal(plan, '');
});

/* ------------------------------------------------------------------ */
/* Le carrousel des questions                                          */
/* ------------------------------------------------------------------ */

test('le carrousel montre la première question sans réponse', () => {
  assert.equal(questionAMontrer({ repondues: [true, false, false] }), 1);
  assert.equal(questionAMontrer({ repondues: [false, false] }), 0);
});

test('toutes répondues : on reste sur la dernière, jamais dans le vide', () => {
  assert.equal(questionAMontrer({ repondues: [true, true] }), 1);
  assert.equal(questionAMontrer({ repondues: [] }), 0);
});

test('un choix manuel l’emporte, tant qu’il reste dans le lot', () => {
  assert.equal(questionAMontrer({ repondues: [false, false, false], choisie: 2 }), 2);
  assert.equal(questionAMontrer({ repondues: [false, false], choisie: 7 }), 0);
});
