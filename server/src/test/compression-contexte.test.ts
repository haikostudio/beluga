import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Agent,
  PLAFOND_CONTEXTE_JETONS,
  contexteApresCompression,
  observerContexte,
  plafondDeContexte,
  resumeContinuite,
  seuilDeCompression,
} from '@haikodev/shared';
import {
  contexteDepuisResultatClaude,
  emitFromClaude,
  lireCommandeContexteClaude,
} from '../engines/claude.js';
import { emitFromCodex, lireContexteCodex } from '../engines/codex.js';
import { EngineEvent } from '../engines/types.js';

test('49 % ne déclenche aucune compression, pour les deux moteurs', () => {
  for (const moteur of ['claude', 'codex']) {
    const observation = observerContexte(undefined, 49_000, 100_000);
    assert.equal(observation?.shouldCompress, false, moteur);
    assert.equal(observation?.state.ratio, 0.49, moteur);
  }
});

test('50 % déclenche exactement une compression au franchissement', () => {
  const observation = observerContexte(undefined, 50_000, 100_000)!;
  assert.equal(observation.shouldCompress, true);
  assert.equal(observation.state.pending, true);

  const apres = contexteApresCompression(observation.state, {
    at: 123,
    method: 'summary',
    tokens: 8_000,
  });
  assert.equal(apres.ratio, 0.08);
  assert.equal(apres.pending, false);
  assert.equal(apres.armed, false);
  assert.equal(apres.lastCompressionAt, 123);
  assert.equal(apres.lastCompressionTokens, 50_000);
  assert.equal(apres.compressionCount, 1);

  // Même si une mesure remonte aussitôt au seuil, la compression ne boucle pas.
  assert.equal(observerContexte(apres, 50_000, 100_000)?.shouldCompress, false);
});

test('après avoir réellement redescendu, un franchissement futur peut recompresser', () => {
  const premiere = observerContexte(undefined, 50_000, 100_000)!;
  const apres = contexteApresCompression(premiere.state, { at: 1, method: 'native', tokens: 10_000 });
  const redescendu = observerContexte(apres, 12_000, 100_000)!;
  assert.equal(redescendu.state.armed, true);
  assert.equal(redescendu.shouldCompress, false);
  assert.equal(observerContexte(redescendu.state, 51_000, 100_000)?.shouldCompress, true);
});

/* ------------------------------------------------------------------ */
/* UNE FENÊTRE D'UN MILLION N'ÉTEINT PLUS LA COMPRESSION.              */
/*                                                                     */
/* Relevé du 17/08/2026 : UNE seule compression en sept jours sur 376  */
/* agents, pour des contextes qui tournent entre 148 000 et 190 000    */
/* jetons. Le seuil valait 500 000 — la moitié d'une fenêtre annoncée. */
/* ------------------------------------------------------------------ */

test('le seuil est le plus petit des deux : part de fenêtre et plafond en jetons', () => {
  // Petite fenêtre : c'est la part qui commande, comme avant.
  assert.equal(seuilDeCompression(100_000), 50_000);
  assert.equal(seuilDeCompression(200_000), 100_000);
  // Fenêtre d'un million : le plafond commande, et non 500 000.
  assert.equal(seuilDeCompression(1_000_000), PLAFOND_CONTEXTE_JETONS);
  assert.equal(seuilDeCompression(2_000_000), PLAFOND_CONTEXTE_JETONS);
});

test('un contexte de 190 000 jetons en fenêtre d’un million se compresse enfin', () => {
  const observation = observerContexte(undefined, 190_000, 1_000_000)!;
  assert.equal(observation.shouldCompress, true);
  // La part de fenêtre, elle, n'aurait rien vu : 19 % seulement.
  assert.equal(observation.state.ratio, 0.19);
});

test('sous le plafond, rien ne part — et le garde-fou anti-boucle compte en jetons', () => {
  assert.equal(observerContexte(undefined, 99_000, 1_000_000)?.shouldCompress, false);

  const premiere = observerContexte(undefined, 150_000, 1_000_000)!;
  const apres = contexteApresCompression(premiere.state, { at: 1, method: 'native', tokens: 120_000 });
  // Une compression qui n'a pas fait redescendre sous le seuil ne repart pas.
  assert.equal(observerContexte(apres, 120_000, 1_000_000)?.shouldCompress, false);
  const redescendu = observerContexte(apres, 30_000, 1_000_000)!;
  assert.equal(redescendu.state.armed, true);
  assert.equal(observerContexte(redescendu.state, 101_000, 1_000_000)?.shouldCompress, true);
});

test('le chef d’orchestre a un plafond plus bas que les autres rôles', () => {
  assert.ok(plafondDeContexte('cadrage') < plafondDeContexte('task'));
  assert.equal(plafondDeContexte('task'), PLAFOND_CONTEXTE_JETONS);
  assert.equal(plafondDeContexte(undefined), PLAFOND_CONTEXTE_JETONS);
  // Les 107 155 jetons de fil mesurés sur un vrai chef partent en compression.
  const chef = observerContexte(undefined, 107_155, 1_000_000, plafondDeContexte('cadrage'));
  assert.equal(chef?.shouldCompress, true);
});

test('Claude normalise le dernier appel, pas le total cumulé du tour', () => {
  const resultat = {
    usage: {
      input_tokens: 900_000,
      iterations: [
        { input_tokens: 2, cache_creation_input_tokens: 14_000, cache_read_input_tokens: 15_000, output_tokens: 500 },
      ],
    },
    modelUsage: {
      principal: { inputTokens: 900_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, contextWindow: 100_000 },
      sousAgent: { inputTokens: 500_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, contextWindow: 200_000 },
    },
  };
  assert.deepEqual(contexteDepuisResultatClaude(resultat), { tokens: 29_502, window: 100_000 });

  const events: EngineEvent[] = [];
  emitFromClaude({ type: 'result', ...resultat }, (e) => events.push(e), new Map());
  assert.deepEqual(events.find((e) => e.kind === 'context')?.context, { tokens: 29_502, window: 100_000 });
  assert.equal(events.find((e) => e.kind === 'usage')?.usage?.inputTokens, 900_000);
});

test('la commande locale de Claude rend la taille après compression', () => {
  assert.deepEqual(lireCommandeContexteClaude('**Tokens:** 29.4k / 1m (3%)'), {
    tokens: 29_400,
    window: 1_000_000,
  });
});

test('Claude rend explicitement le succès ou l’échec de sa compression native', () => {
  const events: EngineEvent[] = [];
  emitFromClaude(
    { type: 'system', subtype: 'status', compact_result: 'success' },
    (event) => events.push(event),
    new Map(),
  );
  emitFromClaude(
    { type: 'system', subtype: 'status', compact_result: 'failed', compact_error: 'trop court' },
    (event) => events.push(event),
    new Map(),
  );
  assert.deepEqual(events.map((event) => event.compaction), [
    { ok: true, error: undefined },
    { ok: false, error: 'trop court' },
  ]);
});

test('Codex lit le dernier appel et la fenêtre dans sa session native', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'contexte-codex-'));
  const sessionId = '019fe13e-2e40-72b2-af48-a0b786ca74d4';
  const dossier = path.join(home, 'sessions', '2026', '08', '08');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(
    path.join(dossier, `rollout-essai-${sessionId}.jsonl`),
    `${JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { total_tokens: 3_000_000 },
          last_token_usage: { input_tokens: 49_500, output_tokens: 700, total_tokens: 50_200 },
          model_context_window: 100_000,
        },
      },
    })}\n`,
  );
  assert.deepEqual(lireContexteCodex(home, sessionId), { tokens: 50_200, window: 100_000 });
  fs.rmSync(home, { recursive: true, force: true });
});

test('l’ancien événement Codex porte aussi le remplissage exact', () => {
  const events: EngineEvent[] = [];
  emitFromCodex(
    {
      msg: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 800_000, output_tokens: 20_000 },
          last_token_usage: { input_tokens: 49_000, output_tokens: 1_000, total_tokens: 50_000 },
          model_context_window: 100_000,
        },
      },
    },
    (event) => events.push(event),
  );
  assert.deepEqual(events.find((e) => e.kind === 'context')?.context, { tokens: 50_000, window: 100_000 });
});

test('le résumé de continuité garde carte, décisions, tâches et dossier', () => {
  const resume = resumeContinuite({
    project: 'HaikoDev',
    workdir: '/tmp/carte',
    role: 'task',
    title: 'Compression',
    card: { title: 'Compresser', description: 'À 50 %', column: 'running' },
    decisions: ['Format → JSON'],
    todos: ['done : mesurer', 'running : reprendre'],
    attachments: ['/tmp/image.png'],
    exchanges: [
      { role: 'user', content: 'Garde le seuil à 50 %.' },
      { role: 'assistant', content: 'Décision retenue.' },
    ],
  });
  for (const indispensable of ['HaikoDev', '/tmp/carte', 'Compresser', 'Format → JSON', 'running : reprendre', '/tmp/image.png', '50 %']) {
    assert.match(resume, new RegExp(indispensable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('tous les rôles d’agent savent conserver le dernier remplissage', () => {
  for (const role of ['task', 'cadrage', 'analysis', 'deploy'] as const) {
    const agent = Agent.parse({
      id: role,
      projectId: 'p',
      role,
      title: role,
      run: { engine: 'codex' },
      status: 'done',
      context: {
        tokens: 20_000,
        window: 100_000,
        ratio: 0.2,
        armed: true,
        pending: false,
        lastCompressionAt: 42,
      },
      createdAt: 1,
      updatedAt: 1,
    });
    assert.equal(agent.context?.lastCompressionAt, 42, role);
  }
});
