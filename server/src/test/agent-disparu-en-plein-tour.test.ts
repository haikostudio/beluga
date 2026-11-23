import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* LE CAS RÉEL DU 09.09.2026 : « la carte est terminée, pourtant elle  */
/* tourne toujours depuis 47 minutes ».                                */
/*                                                                     */
/* L'agent de tâche travaillait SUR les fiches de sauvegarde. En        */
/* appelant l'outil, il était devenu le « fil d'assistant » de la fiche */
/* (`assistantId` = l'agent appelant). En retirant ensuite la fiche en  */
/* double — le travail qu'on lui avait demandé —, la suppression en     */
/* cascade a effacé SON PROPRE enregistrement et tous ses messages, en  */
/* plein tour. Plus rien ne pouvait alors refermer ce tour : la         */
/* fermeture ne trouvait plus d'agent, la veille part de la table des   */
/* agents, et l'écran gardait sa copie « au travail » à vie.            */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-disparu-'));
process.env.BELUGA_DATA = bacASable;

const { Agent, Card, Message, Project, refusDeSupprimerLAgent, siteVierge } = await import('@beluga/shared');
const store = await import('../store.js');
const backups = await import('../backups.js');
const { veilleDesToursBloques } = await import('../runtime.js');
const { bus } = await import('../bus.js');

const projet = store.saveProject(
  Project.parse({
    id: 'projet-disparu',
    name: 'Projet du cas réel',
    path: bacASable,
    createdAt: store.now(),
    updatedAt: store.now(),
  }),
);

/** Une fiche de sauvegarde dont le fil d'assistant est l'agent passé. */
function poserFiche(id: string, assistantId: string) {
  const resultat = backups.enregistrerSite({
    ...siteVierge(projet.id, `Fiche ${id}`),
    id,
    fichiers: { moyen: 'local', chemin: bacASable, hote: '', port: '', utilisateur: '', motDePasse: '' },
    assistantId,
    assistantProjectId: projet.id,
  });
  assert.equal(resultat.ok, true, `la fiche ${id} doit s'enregistrer : ${JSON.stringify(resultat)}`);
  return id;
}

/** Un agent de tâche en plein tour, rattaché à sa carte. */
function poserAgentDeTache(id: string) {
  const carte = store.saveCard(
    Card.parse({
      id: `carte-${id}`,
      projectId: projet.id,
      column: 'running',
      position: 1,
      title: 'Vérifier les sauvegardes',
      run: { engine: 'claude' },
      agentId: id,
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  const agent = store.saveAgent(
    Agent.parse({
      id,
      projectId: projet.id,
      cardId: carte.id,
      role: 'task',
      title: 'Agent de tâche',
      run: { engine: 'claude' },
      status: 'running',
      tourVivantDepuis: store.now() - 30 * 60_000,
      startedAt: store.now() - 30 * 60_000,
      createdAt: store.now() - 30 * 60_000,
      updatedAt: store.now(),
    }),
  );
  store.saveMessage(
    Message.parse({
      id: `message-${id}`,
      agentId: id,
      role: 'assistant',
      content: 'Le compte rendu était pourtant rendu.',
      streaming: true,
      createdAt: store.now(),
    }),
  );
  return agent;
}

test("retirer une fiche n'efface pas l'agent de tâche qui l'avait posée", () => {
  const agent = poserAgentDeTache('agent-du-cas-reel');
  const fiche = poserFiche('fiche-en-double', agent.id);

  const retrait = backups.supprimerSite(fiche);
  assert.equal(retrait.ok, true, 'la fiche part quand même : le refus ne retient jamais le retrait');
  assert.equal(backups.lireSite(fiche), null, 'la fiche a bien été retirée');

  // LE CŒUR DU CAS : l'agent et ses messages survivent au retrait de la fiche.
  const survivant = store.getAgent(agent.id);
  assert.ok(survivant, "l'agent de tâche ne part pas avec la fiche");
  assert.equal(survivant?.tourVivantDepuis !== undefined, true, 'son tour vit toujours');
  assert.equal(store.listMessages(agent.id, 10).length, 1, 'ses messages sont intacts');
});

test('un assistant jetable, lui, part bien avec sa fiche', () => {
  const assistant = store.saveAgent(
    Agent.parse({
      id: 'assistant-jetable',
      projectId: projet.id,
      role: 'analysis',
      title: 'Assistant de sauvegarde',
      run: { engine: 'claude' },
      status: 'done',
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  const fiche = poserFiche('fiche-assistant', assistant.id);

  assert.equal(backups.supprimerSite(fiche).ok, true);
  assert.equal(store.getAgent(assistant.id), null, "l'assistant part avec sa fiche, comme avant");
});

test('la règle de suppression en cascade se lit seule', () => {
  assert.equal(refusDeSupprimerLAgent({ role: 'analysis', status: 'done' }), null);
  assert.ok(refusDeSupprimerLAgent({ role: 'analysis', cardId: 'c1', status: 'done' }));
  assert.ok(refusDeSupprimerLAgent({ role: 'task', status: 'done' }));
  assert.ok(refusDeSupprimerLAgent({ role: 'analysis', status: 'running' }));
  assert.ok(refusDeSupprimerLAgent({ role: 'analysis', status: 'done', tourVivantDepuis: 1 }));
});

test("le retrait d'un assistant est DIT à l'écran", () => {
  const assistant = store.saveAgent(
    Agent.parse({
      id: 'assistant-a-diffuser',
      projectId: projet.id,
      role: 'analysis',
      title: 'Assistant de sauvegarde',
      run: { engine: 'claude' },
      status: 'done',
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  const fiche = poserFiche('fiche-a-diffuser', assistant.id);

  const vus: string[] = [];
  const desabonner = bus.subscribe((event) => {
    if (event.type === 'agent.delete') vus.push(event.id);
  });
  backups.supprimerSite(fiche);
  desabonner();

  assert.deepEqual(vus, [assistant.id], "le client doit savoir que cet agent n'existe plus");
});

test("la veille ne bronche pas quand plus aucun tour n'est suivi", () => {
  // Aucun tour vivant en mémoire ici : la purge des tours sans agent doit
  // simplement ne rien trouver, sans lever ni fermer quoi que ce soit.
  assert.equal(typeof veilleDesToursBloques(), 'number');
});
