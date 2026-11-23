import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent, Card, RAISON_FILE_EN_ATTENTE, retenueParUneEdition } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* UNE DEMANDE EN ATTENTE QU'ON MODIFIE NE PART PAS (12/10/2026).      */
/* « Quand j'édite un prompt en attente, ça ne doit pas le lancer. »   */
/*                                                                     */
/* ET ELLE NE SE PERD PLUS (04/11/2026) : un long message ouvert en     */
/* modification a disparu — l'agent avait fini, la carte s'était       */
/* rangée, le déploiement automatique l'avait mise en ligne, puis le    */
/* message refermé avait été refusé sous la carte en ligne et jeté.     */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'file-en-edition-'));
process.env.BELUGA_DATA = bacASable;
const store = await import('../store.js');
const { carteApresFinDeTour } = await import('../deplacement-carte.js');
const { agentsOccupes } = await import('../deploy.js');

const AGENT = 'agent-qui-attend';

test('la règle : retenue tant que le repère est posé, sans aucune péremption', () => {
  assert.equal(retenueParUneEdition({}), false);
  assert.equal(retenueParUneEdition({ enEditionDepuis: Date.now() - 1_000 }), true);
  // Une modification ouverte il y a deux jours retient toujours : seul l'utilisateur la referme.
  assert.equal(retenueParUneEdition({ enEditionDepuis: Date.now() - 2 * 86_400_000 }), true);
});

test('la file s’arrête devant la demande ouverte, et les suivantes attendent derrière elle', () => {
  const premiere = store.enqueuePrompt(AGENT, 'Première demande.', [])!;
  store.enqueuePrompt(AGENT, 'Seconde demande.', []);
  assert.equal(store.marquerEditionEnFile(premiere.id, true), AGENT);
  assert.equal(store.dequeuePrompt(AGENT), null, 'rien ne part pendant la modification');
  assert.equal(store.listQueue(AGENT).length, 2, 'et rien ne se perd');

  // La modification se referme : la file reprend, dans l'ordre.
  store.updateQueued(premiere.id, 'Première demande, corrigée.');
  store.marquerEditionEnFile(premiere.id, false);
  assert.equal(store.dequeuePrompt(AGENT)?.text, 'Première demande, corrigée.');
  assert.equal(store.dequeuePrompt(AGENT)?.text, 'Seconde demande.');
});

test('une demande déjà partie ne se marque pas', () => {
  assert.equal(store.marquerEditionEnFile('inconnue', true), null);
});

test('une modification laissée ouverte des heures ne part pas, même après un « redémarrage »', () => {
  const agent = 'agent-longue-modif';
  const demande = store.enqueuePrompt(agent, 'Demande ouverte longtemps.', [])!;
  store.marquerEditionEnFile(demande.id, true);
  const realNow = Date.now;
  Date.now = () => realNow() + 6 * 3_600_000;
  try {
    // Le repère vit en base : relu tel quel, il retient toujours.
    assert.equal(store.dequeuePrompt(agent), null, 'six heures plus tard : toujours retenue');
  } finally {
    Date.now = realNow;
  }
  store.marquerEditionEnFile(demande.id, false);
  assert.equal(store.dequeuePrompt(agent)?.text, 'Demande ouverte longtemps.');
});

test('le texte tapé pendant la modification est gardé, mais seul le texte enregistré part', () => {
  const agent = 'agent-brouillon';
  const demande = store.enqueuePrompt(agent, 'Texte d’origine.', [])!;
  store.marquerEditionEnFile(demande.id, true);
  const ouverteA = store.listQueue(agent)[0].enEditionDepuis;
  store.marquerEditionEnFile(demande.id, true, { text: 'Un long texte en cours de frappe…', attachments: [] });
  const relue = store.listQueue(agent)[0];
  assert.equal(relue.brouillonEdition?.text, 'Un long texte en cours de frappe…', 'repris à la réouverture');
  assert.equal(relue.enEditionDepuis, ouverteA, 'la frappe ne repousse pas l’heure d’ouverture');
  assert.equal(relue.text, 'Texte d’origine.', 'le brouillon ne remplace pas le message tant qu’il n’est pas enregistré');

  // Enregistrée : le brouillon tombe, le texte enregistré est celui qui part.
  store.updateQueued(demande.id, 'Texte final.');
  assert.equal(store.listQueue(agent)[0].brouillonEdition, undefined);
  store.marquerEditionEnFile(demande.id, false);
  const partie = store.dequeuePrompt(agent);
  assert.equal(partie?.text, 'Texte final.');
  assert.equal(partie?.brouillonEdition, undefined);
});

test('« Envoyer maintenant » lève toujours le repère et le brouillon', () => {
  const agent = 'agent-envoi-immediat';
  const demande = store.enqueuePrompt(agent, 'À envoyer.', [])!;
  store.marquerEditionEnFile(demande.id, true, { text: 'brouillon' });
  store.remonterEnTete(demande.id);
  const relue = store.listQueue(agent)[0];
  assert.equal(relue.enEditionDepuis, undefined);
  assert.equal(relue.brouillonEdition, undefined);
});

/* ------------------------------------------------------------------ */
/* LA CARTE ATTEND LE MESSAGE                                          */
/* ------------------------------------------------------------------ */

function poser(id: string, colonne: Card['column'] = 'running'): { carte: Card; agent: Agent } {
  const maintenant = Date.now();
  const agent = store.saveAgent(
    Agent.parse({
      id: `agent-${id}`,
      projectId: 'projet-file',
      cardId: id,
      role: 'task',
      title: `Agent de ${id}`,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status: 'done',
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
  );
  const carte = store.saveCard(
    Card.parse({
      id,
      projectId: 'projet-file',
      title: `Carte ${id}`,
      column: colonne,
      position: 1,
      agentId: agent.id,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: { asap: false, attempts: 1, restarts: 0, tourEnVolDepuis: maintenant },
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
  );
  return { carte, agent };
}

const FIN = { role: 'task' as const, reussi: true, trace: 'oui' as const, moteurMuet: false };

test('un tour fini avec un message en attente ne range pas la carte, et le dit', () => {
  const { carte, agent } = poser('carte-retenue');
  const sans = carteApresFinDeTour(carte, { ...FIN, agentId: agent.id });
  assert.notEqual(sans.column, 'running', 'témoin : sans file, la carte se range');

  const avec = carteApresFinDeTour(carte, { ...FIN, agentId: agent.id, fileEnAttente: true });
  assert.equal(avec.column, 'running', 'la carte reste en « En cours »');
  assert.equal(avec.scheduling?.waitingReason, RAISON_FILE_EN_ATTENTE);
  assert.equal(avec.scheduling?.tourEnVolDepuis, undefined, 'la marque de vol s’éteint quand même');
});

test('le déploiement attend une carte dont l’agent a encore un message en file', () => {
  const { agent } = poser('carte-a-deployer', 'to_deploy');
  assert.equal(agentsOccupes('projet-file').some((a) => a.id === agent.id), false, 'témoin : file vide');
  const demande = store.enqueuePrompt(agent.id, 'Encore une chose.', [])!;
  const occupe = agentsOccupes('projet-file').find((a) => a.id === agent.id);
  assert.ok(occupe?.fileEnAttente, 'la carte retient le déploiement');
  store.removeQueued(demande.id);
  assert.equal(agentsOccupes('projet-file').some((a) => a.id === agent.id), false);
});

test('un agent de volet sans carte ne retient aucun déploiement', () => {
  const maintenant = Date.now();
  const volet = store.saveAgent(
    Agent.parse({
      id: 'agent-volet',
      projectId: 'projet-file',
      role: 'task',
      title: 'Chef de marque',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status: 'done',
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
  );
  store.enqueuePrompt(volet.id, 'Point du jour.', []);
  assert.equal(agentsOccupes('projet-file').some((a) => a.id === volet.id), false);
});
