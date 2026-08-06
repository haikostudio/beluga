import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Les images jointes au chef d'orchestre suivent la carte             */
/* ------------------------------------------------------------------ */

/*
 * Une VRAIE base, dans un dossier jetable : le test suit le trajet des images
 * du message déclencheur jusqu'à la carte validée.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'images-carte-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { callTool, createCard } = await import('../tools.js');
const { Message } = await import('@haikodev/shared');

function projetDEssai() {
  return store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

/* Une description qui tient debout (règle « description-carte »). */
const DESCRIPTION = [
  'Constat : le tableau se fabrique dans `web/src/components/board.tsx` et n’offre pas d’icône.',
  'Attendu : une icône fournie en maquette est intégrée à la barre du haut.',
  "Limites : on ne touche ni au glisser-déposer, ni aux règles de passage d'une colonne à l'autre.",
  'Vérification : rejouer `npm test`, puis ouvrir la page et voir l’icône.',
].join('\n');

function messageAvecImages(agentId: string, attachments: string[], createdAt = store.now()) {
  store.saveMessage(
    Message.parse({
      id: store.newId(),
      agentId,
      role: 'user',
      content: 'Voici l’icône à intégrer.',
      attachments,
      createdAt,
    }),
  );
}

test('la proposition retient les images du message déclencheur', async () => {
  const projet = projetDEssai();
  const agentId = 'chef-1';
  messageAvecImages(agentId, ['att-icone', 'att-maquette']);

  const resultat = await callTool(
    { projectId: projet.id, agentId, role: 'orchestrator' } as any,
    'board_create_card',
    { title: 'Intégrer l’icône fournie', description: DESCRIPTION },
  );

  assert.equal(resultat.ok, true);
  assert.deepEqual(resultat.proposal?.attachments, ['att-icone', 'att-maquette']);
});

test('seul le DERNIER message de l’utilisateur compte, pas tout le fil', async () => {
  const projet = projetDEssai();
  const agentId = 'chef-2';
  // Un vieux message avec une image, puis un message plus récent sans image.
  const t0 = store.now();
  messageAvecImages(agentId, ['vieille-image'], t0);
  messageAvecImages(agentId, [], t0 + 1000);

  const resultat = await callTool(
    { projectId: projet.id, agentId, role: 'orchestrator' } as any,
    'propose_task',
    { title: 'Une tâche sans image', description: DESCRIPTION },
  );

  assert.equal(resultat.ok, true);
  assert.deepEqual(resultat.proposal?.attachments, [], 'le fil ancien ne remonte pas');
});

test('la carte validée conserve les images de la proposition', () => {
  const projet = projetDEssai();
  const carte = createCard(projet.id, {
    title: 'Intégrer l’icône fournie',
    description: DESCRIPTION,
    origin: 'agent',
    attachments: ['att-icone', 'att-maquette'],
  });

  const relue = store.getCard(carte.id);
  assert.deepEqual(relue?.attachments, ['att-icone', 'att-maquette']);
});

test('une carte sans image porte une liste vide, jamais indéfinie', () => {
  const projet = projetDEssai();
  const carte = createCard(projet.id, { title: 'Tâche sans image', description: DESCRIPTION });
  assert.deepEqual(store.getCard(carte.id)?.attachments, []);
});
