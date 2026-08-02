import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_MOVABLE_COLUMNS,
  COLUMN_KEYS,
  ColumnKey,
  canMove,
  checkTemplate,
  extractEvolutions,
  templateForColumn,
  wrapPrompt,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Règles de déplacement des cartes (PLAN §4)                          */
/* ------------------------------------------------------------------ */

test('un agent ne peut déplacer une carte que vers notes ou à faire', () => {
  for (const target of COLUMN_KEYS) {
    const decision = canMove('agent', 'todo', target);
    if (AGENT_MOVABLE_COLUMNS.includes(target) || target === 'todo') {
      assert.equal(decision.allowed, true, `${target} devrait être autorisée`);
    } else {
      assert.equal(decision.allowed, false, `${target} devrait être refusée`);
      assert.ok(decision.reason, 'un refus doit être expliqué');
    }
  }
});

test('un agent ne peut pas sortir une carte du pipeline', () => {
  const decision = canMove('agent', 'running', 'todo');
  assert.equal(decision.allowed, false);
});

test('la validation reste un geste humain : la machine ne touche pas « à faire »', () => {
  assert.equal(canMove('machine', 'todo', 'planned').allowed, false);
  assert.equal(canMove('machine', 'validated', 'planned').allowed, true);
  assert.equal(canMove('machine', 'planned', 'running').allowed, true);
});

test('la machine ne peut pas promouvoir vers validé, terminé ou à déployer', () => {
  for (const target of ['validated', 'done', 'to_deploy'] as ColumnKey[]) {
    assert.equal(canMove('machine', 'planned', target).allowed, false);
  }
});

test("l'utilisateur peut tout déplacer", () => {
  for (const from of COLUMN_KEYS) {
    for (const to of COLUMN_KEYS) {
      assert.equal(canMove('user', from, to).allowed, true);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Choix du gabarit (PLAN §9)                                          */
/* ------------------------------------------------------------------ */

test('le gabarit dépend de la colonne', () => {
  assert.equal(templateForColumn('validated'), 'pre_run');
  assert.equal(templateForColumn('planned'), 'pre_run');
  assert.equal(templateForColumn('running'), 'in_run');
  assert.equal(templateForColumn('done'), 'in_run');
  assert.equal(templateForColumn('to_deploy'), 'in_run');
  assert.equal(templateForColumn('todo'), 'free');
  assert.equal(templateForColumn(undefined), 'free');
  assert.equal(templateForColumn('running', true), 'deploy');
});

test("une carte qui n'a rien exécuté n'a pas le droit d'écrire « ce qui est fait »", () => {
  const prompt = wrapPrompt('pre_run', 'Ajoute un bouton');
  assert.match(prompt, /Interdit d'écrire « Ce qui est fait »/);
  assert.match(prompt, /Analyse de la demande/);
  assert.doesNotMatch(prompt.split('FORME DE TA RÉPONSE')[1] ?? '', /^## 1\. Ce qui est fait/m);
});

test('le gabarit d\'analyse réclame des chiffres exploitables', () => {
  const prompt = wrapPrompt('pre_run', 'Refonte du tableau');
  assert.match(prompt, /machineSeconds/);
  assert.match(prompt, /seniorHours/);
  assert.match(prompt, /Ne confonds JAMAIS les deux/);
});

test('le chef d\'orchestre ne reçoit aucun gabarit', () => {
  const prompt = wrapPrompt('none', 'Bonjour');
  assert.equal(prompt, 'Bonjour');
});

test('le contrôle de forme repère une réponse hors format', () => {
  const good = '## 1. Ce qui est fait\n## 2. Ce qui change\n## 3. Impact\n## 4. Évolutions possibles';
  assert.equal(checkTemplate('in_run', good).ok, true);

  const bad = '## 1. Ce qui est fait\n## 2. Bla';
  const result = checkTemplate('in_run', bad);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('Impact'));
});

test('un journal de publication ne finit pas par une ligne de facture', () => {
  const prompt = wrapPrompt('deploy', 'Publie le lot');
  assert.match(prompt, /Interdit de terminer par une ligne de facture/);
});

/* ------------------------------------------------------------------ */
/* Évolutions cliquables (PLAN §15)                                    */
/* ------------------------------------------------------------------ */

test('les suggestions sont extraites de la section « Évolutions possibles »', () => {
  const text = `## 3. Impact
- Un point qui ne compte pas

## 4. Évolutions possibles
- Ajouter un filtre par étiquette
- **Exporter** le tableau en PDF

## 5. Activation & facturation
- Rien ici`;
  const items = extractEvolutions(text);
  assert.deepEqual(items, ['Ajouter un filtre par étiquette', 'Exporter le tableau en PDF']);
});
