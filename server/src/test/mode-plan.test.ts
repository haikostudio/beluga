import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildClaudeArgs } from '../engines/claude.js';
import { buildCodexArgs } from '../engines/codex.js';
import { rolePrompt, TRI_MODE_PLAN } from '../runtime.js';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-plan-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { callTool } = await import('../tools.js');

/*
 * Une proposition n'est affichée que si sa description tient debout (règle
 * « description-carte ») : sans rôle « orchestrator » sur le contexte de
 * test, l'exigence est la plus complète — on la fournit donc en entier.
 */
const DESCRIPTION = [
  "Constat : le tableau se fabrique dans `web/src/components/board.tsx` et n’offre aucun bouton d’export des cartes.",
  'Attendu : un bouton d’export rend le contenu de la colonne dans un fichier téléchargeable.',
  "Limites : on ne touche ni au glisser-déposer, ni aux règles de passage d'une colonne à l'autre.",
  'Vérification : rejouer `npm test`, puis cliquer le bouton et ouvrir le fichier obtenu.',
].join('\n');

function projetDEssai() {
  return store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

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

/* ------------------------------------------------------------------ */
/* Le mode plan ne doit RENDRE AUCUNE carte : refusé au niveau de       */
/* l'outil, pas seulement dit dans la consigne (PLAN §2 principe 3).    */
/* ------------------------------------------------------------------ */

test('board_create_card est refusé en mode plan, aucune carte n’apparaît', async () => {
  const projet = projetDEssai();
  const resultat = await callTool({ projectId: projet.id, mode: 'plan' } as any, 'board_create_card', {
    title: 'Ajouter un bouton',
    description: DESCRIPTION,
  });
  assert.equal(resultat.ok, false);
  assert.equal(resultat.proposal, undefined, 'aucune proposition, donc aucune carte affichée');
  assert.match(resultat.text, /mode plan/i);
});

test('propose_task est refusé en mode plan', async () => {
  const projet = projetDEssai();
  const resultat = await callTool({ projectId: projet.id, mode: 'plan' } as any, 'propose_task', {
    title: 'Corriger un défaut',
    description: DESCRIPTION,
  });
  assert.equal(resultat.ok, false);
  assert.equal(resultat.proposal, undefined);
});

test('sans mode (ou en mode direct), board_create_card fonctionne comme avant', async () => {
  const projet = projetDEssai();
  const resultat = await callTool({ projectId: projet.id, mode: 'direct' } as any, 'board_create_card', {
    title: 'Ajouter un bouton',
    description: DESCRIPTION,
  });
  assert.equal(resultat.ok, true);
  assert.ok(resultat.proposal);
});

/* ------------------------------------------------------------------ */
/* La consigne du chef change en mode plan : elle demande un plan       */
/* écrit dans la conversation, pas une carte.                           */
/* ------------------------------------------------------------------ */

test('la consigne du chef en mode plan porte les quatre parties du plan et interdit la carte', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude', 'complet', 'plan');
  assert.match(consigne, /FAISABILITÉ/);
  assert.match(consigne, /CHEMIN À SUIVRE/);
  assert.match(consigne, /CONSÉQUENCES/);
  assert.match(consigne, /AMÉLIORATIONS APPORTÉES/);
  assert.match(consigne, /NE PROPOSES AUCUNE carte/);
  assert.match(consigne, /analysis\.context/);
  assert.ok(consigne.includes(TRI_MODE_PLAN));
});

test('la consigne du chef en mode direct ne porte pas le texte du mode plan', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude');
  assert.ok(!consigne.includes(TRI_MODE_PLAN));
});
