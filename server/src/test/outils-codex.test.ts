import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCodexArgs, emitFromCodex, explainToolFailure, preparerMaisonDeTour } from '../engines/codex.js';
import { EngineEvent } from '../engines/types.js';

const BRIDGE = '/opt/beluga/server/mcp-bridge.mjs';

function args(extra: Partial<Parameters<typeof buildCodexArgs>[0]> = {}): string[] {
  return buildCodexArgs({
    cwd: '/root/projet',
    prompt: 'bonjour',
    fullAccess: false,
    mcpConfigPath: '/var/log/beluga/mcp-a1.json',
    mcpBridgePath: BRIDGE,
    env: { BELUGA_TOKEN: 'jeton', BELUGA_URL: 'http://127.0.0.1:7070', BELUGA_AGENT: 'a1' },
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
  assert.ok(line.includes(`mcp_servers.beluga.command=${JSON.stringify(process.execPath)}`));
  assert.ok(line.includes(`mcp_servers.beluga.args=["${BRIDGE}"]`));
});

/** Sans ce mode, chaque appel demande une approbation que personne ne donne :
 *  Codex rend « user cancelled MCP tool call » et la carte n'est jamais proposée. */
test('les outils du projet sont approuvés d\'avance, même en lecture seule', () => {
  for (const options of [{}, { fullAccess: true }, { sessionId: 'fil-1' }]) {
    const line = args(options).join(' ');
    assert.ok(
      line.includes('mcp_servers.beluga.default_tools_approval_mode="approve"'),
      `mode d'approbation manquant pour ${JSON.stringify(options)}`,
    );
    assert.ok(line.includes(BRIDGE), `pont manquant pour ${JSON.stringify(options)}`);
  }
});

test('le jeton, l\'adresse et l\'agent voyagent avec le pont', () => {
  const line = args().join(' ');
  assert.ok(line.includes('mcp_servers.beluga.env.BELUGA_TOKEN="jeton"'));
  assert.ok(line.includes('mcp_servers.beluga.env.BELUGA_URL="http://127.0.0.1:7070"'));
  assert.ok(line.includes('mcp_servers.beluga.env.BELUGA_AGENT="a1"'));
});

test('sans pont annoncé, aucune ligne de serveur d\'outils', () => {
  const line = args({ mcpBridgePath: undefined }).join(' ');
  assert.ok(!line.includes('mcp_servers.beluga'));
  assert.ok(!line.includes('features.memories'), 'rien à éteindre si le projet ne branche rien');
});

/*
 * Le défaut du 4 août : un AUTRE serveur d'outils, branché dans la
 * configuration de Codex, proposait sa propre mémoire. Le modèle l'appelait à
 * la place de `project_memory`, puis annonçait des faits qu'il n'était jamais
 * allé chercher.
 */
test('les serveurs d\'outils étrangers sont éteints le temps du tour', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-essai-'));
  fs.writeFileSync(
    path.join(home, 'config.toml'),
    '[mcp_servers.memoire]\nurl = "https://exemple/mcp"\n\n[mcp_servers.beluga]\ncommand = "node"\n',
    'utf8',
  );
  const line = args({
    env: { BELUGA_TOKEN: 'jeton', BELUGA_URL: 'http://127.0.0.1:7070', BELUGA_AGENT: 'a1', CODEX_HOME: home },
  }).join(' ');
  fs.rmSync(home, { recursive: true, force: true });

  assert.ok(line.includes('mcp_servers.memoire.enabled=false'), 'le serveur étranger doit être éteint');
  assert.ok(!line.includes('mcp_servers.beluga.enabled=false'), 'le serveur du projet reste allumé');
  assert.ok(line.includes(BRIDGE), 'le pont du projet est toujours branché');
});

/** La mémoire propre du moteur, commune à tous les projets, en est une autre. */
test('la mémoire interne du moteur est éteinte : celle du projet fait foi', () => {
  assert.ok(args().join(' ').includes('features.memories=false'));
});

/** Une extension personnelle (mémoire, rappel…) apporte ses propres consignes. */
test('les extensions étrangères du compte sont éteintes le temps du tour', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-essai-'));
  fs.writeFileSync(
    path.join(home, 'config.toml'),
    '[plugins."cerveau-memory@personal"]\nenabled = true\n',
    'utf8',
  );
  const line = args({
    env: { BELUGA_TOKEN: 'jeton', BELUGA_URL: 'http://127.0.0.1:7070', BELUGA_AGENT: 'a1', CODEX_HOME: home },
  }).join(' ');
  fs.rmSync(home, { recursive: true, force: true });
  assert.ok(line.includes('plugins."cerveau-memory@personal".enabled=false'));
});

/**
 * Codex lit `AGENTS.md` et `hooks.json` de son dossier d'accueil, et rien ne
 * les ignore : un tour de Beluga lit donc un dossier à part, qui relie tout le
 * reste du compte (connexion, fils) et jamais ces deux fichiers.
 */
test('la maison d\'un tour reprend le compte sans ses consignes ni ses automatismes personnels', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-maison-'));
  const compte = path.join(base, 'compte');
  const atelier = path.join(base, 'atelier');
  fs.mkdirSync(path.join(compte, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(compte, 'AGENTS.md'), '🧠 Mémoire consultée', 'utf8');
  fs.writeFileSync(path.join(compte, 'hooks.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(compte, 'auth.json'), '{"jeton":1}', 'utf8');
  fs.writeFileSync(path.join(compte, 'config.toml'), '', 'utf8');

  const maison = preparerMaisonDeTour(compte, atelier);
  assert.ok(!fs.existsSync(path.join(maison, 'AGENTS.md')), 'les consignes globales ne sont pas reliées');
  assert.ok(!fs.existsSync(path.join(maison, 'hooks.json')), 'les automatismes ne sont pas reliés');
  assert.equal(fs.readFileSync(path.join(maison, 'auth.json'), 'utf8'), '{"jeton":1}');
  assert.ok(fs.existsSync(path.join(maison, 'config.toml')));
  // Les fils restent chez le compte : une écriture dans la maison y atterrit.
  fs.writeFileSync(path.join(maison, 'sessions', 'fil.jsonl'), 'x', 'utf8');
  assert.ok(fs.existsSync(path.join(compte, 'sessions', 'fil.jsonl')));
  assert.ok(fs.existsSync(path.join(compte, 'AGENTS.md')), 'le dossier du compte n\'est jamais touché');

  // Rejouée : même maison ; un jeton réécrit dans la maison est rapatrié chez le compte.
  fs.rmSync(path.join(maison, 'auth.json'));
  fs.writeFileSync(path.join(maison, 'auth.json'), '{"jeton":2}', 'utf8');
  assert.equal(preparerMaisonDeTour(compte, atelier), maison);
  assert.equal(fs.readFileSync(path.join(compte, 'auth.json'), 'utf8'), '{"jeton":2}');
  assert.ok(fs.lstatSync(path.join(maison, 'auth.json')).isSymbolicLink());
  fs.rmSync(base, { recursive: true, force: true });
});

test('une configuration illisible n\'éteint rien et ne casse rien', () => {
  const line = args({
    env: { BELUGA_TOKEN: 'j', BELUGA_URL: 'u', BELUGA_AGENT: 'a', CODEX_HOME: '/dossier/qui/nexiste/pas' },
  }).join(' ');
  assert.ok(!line.includes('.enabled=false'));
  assert.ok(line.includes(BRIDGE));
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
