import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDIT_HORS_DE_PORTEE,
  consigneEnTeteDeSession,
  creditDepuisReponseCursor,
  decomposerModeleCursor,
  montantCursorEnClair,
  periodeDuCreditCursor,
  texteDuPlanCursor,
  fenetreDepuisLibelleCursor,
  fichierNatif,
  idCursorPourNiveau,
  manqueDuMoteurCursor,
  modelesCursorDepuisListe,
  moteurSansQuota,
  outilCursor,
  raisonDeLaSortieCursor,
  raisonDeRefusCursor,
} from '@haikodev/shared';
import { buildCursorArgs, emitFromCursor } from '../engines/cursor.js';
import type { EngineEvent, EngineRunOptions } from '../engines/types.js';

/*
 * LES RÈGLES DU MOTEUR CURSOR, jouées sans réseau ni processus. Cursor est
 * désormais un OUTIL EN LIGNE DE COMMANDE (`cursor-agent`) lancé dans la copie
 * de travail de la carte : il lit et modifie les fichiers sur la machine, comme
 * Claude et Codex. Les extraits repris ici — liste de modèles, flux
 * d'événements — sont ceux RÉELLEMENT rendus par le CLI le 14/08/2026.
 */

/** Un extrait fidèle de `cursor-agent --list-models`. */
const LISTE = `Available models

auto - Auto (current, default)
composer-2.5 - Composer 2.5
composer-2.5-fast - Composer 2.5 Fast
claude-opus-5-low - Opus 5 1M Low
claude-opus-5-low-fast - Opus 5 1M Low Fast
claude-opus-5-medium - Opus 5 1M Medium
claude-opus-5-high - Opus 5 1M
claude-opus-5-thinking-low - Opus 5 1M Low Thinking
claude-opus-5-thinking-high - Opus 5 1M Thinking
claude-opus-5-thinking-max - Opus 5 1M Max Thinking
gpt-5.5-none - GPT-5.5 1M None
gpt-5.5-medium - GPT-5.5 1M
gpt-5.5-extra-high - GPT-5.5 1M Extra High
gemini-3.1-pro - Gemini 3.1 Pro
`;

test('un nom de modèle se décompose en modèle et niveau', () => {
  assert.deepEqual(decomposerModeleCursor('claude-opus-5-thinking-xhigh'), {
    base: 'claude-opus-5-thinking',
    niveau: 'xhigh',
  });
  // « extra-high » chez Cursor, « xhigh » partout ailleurs dans HaikoDev.
  assert.deepEqual(decomposerModeleCursor('gpt-5.5-extra-high'), { base: 'gpt-5.5', niveau: 'xhigh' });
  // Un nom sans suffixe connu n'a pas de niveau : il part tel quel.
  assert.deepEqual(decomposerModeleCursor('composer-2.5'), { base: 'composer-2.5', niveau: null });
  assert.deepEqual(decomposerModeleCursor('gemini-3.1-pro'), { base: 'gemini-3.1-pro', niveau: null });
});

test('la liste du CLI devient des modèles avec leurs vrais niveaux', () => {
  const modeles = modelesCursorDepuisListe(LISTE);
  const parId = new Map(modeles.map((m) => [m.id, m]));

  // Un modèle, ses niveaux réels — jamais un niveau inventé.
  assert.deepEqual(parId.get('claude-opus-5')?.niveaux, ['low', 'medium', 'high']);
  assert.deepEqual(parId.get('claude-opus-5-thinking')?.niveaux, ['low', 'high', 'max']);
  assert.deepEqual(parId.get('gpt-5.5')?.niveaux, ['none', 'medium', 'xhigh']);
  // Sans suffixe : un seul niveau, « sans réflexion ».
  assert.deepEqual(parId.get('composer-2.5')?.niveaux, ['none']);
  assert.deepEqual(parId.get('gemini-3.1-pro')?.niveaux, ['none']);

  // Le libellé du modèle ne porte plus de mention de niveau, et la fenêtre de
  // contexte se lit dedans quand Cursor l'y écrit.
  assert.equal(parId.get('claude-opus-5')?.label, 'Opus 5 1M');
  assert.equal(parId.get('claude-opus-5')?.fenetre, 1_000_000);
  assert.equal(parId.get('composer-2.5')?.fenetre, undefined);

  // Le défaut est celui que Cursor nomme sans mention de niveau.
  assert.equal(parId.get('claude-opus-5')?.niveauParDefaut, 'high');
  assert.equal(parId.get('gpt-5.5')?.niveauParDefaut, 'medium');
});

/*
 * LE POINT QUI A FAIT ÉCHOUER UN VRAI TOUR : le CLI n'accepte QUE les noms de
 * sa liste. « composer-2.5[effort=high] » — le format de l'API cloud — est
 * refusé (« Cannot use this model »), et un niveau absent doit retomber sur le
 * défaut du modèle plutôt que de composer un nom qui n'existe pas.
 */
test('le niveau choisi redevient un suffixe du nom envoyé au CLI', () => {
  const modeles = modelesCursorDepuisListe(LISTE);
  assert.equal(idCursorPourNiveau(modeles, 'claude-opus-5', 'low'), 'claude-opus-5-low');
  assert.equal(idCursorPourNiveau(modeles, 'gpt-5.5', 'xhigh'), 'gpt-5.5-extra-high');
  assert.equal(idCursorPourNiveau(modeles, 'composer-2.5', 'none'), 'composer-2.5');
  // Niveau que ce modèle ne propose pas : son défaut, jamais un nom composé.
  assert.equal(idCursorPourNiveau(modeles, 'claude-opus-5', 'max'), 'claude-opus-5-high');
  assert.equal(idCursorPourNiveau(modeles, 'composer-2.5', 'high'), 'composer-2.5');
  // Catalogue illisible ou nom plus ancien que la refonte : il part inchangé.
  assert.equal(idCursorPourNiveau([], 'gpt-5.4-xhigh', 'low'), 'gpt-5.4-xhigh');
  assert.equal(idCursorPourNiveau(modeles, undefined, 'low'), 'composer-2.5');
});

test('la variante « rapide » ne double pas la liste', () => {
  const ids = modelesCursorDepuisListe(LISTE).flatMap((m) => Object.values(m.ids));
  assert.equal(ids.some((id) => id.endsWith('-fast')), false);
});

test('la fenêtre de contexte se lit dans le libellé, ou reste absente', () => {
  assert.equal(fenetreDepuisLibelleCursor('GPT-5.6 Sol 1M Max'), 1_000_000);
  assert.equal(fenetreDepuisLibelleCursor('Un modèle 272k'), 272_000);
  // Aucune capacité annoncée : on ne devine pas.
  assert.equal(fenetreDepuisLibelleCursor('Sonnet 4.5'), undefined);
  assert.equal(fenetreDepuisLibelleCursor(undefined), undefined);
});

/*
 * LA LIGNE DE COMMANDE. Le travail se fait DANS le dossier de la carte : ce
 * sont ces arguments-là qui l'y autorisent, et le mode plan qui l'en empêche.
 */
function options(extra: Partial<EngineRunOptions> = {}): EngineRunOptions {
  return {
    cwd: '/tmp/carte',
    prompt: 'fais le travail',
    fullAccess: true,
    onEvent: () => undefined,
    ...extra,
  };
}

test('la commande lance le CLI en accès complet, dans le dossier de la carte', () => {
  const args = buildCursorArgs(options(), 'claude-opus-5-high');
  assert.deepEqual(args.slice(0, 5), ['-p', '--output-format', 'stream-json', '--model', 'claude-opus-5-high']);
  // Le consentement a été donné en validant la carte : aucune fenêtre à ouvrir.
  assert.ok(args.includes('--force'));
  assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'disabled']);
  // Aucun dépôt, aucune branche distante : plus rien de l'ancien pilotage cloud.
  assert.equal(args.some((a) => /repo|github|autoCreatePR/i.test(a)), false);
});

test('le mode plan ferme l\'écriture, et une reprise garde son fil', () => {
  const plan = buildCursorArgs(options({ mode: 'plan', role: 'task' }), 'composer-2.5');
  assert.deepEqual(plan.slice(plan.indexOf('--mode'), plan.indexOf('--mode') + 2), ['--mode', 'plan']);
  assert.equal(plan.includes('--force'), false);

  const reprise = buildCursorArgs(options({ sessionId: '7eb16b33-236c' }), 'composer-2.5');
  assert.deepEqual(reprise.slice(reprise.indexOf('--resume'), reprise.indexOf('--resume') + 2), [
    '--resume',
    '7eb16b33-236c',
  ]);
  // Les outils du projet ne sont approuvés que s'il y en a à brancher.
  assert.equal(reprise.includes('--approve-mcps'), false);
  assert.ok(buildCursorArgs(options({ mcpConfigPath: '/tmp/mcp.json' }), 'composer-2.5').includes('--approve-mcps'));
});

/*
 * LE FLUX DU CLI, traduit dans les événements communs aux moteurs. Les lignes
 * reprises ici sont celles d'un vrai tour du 14/08/2026, qui a modifié un
 * fichier local.
 */
function evenements(lignes: any[]): EngineEvent[] {
  const rendus: EngineEvent[] = [];
  const attente = new Map<string, string>();
  for (const ligne of lignes) emitFromCursor(ligne, (e) => rendus.push(e), attente);
  return rendus;
}

test('le fil, le texte et la mesure remontent comme pour les autres moteurs', () => {
  const rendus = evenements([
    { type: 'system', subtype: 'init', session_id: '7eb16b33' },
    { type: 'thinking', subtype: 'delta', text: 'je réfléchis' },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Fichier modifié.' }] } },
    {
      type: 'result',
      subtype: 'success',
      session_id: '7eb16b33',
      is_error: false,
      duration_ms: 8757,
      result: 'Fichier modifié.',
      usage: { inputTokens: 13631, outputTokens: 127, cacheReadTokens: 29184, cacheWriteTokens: 0 },
    },
  ]);

  assert.deepEqual(rendus.filter((e) => e.kind === 'session').map((e) => e.sessionId), ['7eb16b33', '7eb16b33']);
  // Le raisonnement n'est pas une étape d'exécution : il ne s'affiche pas.
  assert.equal(rendus.some((e) => e.kind === 'step'), false);
  assert.deepEqual(rendus.filter((e) => e.kind === 'text').map((e) => e.text), ['Fichier modifié.']);

  const mesure = rendus.find((e) => e.kind === 'usage')?.usage;
  // Cursor compte le cache À PART : les deux parts restent disjointes.
  assert.equal(mesure?.inputTokens, 13631);
  assert.equal(mesure?.cachedTokens, 29184);
  assert.equal(mesure?.outputTokens, 127);
  assert.equal(mesure?.durationMs, 8757);
});

test('un appel d\'outil devient une étape lisible, ouverte puis refermée', () => {
  const appel = { editToolCall: { args: { path: '/tmp/carte/note.txt' } } };
  const rendus = evenements([
    { type: 'tool_call', subtype: 'started', call_id: 'tool_1', tool_call: appel },
    {
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'tool_1',
      tool_call: {
        editToolCall: {
          args: { path: '/tmp/carte/note.txt' },
          result: { success: { message: 'Wrote contents to /tmp/carte/note.txt' } },
        },
      },
    },
  ]);
  assert.equal(rendus.length, 2);
  assert.equal(rendus[0].step?.state, 'running');
  assert.match(rendus[0].step?.label ?? '', /Modification de/);
  assert.equal(rendus[1].step?.state, 'done');
  assert.match(rendus[1].step?.detail ?? '', /Wrote contents/);
});

test('un outil qui échoue le DIT, au lieu d\'une étape verte muette', () => {
  const rendus = evenements([
    {
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'tool_2',
      tool_call: { shellToolCall: { args: { command: 'npm test' }, result: { error: 'command not found' } } },
    },
  ]);
  assert.equal(rendus[0].step?.state, 'failed');
  assert.match(rendus[0].step?.detail ?? '', /command not found/);
});

test('les outils de Cursor parlent le vocabulaire commun des moteurs', () => {
  assert.deepEqual(outilCursor({ readToolCall: { args: { path: '/a/b.ts' } } }), {
    nom: 'Read',
    entree: { file_path: '/a/b.ts' },
  });
  assert.deepEqual(outilCursor({ shellToolCall: { args: { command: 'ls' } } }), {
    nom: 'Bash',
    entree: { command: 'ls' },
  });
  assert.equal(outilCursor({ globToolCall: { args: { globPattern: '**/*.ts' } } })?.nom, 'Glob');
  // Un outil du projet garde son nom, pour que l'étape dise ce qu'il est allé chercher.
  assert.equal(outilCursor({ mcpToolCall: { args: { toolName: 'project_memory' } } })?.nom, 'mcp__haikodev__project_memory');
  // Un outil jamais vu garde son nom nettoyé : une étape brute vaut mieux qu'une étape muette.
  assert.equal(outilCursor({ inconnuToolCall: { args: {} } })?.nom, 'inconnu');
  assert.equal(outilCursor({ rien: 1 }), null);
  assert.equal(outilCursor(null), null);
});

/** La liste de tâches a son propre affichage : elle n'est pas une étape. */
test('la liste de tâches du moteur s\'affiche à part', () => {
  const rendus = evenements([
    {
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'tool_3',
      tool_call: {
        updateTodosToolCall: {
          args: { todos: [{ content: 'Lire le projet', status: 'completed' }, { content: 'Écrire', status: 'in_progress' }] },
        },
      },
    },
  ]);
  assert.equal(rendus.length, 1);
  assert.equal(rendus[0].kind, 'todo');
  assert.deepEqual(rendus[0].todos, [
    { label: 'Lire le projet', state: 'done' },
    { label: 'Écrire', state: 'running' },
  ]);
});

/*
 * UNE PANNE SE DIT TOUJOURS. Un moteur qui ne peut pas partir doit nommer la
 * pièce qui manque — un témoin qui tourne sur un outil absent est le défaut que
 * ce moteur ne doit pas introduire.
 */
test('ce qui manque pour lancer un tour se dit en toutes lettres', () => {
  assert.match(manqueDuMoteurCursor(false, true) ?? '', /cursor-agent/);
  assert.match(manqueDuMoteurCursor(true, false) ?? '', /clé/);
  assert.match(manqueDuMoteurCursor(false, false) ?? '', /cursor-agent.*clé/s);
  assert.equal(manqueDuMoteurCursor(true, true), null);
});

/*
 * CE QUE LE CLI ÉCRIT EN PARTANT est en ANGLAIS et coloré pour un terminal :
 * l'afficher tel quel dans une conversation, c'est un « code 1 » déguisé. Les
 * lignes reprises ici sont celles d'un vrai lancement à clé invalide.
 */
test('la plainte du CLI est traduite avant de paraître à l\'écran', () => {
  const clePourrie =
    '[33m⚠ Warning: The provided API key is invalid.[0m\n' +
    'The API key was loaded from the CURSOR_API_KEY environment variable.\n' +
    'Please check you have the right key, create a new one, or authenticate without it.';
  assert.match(raisonDeLaSortieCursor(clePourrie, 1), /refusé la clé d'accès/);
  assert.match(raisonDeLaSortieCursor('Cannot use this model: composer-2.5[effort=high]', 1), /refusé le modèle/);
  assert.match(raisonDeLaSortieCursor('Error: rate limit exceeded', 1), /limite les appels/);
  // Une sortie jamais vue garde ses derniers mots, sans ses couleurs — une
  // phrase brute vaut mieux qu'une bulle muette.
  const inconnu = raisonDeLaSortieCursor('[31msomething odd happened[0m', 1);
  assert.equal(inconnu, 'something odd happened');
  // Rien du tout : le code, faute de mieux, mais jamais le silence.
  assert.match(raisonDeLaSortieCursor('', 3), /code 3/);
});

test('un refus est dit en français, jamais par un code nu', () => {
  assert.match(raisonDeRefusCursor(401, 'Invalid User API Key'), /refusé la clé/);
  assert.match(raisonDeRefusCursor(503), /indisponible/);
  assert.match(raisonDeRefusCursor(429), /limite les appels/);
  // Un code jamais vu se dit quand même, plutôt que de rester muet.
  assert.match(raisonDeRefusCursor(418, 'théière'), /418/);
});

test('un moteur sans quota publié n\'affiche aucune jauge', () => {
  assert.equal(moteurSansQuota('cursor'), true);
  assert.equal(moteurSansQuota('claude'), false);
  assert.equal(moteurSansQuota('codex'), false);
});

/*
 * CURSOR SUIT LES RÈGLES DÉJÀ ÉCRITES, il ne s'en invente pas : sa consigne
 * système n'est pas un préfixe de session (comme Codex), et son fichier
 * d'instructions natif est `AGENTS.md`.
 */
test('Cursor prend sa place dans les règles communes aux moteurs', () => {
  assert.equal(consigneEnTeteDeSession('cursor'), false);
  assert.equal(consigneEnTeteDeSession('claude'), true);
  assert.equal(fichierNatif('cursor'), 'AGENTS.md');
});

/*
 * LE MODE PLAN. Cursor ne rend PAS son plan dans la conversation : il n'y laisse
 * qu'une narration et pose le plan entier dans un appel `createPlanToolCall`
 * (constaté sur un vrai tour le 14/08/2026, `scripts/verif-mode-plan-cursor.mjs`).
 * Sans traduction, le cadre du plan et ses boutons de décision ne paraissent
 * jamais — le démon ne voit aucune des quatre parties.
 */
function appelDePlan(subtype: 'started' | 'completed', plan: string, todos?: unknown[]) {
  return {
    type: 'tool_call',
    subtype,
    call_id: 'plan-1',
    tool_call: { createPlanToolCall: { args: { plan, overview: 'Résumé', todos } } },
  };
}

test('le plan de Cursor revient dans la conversation, pas dans le journal des étapes', () => {
  const vus: EngineEvent[] = [];
  const attente = new Map<string, string>();
  const texte = '## Faisabilité\nOui.\n\n## Chemin à suivre\n1. Faire.\n';
  emitFromCursor(appelDePlan('completed', texte), (e) => vus.push(e), attente);

  assert.deepEqual(vus.filter((e) => e.kind === 'text').map((e: any) => e.text), [texte.trim()]);
  // Une étape nommée « createPlan » à la place du plan, c'est le défaut réparé.
  assert.equal(vus.some((e) => e.kind === 'step'), false);
});

test('le même plan annoncé deux fois n’arrive qu’une fois dans le fil', () => {
  const vus: EngineEvent[] = [];
  const attente = new Map<string, string>();
  emitFromCursor(appelDePlan('started', 'Le plan'), (e) => vus.push(e), attente);
  emitFromCursor(appelDePlan('completed', 'Le plan'), (e) => vus.push(e), attente);
  assert.equal(vus.filter((e) => e.kind === 'text').length, 1);
});

test('les étapes du plan deviennent une liste de tâches, jamais une étape muette', () => {
  const vus: EngineEvent[] = [];
  const attente = new Map<string, string>();
  emitFromCursor(
    appelDePlan('completed', 'Le plan', [{ id: 'a', content: 'Faire', status: 'TODO_STATUS_PENDING' }]),
    (e) => vus.push(e),
    attente,
  );
  const taches = vus.find((e) => e.kind === 'todo') as any;
  assert.equal(taches?.todos?.length, 1);
});

test('un plan sans texte se rabat sur son résumé plutôt que de se perdre', () => {
  assert.equal(texteDuPlanCursor({ plan: '   ', overview: 'Résumé' }), 'Résumé');
  assert.equal(texteDuPlanCursor({ plan: 'Le plan', overview: 'Résumé' }), 'Le plan');
  assert.equal(texteDuPlanCursor({}), null);
  assert.equal(texteDuPlanCursor(null), null);
});

/*
 * LE CRÉDIT DÉPENSÉ. Cursor facture à la dépense : là où les autres moteurs
 * montrent une jauge, c'est un MONTANT qui se lit. Il ne se reconstitue pas
 * depuis des jetons et un tarif deviné — il se demande, et son absence se DIT.
 */
test('la dépense est la somme des lignes, jamais la première', () => {
  const credit = creditDepuisReponseCursor({
    teamMemberSpend: [{ spendCents: 1250 }, { spendCents: 340 }],
    subscriptionCycleStart: 1786000000000,
  });
  assert.equal(credit.centimes, 1590);
  assert.equal(credit.membres, 2);
  assert.equal(credit.indisponible, undefined);
});

test('une réponse illisible rend « indisponible », jamais zéro', () => {
  assert.ok(creditDepuisReponseCursor(null).indisponible);
  assert.ok(creditDepuisReponseCursor({ teamMemberSpend: [] }).indisponible);
  assert.ok(creditDepuisReponseCursor({ teamMemberSpend: [{}] }).indisponible);
  assert.equal(creditDepuisReponseCursor({ teamMemberSpend: [{}] }).centimes, undefined);
});

test('un montant se lit en dollars, la devise de Cursor, jamais converti', () => {
  assert.match(montantCursorEnClair(1590), /15[.,]90/);
  assert.match(montantCursorEnClair(1590), /USD/);
  assert.match(montantCursorEnClair(0), /0[.,]00/);
});

test('une clé personnelle ne peut pas lire la dépense, et la phrase le dit', () => {
  assert.match(CREDIT_HORS_DE_PORTEE, /clé d'administration d'équipe/);
  assert.match(periodeDuCreditCursor(undefined), /cycle de facturation/);
  assert.match(periodeDuCreditCursor(1786000000000), /Dépense depuis le/);
});
