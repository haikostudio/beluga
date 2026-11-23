import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * UN PAS D'AGENT NE RELIT PLUS LE MESSAGE ENTIER (carte 4e7f1032, 16/11/2026).
 * `patcherMessage` écrit le patch d'un pas sans décoder le contexte envoyé :
 * ces essais verrouillent que le message relu est EXACTEMENT celui qu'aurait
 * écrit l'ancien chemin (relire, fusionner, réécrire), que le contexte n'est
 * jamais perdu, qu'il garde son identité d'un pas à l'autre — l'écran ne le
 * resérialise pas — et qu'un contexte changé par un autre écrivain est relu.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'pas-d-agent-leger-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');

function contexte(prompt: string) {
  return {
    engine: 'claude',
    session: 'new',
    prompt,
    systemInstruction: { kind: 'full', content: 'consigne '.repeat(2000), transport: 'separate' },
    blocks: [],
    history: 'none',
    sentAt: 1,
  };
}

function messageDEssai() {
  const projet = store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
  const agent = store.saveAgent({
    id: store.newId(),
    projectId: projet.id,
    role: 'task',
    title: 'Agent d’essai',
    run: {},
    status: 'running',
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
  return store.saveMessage({
    id: store.newId(),
    agentId: agent.id,
    role: 'assistant',
    content: 'Début',
    streaming: true,
    sentContext: contexte('la demande'),
    createdAt: store.now(),
  } as any);
}

test('un pas écrit le même message que l’ancien chemin, contexte compris', () => {
  const message = messageDEssai();
  const patch = { content: 'Début\n\nsuite', streaming: true, todos: [] };
  const attendu = JSON.parse(JSON.stringify({ ...store.getMessage(message.id)!, ...patch }));
  const rendu = store.patcherMessage(message.id, patch);
  assert.deepEqual(JSON.parse(JSON.stringify(rendu)), attendu);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getMessage(message.id))), attendu);
});

test('le contexte garde son identité d’un pas à l’autre, et se relit s’il a changé', () => {
  const message = messageDEssai();
  const garde = {};
  const premier = store.patcherMessage(message.id, { content: 'un' }, garde)!;
  const second = store.patcherMessage(message.id, { content: 'deux' }, garde)!;
  assert.ok(premier.sentContext);
  assert.equal(second.sentContext, premier.sentContext, 'même objet : rien à resérialiser');

  // Un autre écrivain (les jetons comptés en fin de tour) change le contexte.
  const courant = store.getMessage(message.id)!;
  store.saveMessage({ ...courant, sentContext: { ...courant.sentContext!, prompt: 'autre demande' } });
  const troisieme = store.patcherMessage(message.id, { content: 'trois' }, garde)!;
  assert.notEqual(troisieme.sentContext, premier.sentContext);
  assert.equal(troisieme.sentContext?.prompt, 'autre demande');
  assert.equal(store.getMessage(message.id)?.content, 'trois');
});

test('un message sans contexte reste sans contexte, et un message absent rend null', () => {
  const message = messageDEssai();
  const courant = store.getMessage(message.id)!;
  store.saveMessage({ ...courant, sentContext: undefined });
  const rendu = store.patcherMessage(message.id, { content: 'fin', streaming: false })!;
  assert.equal(rendu.sentContext, undefined);
  assert.equal(store.getMessage(message.id)?.sentContext, undefined);
  assert.equal(store.getMessage(message.id)?.streaming, false);
  assert.equal(store.patcherMessage('inconnu', { content: 'x' }), null);
});
