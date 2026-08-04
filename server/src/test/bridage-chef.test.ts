import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FONCTIONNALITES_DE_FOND,
  chefBride,
  outilsDuProjet,
  outilsNatifs,
  surchargesCodexDuChef,
} from '@haikodev/shared';
import { buildCodexArgs } from '../engines/codex.js';
import { buildClaudeArgs } from '../engines/claude.js';
import { orchestratorAllowList, orchestratorDenyList } from '../tools.js';
import { EngineRunOptions } from '../engines/types.js';

const PONT = '/opt/haikodev/server/mcp-bridge.mjs';

/** Le tour d'un chef d'orchestre sur un projet ORDINAIRE : les deux listes. */
function tourDuChef(extra: Partial<EngineRunOptions> = {}): EngineRunOptions {
  return {
    cwd: '/root/projet',
    prompt: 'bonjour',
    fullAccess: false,
    mcpConfigPath: '/var/log/haikodev/mcp-a1.json',
    mcpBridgePath: PONT,
    allowedTools: orchestratorAllowList(),
    disallowedTools: orchestratorDenyList(),
    env: { HAIKODEV_TOKEN: 'jeton', HAIKODEV_URL: 'http://127.0.0.1:7070', HAIKODEV_AGENT: 'a1' },
    onEvent: () => {},
    ...extra,
  } as EngineRunOptions;
}

/** Le tour d'un agent de tâche : accès complet, aucune liste. */
function tourDeTache(extra: Partial<EngineRunOptions> = {}): EngineRunOptions {
  return tourDuChef({ fullAccess: true, allowedTools: undefined, disallowedTools: undefined, ...extra });
}

test('les deux listes partent au moteur, pour Claude COMME pour Codex', () => {
  const claude = buildClaudeArgs(tourDuChef()).join(' ');
  assert.ok(claude.includes('--allowedTools'), 'Claude doit recevoir la liste blanche');
  assert.ok(claude.includes('--disallowedTools'), 'Claude doit recevoir la liste noire');
  assert.ok(claude.includes('mcp__haikodev__board_create_card'), 'la proposition de carte reste permise');

  // Le défaut d'origine : Codex ne lisait ni l'une ni l'autre, et le chef y
  // écrivait des fichiers.
  const codex = buildCodexArgs(tourDuChef()).join(' ');
  for (const surcharge of surchargesCodexDuChef(tourDuChef())) {
    assert.ok(codex.includes(surcharge), `Codex doit recevoir « ${surcharge} »`);
  }
});

test('sous Codex, le chef ne peut ni écrire ni lancer un travail de fond', () => {
  for (const reprise of [undefined, 'fil-1']) {
    const codex = buildCodexArgs(tourDuChef({ sessionId: reprise })).join(' ');
    assert.ok(codex.includes('sandbox_mode="read-only"'), 'le bac à sable reste en lecture seule');
    assert.ok(
      !codex.includes('--dangerously-bypass-approvals-and-sandbox'),
      'le bridage ne doit jamais ouvrir le bac à sable',
    );
    assert.ok(codex.includes('approval_policy="never"'), 'une écriture refusée doit échouer, pas attendre');
    for (const nom of FONCTIONNALITES_DE_FOND) {
      assert.ok(codex.includes(`features.${nom}=false`), `« ${nom} » doit être éteint`);
    }
  }
});

test('sous Codex, les outils du projet sont énumérés un par un', () => {
  const codex = buildCodexArgs(tourDuChef()).join(' ');
  const permis = outilsDuProjet(orchestratorAllowList());
  const interdits = outilsDuProjet(orchestratorDenyList());
  assert.ok(permis.includes('board_create_card'), 'la liste blanche porte bien les outils du projet');
  assert.ok(interdits.length > 0, 'la liste noire porte au moins un outil du projet');
  assert.ok(codex.includes(`mcp_servers.haikodev.enabled_tools=${JSON.stringify(permis)}`));
  assert.ok(codex.includes(`mcp_servers.haikodev.disabled_tools=${JSON.stringify(interdits)}`));
});

test('le bridage ne mord jamais sur un agent de tâche', () => {
  assert.equal(chefBride(tourDeTache()), false);
  assert.deepEqual(surchargesCodexDuChef(tourDeTache()), []);
  const codex = buildCodexArgs(tourDeTache()).join(' ');
  assert.ok(codex.includes('--dangerously-bypass-approvals-and-sandbox'), 'un agent de tâche garde son accès complet');
  assert.ok(!codex.includes('enabled_tools'), 'aucune liste d\'outils ne lui est imposée');
});

test('un outil natif interdit ne se confond pas avec un outil du projet', () => {
  const natifs = outilsNatifs(orchestratorDenyList());
  assert.ok(natifs.includes('Write') && natifs.includes('Bash'), 'écriture et commandes restent interdites');
  assert.ok(
    outilsDuProjet(orchestratorDenyList()).every((nom) => !nom.startsWith('mcp__')),
    'le préfixe du moteur est retiré une seule fois',
  );
});
