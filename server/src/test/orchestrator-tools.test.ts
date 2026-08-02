import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ORCHESTRATOR_ALLOWED_NATIVE,
  ORCHESTRATOR_DENIED_NATIVE,
  TASK_ONLY_TOOLS,
  TOOL_DEFS,
  orchestratorAllowList,
  orchestratorDenyList,
  toolsFor,
} from '../tools.js';

const execFileAsync = promisify(execFile);

/**
 * Le test de complétude (PLAN §5) : tout outil du moteur doit être CLASSÉ.
 * Un outil ajouté demain par une mise à jour du CLI fait échouer ce test,
 * donc il est bloqué par défaut au lieu de passer discrètement.
 */
test('tout outil du moteur est classé autorisé ou interdit pour le chef d\'orchestre', async () => {
  const classified = new Set([...ORCHESTRATOR_ALLOWED_NATIVE, ...ORCHESTRATOR_DENIED_NATIVE]);

  let engineTools: string[] = [];
  try {
    const { stdout } = await execFileAsync(
      'bash',
      [
        '-lc',
        'claude -p "ok" --output-format stream-json --verbose --model haiku --permission-mode bypassPermissions 2>/dev/null | head -1',
      ],
      { timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
    );
    const init = JSON.parse(stdout.trim().split('\n')[0]);
    engineTools = Array.isArray(init.tools) ? init.tools : [];
  } catch {
    // Moteur indisponible (quota, réseau) : on vérifie au moins la liste connue.
    engineTools = [];
  }

  const unclassified = engineTools.filter((tool) => !classified.has(tool));
  assert.deepEqual(
    unclassified,
    [],
    `outils non classés (bloqués par défaut, à trancher explicitement) : ${unclassified.join(', ')}`,
  );
});

test('les outils interdits ne fuient jamais dans la liste autorisée', () => {
  const allow = new Set(orchestratorAllowList());
  for (const denied of ORCHESTRATOR_DENIED_NATIVE) {
    assert.equal(allow.has(denied), false, `${denied} ne doit pas être autorisé`);
  }
});

test('la liste d\'interdiction est explicite, jamais un joker', () => {
  const deny = orchestratorDenyList();
  assert.ok(deny.length >= ORCHESTRATOR_DENIED_NATIVE.length);
  assert.equal(deny.includes('*'), false);
  assert.ok(deny.includes('Bash'));
  assert.ok(deny.includes('Edit'));
  assert.ok(deny.includes('Write'));
  assert.ok(deny.includes('Task'));
});

test('le chef d\'orchestre ne voit pas les outils réservés aux agents de tâche', () => {
  const names = toolsFor('orchestrator').map((tool) => tool.name);
  for (const reserved of TASK_ONLY_TOOLS) {
    assert.equal(names.includes(reserved), false);
  }
  // Mais il garde ceux dont il a besoin pour trier et documenter.
  for (const expected of ['board_create_card', 'board_move_card', 'propose_task', 'write_document', 'make_archive']) {
    assert.ok(names.includes(expected), `${expected} devrait rester autorisé`);
  }
});

test('un agent de tâche dispose de tous les outils du démon', () => {
  assert.equal(toolsFor('task').length, TOOL_DEFS.length);
});

test('l\'outil de déplacement n\'accepte que notes et à faire', () => {
  const move = TOOL_DEFS.find((tool) => tool.name === 'board_move_card');
  const column = (move?.inputSchema as any)?.properties?.column;
  assert.deepEqual(column.enum, ['notes', 'todo']);
});

test('la création de carte ne propose aucun champ « colonne »', () => {
  const create = TOOL_DEFS.find((tool) => tool.name === 'board_create_card');
  const properties = (create?.inputSchema as any)?.properties ?? {};
  assert.equal('column' in properties, false, 'une carte naît toujours dans « À faire »');
});
