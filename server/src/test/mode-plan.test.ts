import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeArgs } from '../engines/claude.js';
import { buildCodexArgs } from '../engines/codex.js';

/* ------------------------------------------------------------------ */
/* Le mode plan (RunConfig.mode) : l'agent prépare SANS écrire, quel    */
/* que soit son accès habituel — priorité sur `fullAccess`.             */
/* ------------------------------------------------------------------ */

test('Claude : le mode plan force --permission-mode plan même en accès complet', () => {
  const args = buildClaudeArgs({
    cwd: '/tmp',
    prompt: 'prépare la refonte',
    fullAccess: true,
    mode: 'plan',
    onEvent: () => {},
  });
  const i = args.indexOf('--permission-mode');
  assert.equal(args[i + 1], 'plan');
});

test('Claude : sans mode plan, l’accès complet garde bypassPermissions', () => {
  const args = buildClaudeArgs({
    cwd: '/tmp',
    prompt: 'ajoute un bouton',
    fullAccess: true,
    mode: 'direct',
    onEvent: () => {},
  });
  const i = args.indexOf('--permission-mode');
  assert.equal(args[i + 1], 'bypassPermissions');
});

test('Codex : le mode plan garde le bac à sable en lecture seule même en accès complet', () => {
  const args = buildCodexArgs({
    cwd: '/root/projet',
    prompt: 'prépare la refonte',
    fullAccess: true,
    mode: 'plan',
    mcpBridgePath: '/opt/haikodev/server/mcp-bridge.mjs',
    onEvent: () => {},
  } as any);
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'), 'aucun contournement du bac à sable en mode plan');
  const i = args.indexOf('-s');
  assert.equal(args[i + 1], 'read-only');
});

test('Codex : en reprise et mode plan, la surcharge de configuration reste en lecture seule', () => {
  const args = buildCodexArgs({
    cwd: '/root/projet',
    prompt: 'prépare la refonte',
    sessionId: 'fil-123',
    fullAccess: true,
    mode: 'plan',
    mcpBridgePath: '/opt/haikodev/server/mcp-bridge.mjs',
    onEvent: () => {},
  } as any);
  assert.ok(args.includes('sandbox_mode="read-only"'));
});

test('Codex : sans mode plan, l’accès complet contourne bien le bac à sable', () => {
  const args = buildCodexArgs({
    cwd: '/root/projet',
    prompt: 'ajoute un bouton',
    fullAccess: true,
    mode: 'direct',
    mcpBridgePath: '/opt/haikodev/server/mcp-bridge.mjs',
    onEvent: () => {},
  } as any);
  assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));
});
