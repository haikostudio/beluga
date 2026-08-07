import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeArgs } from '../engines/claude.js';
import { rolePrompt, rappelDeMethode } from '../runtime.js';

/* ------------------------------------------------------------------ */
/* Sous Claude, la consigne système entière ne part qu'au PREMIER tour  */
/* ------------------------------------------------------------------ */

/*
 * `--append-system-prompt` est réappliqué à chaque invocation : on renvoyait
 * donc la consigne de rôle ENTIÈRE à chaque reprise, alors que le cache de la
 * session la porte déjà. En reprise, seul le rappel court doit repartir — comme
 * Codex. Ces contrôles lisent l'argument réellement passé au moteur.
 */

/** Le texte qui suit `--append-system-prompt` dans la ligne de commande. */
function enteteSysteme(args: string[]): string | undefined {
  const i = args.indexOf('--append-system-prompt');
  return i >= 0 ? args[i + 1] : undefined;
}

test('au premier tour, Claude reçoit la consigne système ENTIÈRE', () => {
  const args = buildClaudeArgs({
    cwd: '/tmp',
    prompt: 'DEMANDE : ajoute un bouton.',
    systemPrompt: rolePrompt('task', true, 'claude'),
    systemPromptRappel: rappelDeMethode('claude'),
    fullAccess: true,
    onEvent: () => {},
  });
  const entete = enteteSysteme(args);
  assert.match(entete ?? '', /MÉTHODE DE TRAVAIL IMPOSÉE/);
});

test('en reprise, Claude ne reçoit que le RAPPEL court', () => {
  const args = buildClaudeArgs({
    cwd: '/tmp',
    prompt: 'DEMANDE : ajoute un bouton.',
    sessionId: 'fil-123',
    systemPrompt: rolePrompt('task', true, 'claude'),
    systemPromptRappel: rappelDeMethode('claude'),
    fullAccess: true,
    onEvent: () => {},
  });
  const entete = enteteSysteme(args);
  assert.match(entete ?? '', /RAPPEL DE MÉTHODE/);
  assert.match(entete ?? '', /TaskCreate/);
  // Le pavé entier, lui, ne repart pas : la session le porte déjà.
  assert.doesNotMatch(entete ?? '', /MÉTHODE DE TRAVAIL IMPOSÉE/);
  // Et il est bien plus court que la consigne entière.
  assert.ok((entete ?? '').length < rolePrompt('task', true, 'claude').length);
});

test('la reprise passe bien par --resume, le premier tour par --session-id', () => {
  const premier = buildClaudeArgs({
    cwd: '/tmp',
    prompt: 'x',
    systemPrompt: 's',
    systemPromptRappel: 'r',
    fullAccess: true,
    onEvent: () => {},
  });
  assert.ok(premier.includes('--session-id'));
  assert.ok(!premier.includes('--resume'));

  const reprise = buildClaudeArgs({
    cwd: '/tmp',
    prompt: 'x',
    sessionId: 'fil-9',
    systemPrompt: 's',
    systemPromptRappel: 'r',
    fullAccess: true,
    onEvent: () => {},
  });
  assert.ok(reprise.includes('--resume'));
  assert.ok(!reprise.includes('--session-id'));
});
