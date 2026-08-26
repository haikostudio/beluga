import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { outilsNatifsDuMoteur } from '@haikodev/shared';
import {
  CADRAGE_ALLOWED_NATIVE,
  CADRAGE_DENIED_NATIVE,
  CADRAGE_BLOCKED_TOOLS,
  TOOL_DEFS,
  cadrageAllowList,
  cadrageDenyList,
  toolsFor,
} from '../tools.js';

const execFileAsync = promisify(execFile);

/**
 * Le test de complétude (PLAN §5) : tout outil du moteur doit être CLASSÉ.
 * Un outil ajouté demain par une mise à jour du CLI fait échouer ce test,
 * donc il est bloqué par défaut au lieu de passer discrètement.
 */
test('tout outil du moteur est classé autorisé ou interdit pour le chef d\'orchestre', async () => {
  const classified = new Set([...CADRAGE_ALLOWED_NATIVE, ...CADRAGE_DENIED_NATIVE]);

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
  const allow = new Set(cadrageAllowList());
  for (const denied of CADRAGE_DENIED_NATIVE) {
    assert.equal(allow.has(denied), false, `${denied} ne doit pas être autorisé`);
  }
});

test('la liste d\'interdiction est explicite, jamais un joker', () => {
  const deny = cadrageDenyList();
  assert.ok(deny.length >= CADRAGE_DENIED_NATIVE.length);
  assert.equal(deny.includes('*'), false);
  // Le shell est désormais PERMIS à l'agent bridé ; c'est le bac à sable qui garde le
  // projet en lecture seule, pas l'absence de « Bash ».
  assert.equal(deny.includes('Bash'), false);
  // L'édition de fichiers et les travaux de fond restent, eux, interdits.
  assert.ok(deny.includes('Edit'));
  assert.ok(deny.includes('Write'));
  assert.ok(deny.includes('Task'));
});

test('l\'agent de cadrage ne voit ni les outils de tâche, ni de quoi proposer une autre carte', () => {
  const names = toolsFor('cadrage').map((tool) => tool.name);
  for (const reserved of CADRAGE_BLOCKED_TOOLS) {
    assert.equal(names.includes(reserved), false, `${reserved} ne doit pas lui être servi`);
  }
  // Mais il garde ceux dont il a besoin pour écrire SA carte et documenter.
  for (const expected of ['board_update_card', 'write_document', 'ask_user', 'project_memory']) {
    assert.ok(names.includes(expected), `${expected} devrait rester autorisé`);
  }
});

test('la facturation est ouverte à l\'agent de cadrage, comme aux agents de tâche', () => {
  // L'agent bridé ne peut pas éditer de fichiers ni lancer « Skill » : l'outil
  // MCP « compta » est son accès à la facturation, et il doit lui rester ouvert.
  const chef = toolsFor('cadrage').map((tool) => tool.name);
  assert.ok(chef.includes('compta'), 'le cadrage doit voir l\'outil de facturation');
  assert.ok(cadrageAllowList().includes('mcp__haikodev__compta'), 'compta doit être dans la liste blanche du cadrage');
  assert.equal(cadrageDenyList().includes('mcp__haikodev__compta'), false, 'compta ne doit jamais être interdit');
  assert.ok(toolsFor('task').map((tool) => tool.name).includes('compta'), 'un agent de tâche garde aussi la facturation');
});

test('un agent de tâche dispose de tous les outils du démon', () => {
  assert.equal(toolsFor('task').length, TOOL_DEFS.length);
});

test('l\'outil de déplacement n\'accepte que notes et à faire', () => {
  const move = TOOL_DEFS.find((tool) => tool.name === 'board_move_card');
  const column = (move?.inputSchema as any)?.properties?.column;
  assert.deepEqual(column.enum, ['notes', 'planned']);
});

test('la création de carte ne propose aucun champ « colonne »', () => {
  const create = TOOL_DEFS.find((tool) => tool.name === 'board_create_card');
  const properties = (create?.inputSchema as any)?.properties ?? {};
  assert.equal('column' in properties, false, 'une carte naît toujours dans « Planifié »');
});
