import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCodexArgs } from '../engines/codex.js';
import { instantaneContexteEnvoye, mesureEntreeMoteur } from '../runtime.js';

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

test('la mesure affichée vient de l’usage moteur et sépare le cache', () => {
  assert.deepEqual(mesureEntreeMoteur({ inputTokens: 700, cachedTokens: 300, outputTokens: 120 }), {
    inputTokens: 700,
    cachedInputTokens: 300,
    totalInputTokens: 1_000,
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
  const file = sendPrompt.indexOf('if (live.has(agentId))');
  const retour = sendPrompt.indexOf('return;', file);
  const message = sendPrompt.indexOf('let userMessageId');
  const depart = runtime.indexOf('adapter.run({');
  const rattachement = runtime.indexOf('sentContext: instantane', depart);

  assert.ok(file >= 0 && retour > file && message > retour, 'la file rend la main avant de créer le message utilisateur');
  assert.ok(depart >= 0 && rattachement > depart, 'l’instantané n’est rattaché qu’après le lancement par l’adaptateur');
  assert.doesNotMatch(sendPrompt.slice(message, message + 700), /text\.length \/ 4/);
});
