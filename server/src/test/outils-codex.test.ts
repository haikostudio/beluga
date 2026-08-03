import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexArgs, emitFromCodex, explainToolFailure } from '../engines/codex.js';
import { EngineEvent } from '../engines/types.js';

const BRIDGE = '/opt/haikodev/server/mcp-bridge.mjs';

function args(extra: Partial<Parameters<typeof buildCodexArgs>[0]> = {}): string[] {
  return buildCodexArgs({
    cwd: '/root/projet',
    prompt: 'bonjour',
    fullAccess: false,
    mcpConfigPath: '/var/log/haikodev/mcp-a1.json',
    mcpBridgePath: BRIDGE,
    env: { HAIKODEV_TOKEN: 'jeton', HAIKODEV_URL: 'http://127.0.0.1:7070', HAIKODEV_AGENT: 'a1' },
    onEvent: () => {},
    ...extra,
  } as any);
}

/** Le défaut d'origine : Codex recevait le fichier de configuration de Claude
 *  Code (« node mcp-a1.json »), qui sort aussitôt — donc AUCUN outil. */
test('Codex lance le pont d\'outils, jamais le fichier de configuration', () => {
  const line = args().join(' ');
  assert.ok(line.includes(BRIDGE), 'le chemin du pont doit être passé à Codex');
  assert.ok(!line.includes('mcp-a1.json'), 'le fichier de configuration de Claude Code n\'a rien à faire ici');
  assert.ok(line.includes(`mcp_servers.haikodev.command=${JSON.stringify(process.execPath)}`));
  assert.ok(line.includes(`mcp_servers.haikodev.args=["${BRIDGE}"]`));
});

/** Sans ce mode, chaque appel demande une approbation que personne ne donne :
 *  Codex rend « user cancelled MCP tool call » et la carte n'est jamais proposée. */
test('les outils du projet sont approuvés d\'avance, même en lecture seule', () => {
  for (const options of [{}, { fullAccess: true }, { sessionId: 'fil-1' }]) {
    const line = args(options).join(' ');
    assert.ok(
      line.includes('mcp_servers.haikodev.default_tools_approval_mode="approve"'),
      `mode d'approbation manquant pour ${JSON.stringify(options)}`,
    );
    assert.ok(line.includes(BRIDGE), `pont manquant pour ${JSON.stringify(options)}`);
  }
});

test('le jeton, l\'adresse et l\'agent voyagent avec le pont', () => {
  const line = args().join(' ');
  assert.ok(line.includes('mcp_servers.haikodev.env.HAIKODEV_TOKEN="jeton"'));
  assert.ok(line.includes('mcp_servers.haikodev.env.HAIKODEV_URL="http://127.0.0.1:7070"'));
  assert.ok(line.includes('mcp_servers.haikodev.env.HAIKODEV_AGENT="a1"'));
});

test('sans pont annoncé, aucune ligne de serveur d\'outils', () => {
  const line = args({ mcpBridgePath: undefined }).join(' ');
  assert.ok(!line.includes('mcp_servers.haikodev'));
});

/** Une étape rouge sans explication laissait « 1 en échec » sans dire pourquoi. */
test('un appel d\'outil non abouti dit sa raison en clair', () => {
  const events: EngineEvent[] = [];
  emitFromCodex(
    {
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'mcp_tool_call',
        tool: 'board_create_card',
        arguments: { title: 'essai' },
        status: 'failed',
        error: { message: 'user cancelled MCP tool call' },
      },
    },
    (e) => events.push(e),
  );
  const step = events[0]?.step;
  assert.equal(step?.state, 'failed');
  assert.ok(step?.label.includes('non aboutie'));
  assert.ok(/refusé/i.test(step?.detail ?? ''), 'la raison doit être écrite dans le détail');
});

test('un appel d\'outil réussi reste une étape normale', () => {
  const events: EngineEvent[] = [];
  emitFromCodex(
    {
      type: 'item.completed',
      item: { id: 'item_1', type: 'mcp_tool_call', tool: 'project_memory', arguments: { sujet: 'codex' }, status: 'completed' },
    },
    (e) => events.push(e),
  );
  assert.equal(events[0]?.step?.state, 'done');
  assert.ok(!events[0]?.step?.label.includes('non aboutie'));
});

test('une panne sans message reste dite, jamais muette', () => {
  assert.ok(explainToolFailure(undefined).length > 10);
  assert.ok(/introuvable/i.test(explainToolFailure('tool not found')));
});
