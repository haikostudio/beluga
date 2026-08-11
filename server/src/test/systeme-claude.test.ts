import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeArgs } from '../engines/claude.js';
import { buildCodexArgs } from '../engines/codex.js';
import { rolePrompt, rappelDeMethode } from '../runtime.js';

/* ------------------------------------------------------------------ */
/* Sous Claude, la consigne système NE CHANGE PAS pendant une session   */
/* ------------------------------------------------------------------ */

/*
 * `--append-system-prompt` est réappliqué à chaque invocation, et ce texte se
 * pose TOUT DEVANT la conversation : il en est le PRÉFIXE. Le cache du moteur ne
 * se relit que par préfixe — un entête qui change au tour 2 fait RÉÉCRIRE toute
 * la conversation au lieu de la relire. Mesuré sur le moteur réel
 * (`scripts/mesure-cache-prefixe.mjs`) : 32 667 jetons réécrits contre 771, pour
 * 930 jetons de texte économisés. La consigne entière repart donc à chaque tour.
 * Ces contrôles lisent l'argument réellement passé au moteur.
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

test('en reprise, Claude reçoit EXACTEMENT le même entête qu’au premier tour', () => {
  const commun = {
    cwd: '/tmp',
    prompt: 'DEMANDE : ajoute un bouton.',
    systemPrompt: rolePrompt('task', true, 'claude'),
    systemPromptRappel: rappelDeMethode('claude'),
    fullAccess: true,
    onEvent: () => {},
  };
  const premier = enteteSysteme(buildClaudeArgs(commun));
  const reprise = enteteSysteme(buildClaudeArgs({ ...commun, sessionId: 'fil-123' }));

  // Le préfixe de la session ne bouge pas : au signe près, le même texte.
  assert.equal(reprise, premier);
  assert.match(reprise ?? '', /MÉTHODE DE TRAVAIL IMPOSÉE/);
  // Et surtout : le rappel court ne vient JAMAIS le remplacer en cours de route.
  assert.doesNotMatch(reprise ?? '', /RAPPEL DE MÉTHODE/);
});

test('Codex garde le rappel court : sa consigne suit l’historique, elle ne le précède pas', () => {
  const commun = {
    cwd: '/tmp',
    prompt: 'DEMANDE : ajoute un bouton.',
    systemPrompt: rolePrompt('task', true, 'codex'),
    systemPromptRappel: rappelDeMethode('codex'),
    fullAccess: true,
    onEvent: () => {},
  };
  const premier = buildCodexArgs(commun).at(-1) ?? '';
  const reprise = buildCodexArgs({ ...commun, sessionId: 'fil-9' }).at(-1) ?? '';

  assert.match(premier, /MÉTHODE DE TRAVAIL IMPOSÉE/);
  assert.match(reprise, /RAPPEL DE MÉTHODE/);
  assert.doesNotMatch(reprise, /MÉTHODE DE TRAVAIL IMPOSÉE/);
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
