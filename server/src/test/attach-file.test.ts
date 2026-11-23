import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * UN FICHIER RENDU PAR UN AGENT DOIT S'AFFICHER DANS LE CHAT — N'IMPORTE LEQUEL.
 *
 * Avant ce test, un script de vérification (navigateur d'essai…) écrivait ses
 * PNG sur disque, mais rien ne les faisait remonter dans la conversation :
 * l'utilisateur ne les voyait jamais. L'outil joint un fichier déjà écrit à la
 * réponse de l'agent, exactement comme une pièce jointe reçue de l'utilisateur
 * (`message.attachments`) — même table, même dossier disque, même composant
 * d'affichage côté web.
 *
 * Il ne se limitait QU'AUX IMAGES : une table de cinq extensions servait de
 * filtre, et un agent qui voulait rendre un rapport PDF, un journal ou une
 * archive n'avait d'autre choix que d'en donner le chemin sur disque. L'outil
 * s'appelle maintenant `attach_file`, accepte TOUT type de fichier, et ne refuse
 * plus que sur le POIDS. `attach_screenshot` reste un ALIAS : un fil ouvert
 * avant le renommage porte l'ancien nom dans le schéma de son moteur.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-file-'));
process.env.BELUGA_DATA = bacASable;

const { Agent, Message, Project, TAILLE_MAX_PIECE, nomSurDisque } = await import('@beluga/shared');
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

test('attach_file joint une capture déjà sur disque, comme pièce jointe', async () => {
  const { projet, agent, message } = poserProjetEtAgent();

  const dossierCaptures = path.join(dossierProjet, 'data', 'verification');
  fs.mkdirSync(dossierCaptures, { recursive: true });
  fs.writeFileSync(path.join(dossierCaptures, 'accueil.png'), PNG_MINIMAL);

  const resultat = await callTool(
    { agentId: agent.id, projectId: projet.id, role: 'task', cardId: agent.cardId },
    'attach_file',
    { path: 'data/verification/accueil.png', label: 'Accueil' },
  );

  assert.equal(resultat.ok, true);
  assert.ok(resultat.attachment, 'une pièce jointe est rendue');
  // Le fichier porte l'IDENTIFIANT COURT de la pièce, pas son UUID entier :
  // c'est ce nom-là que le prompt donne à l'agent.
  assert.ok(resultat.attachment!.alias, 'la pièce jointe reçoit un identifiant court');
  assert.ok(
    resultat.attachment!.id.startsWith(resultat.attachment!.alias!),
    "l'identifiant court est le début de l'identifiant entier",
  );
  const fichierEcrit = path.join(PATHS.attachments, nomSurDisque(resultat.attachment!));
  assert.ok(fs.existsSync(fichierEcrit), 'le fichier est recopié dans le dossier des pièces jointes');
  assert.equal(resultat.attachment!.mime, 'image/png');
  assert.equal(resultat.attachment!.deLAgent, true, 'la pièce porte l’origine « agent » : le filtre « pas encore vues » la compte');

  attachToCurrentMessage(agent.id, { attachment: resultat.attachment!.id });
  const relu = store.getMessage(message.id);
  assert.ok(relu);
  assert.deepEqual(relu!.attachments, [resultat.attachment!.id]);
});

test('un chemin hors du dossier de travail, du projet et des données de Beluga Build est refusé', async () => {
  const { projet, agent } = poserProjetEtAgent();
  const ailleurs = fs.mkdtempSync(path.join(os.tmpdir(), 'ailleurs-'));
  fs.writeFileSync(path.join(ailleurs, 'secret.png'), PNG_MINIMAL);

  const resultat = await callTool(
    { agentId: agent.id, projectId: projet.id, role: 'task', cardId: agent.cardId },
    'attach_file',
    { path: path.join(ailleurs, 'secret.png') },
  );

  assert.equal(resultat.ok, false);
  assert.equal(resultat.attachment, undefined);
});

test('un PDF et une archive sont joints, avec leur vrai type', async () => {
  const { projet, agent } = poserProjetEtAgent();
  fs.writeFileSync(path.join(dossierProjet, 'rapport.pdf'), '%PDF-1.4 faux rapport');
  fs.writeFileSync(path.join(dossierProjet, 'journaux.zip'), Buffer.from('504b0304', 'hex'));

  const pdf = await callTool(
    { agentId: agent.id, projectId: projet.id, role: 'task', cardId: agent.cardId },
    'attach_file',
    { path: 'rapport.pdf' },
  );
  assert.equal(pdf.ok, true, pdf.text);
  assert.equal(pdf.attachment!.mime, 'application/pdf');
  assert.equal(pdf.attachment!.name, 'rapport.pdf', 'le VRAI nom est gardé : c\'est celui du téléchargement');

  const archive = await callTool(
    { agentId: agent.id, projectId: projet.id, role: 'task', cardId: agent.cardId },
    'attach_file',
    { path: 'journaux.zip' },
  );
  assert.equal(archive.ok, true, archive.text);
  assert.equal(archive.attachment!.mime, 'application/zip');
});

test('un fichier de type inconnu passe quand même, en octet-stream', async () => {
  const { projet, agent } = poserProjetEtAgent();
  fs.writeFileSync(path.join(dossierProjet, 'dump.quoi'), 'contenu opaque');

  const resultat = await callTool(
    { agentId: agent.id, projectId: projet.id, role: 'task', cardId: agent.cardId },
    'attach_file',
    { path: 'dump.quoi' },
  );

  assert.equal(resultat.ok, true, resultat.text);
  assert.equal(resultat.attachment!.mime, 'application/octet-stream');
});

test('un texte brut passe, alors qu’il était refusé du temps du filtre d’images', async () => {
  const { projet, agent } = poserProjetEtAgent();
  fs.writeFileSync(path.join(dossierProjet, 'notes.txt'), 'un journal de travail');

  const resultat = await callTool(
    { agentId: agent.id, projectId: projet.id, role: 'task', cardId: agent.cardId },
    'attach_file',
    { path: 'notes.txt' },
  );

  assert.equal(resultat.ok, true, resultat.text);
  assert.equal(resultat.attachment!.mime, 'text/plain');
});

test('l’ancien nom « attach_screenshot » reste servi', async () => {
  const { projet, agent } = poserProjetEtAgent();
  fs.writeFileSync(path.join(dossierProjet, 'ancien.png'), PNG_MINIMAL);

  const resultat = await callTool(
    { agentId: agent.id, projectId: projet.id, role: 'task', cardId: agent.cardId },
    'attach_screenshot',
    { path: 'ancien.png' },
  );

  assert.equal(resultat.ok, true, resultat.text);
  assert.equal(resultat.attachment!.mime, 'image/png');
});

test('un fichier trop lourd est refusé EN LE DISANT, jamais avalé', async () => {
  const { projet, agent } = poserProjetEtAgent();
  const enorme = path.join(dossierProjet, 'enorme.bin');
  /* Un fichier creux : il déclare sa taille sans occuper le disque. */
  const fd = fs.openSync(enorme, 'w');
  fs.ftruncateSync(fd, TAILLE_MAX_PIECE + 1);
  fs.closeSync(fd);

  const resultat = await callTool(
    { agentId: agent.id, projectId: projet.id, role: 'task', cardId: agent.cardId },
    'attach_file',
    { path: 'enorme.bin' },
  );

  assert.equal(resultat.ok, false);
  assert.match(resultat.text, /Mo/, 'le refus dit le plafond en clair');
  assert.equal(resultat.attachment, undefined);
});
