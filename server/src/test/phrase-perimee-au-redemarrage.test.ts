import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Agent,
  Card,
  RAISON_ATTEND_VOTRE_REPONSE,
  RAISON_DEJA_LIVRE,
  colonneAuDemarrage,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* UNE BARRE JAUNE SANS OBJET N'EXISTE PLUS                            */
/*                                                                     */
/* Le bogue rapporté : une carte affichait « La tâche attend votre     */
/* réponse » alors que la réponse avait été donnée depuis longtemps et  */
/* que l'agent retravaillait. Le triangle jaune restait posé en pied de */
/* carte, sans rien attendre de personne.                              */
/*                                                                     */
/* La cause : l'agent qui pose une question laisse sa carte EN PLACE,   */
/* dans « Travail », avec sa phrase. Quand le tour repart après la      */
/* réponse, la carte ne CHANGE donc pas de colonne — et le chemin de    */
/* démarrage qui n'a rien à déplacer se contentait de poser la marque   */
/* de vol, sans jamais toucher à la phrase. Elle survivait au tour      */
/* suivant, et à tous les autres si celui-ci tombait.                   */
/*                                                                     */
/* La branche d'à côté — celle qui déplace la carte — effaçait déjà     */
/* cette phrase. Les deux disent maintenant la même chose.             */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'phrase-perimee-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { replacerCarteAuDemarrage } = await import('../runtime.js');

const PROJET = 'projet-essai';

/**
 * Une carte en « Travail » qui porte une phrase, avec son agent : l'état exact
 * d'une carte dont l'agent vient de poser une question.
 */
function poserCarte(id: string, phrase: string | undefined, colonne: Card['column'] = 'running'): Agent {
  const maintenant = Date.now();
  const agent = Agent.parse({
    id: `agent-${id}`,
    projectId: PROJET,
    cardId: id,
    role: 'task',
    title: `Agent de ${id}`,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  });
  store.saveAgent(agent);
  store.saveCard(
    Card.parse({
      id,
      projectId: PROJET,
      title: `Carte ${id}`,
      column: colonne,
      position: 1,
      agentId: agent.id,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: { asap: false, attempts: 1, restarts: 0 },
      ...(phrase ? { sansModification: phrase } : {}),
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
  );
  return agent;
}

test('la carte qui attendait une réponse n’a RIEN à changer de colonne', () => {
  // C'est tout le piège : sans déplacement, l'ancien code ne touchait à rien.
  assert.equal(colonneAuDemarrage('running', 'task'), null);
});

test('un tour qui repart efface la phrase « attend votre réponse »', () => {
  const agent = poserCarte('c-question', RAISON_ATTEND_VOTRE_REPONSE);
  replacerCarteAuDemarrage(agent);
  const apres = store.getCard('c-question');
  assert.equal(apres?.sansModification, undefined, 'la barre jaune ne survit pas au tour suivant');
  assert.equal(apres?.column, 'running', 'et la carte ne bouge pas pour autant');
  assert.ok(apres?.scheduling?.tourEnVolDepuis, 'la marque de vol est posée comme avant');
});

test('…y compris quand la marque de vol était DÉJÀ posée', () => {
  // Le cas d'une carte reprise deux fois de suite : l'ancien code sortait
  // aussitôt sur la marque déjà présente, sans jamais effacer la phrase.
  const agent = poserCarte('c-deux-fois', RAISON_ATTEND_VOTRE_REPONSE);
  const carte = store.getCard('c-deux-fois')!;
  store.saveCard({ ...carte, scheduling: { ...carte.scheduling!, tourEnVolDepuis: 1_000 } });
  replacerCarteAuDemarrage(agent);
  assert.equal(store.getCard('c-deux-fois')?.sansModification, undefined);
  assert.equal(store.getCard('c-deux-fois')?.scheduling?.tourEnVolDepuis, 1_000, 'la marque d’origine est gardée');
});

test('une carte rangée dans une fin de parcours n’est pas rouverte par un tour de suite', () => {
  /*
   * L'ancienne garde protégeait un cas réel : une carte close, relancée par un
   * simple tour de suite, ne doit voir ni sa date de clôture ni sa suspension
   * effacées — sinon elle se rouvrirait toute seule. Effacer la phrase ne doit
   * rien changer à cela.
   */
  const agent = poserCarte('c-close', RAISON_DEJA_LIVRE, 'to_deploy');
  const carte = store.getCard('c-close')!;
  store.saveCard({
    ...carte,
    doneAt: 1_000,
    scheduling: { ...carte.scheduling!, suspendu: true, tourEnVolDepuis: 1_000 },
  });
  replacerCarteAuDemarrage(agent);
  const apres = store.getCard('c-close');
  assert.equal(apres?.column, 'to_deploy', 'une fin de parcours ne se rouvre que sur geste humain');
  assert.equal(apres?.doneAt, 1_000, 'sa date de clôture tient');
  assert.equal(apres?.scheduling?.suspendu, true, 'sa suspension aussi');
});

test('toute phrase du tour d’avant s’efface, pas seulement celle de la question', () => {
  // Une phrase de constat est vraie du tour PRÉCÉDENT : la garder pendant que
  // l'agent retravaille ferait lire l'état d'hier sur un travail d'aujourd'hui.
  const agent = poserCarte('c-constat', RAISON_DEJA_LIVRE);
  replacerCarteAuDemarrage(agent);
  assert.equal(store.getCard('c-constat')?.sansModification, undefined);
});
