import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FONCTIONNALITES_DE_FOND,
  chefBride,
  outilsDuProjet,
  outilsNatifs,
  reglagesClaudeDuChef,
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

test('sous Codex, le chef écrit dans son espace mais jamais le projet, ni ne lance un travail de fond', () => {
  for (const reprise of [undefined, 'fil-1']) {
    const codex = buildCodexArgs(tourDuChef({ sessionId: reprise })).join(' ');
    // Écriture PERMISE dans l'espace de travail (le cwd), projet en lecture seule.
    assert.ok(codex.includes('sandbox_mode="workspace-write"'), 'le bac à sable ouvre l\'espace de travail');
    assert.ok(!codex.includes('sandbox_mode="read-only"'), 'le chef n\'est plus muré en lecture seule');
    assert.ok(
      codex.includes('sandbox_workspace_write.network_access=true'),
      'le chef a le droit au réseau pour ses recherches',
    );
    assert.ok(
      !codex.includes('--dangerously-bypass-approvals-and-sandbox'),
      'le bridage ne doit jamais ouvrir le bac à sable en grand',
    );
    assert.ok(codex.includes('approval_policy="never"'), 'une écriture refusée doit échouer, pas attendre');
    for (const nom of FONCTIONNALITES_DE_FOND) {
      assert.ok(codex.includes(`features.${nom}=false`), `« ${nom} » doit être éteint`);
    }
  }
});

test('sous Claude, le bac à sable s\'allume pour le chef et le projet est monté en lecture', () => {
  const claude = buildClaudeArgs(tourDuChef({ projectRoot: '/root/projet' }));
  const ligne = claude.join(' ');
  assert.ok(ligne.includes('--settings'), 'Claude reçoit des réglages de bac à sable');
  const i = claude.indexOf('--settings');
  const reglages = JSON.parse(claude[i + 1]);
  assert.equal(reglages.sandbox.enabled, true, 'le bac à sable est allumé');
  assert.equal(reglages.sandbox.allowUnsandboxedCommands, false, 'aucun repli hors bac à sable');
  assert.ok(ligne.includes('--add-dir /root/projet'), 'le projet est monté en lecture');
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

test('sous Codex, la facturation est énumérée parmi les outils permis au chef', () => {
  const permis = outilsDuProjet(orchestratorAllowList());
  assert.ok(permis.includes('compta'), 'compta doit être dans les outils permis du chef');
  const codex = buildCodexArgs(tourDuChef()).join(' ');
  assert.ok(
    codex.includes(`mcp_servers.haikodev.enabled_tools=${JSON.stringify(permis)}`),
    'la liste enabled_tools de Codex doit porter compta',
  );
});

test('le bridage ne mord jamais sur un agent de tâche', () => {
  assert.equal(chefBride(tourDeTache()), false);
  assert.deepEqual(surchargesCodexDuChef(tourDeTache()), []);
  assert.equal(reglagesClaudeDuChef(tourDeTache()), null, 'aucun bac à sable imposé à un agent de tâche');
  const codex = buildCodexArgs(tourDeTache()).join(' ');
  assert.ok(codex.includes('--dangerously-bypass-approvals-and-sandbox'), 'un agent de tâche garde son accès complet');
  assert.ok(!codex.includes('enabled_tools'), 'aucune liste d\'outils ne lui est imposée');
  const claude = buildClaudeArgs(tourDeTache()).join(' ');
  assert.ok(!claude.includes('--settings'), 'aucun réglage de bac à sable pour un agent de tâche');
});

test('le shell est permis au chef, l\'édition de fichiers reste interdite', () => {
  const permis = new Set(outilsNatifs(orchestratorAllowList()));
  const interdits = new Set(outilsNatifs(orchestratorDenyList()));
  // Le shell est OUVERT : sondages, études, analyses. Le projet reste protégé
  // par le bac à sable, pas par l'absence de « Bash ».
  assert.ok(permis.has('Bash'), 'le chef peut lancer des commandes');
  // L'édition de fichiers reste fermée : modifier le code s'ouvre en carte.
  assert.ok(interdits.has('Write') && interdits.has('Edit'), 'l\'édition de fichiers reste interdite');
  assert.ok(!interdits.has('Bash'), 'le shell n\'est plus dans les interdits');
  assert.ok(
    outilsDuProjet(orchestratorDenyList()).every((nom) => !nom.startsWith('mcp__')),
    'le préfixe du moteur est retiré une seule fois',
  );
});
