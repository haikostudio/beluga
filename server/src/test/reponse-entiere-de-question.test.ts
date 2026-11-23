import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detailDEtape,
  plafondDuDetailDEtape,
  PLAFOND_DETAIL_D_ETAPE,
  separerLaReponse,
  texteDeReponseALaQuestion,
  vueDeLEntree,
  type EntreeJournal,
} from '@beluga/shared';
import { emitFromClaude } from '../engines/claude.js';
import { emitFromCodex } from '../engines/codex.js';
import { emitFromCursor } from '../engines/cursor.js';
import { EngineEvent } from '../engines/types.js';

/*
 * LA PRÉCISION ÉCRITE À LA MAIN SOUS UNE QUESTION RESTE ENTIÈRE. Les trois
 * adaptateurs coupaient le résultat d'un outil à 400 signes : celui de
 * `ask_user` est la réponse de l'utilisateur, que l'encadré « Question posée »
 * relit — elle s'arrêtait au milieu d'un mot.
 */

const COMPLEMENT = `${'Donc Marc-Olivier et moi, on veut que la page parle aux familles. '.repeat(10)}Fin.`;
const REPONSE = `Option A — ${COMPLEMENT}`;
const RESULTAT = texteDeReponseALaQuestion(REPONSE);

function detailFinal(events: EngineEvent[]): string | undefined {
  return events.filter((e) => e.kind === 'step' && e.step?.state === 'done').at(-1)?.step?.detail;
}

function relu(detail: string | undefined) {
  const entree: EntreeJournal = {
    id: 'e1',
    cardId: 'c1',
    phase: 'execution',
    nature: 'requete',
    at: 1,
    rang: 1,
    libelle: 'Question',
    outil: 'mcp__beluga__ask_user',
    params: JSON.stringify({ question: 'Pour qui ?', kind: 'single', options: [{ label: 'Option A' }, { label: 'Option B' }] }),
    resultat: detail ?? '',
  };
  const vue = vueDeLEntree(entree);
  assert.equal(vue.sorte, 'question');
  return vue.sorte === 'question' ? vue.reponse : undefined;
}

test('seuls les outils de question échappent à la coupe à 400 signes', () => {
  assert.ok(COMPLEMENT.length > 600);
  assert.equal(plafondDuDetailDEtape('Bash'), PLAFOND_DETAIL_D_ETAPE);
  assert.equal(plafondDuDetailDEtape('mcp__beluga__memoire'), PLAFOND_DETAIL_D_ETAPE);
  assert.equal(plafondDuDetailDEtape(undefined), PLAFOND_DETAIL_D_ETAPE);
  assert.ok(plafondDuDetailDEtape('mcp__beluga__ask_user') > 4000);
  assert.ok(plafondDuDetailDEtape('ask_user') > 4000);
  assert.equal(detailDEtape('Bash', 'x'.repeat(1000))?.length, 400);
  assert.equal(detailDEtape('Bash', undefined), undefined);
});

test('Claude : la réponse longue ressort entière, choix et complément séparés', () => {
  const events: EngineEvent[] = [];
  const pending = new Map<string, string>();
  emitFromClaude(
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_q1', name: 'mcp__beluga__ask_user', input: { question: 'Pour qui ?' } }] } },
    (e) => events.push(e),
    pending,
  );
  emitFromClaude(
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_q1', content: [{ type: 'text', text: RESULTAT }] }] } },
    (e) => events.push(e),
    pending,
  );
  const reponse = relu(detailFinal(events));
  assert.equal(reponse, REPONSE);
  const separee = separerLaReponse(reponse, ['Option A', 'Option B']);
  assert.deepEqual(separee.libelles, ['Option A']);
  assert.equal(separee.complement, COMPLEMENT);
});

test('Claude : une sortie de commande reste coupée à 400 signes', () => {
  const events: EngineEvent[] = [];
  const pending = new Map<string, string>();
  emitFromClaude(
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_b1', name: 'Bash', input: { command: 'ls' } }] } },
    (e) => events.push(e),
    pending,
  );
  emitFromClaude(
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_b1', content: 'y'.repeat(2000) }] } },
    (e) => events.push(e),
    pending,
  );
  assert.equal(detailFinal(events)?.length, 400);
});

test('Cursor : la réponse longue ressort entière', () => {
  const events: EngineEvent[] = [];
  const pending = new Map<string, string>();
  const appel = (result?: unknown) => ({ mcpToolCall: { args: { toolName: 'ask_user', question: 'Pour qui ?' }, result } });
  emitFromCursor({ type: 'tool_call', subtype: 'started', call_id: 'c1', tool_call: appel() }, (e) => events.push(e), pending);
  emitFromCursor(
    { type: 'tool_call', subtype: 'completed', call_id: 'c1', tool_call: appel({ success: { content: [{ text: { text: RESULTAT } }] } }) },
    (e) => events.push(e),
    pending,
  );
  assert.equal(relu(detailFinal(events)), REPONSE);
});

test('Codex : la réponse est recopiée, entière — elle ne l’était pas du tout', () => {
  const events: EngineEvent[] = [];
  emitFromCodex(
    {
      type: 'item.completed',
      item: {
        id: 'item_q',
        type: 'mcp_tool_call',
        tool: 'ask_user',
        arguments: { question: 'Pour qui ?' },
        status: 'completed',
        result: { content: [{ type: 'text', text: RESULTAT }] },
      },
    },
    (e) => events.push(e),
  );
  assert.equal(relu(detailFinal(events)), REPONSE);
});

test('une réponse avec pièces jointes garde son texte entier, sans la mention des fichiers', () => {
  const avecFichiers = texteDeReponseALaQuestion(COMPLEMENT, ['#img1 — /tmp/a.png']);
  const reponse = relu(detailDEtape('mcp__beluga__ask_user', avecFichiers));
  assert.equal(reponse, COMPLEMENT);
});
