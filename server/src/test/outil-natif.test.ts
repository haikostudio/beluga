import test from 'node:test';
import assert from 'node:assert/strict';
import { PLOMBERIE_SERVEURS, outilDUnServeurBranche, outilsNatifsDuMoteur } from '@haikodev/shared';

/*
 * Le contrôle de complétude ne juge que les outils DU MOTEUR : ceux des
 * serveurs branchés sur le compte de l'utilisateur vont et viennent, et les
 * compter faisait tomber ce contrôle au hasard — donc la publication avec lui.
 */

test('un outil du moteur reste un outil du moteur', () => {
  for (const nom of ['Read', 'Bash', 'TaskCreate', 'WebSearch']) {
    assert.equal(outilDUnServeurBranche(nom), false, nom);
  }
});

test('un outil de serveur branché est reconnu, y compris celui du projet', () => {
  assert.equal(outilDUnServeurBranche('mcp__claude_ai_Google_Calendar__list_events'), true);
  assert.equal(outilDUnServeurBranche('mcp__claude_ai_Figma__get_metadata'), true);
  // Les outils du projet sont classés par leur propre liste, pas par celle-ci.
  assert.equal(outilDUnServeurBranche('mcp__haikodev__board_create_card'), true);
});

test('la plomberie des serveurs branchés n\'est pas du moteur non plus', () => {
  for (const nom of PLOMBERIE_SERVEURS) {
    assert.equal(outilDUnServeurBranche(nom), true, nom);
  }
});

test('le tri garde les outils du moteur et écarte le reste, dans l\'ordre', () => {
  const vivante = [
    'Read',
    'mcp__claude_ai_Vercel__list_projects',
    'Bash',
    'ListMcpResourcesTool',
    'mcp__haikodev__remember',
    'Write',
  ];
  assert.deepEqual(outilsNatifsDuMoteur(vivante), ['Read', 'Bash', 'Write']);
});

test('une liste sans rien d\'étranger n\'est pas touchée', () => {
  assert.deepEqual(outilsNatifsDuMoteur(['Read', 'Grep']), ['Read', 'Grep']);
  assert.deepEqual(outilsNatifsDuMoteur([]), []);
});
