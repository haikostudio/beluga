import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeArgs, CumulDesResultats, emitFromClaude, partDesAides } from '../engines/claude.js';
import { AIDES_FERMEES, MODELE_DES_AIDES } from '../engines/aides-claude.js';
import { EngineEvent } from '../engines/types.js';
import { CONSIGNE_DES_AIDES, CONSIGNE_DE_PSTACK, rolePrompt } from '../runtime.js';

const tour = (extra: Record<string, unknown> = {}) =>
  ({ cwd: '/tmp/carte', prompt: 'Fais la tâche.', fullAccess: true, role: 'task', onEvent: () => {}, ...extra }) as any;

const valeurDe = (args: string[], option: string) => args[args.indexOf(option) + 1];

test('un agent de tâche reçoit « Explore » sur le modèle léger, et les aides coûteuses fermées', () => {
  const args = buildClaudeArgs(tour());
  const aides = JSON.parse(valeurDe(args, '--agents'));
  assert.equal(aides.Explore.model, MODELE_DES_AIDES);
  assert.deepEqual(aides.Explore.tools, ['Read', 'Grep', 'Glob', 'Bash']);
  assert.match(aides.Explore.prompt, /tu ne modifies RIEN/);
  const fermes = valeurDe(args, '--disallowedTools').split(',');
  for (const aide of AIDES_FERMEES) assert.ok(fermes.includes(aide), aide);
});

test('la définition des aides est identique d’un tour à l’autre (préfixe du cache)', () => {
  assert.equal(
    valeurDe(buildClaudeArgs(tour()), '--agents'),
    valeurDe(buildClaudeArgs(tour({ sessionId: 'fil-1' })), '--agents'),
  );
});

test('les autres rôles ne reçoivent aucune redéfinition d’aide', () => {
  for (const role of ['analysis', 'deploy', 'cadrage']) {
    const args = buildClaudeArgs(tour({ role, fullAccess: role !== 'cadrage' }));
    assert.ok(!args.includes('--agents'), role);
    assert.ok(!(valeurDe(args, '--disallowedTools') ?? '').includes('Agent(general-purpose)'), role);
  }
});

test('les outils déjà fermés d’un tour restent fermés à côté des aides', () => {
  const fermes = valeurDe(buildClaudeArgs(tour({ disallowedTools: ['WebFetch'] })), '--disallowedTools').split(',');
  assert.ok(fermes.includes('WebFetch'));
  assert.ok(fermes.includes('Agent(general-purpose)'));
});

test('la règle des aides est donnée aux agents de tâche, quel que soit le moteur', () => {
  assert.ok(rolePrompt('task', false, 'claude').includes(CONSIGNE_DES_AIDES));
  assert.ok(rolePrompt('task', false, 'codex').includes(CONSIGNE_DES_AIDES));
  assert.ok(!rolePrompt('analysis', false, 'claude').includes(CONSIGNE_DES_AIDES));
});

test('pstack est au jugement de l’agent de tâche, et ses aides parallèles demandent un accord', () => {
  for (const moteur of ['claude', 'codex', 'cursor'] as const) {
    assert.ok(rolePrompt('task', false, moteur).includes(CONSIGNE_DE_PSTACK), moteur);
  }
  assert.ok(!rolePrompt('analysis', false, 'claude').includes(CONSIGNE_DE_PSTACK));
  assert.match(CONSIGNE_DE_PSTACK, /pstack/);
  assert.match(CONSIGNE_DE_PSTACK, /JUGEMENT/);
  // Les deux textes disent la même chose : jamais d'aides en parallèle sans accord par ask_user.
  assert.match(CONSIGNE_DE_PSTACK, /ask_user/);
  assert.match(CONSIGNE_DE_PSTACK, /sans accord, continue seul/);
  assert.match(CONSIGNE_DES_AIDES, /en parallèle : seulement après accord par ask_user/);
  // Courte : chaque tour de chaque agent de tâche la paie.
  assert.ok(CONSIGNE_DE_PSTACK.length < 500, `${CONSIGNE_DE_PSTACK.length} signes`);
  // L'accord n'ouvre aucune aide fermée.
  assert.deepEqual(AIDES_FERMEES, ['Agent(general-purpose)', 'Agent(claude)', 'Agent(Plan)']);
});

// Forme mesurée le 13/10/2026 (Claude Code 2.1.296) : `usage` = le principal
// seul, `modelUsage` = tout, rangé par modèle.
const resultatAvecAideLegere = {
  usage: { input_tokens: 6, cache_read_input_tokens: 65_675, cache_creation_input_tokens: 16_883, output_tokens: 435 },
  modelUsage: {
    'claude-sonnet-5-5': { inputTokens: 6, cacheReadInputTokens: 65_675, cacheCreationInputTokens: 16_883, outputTokens: 435 },
    'claude-haiku-5-5': { inputTokens: 4, cacheReadInputTokens: 3_505, cacheCreationInputTokens: 3_605, outputTokens: 115 },
  },
};

test('la part d’une aide sur un autre modèle est isolée', () => {
  assert.deepEqual(partDesAides(resultatAvecAideLegere), {
    tokens: 4 + 3_505 + 3_605 + 115,
    sortie: 115,
    entree: 4 + 3_605,
    relu: 3_505,
    modeles: ['claude-haiku-5-5'],
  });
});

test('une aide fondue dans la ligne du principal est retrouvée par l’écart', () => {
  const resultat = {
    usage: { input_tokens: 4, cache_read_input_tokens: 40_177, cache_creation_input_tokens: 15_101, output_tokens: 203 },
    modelUsage: {
      'claude-sonnet-5-5': { inputTokens: 8, cacheReadInputTokens: 61_107, cacheCreationInputTokens: 36_694, outputTokens: 271 },
    },
  };
  assert.deepEqual(partDesAides(resultat), {
    tokens: 4 + 20_930 + 21_593 + 68,
    sortie: 68,
    entree: 4 + 21_593,
    relu: 20_930,
    modeles: ['claude-sonnet-5-5'],
  });
});

test('un tour sans aide ne rend aucune part', () => {
  const resultat = {
    usage: { input_tokens: 4, cache_read_input_tokens: 100, output_tokens: 10 },
    modelUsage: { 'claude-opus-5-5': { inputTokens: 4, cacheReadInputTokens: 100, outputTokens: 10 } },
  };
  assert.equal(partDesAides(resultat), null);
  assert.equal(partDesAides({ usage: {} }), null);
});

test('la part des aides voyage avec l’usage du tour, sans toucher à ses totaux', () => {
  const events: EngineEvent[] = [];
  emitFromClaude({ type: 'result', ...resultatAvecAideLegere }, (e) => events.push(e), new Map());
  const usage = events.find((e) => e.kind === 'usage')?.usage;
  assert.equal(usage?.inputTokens, 6 + 16_883);
  assert.equal(usage?.cachedTokens, 65_675);
  assert.equal(usage?.aides?.tokens, 7_229);
});

test('une aide en arrière-plan coupe le tour en deux résultats : le principal est cumulé, l’aide isolée', () => {
  // Les deux résultats d'un même processus, relevés tels quels le 13/10/2026 :
  // `usage` par morceau, `modelUsage` cumulé sur tout le processus.
  const modelUsage = {
    'claude-sonnet-5-5': { inputTokens: 6, cacheReadInputTokens: 93_952, cacheCreationInputTokens: 32_718, outputTokens: 888 },
    'claude-haiku-5-5': { inputTokens: 10, cacheReadInputTokens: 97_779, cacheCreationInputTokens: 26_560, outputTokens: 2_763 },
  };
  const premier = {
    type: 'result',
    usage: { input_tokens: 4, cache_read_input_tokens: 52_081, cache_creation_input_tokens: 30_884, output_tokens: 400 },
    modelUsage,
    duration_ms: 4_000,
    num_turns: 2,
  };
  const second = {
    type: 'result',
    usage: { input_tokens: 2, cache_read_input_tokens: 41_871, cache_creation_input_tokens: 1_834, output_tokens: 488 },
    modelUsage,
    duration_ms: 3_000,
    num_turns: 1,
  };
  const events: EngineEvent[] = [];
  const cumul = new CumulDesResultats();
  emitFromClaude(premier, (e) => events.push(e), new Map(), undefined, cumul);
  emitFromClaude(second, (e) => events.push(e), new Map(), undefined, cumul);
  const usages = events.filter((e) => e.kind === 'usage').map((e) => e.usage!);
  const dernier = usages[usages.length - 1];
  // Le principal = la somme des deux morceaux = exactement sa ligne de modelUsage.
  assert.equal(dernier.inputTokens, 6 + 32_718);
  assert.equal(dernier.cachedTokens, 93_952);
  assert.equal(dernier.outputTokens, 888);
  assert.equal(dernier.durationMs, 7_000);
  assert.equal(dernier.turns, 3);
  // Le contexte reste celui du dernier morceau.
  assert.equal(dernier.contextTokens, 2 + 41_871 + 1_834 + 488);
  // L'aide : la ligne du modèle léger, et rien du principal.
  assert.deepEqual(dernier.aides, { tokens: 10 + 97_779 + 26_560 + 2_763, sortie: 2_763, entree: 10 + 26_560, relu: 97_779, modeles: ['claude-haiku-5-5'] });
});
