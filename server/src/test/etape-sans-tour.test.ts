import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent, Card, DELAI_ETAPE_SANS_TOUR_MS, INCIDENT_PLAN_NON_RENDU } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* AUCUNE ÉTAPE NE RESTE ALLUMÉE PLUS LONGTEMPS QUE SON TOUR           */
/*                                                                     */
/* Le symptôme rapporté : « je vois le plan toujours en train d'être    */
/* généré après des heures… ça a planté ». La carte portait sa demande  */
/* de plan (`parcours.planDemandeA`), posée au clic ; le tour, lui,     */
/* était mort — quota épuisé, démon redémarré — sans jamais passer par  */
/* la fin de tour qui aurait effacé cette demande. L'écran affichait    */
/* donc « génération du plan en cours » indéfiniment, et le bouton      */
/* « Générer le plan » restait éteint : la carte était murée.           */
/*                                                                     */
/* `rangerLesCartesOubliees` ne pouvait rien : il ne regarde que la     */
/* colonne « En cours », et une carte de cadrage ne quitte jamais       */
/* « Planifié ». Ce contrôle rejoue le balayage qui manquait, sur une   */
/* VRAIE base.                                                          */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'etape-sans-tour-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { refermerLesEtapesSansTour } = await import('../deplacement-carte.js');

const PROJET = 'projet-essai';
/** Une demande de plan bien plus vieille que le délai de grâce. */
const DEMANDE_MORTE = Date.now() - DELAI_ETAPE_SANS_TOUR_MS - 60_000;

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
      role: 'cadrage',
      title: `Cadrage de ${id}`,
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
      column: 'planned',
      position: 1,
      agentId: agent.id,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      parcours: { plans: [], planDemandeA: DEMANDE_MORTE },
      createdAt: maintenant,
      updatedAt: maintenant,
      ...cartePatch,
    }),
  );
  return { carte, agent };
}

test('une demande de plan dont le tour est MORT se referme sur son incident', () => {
  poser('c-plan-mort');

  refermerLesEtapesSansTour();

  const apres = store.getCard('c-plan-mort');
  assert.equal(apres?.parcours?.planDemandeA, undefined, 'l’étape ne tourne plus');
  assert.equal(apres?.parcours?.incident?.texte, INCIDENT_PLAN_NON_RENDU, 'et l’incident dit quoi faire');
});

test('un tour ENCORE VIVANT garde son étape allumée', () => {
  poser('c-plan-vivant', { tourVivantDepuis: Date.now() - 20 * 60_000 });

  refermerLesEtapesSansTour();

  const apres = store.getCard('c-plan-vivant');
  assert.equal(apres?.parcours?.planDemandeA, DEMANDE_MORTE, 'rien n’a été refermé');
  assert.equal(apres?.parcours?.incident, undefined);
});

test('un agent AU TRAVAIL garde son étape allumée, lui aussi', () => {
  poser('c-plan-au-travail', { status: 'running' });

  refermerLesEtapesSansTour();

  assert.equal(store.getCard('c-plan-au-travail')?.parcours?.planDemandeA, DEMANDE_MORTE);
});

test('une demande TOUTE FRAÎCHE n’est jamais refermée : le moteur démarre encore', () => {
  poser('c-plan-frais', {}, { parcours: { plans: [], planDemandeA: Date.now() - 5_000 } });

  refermerLesEtapesSansTour();

  assert.ok(store.getCard('c-plan-frais')?.parcours?.planDemandeA, 'le délai de grâce protège le départ');
});

test('le balayage repasse sans rien casser sur une carte déjà refermée', () => {
  poser('c-plan-deux-fois');

  refermerLesEtapesSansTour();
  const premier = store.getCard('c-plan-deux-fois')?.parcours?.incident?.at;
  refermerLesEtapesSansTour();
  const second = store.getCard('c-plan-deux-fois')?.parcours?.incident?.at;

  assert.equal(premier, second, 'l’incident n’est pas réécrit à chaque passage');
});
