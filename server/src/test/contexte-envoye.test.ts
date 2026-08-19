import test from 'node:test';
import assert from 'node:assert/strict';
import { jetonsApproches } from '@haikodev/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCodexArgs } from '../engines/codex.js';
import { instantaneContexteEnvoye, mesureEntreeMoteur } from '../runtime.js';
import { chronologieContexteEnvoye, recapitulatifEnvoi } from '@haikodev/shared';

const PROMPT = 'DEMANDE : montre exactement ce nouveau contenu.';
const BLOCS = [{ kind: 'request' as const, label: 'Demande utilisateur', characters: PROMPT.length }];

test('premier tour : l’instantané porte le prompt exact remis à l’adaptateur', () => {
  const instantane = instantaneContexteEnvoye({
    engine: 'codex',
    model: 'gpt-5.4',
    nouvelleSession: true,
    prompt: PROMPT,
    systemPrompt: 'CONSIGNE COMPLÈTE',
    blocks: BLOCS,
    sentAt: 10,
  });
  const args = buildCodexArgs({
    cwd: '/tmp',
    prompt: PROMPT,
    model: 'gpt-5.4',
    systemPrompt: instantane.systemInstruction.content,
    fullAccess: true,
    onEvent: () => {},
  });

  assert.equal(instantane.prompt, PROMPT);
  assert.equal(instantane.session, 'new');
  assert.equal(instantane.systemInstruction.kind, 'full');
  assert.equal(args.at(-1), `CONSIGNE COMPLÈTE\n\n---\n\n${instantane.prompt}`);
});

test('reprise : seul le nouveau prompt et le rappel sont montrés', () => {
  const instantane = instantaneContexteEnvoye({
    engine: 'claude',
    nouvelleSession: false,
    prompt: PROMPT,
    systemPrompt: 'RAPPEL COURT',
    blocks: BLOCS,
  });

  assert.equal(instantane.prompt, PROMPT);
  assert.equal(instantane.session, 'resumed');
  assert.equal(instantane.systemInstruction.kind, 'reminder');
  assert.equal(instantane.systemInstruction.transport, 'separate');
  assert.equal(instantane.history, 'retained_by_engine');
  assert.doesNotMatch(JSON.stringify(instantane), /ancien message opaque/);
});

test('sans passage retrouvé, l’instantané porte la raison — jamais silencieux', () => {
  const instantane = instantaneContexteEnvoye({
    engine: 'claude',
    nouvelleSession: false,
    prompt: PROMPT,
    systemPrompt: 'RAPPEL COURT',
    blocks: BLOCS,
    passagesRaison: 'Reprise de session : la mémoire a déjà été transmise au premier tour de ce fil.',
  });
  assert.deepEqual(instantane.passages, []);
  assert.equal(instantane.passagesRaison, 'Reprise de session : la mémoire a déjà été transmise au premier tour de ce fil.');
});

test('des passages retrouvés effacent la raison — les deux ne coexistent jamais', () => {
  const instantane = instantaneContexteEnvoye({
    engine: 'claude',
    nouvelleSession: true,
    prompt: PROMPT,
    systemPrompt: 'CONSIGNE COMPLÈTE',
    blocks: BLOCS,
    passages: [{ source: 'docs/regles/cartes.md', titre: 'Cartes', score: 0.6, tokens: 100, texte: 'texte' }],
    passagesRaison: 'ne devrait jamais apparaître',
  });
  assert.equal(instantane.passages.length, 1);
  assert.equal(instantane.passagesRaison, undefined);
});

test('la mesure affichée vient de l’usage moteur et sépare le cache', () => {
  assert.deepEqual(mesureEntreeMoteur({ inputTokens: 700, cachedTokens: 300, outputTokens: 120 }), {
    inputTokens: 700,
    cachedInputTokens: 300,
    totalInputTokens: 700,
  });
  assert.deepEqual(mesureEntreeMoteur({ inputTokens: 700, outputTokens: 120 }), {
    inputTokens: 700,
    cachedInputTokens: undefined,
    totalInputTokens: 700,
  });
});

test('une demande mise en file ne reçoit aucun instantané avant son vrai départ', () => {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const runtime = fs.readFileSync(path.resolve(ici, '../../src/runtime.ts'), 'utf8');
  const sendPrompt = runtime.split('export async function sendPrompt')[1].split('\n/**\n * Le bloc « carte en cours »')[0];
  // La file s'ouvre dès la PRÉPARATION, pas au seul moteur lancé : deux demandes
  // trop rapprochées se suivent au lieu de se doubler (`demandes-rapprochees`).
  const file = sendPrompt.indexOf('if (live.has(agentId) || demarrant.has(agentId))');
  const retour = sendPrompt.indexOf('return;', file);
  const message = sendPrompt.indexOf('let userMessageId');
  const depart = runtime.indexOf('adapter.run({');
  const rattachement = runtime.indexOf('sentContext: instantane', depart);

  assert.ok(file >= 0 && retour > file && message > retour, 'la file rend la main avant de créer le message utilisateur');
  assert.ok(depart >= 0 && rattachement > depart, 'l’instantané n’est rattaché qu’après le lancement par l’adaptateur');
  assert.doesNotMatch(sendPrompt.slice(message, message + 700), /text\.length \/ 4/);
});

test('un moteur lancé est suivi AVANT tout autre travail — aucune fenêtre aveugle', () => {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const runtime = fs.readFileSync(path.resolve(ici, '../../src/runtime.ts'), 'utf8');
  const depart = runtime.indexOf('adapter.run({');
  const suivi = runtime.indexOf('live.set(agent.id, runState)', depart);
  const rattachement = runtime.indexOf('sentContext: instantane', depart);

  // Entre le lancement du moteur et son inscription dans les tours vivants, une
  // panne refermerait un tour BIEN VIVANT : bulle rouge sur un travail qui
  // continue, et moteur laissé seul. Le suivi passe donc devant.
  assert.ok(suivi > depart, 'le tour entre dans les tours vivants dès que le moteur est lancé');
  assert.ok(rattachement > suivi, 'le contexte envoyé s’enregistre après, jamais avant le suivi');
});

function tourEssai(sentAt: number, memoireCaracteres: number, usage?: { inputTokens: number; cachedInputTokens?: number }) {
  return {
    engine: 'claude' as const,
    session: 'resumed' as const,
    prompt: 'demande',
    systemInstruction: { kind: 'reminder' as const, content: 'rappel', transport: 'separate' as const },
    blocks: [{ kind: 'memory' as const, label: 'faits ajoutés', characters: memoireCaracteres }],
    passages: [],
    passagesRaison: 'sans objet pour cet essai',
    history: 'retained_by_engine' as const,
    usage,
    sentAt,
  };
}

test('la chronologie numérote les tours dans l’ordre où ils sont réellement partis', () => {
  const messages = [
    { id: 'm-2', sentContext: tourEssai(200, 400, { inputTokens: 500 }) },
    { id: 'm-1', sentContext: tourEssai(100, 800, { inputTokens: 1000, cachedInputTokens: 200 }) },
    { id: 'm-sans', sentContext: undefined },
  ];
  const tours = chronologieContexteEnvoye(messages);
  assert.deepEqual(
    tours.map((t) => [t.numero, t.messageId]),
    [[1, 'm-1'], [2, 'm-2']],
  );
  // 800 signes de mémoire, au rapport MESURÉ de 2,2 signes par jeton.
  assert.equal(tours[0].repartition.memoireTokens, jetonsApproches(800));
  assert.equal(tours[1].repartition.envoyeTokens, 500);
});

test('le récapitulatif additionne la mémoire et l’envoi de tous les tours mesurés', () => {
  const tours = chronologieContexteEnvoye([
    { id: 'm-1', sentContext: tourEssai(100, 800, { inputTokens: 1000, cachedInputTokens: 200 }) },
    { id: 'm-2', sentContext: tourEssai(200, 400, { inputTokens: 500 }) },
  ]);
  const recap = recapitulatifEnvoi(tours);
  assert.equal(recap.tours, 2);
  assert.equal(recap.memoireTotale, jetonsApproches(800) + jetonsApproches(400));
  assert.equal(recap.envoyeTotal, 1_700);
});

test('un envoi non mesuré ne fausse pas le total : il reste indéfini plutôt que sous-évalué', () => {
  const tours = chronologieContexteEnvoye([{ id: 'm-1', sentContext: tourEssai(100, 800) }]);
  const recap = recapitulatifEnvoi(tours);
  assert.equal(recap.envoyeTotal, undefined);
});
