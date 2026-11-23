import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Agent,
  LIMITE_HISTORIQUE_COMPRESSIONS,
  contexteApresCompression,
  observerContexte,
  plafondDeContexte,
  raisonDeRepli,
  repliSansSecondAppel,
  resumeContinuite,
  seuilDeCompression,
} from '@beluga/shared';
import {
  contexteDepuisResultatClaude,
  emitFromClaude,
  lireCommandeContexteClaude,
} from '../engines/claude.js';
import { emitFromCodex, lireContexteCodex } from '../engines/codex.js';
import { EngineEvent } from '../engines/types.js';

test('79 % ne déclenche aucune compression, pour les deux moteurs', () => {
  for (const moteur of ['claude', 'codex']) {
    const observation = observerContexte(undefined, 79_000, 100_000);
    assert.equal(observation?.shouldCompress, false, moteur);
    assert.equal(observation?.state.ratio, 0.79, moteur);
  }
});

test('80 % déclenche exactement une compression au franchissement', () => {
  const observation = observerContexte(undefined, 80_000, 100_000)!;
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
  assert.equal(apres.lastCompressionTokens, 80_000);
  assert.equal(apres.compressionCount, 1);

  // Même si une mesure remonte aussitôt au seuil, la compression ne boucle pas.
  assert.equal(observerContexte(apres, 80_000, 100_000)?.shouldCompress, false);
});

test('après avoir réellement redescendu, un franchissement futur peut recompresser', () => {
  const premiere = observerContexte(undefined, 80_000, 100_000)!;
  const apres = contexteApresCompression(premiere.state, { at: 1, method: 'native', tokens: 10_000 });
  const redescendu = observerContexte(apres, 12_000, 100_000)!;
  assert.equal(redescendu.state.armed, true);
  assert.equal(redescendu.shouldCompress, false);
  assert.equal(observerContexte(redescendu.state, 81_000, 100_000)?.shouldCompress, true);
});

/* ------------------------------------------------------------------ */
/* LE SEUIL EST 80 % DE LA FENÊTRE, SANS PLAFOND EN JETONS.            */
/*                                                                     */
/* Il remplace la règle DEC-119 (plus petit de 0,5 de la fenêtre et    */
/* 100 000 jetons). Sur une fenêtre d'un million il vaut 800 000 : le  */
/* risque est connu et assumé, voir l'en-tête de `contexte-agent.ts`.  */
/* ------------------------------------------------------------------ */

test('le seuil est 80 % de la fenêtre, quelle que soit sa taille', () => {
  assert.equal(seuilDeCompression(100_000), 80_000);
  assert.equal(seuilDeCompression(200_000), 160_000);
  assert.equal(seuilDeCompression(1_000_000), 800_000);
  assert.equal(seuilDeCompression(2_000_000), 1_600_000);
  // Une fenêtre inconnue ne donne jamais un seuil fantaisiste.
  assert.equal(seuilDeCompression(0), 0);
});

test('un contexte de 190 000 jetons en fenêtre d’un million ne se compresse plus tout seul', () => {
  const observation = observerContexte(undefined, 190_000, 1_000_000)!;
  assert.equal(observation.shouldCompress, false);
  assert.equal(observerContexte(undefined, 800_000, 1_000_000)?.shouldCompress, true);
});

test('le garde-fou anti-boucle compte toujours en jetons, au seuil de 80 %', () => {
  const premiere = observerContexte(undefined, 160_000, 200_000)!;
  assert.equal(premiere.shouldCompress, true);
  const apres = contexteApresCompression(premiere.state, { at: 1, method: 'native', tokens: 150_000 });
  // Une compression qui n'a pas fait redescendre sous le seuil ne repart pas.
  assert.equal(observerContexte(apres, 150_000, 200_000)?.shouldCompress, false);
  assert.equal(observerContexte(apres, 170_000, 200_000)?.shouldCompress, false);
  const redescendu = observerContexte(apres, 30_000, 200_000)!;
  assert.equal(redescendu.state.armed, true);
  assert.equal(observerContexte(redescendu.state, 161_000, 200_000)?.shouldCompress, true);
});

test('l’agent de tâche n’a pas de plafond, le cadrage garde le sien', () => {
  assert.equal(plafondDeContexte('task'), Infinity);
  assert.equal(plafondDeContexte(undefined), Infinity);
  assert.equal(plafondDeContexte('cadrage'), 60_000);
  // Les 107 155 jetons de fil mesurés sur un vrai cadrage partent en compression.
  const cadrage = observerContexte(undefined, 107_155, 1_000_000, plafondDeContexte('cadrage'));
  assert.equal(cadrage?.shouldCompress, true);
  assert.equal(seuilDeCompression(1_000_000, plafondDeContexte('cadrage')), 60_000);
});

/* ------------------------------------------------------------------ */
/* L'HISTORIQUE DES COMPRESSIONS, GARDÉ DANS L'AGENT.                  */
/* ------------------------------------------------------------------ */

test('une compression native pose une entrée avec le niveau avant et après', () => {
  const premiere = observerContexte(undefined, 80_000, 100_000)!;
  const apres = contexteApresCompression(premiere.state, { at: 1_000, method: 'native', tokens: 12_000, window: 100_000 });
  assert.deepEqual(apres.historiqueCompressions, [
    {
      at: 1_000,
      method: 'native',
      tokensAvant: 80_000,
      pourcentageAvant: 80,
      tokensApres: 12_000,
      pourcentageApres: 12,
      window: 100_000,
    },
  ]);
});

test('un résumé de repli ne pose jamais un faux 0 % : le niveau après se lit au tour suivant', () => {
  const premiere = observerContexte(undefined, 80_000, 100_000)!;
  const apres = contexteApresCompression(premiere.state, {
    at: 2_000,
    method: 'summary',
    tokens: 0,
    raison: 'delai',
  });
  const entree = apres.historiqueCompressions![0];
  assert.equal(entree.tokensApres, undefined);
  assert.equal(entree.pourcentageApres, undefined);
  assert.equal(entree.raison, 'delai');

  // Première mesure du tour suivant : l'entrée ouverte se complète, une seule fois.
  const suivante = observerContexte(apres, 9_000, 100_000)!;
  assert.equal(suivante.state.historiqueCompressions![0].tokensApres, 9_000);
  assert.equal(suivante.state.historiqueCompressions![0].pourcentageApres, 9);
  const encore = observerContexte(suivante.state, 30_000, 100_000)!;
  assert.equal(encore.state.historiqueCompressions![0].tokensApres, 9_000);
});

test('l’historique garde les 50 dernières compressions, la plus récente en premier', () => {
  let etat = observerContexte(undefined, 80_000, 100_000)!.state;
  for (let i = 1; i <= 55; i++) {
    etat = contexteApresCompression(etat, { at: i, method: 'native', tokens: 10_000 });
    etat = observerContexte(etat, 10_000, 100_000)!.state;
    etat = observerContexte(etat, 80_000, 100_000)!.state;
  }
  assert.equal(etat.historiqueCompressions!.length, LIMITE_HISTORIQUE_COMPRESSIONS);
  assert.equal(etat.historiqueCompressions![0].at, 55);
  assert.equal(etat.historiqueCompressions![49].at, 6);
  assert.equal(etat.compressionCount, 55);
});

test('un agent enregistré sans historique est relu, et l’historique s’y ajoute', () => {
  const agent = Agent.parse({
    id: 'ancien',
    projectId: 'p',
    role: 'task',
    title: 'ancien',
    run: { engine: 'claude' },
    status: 'done',
    context: { tokens: 20_000, window: 100_000, ratio: 0.2, compressionCount: 3, lastCompressionAt: 7 },
    createdAt: 1,
    updatedAt: 1,
  });
  assert.equal(agent.context?.historiqueCompressions, undefined);
  const apres = contexteApresCompression(agent.context!, { at: 9, method: 'native', tokens: 5_000 });
  assert.equal(apres.historiqueCompressions?.length, 1);
  assert.equal(apres.compressionCount, 4);
});

test('une entrée d’historique passe le schéma de l’agent', () => {
  const etat = contexteApresCompression(observerContexte(undefined, 80_000, 100_000)!.state, {
    at: 5,
    method: 'summary',
    tokens: 0,
    raison: 'quota',
  });
  const agent = Agent.parse({
    id: 'a',
    projectId: 'p',
    role: 'task',
    title: 'a',
    run: { engine: 'claude' },
    status: 'done',
    context: etat,
    createdAt: 1,
    updatedAt: 1,
  });
  assert.equal(agent.context?.historiqueCompressions?.[0].raison, 'quota');
});

test('le repli se classe selon l’échec de la compression native', () => {
  assert.equal(
    raisonDeRepli("Le moteur ne rendait pas la main : il a été arrêté pour ne pas bloquer l'agent."),
    'delai',
  );
  assert.equal(raisonDeRepli("Error during compaction: You've hit your session limit · resets 12pm (UTC)"), 'quota');
  assert.equal(raisonDeRepli('spawn claude ENOENT'), 'indisponible');
  assert.equal(raisonDeRepli("La session a été compactée, mais sa nouvelle taille n'a pas pu être mesurée."), 'mesure');
  assert.equal(raisonDeRepli('trop court'), 'refus');
  assert.equal(raisonDeRepli(undefined), 'refus');
  // Un moteur muet ou à la limite ne répond pas davantage au résumé : pas de second appel.
  assert.equal(repliSansSecondAppel('delai'), true);
  assert.equal(repliSansSecondAppel('quota'), true);
  assert.equal(repliSansSecondAppel('indisponible'), true);
  assert.equal(repliSansSecondAppel('refus'), false);
  assert.equal(repliSansSecondAppel('mesure'), false);
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
    project: 'Beluga Build',
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
  for (const indispensable of ['Beluga Build', '/tmp/carte', 'Compresser', 'Format → JSON', 'running : reprendre', '/tmp/image.png', '50 %']) {
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
