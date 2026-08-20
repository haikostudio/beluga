import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * UNE CAPTURE D'ÉCRAN DE TEST DOIT S'AFFICHER DANS LE CHAT.
 *
 * Avant ce test, un script de vérification (navigateur d'essai…) écrivait ses
 * PNG sur disque, mais rien ne les faisait remonter dans la conversation :
 * l'utilisateur ne les voyait jamais. L'outil « attach_screenshot » joint un
 * fichier déjà écrit à la réponse de l'agent, exactement comme une pièce
 * jointe reçue de l'utilisateur (`message.attachments`) — même table, même
 * dossier disque, même composant d'affichage côté web.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-screenshot-'));
process.env.HAIKODEV_DATA = bacASable;

const { Agent, Message, Project } = await import('@haikodev/shared');
const store = await import('../store.js');
const { callTool } = await import('../tools.js');
const { attachToCurrentMessage } = await import('../runtime.js');
const { PATHS } = await import('../config.js');

const dossierProjet = fs.mkdtempSync(path.join(os.tmpdir(), 'projet-capture-'));

const PNG_MINIMAL = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000a4944415478da6360000002000155a2497e0000000049454e44ae426082',
  'hex',
);

function poserProjetEtAgent() {
  const projet = store.saveProject(
    Project.parse({
      id: 'projet-capture',
      name: 'Projet capture',
      path: dossierProjet,
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  const agent = store.saveAgent(
    Agent.parse({
      id: 'agent-capture',
      projectId: projet.id,
      cardId: 'carte-capture',
      role: 'task',
      title: 'Agent de test',
      run: { engine: 'claude' },
      workdir: dossierProjet,
      status: 'running',
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  const message = store.saveMessage(
    Message.parse({ id: 'message-capture', agentId: agent.id, role: 'assistant', createdAt: store.now() }),
  );
  return { projet, agent, message };
}

test('attach_screenshot joint une capture déjà sur disque, comme pièce jointe', async () => {
  const { projet, agent, message } = poserProjetEtAgent();

  const dossierCaptures = path.join(dossierProjet, 'data', 'verification');
  fs.mkdirSync(dossierCaptures, { recursive: true });
  fs.writeFileSync(path.join(dossierCaptures, 'accueil.png'), PNG_MINIMAL);

  const resultat = await callTool(
    { agentId: agent.id, projectId: projet.id, role: 'task', cardId: agent.cardId },
    'attach_screenshot',
    { path: 'data/verification/accueil.png', label: 'Accueil' },
  );

  assert.equal(resultat.ok, true);
  assert.ok(resultat.attachment, 'une pièce jointe est rendue');
  const fichierEcrit = path.join(PATHS.attachments, `${resultat.attachment!.id}-${resultat.attachment!.name}`);
  assert.ok(fs.existsSync(fichierEcrit), 'le fichier est recopié dans le dossier des pièces jointes');
  assert.equal(resultat.attachment!.mime, 'image/png');

  attachToCurrentMessage(agent.id, { attachment: resultat.attachment!.id });
  const relu = store.getMessage(message.id);
  assert.ok(relu);
  assert.deepEqual(relu!.attachments, [resultat.attachment!.id]);
});

test('un chemin hors du dossier de travail, du projet et des données de HaikoDev est refusé', async () => {
  const { projet, agent } = poserProjetEtAgent();
  const ailleurs = fs.mkdtempSync(path.join(os.tmpdir(), 'ailleurs-'));
  fs.writeFileSync(path.join(ailleurs, 'secret.png'), PNG_MINIMAL);

  const resultat = await callTool(
    { agentId: agent.id, projectId: projet.id, role: 'task', cardId: agent.cardId },
    'attach_screenshot',
    { path: path.join(ailleurs, 'secret.png') },
  );

  assert.equal(resultat.ok, false);
  assert.equal(resultat.attachment, undefined);
});

test('un fichier qui n’est pas une image reconnue est refusé', async () => {
  const { projet, agent } = poserProjetEtAgent();
  fs.writeFileSync(path.join(dossierProjet, 'notes.txt'), 'pas une image');

  const resultat = await callTool(
    { agentId: agent.id, projectId: projet.id, role: 'task', cardId: agent.cardId },
    'attach_screenshot',
    { path: 'notes.txt' },
  );

  assert.equal(resultat.ok, false);
});
