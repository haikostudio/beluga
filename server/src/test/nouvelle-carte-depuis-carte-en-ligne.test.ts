import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * UN MESSAGE SOUS UNE CARTE DÉJÀ EN LIGNE OUVRE UNE NOUVELLE CARTE, d'office à
 * l'envoi (décision du 23/11/2026), et le message est posé dans son CHAMP sans
 * qu'aucun tour ne parte — l'ancien
 * refus « carte-deployee » (DEC-049) n'existe plus. Une carte archivée jamais
 * publiée n'est PAS concernée (« Archivé » ne se rouvre que sur geste humain),
 * et rien ne se crée pendant une publication.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'nouvelle-carte-'));
process.env.BELUGA_DATA = bacASable;

const { Agent, Card, Project, messageOuvreUneNouvelleCarte, messageDeLaCarteVaAuCadrage } = await import('@beluga/shared');
const store = await import('../store.js');
const { ouvrirUneNouvelleCarteDepuis } = await import('../cadrage.js');

const ICI = path.dirname(fileURLToPath(import.meta.url));
const lire = (fichier: string) => fs.readFileSync(path.resolve(ICI, '../../src', fichier), 'utf8');

test('seule une carte archivée ET mise en ligne ouvre une nouvelle carte', () => {
  assert.equal(messageOuvreUneNouvelleCarte({ column: 'archived', deployedAt: 1 }), true);
  assert.equal(messageOuvreUneNouvelleCarte({ column: 'archived' }), false, 'archivée jamais publiée : geste humain');
  assert.equal(messageOuvreUneNouvelleCarte({ column: 'to_deploy', deployedAt: 1 }), false);
  assert.equal(messageOuvreUneNouvelleCarte({ column: 'planned' }), false);
  // DEC-245 intact : « À déployer » reste rouverte par le cadrage, pas par une nouvelle carte.
  assert.equal(messageDeLaCarteVaAuCadrage({ column: 'to_deploy' }), true);
  assert.equal(messageDeLaCarteVaAuCadrage({ column: 'archived' }), false);
});

test('le message crée UNE carte neuve, reprend le texte, laisse l’ancienne intacte et se rejoue sans doublon', async () => {
  const projet = store.saveProject(
    Project.parse({ id: 'p-en-ligne', name: 'Projet', path: bacASable, createdAt: store.now(), updatedAt: store.now() }),
  );
  const ancienne = store.saveCard(
    Card.parse({
      id: 'carte-en-ligne',
      projectId: projet.id,
      title: 'Déjà livrée',
      column: 'archived',
      deployedAt: 5_000,
      run: { engine: 'claude' },
      position: 0,
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  const agent = store.saveAgent(
    Agent.parse({ id: 'agent-en-ligne', projectId: projet.id, role: 'task', title: 'Tâche', cardId: ancienne.id, run: { engine: 'claude' }, status: 'done', createdAt: store.now(), updatedAt: store.now() }),
  );

  const avant = store.listCards(projet.id).length;
  const nouvelle = await ouvrirUneNouvelleCarteDepuis(agent.id, 'Ajoute un bouton', ['piece-1']);
  assert.ok(nouvelle);
  assert.equal(nouvelle!.column, 'planned', 'la carte naît dans « Planifié »');
  assert.equal(nouvelle!.projectId, projet.id);
  assert.equal(store.listCards(projet.id).length, avant + 1);

  const cadrage = store.getCadrageAgentByCard(nouvelle!.id);
  assert.ok(cadrage, 'son agent de cadrage existe');
  assert.equal(cadrage!.role, 'cadrage');

  const intacte = store.getCard(ancienne.id)!;
  assert.equal(intacte.column, 'archived');
  assert.equal(intacte.deployedAt, 5_000);
  const note = store.listMessages(agent.id).at(-1)!;
  assert.equal(note.role, 'assistant');
  assert.equal(note.proposals[0]?.cardId, nouvelle!.id, 'la note pointe vers la nouvelle carte');
  assert.equal(note.error, undefined, 'plus de refus « carte-deployee »');

  // RIEN NE PART : le message et ses pièces attendent dans le champ de la nouvelle carte.
  assert.equal(store.listMessages(cadrage!.id).length, 0, 'aucun message envoyé au cadrage');
  assert.notEqual(cadrage!.status, 'running');
  assert.equal(store.readPreference(`draft.${cadrage!.id}`), 'Ajoute un bouton', 'le texte est dans le champ');

  const rejoue = await ouvrirUneNouvelleCarteDepuis(agent.id, 'Ajoute un bouton', ['piece-1']);
  assert.equal(rejoue!.id, nouvelle!.id, 'un envoi rejoué ne crée pas une seconde carte');
  assert.equal(store.listCards(projet.id).length, avant + 1);
});

test('les pièces jointes suivent le message dans le champ de la nouvelle carte', async () => {
  const { Attachment } = await import('@beluga/shared');
  const agent = store.getAgent('agent-en-ligne')!;
  const piece = store.saveAttachment(
    Attachment.parse({ id: 'piece-jointe-1', projectId: agent.projectId, name: 'capture.png', mime: 'image/png', size: 10, sha: 'empreinte-1', createdAt: store.now() }),
  );
  const nouvelle = await ouvrirUneNouvelleCarteDepuis(agent.id, 'Avec une image', [piece.id]);
  const cadrage = store.getCadrageAgentByCard(nouvelle!.id)!;
  const jointes = store.readPreference(`draftAttachments.${cadrage.id}`) as Array<{ id: string }>;
  assert.deepEqual(jointes.map((a) => a.id), [piece.id]);
  assert.equal(store.listMessages(cadrage.id).length, 0);
});

test('le verrou de publication passe AVANT toute création de carte', () => {
  const ws = lire('ws.ts');
  const commande = ws.split("case 'agent.prompt': {")[1]!;
  const verrou = commande.indexOf('throw new Error(TEXTE_CARTE_EN_PUBLICATION)');
  const creation = commande.indexOf('ouvrirUneNouvelleCarteDepuis(');
  assert.ok(verrou > 0 && creation > verrou, 'le refus de publication précède la création');

  // `sendPrompt` ne crée plus aucune carte : seul le clic d'accord le fait (agents-de-volet.test.ts).
  const runtime = lire('runtime.ts');
  const envoi = runtime.split('export async function sendPrompt(')[1]!.split('Un agent occupé ?')[0]!;
  assert.doesNotMatch(envoi, /ouvrirUneNouvelleCarteDepuis\(/);
  assert.doesNotMatch(envoi, /carte-deployee/);
});

test('l’écran annonce la nouvelle carte, sans écho « Demande envoyée » sur l’ancienne', () => {
  const composer = fs.readFileSync(path.resolve(ICI, '../../../web/src/components/composer.tsx'), 'utf8');
  assert.match(composer, /if \(!ouvreUneNouvelleCarte\) onEnvoiCommence\?\.\(body\)/);
  assert.match(composer, /reponse\?\.nouvelleCarteId/);
  assert.match(composer, /client\.openCard\(reponse\.nouvelleCarteId\)/);
});
