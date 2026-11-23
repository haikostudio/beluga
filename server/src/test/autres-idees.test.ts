import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* « D'AUTRES IDÉES » SANS RELANCER L'AGENT                            */
/*                                                                      */
/* Le bouton fait chercher trois suites à part, par le moteur de la     */
/* carte, et les AJOUTE sous les existantes : sur le message ET sur le  */
/* jalon de la réponse, sans un seul tour ni message de plus. Le moteur */
/* est remplacé ici par un faux : les tests ne paient pas de modèle.    */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'autres-idees-'));
process.env.BELUGA_DATA = bacASable;

const { Agent, Card, Message, Project } = await import('@beluga/shared');
const store = await import('../store.js');
const { ajouterAuJournal, entreeDuJournal } = await import('../journal-carte.js');
const { chercherDAutresIdees, remplacerLeMoteurDesIdees } = await import('../autres-idees.js');

const projet = store.saveProject(
  Project.parse({ id: 'projet-idees', name: 'Idées', path: bacASable, createdAt: store.now(), updatedAt: store.now() }),
);

function poserReponse(id: string) {
  const carte = store.saveCard(
    Card.parse({
      id: `carte-${id}`,
      projectId: projet.id,
      column: 'to_deploy',
      position: 1,
      title: 'Bouton plus rapide',
      run: { engine: 'codex', model: 'gpt-x' },
      agentId: `agent-${id}`,
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  const agent = store.saveAgent(
    Agent.parse({
      id: `agent-${id}`,
      projectId: projet.id,
      cardId: carte.id,
      role: 'task',
      title: 'Agent',
      run: { engine: 'codex', model: 'gpt-x' },
      status: 'idle',
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  const suites = [
    { titre: 'Ajouter un réglage', description: 'a' },
    { titre: 'Expliquer davantage', description: 'b' },
  ];
  const message = store.saveMessage(
    Message.parse({ id: `message-${id}`, agentId: agent.id, role: 'assistant', content: 'Le bouton répond.', suites, createdAt: store.now() }),
  );
  const jalon = ajouterAuJournal({
    cardId: carte.id,
    phase: 'rapport',
    nature: 'jalon',
    libelle: 'Rapport',
    agentId: agent.id,
    tourId: message.id,
    resultat: 'Le bouton répond.',
    donnees: { compte: 'c', suites },
  });
  assert.ok(jalon);
  return { carte, agent, message, jalon };
}

const sortie = JSON.stringify([
  { titre: 'Essayer sur téléphone', description: 'Vérifier l’écran étroit.' },
  { titre: 'ajouter un réglage', description: 'doublon, écarté' },
  { titre: 'Mesurer la vitesse', description: 'Chiffrer le gain.' },
]);

test('trois suites cherchées à part rejoignent le message ET le jalon, sans toucher la conversation', async () => {
  const { agent, message, jalon } = poserReponse('a');
  store.setSessionId(agent.id, 'session-intacte', 'claude');
  const vus: { demande: string; moteur: string; modele?: string }[] = [];
  remplacerLeMoteurDesIdees(async (demande, a) => {
    vus.push({ demande, moteur: a.run.engine, modele: a.run.model });
    return `Voici :\n${sortie}`;
  });
  const avant = store.listMessages(agent.id).length;
  const resultat = await chercherDAutresIdees({ messageId: message.id });
  assert.deepEqual(resultat, { ok: true, ajoutees: 2 });
  assert.equal(vus[0].moteur, 'codex', 'le moteur de la carte');
  assert.equal(vus[0].modele, 'gpt-x', 'et son modèle');
  assert.match(vus[0].demande, /- Ajouter un réglage/);
  const titres = store.getMessage(message.id)!.suites!.map((s) => s.titre);
  assert.deepEqual(titres, ['Ajouter un réglage', 'Expliquer davantage', 'Essayer sur téléphone', 'Mesurer la vitesse']);
  const surLeJalon = JSON.parse(entreeDuJournal(jalon!.id)!.donnees!).suites.map((s: any) => s.titre);
  assert.deepEqual(surLeJalon, titres, 'le fil de la carte ne diverge pas');
  assert.equal(JSON.parse(entreeDuJournal(jalon!.id)!.donnees!).compte, 'c', 'les autres données restent');
  assert.equal(store.listMessages(agent.id).length, avant, 'aucun message de plus');
  assert.equal(store.getCard(`carte-a`)!.column, 'to_deploy', 'la carte ne bouge pas');
  assert.equal(store.getAgent(agent.id)!.status, 'idle');
  assert.equal(store.getSessionId(agent.id, 'claude'), 'session-intacte', 'la session de l’agent est intacte');
});

test('depuis le jalon du fil, et un second clic pendant la recherche est refusé', async () => {
  const { message, jalon } = poserReponse('b');
  let relacher!: () => void;
  remplacerLeMoteurDesIdees(() => new Promise((ok) => (relacher = () => ok(sortie))));
  const premier = chercherDAutresIdees({ entreeId: jalon!.id });
  const second = await chercherDAutresIdees({ messageId: message.id });
  assert.equal(second.ok, false);
  assert.equal((second as any).enCours, true);
  relacher();
  assert.equal((await premier).ok, true);
  assert.equal(store.getMessage(message.id)!.suites!.length, 4);
});

test('une sortie illisible ou une panne se dit, et rien ne change', async () => {
  const { message } = poserReponse('c');
  remplacerLeMoteurDesIdees(async () => 'pas de JSON');
  assert.equal((await chercherDAutresIdees({ messageId: message.id })).ok, false);
  remplacerLeMoteurDesIdees(async () => {
    throw new Error('aucun compte');
  });
  const panne = await chercherDAutresIdees({ messageId: message.id });
  assert.equal(panne.ok, false);
  assert.match((panne as any).raison, /aucun compte/);
  assert.equal(store.getMessage(message.id)!.suites!.length, 2);
  remplacerLeMoteurDesIdees(null);
  assert.equal((await chercherDAutresIdees({ messageId: message.id })).ok, false, 'sans moteur injecté, aucun modèle en test');
});
