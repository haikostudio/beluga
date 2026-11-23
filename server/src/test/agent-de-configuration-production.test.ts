import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* L'AGENT DE CONFIGURATION DE LA MISE EN PRODUCTION (refonte du        */
/* 24/09/2026). Sa conversation se retrouve et se poursuit : il est     */
/* RETENU sur le projet, un seul, et le processus qu'il rend dans un    */
/* message — d'où qu'il vienne — s'enregistre une fois, avec son        */
/* explication en clair, sans jamais faire oublier l'agent.             */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-configuration-'));
process.env.BELUGA_DATA = bacASable;

const { DEBUT_PROCESSUS, FIN_PROCESSUS, Message, Project } = await import('@beluga/shared');
const store = await import('../store.js');
const {
  agentDeConfigurationDuProjet,
  contexteDeConfiguration,
  etapeConfigureePar,
  retenirProcessusDuMessage,
} = await import('../procedure-publication.js');

const projet = store.saveProject(
  Project.parse({
    id: 'projet-configuration',
    name: 'Projet à configurer',
    path: bacASable,
    createdAt: store.now(),
    updatedAt: store.now(),
  }),
);

const rendu = (id: string, agentId: string, contenu: string) =>
  Message.parse({ id, agentId, role: 'assistant', content: contenu, streaming: false, createdAt: store.now() });

test('un seul agent de configuration, retenu sur le projet et retrouvé ensuite', () => {
  const premier = agentDeConfigurationDuProjet(projet.id);
  assert.ok(premier);
  assert.equal(premier.role, 'deploy');
  assert.equal(premier.cardId, undefined, 'aucune carte, donc aucune branche « tache/… »');
  assert.equal(store.getProject(projet.id)?.miseEnProduction?.agentId, premier.id);
  const second = agentDeConfigurationDuProjet(projet.id);
  assert.equal(second?.id, premier.id, 'la même conversation, pas un agent neuf');
  assert.equal(etapeConfigureePar(premier) !== null, true);
});

test('le processus rendu dans un message s’enregistre UNE fois, avec son explication, sans oublier l’agent', () => {
  const agent = agentDeConfigurationDuProjet(projet.id)!;
  const contenu = `Votre site vit chez o2switch.\n${DEBUT_PROCESSUS}\n{"etapes":[{"libelle":"Contrôler","commande":"curl -fsS https://x","delaiS":20}]}\n${FIN_PROCESSUS}`;
  assert.equal(retenirProcessusDuMessage(rendu('m-1', agent.id, contenu)), true);
  const miseEnProduction = store.getProject(projet.id)?.miseEnProduction;
  assert.equal(miseEnProduction?.processus?.explication, 'Votre site vit chez o2switch.');
  assert.equal(miseEnProduction?.processus?.depuisMessage, 'm-1');
  assert.equal(miseEnProduction?.agentId, agent.id);
  assert.equal(retenirProcessusDuMessage(rendu('m-1', agent.id, contenu)), false, 'un même message ne se réécrit pas');
});

test('un bloc illisible ou un autre agent ne touchent pas au processus en place', () => {
  const agent = agentDeConfigurationDuProjet(projet.id)!;
  assert.equal(retenirProcessusDuMessage(rendu('m-2', agent.id, `${DEBUT_PROCESSUS}\n{pas du json\n${FIN_PROCESSUS}`)), false);
  assert.equal(retenirProcessusDuMessage(rendu('m-3', 'un-autre-agent', `${DEBUT_PROCESSUS}\n{"etapes":[{"commande":"true"}]}\n${FIN_PROCESSUS}`)), false);
  assert.equal(store.getProject(projet.id)?.miseEnProduction?.processus?.depuisMessage, 'm-1');
});

test('un message écrit à l’agent emporte le rappel de ce qu’il rend, et rien pour un autre agent', async () => {
  const agent = agentDeConfigurationDuProjet(projet.id)!;
  store.saveMessage(rendu('m-4', agent.id, 'Bonjour'));
  const contexte = await contexteDeConfiguration(agent);
  assert.match(contexte ?? '', /ne lances JAMAIS la mise en production/);
  const autre = store.saveAgent({ ...agent, id: 'agent-autre' });
  assert.equal(await contexteDeConfiguration(autre), undefined);
});
