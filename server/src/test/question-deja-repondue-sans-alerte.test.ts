/**
 * UNE QUESTION NÉE RÉPONDUE N'ALERTE PERSONNE.
 *
 * Les compétences retenues d'office au cadrage (DEC-322) sont rattachées au
 * message comme des questions, déjà répondues « Utiliser ». Le rattachement
 * notifiait toute question : le téléphone sonnait « Utiliser la compétence … ? »
 * alors que la compétence était déjà affichée « Compétence utilisée ».
 * Verrouillé ici : une question répondue ne notifie pas et n'allume pas le
 * signal d'attention ; une vraie question, elle, alerte toujours.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'question-repondue-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { attachToCurrentMessage } = await import('../runtime.js');
const { bus } = await import('../bus.js');
const { viderLesGroupes } = await import('../notify.js');

function cadrageDEssai() {
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
    role: 'cadrage',
    title: 'Cadrage',
    run: {},
    status: 'running',
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
  store.saveMessage({
    id: store.newId(),
    agentId: agent.id,
    role: 'assistant',
    content: 'Voici ce que je retiens.',
    createdAt: store.now(),
  } as any);
  return agent;
}

async function attacher(question: Record<string, unknown>) {
  const agent = cadrageDEssai();
  const vus: string[] = [];
  const stop = bus.subscribe((event: any) => {
    if (event.type === 'notify' || event.type === 'attention') vus.push(event.type);
  });
  attachToCurrentMessage(agent.id, { question: question as any });
  await viderLesGroupes();
  stop();
  return vus;
}

test('une compétence retenue d’office (question déjà répondue) ne notifie pas et n’allume rien', async () => {
  const vus = await attacher({
    id: store.newId(),
    question: 'Utiliser la compétence « Clavier iOS » ?',
    options: [
      { id: 'utiliser', label: 'Utiliser' },
      { id: 'pas-utile', label: 'Pas utile' },
    ],
    competence: { nom: 'clavier-ios', titre: 'Clavier iOS' },
    answer: 'Utiliser',
    answeredAt: store.now(),
  });
  assert.deepEqual(vus, [], 'aucune alerte pour ce qui est déjà tranché');
});

test('une vraie question sans réponse notifie et allume le signal', async () => {
  const vus = await attacher({
    id: store.newId(),
    question: 'Quelle couleur pour le bouton ?',
    options: [
      { id: 'bleu', label: 'Bleu' },
      { id: 'vert', label: 'Vert' },
    ],
  });
  assert.ok(vus.includes('attention'), 'le signal d’attention part');
  assert.ok(vus.includes('notify'), 'la notification part');
});
