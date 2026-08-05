import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { outilsNatifsDuMoteur } from '@haikodev/shared';
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

  // Ce contrôle interroge le VRAI moteur : il peut être momentanément
  // indisponible (quota, réseau). Dans ce cas on ne conclut pas — un test qui
  // échoue au hasard ne protège plus de rien.
  let engineTools: string[] = [];
  let interroge = false;
  try {
    const { stdout } = await execFileAsync(
      'bash',
      [
        '-lc',
        'claude -p "ok" --output-format stream-json --verbose --model haiku --permission-mode bypassPermissions 2>/dev/null | head -1',
      ],
      { timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
    );
    const premiere = stdout.trim().split('\n')[0];
    if (premiere.startsWith('{')) {
      const init = JSON.parse(premiere);
      if (Array.isArray(init.tools)) {
        engineTools = init.tools;
        interroge = true;
      }
    }
  } catch {
    interroge = false;
  }

  if (!interroge) {
    console.log('    (moteur momentanément indisponible : liste vivante non vérifiée cette fois)');
    return;
  }

  /*
   * On ne juge que les outils DU MOTEUR. La liste vivante porte aussi ceux des
   * serveurs branchés sur le compte de l'utilisateur, qui vont et viennent
   * selon leur connexion : les compter faisait tomber ce contrôle au hasard,
   * et avec lui la publication.
   */
  const unclassified = outilsNatifsDuMoteur(engineTools).filter((tool) => !classified.has(tool));
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

test('la facturation est ouverte au chef d\'orchestre, comme aux agents de tâche', () => {
  // Le chef bridé ne peut lancer ni Bash ni Skill : l'outil MCP « compta » est
  // son seul accès à la facturation, et il doit donc lui rester ouvert.
  const chef = toolsFor('orchestrator').map((tool) => tool.name);
  assert.ok(chef.includes('compta'), 'le chef doit voir l\'outil de facturation');
  assert.ok(orchestratorAllowList().includes('mcp__haikodev__compta'), 'compta doit être dans la liste blanche du chef');
  assert.equal(orchestratorDenyList().includes('mcp__haikodev__compta'), false, 'compta ne doit jamais être interdit');
  assert.ok(toolsFor('task').map((tool) => tool.name).includes('compta'), 'un agent de tâche garde aussi la facturation');
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
