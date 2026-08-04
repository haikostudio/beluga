import test from 'node:test';
import assert from 'node:assert/strict';
import { rolePrompt } from '../runtime.js';

/* ------------------------------------------------------------------ */
/* Le déroulé est le MÊME pour Codex et pour Claude                     */
/* ------------------------------------------------------------------ */

/*
 * HaikoDev impose le processus ; le moteur ne fait que l'exécuter. Ces contrôles
 * garantissent qu'à rôle égal, les deux moteurs reçoivent EXACTEMENT le même
 * déroulé — seul le nom de l'outil de liste, propre à chaque moteur, diffère.
 */

const ROLES = ['orchestrator', 'analysis', 'deploy', 'task'] as const;

/** On retire la seule ligne qui nomme l'outil : le reste doit être identique. */
function sansLigneOutil(prompt: string): string {
  return prompt
    .split('\n')
    .filter((l) => !l.startsWith("1. AVANT d'agir, annonce ta liste de tâches"))
    .join('\n');
}

test('à rôle égal, le déroulé de Codex et de Claude est identique (hors nom d’outil)', () => {
  for (const role of ROLES) {
    const claude = rolePrompt(role, false, 'claude');
    const codex = rolePrompt(role, false, 'codex');
    assert.equal(
      sansLigneOutil(codex),
      sansLigneOutil(claude),
      `Le déroulé diffère entre les moteurs pour le rôle « ${role} »`,
    );
  }
});

test('chaque moteur ne se voit nommer QUE son propre outil de liste', () => {
  const claude = rolePrompt('task', false, 'claude');
  const codex = rolePrompt('task', false, 'codex');

  assert.match(claude, /TaskCreate/);
  assert.match(claude, /TaskUpdate/);
  assert.doesNotMatch(claude, /update_plan/);

  assert.match(codex, /update_plan/);
  assert.doesNotMatch(codex, /TaskCreate/);
  assert.doesNotMatch(codex, /TaskUpdate/);
});

test('les règles de déroulé communes sont présentes dans les deux', () => {
  for (const engine of ['claude', 'codex'] as const) {
    const p = rolePrompt('task', false, engine);
    assert.match(p, /DÉROULÉ VISIBLE/);
    assert.match(p, /Une seule ligne en cours à la fois/);
    assert.match(p, /coche-la dès qu'elle est terminée/);
  }
});

test('sans moteur précisé, le déroulé reste celui de Claude (valeur par défaut sûre)', () => {
  assert.equal(rolePrompt('task', false), rolePrompt('task', false, 'claude'));
});
