import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent, Card, RAISON_TOUR_SANS_ISSUE, SEUIL_VOL_BLOQUE_MS } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* UNE CARTE NE PASSE EN « TERMINÉ » QUE QUAND SON TOUR A FINI DE      */
/* RANGER                                                              */
/*                                                                     */
/* Le bogue rapporté : plusieurs cartes, sur plusieurs projets, se      */
/* retrouvaient rangées d'office en « Terminé » avec la phrase « le     */
/* tour s'est terminé sans ranger la carte », liste de sous-tâches      */
/* incomplète (6/7, 4/5, 5/6) et travail qui continuait.               */
/*                                                                     */
/* La cause : un tour se range EN PLUSIEURS TEMPS. Le démon fige la     */
/* réponse à l'écran, remet l'agent au repos — statut « terminé » —,    */
/* PUIS comprime le fil, mesure le quota, constate le dépôt, fusionne   */
/* la branche de la carte et referme sa copie de travail. Des minutes   */
/* entières. Le balayage des cartes oubliées ne regardait que le        */
/* STATUT : il voyait une carte en « En cours » sans agent au travail,  */
/* avec une marque de vol vieille de plus de cinq minutes, et la        */
/* fermait — avant la fusion de branche. Le vrai rangement, arrivé une  */
/* minute plus tard, ne trouvait plus sa carte en « En cours » et ne    */
/* faisait donc plus rien : la phrase fausse restait.                   */
/*                                                                     */
/* Le témoin qui couvre cette fenêtre est `Agent.tourVivantDepuis`,     */
/* posé au lancement du moteur et retiré à la toute dernière ligne du   */
/* tour. Ce contrôle le rejoue sur le VRAI balayage du démon.          */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'carte-en-rangement-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { rangerLesCartesOubliees } = await import('../deplacement-carte.js');
const { agentsOccupes } = await import('../deploy.js');

const PROJET = 'projet-essai';
/** Bien au-delà du seuil : la marque de vol ne protège plus rien par elle-même. */
const VOL_PERIME = Date.now() - SEUIL_VOL_BLOQUE_MS - 60_000;

/**
 * Une carte en « En cours » et l'agent qui la porte, posés dans une vraie base.
 * `statut` et `tourVivant` sont les deux témoins dont on veut comparer l'effet.
 */
function poser(
  id: string,
  agentPatch: Partial<Agent> = {},
  cartePatch: Partial<Card> = {},
): { carte: Card; agent: Agent } {
  const maintenant = Date.now();
  const agent = store.saveAgent(
    Agent.parse({
      id: `agent-${id}`,
      projectId: PROJET,
      cardId: id,
      role: 'task',
      title: `Agent de ${id}`,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status: 'done',
      createdAt: maintenant,
      updatedAt: maintenant,
      ...agentPatch,
    }),
  );
  const carte = store.saveCard(
    Card.parse({
      id,
      projectId: PROJET,
      title: `Carte ${id}`,
      column: 'running',
      position: 1,
      agentId: agent.id,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: { asap: false, attempts: 1, restarts: 0, tourEnVolDepuis: VOL_PERIME },
      createdAt: maintenant,
      updatedAt: maintenant,
      ...cartePatch,
    }),
  );
  return { carte, agent };
}

test('une carte dont le TOUR RANGE ENCORE n’est pas fermée par le balayage', () => {
  poser('c-en-rangement', { tourVivantDepuis: Date.now() - 20 * 60_000 });

  rangerLesCartesOubliees();

  const apres = store.getCard('c-en-rangement');
  assert.equal(apres?.column, 'running', 'la carte est restée là où son tour la rangera');
  assert.equal(apres?.sansModification, undefined, 'aucune phrase de rangement d’office');
});

test('…tandis qu’une VRAIE oubliée, elle, est bien fermée', () => {
  // Même carte à tous égards : seul le témoin de tour vivant change.
  poser('c-vraiment-oubliee');

  rangerLesCartesOubliees();

  const apres = store.getCard('c-vraiment-oubliee');
  assert.equal(apres?.column, 'done');
  assert.equal(apres?.sansModification, RAISON_TOUR_SANS_ISSUE);
});

test('le tour vivant se retire, et le balayage reprend alors ses droits', () => {
  const { agent } = poser('c-rangement-fini', { tourVivantDepuis: Date.now() - 20 * 60_000 });

  rangerLesCartesOubliees();
  assert.equal(store.getCard('c-rangement-fini')?.column, 'running');

  // Le tour a fini de tout ranger : la marque tombe, plus rien ne le retient.
  store.saveAgent({ ...store.getAgent(agent.id)!, tourVivantDepuis: undefined });
  rangerLesCartesOubliees();
  assert.equal(store.getCard('c-rangement-fini')?.column, 'done');
});

test('une publication refuse de partir pendant qu’un tour range encore', () => {
  /*
   * MÊME FENÊTRE, AUTRE VICTIME. `agentsOccupes` ne regardait que le statut :
   * le déploiement — automatique compris, qui repasse toutes les quinze
   * secondes — pouvait donc mettre en ligne un lot AMPUTÉ du travail de la
   * carte qui venait de finir, sa branche n'étant pas encore fusionnée.
   */
  poser('c-publication', { tourVivantDepuis: Date.now() - 20 * 60_000 });
  const occupes = agentsOccupes(PROJET);
  assert.ok(
    occupes.some((a) => a.id === 'agent-c-publication'),
    'l’agent dont le tour range encore compte comme occupé',
  );
});

test('un agent au repos depuis longtemps ne bloque, lui, aucune publication', () => {
  poser('c-au-repos');
  assert.equal(
    agentsOccupes(PROJET).some((a) => a.id === 'agent-c-au-repos'),
    false,
  );
});
