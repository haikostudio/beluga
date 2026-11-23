import test from 'node:test';
import assert from 'node:assert/strict';
import { DUREE_DES_TACHES_EN_COURS_MS, DUREE_D_UNE_DEPLOYEE_A_OUVRIR_MS, deployeeNonVue, estTacheEnCours, tachesEnCours } from '@beluga/shared';

/* La zone « En cours » de la colonne de gauche (`shared/src/taches-en-cours.ts`, 01/11/2026). */
const MAINTENANT = 10 * DUREE_DES_TACHES_EN_COURS_MS;
const JOUR = 24 * 60 * 60 * 1000;
const carte = (id: string, patch: Record<string, unknown>) => ({ id, column: 'planned', updatedAt: MAINTENANT - JOUR, ...patch }) as any;

test('une carte non archivée y est si elle a bougé dans les dernières 24 h (13/11/2026)', () => {
  assert.equal(estTacheEnCours(carte('demo', { column: 'planned', updatedAt: MAINTENANT - 1000 }), false, MAINTENANT), true);
  assert.equal(estTacheEnCours(carte('limite', { column: 'running', updatedAt: MAINTENANT - JOUR }), false, MAINTENANT), true);
  // endormie depuis plus de 24 h, sans agent ni question → DEHORS
  assert.equal(estTacheEnCours(carte('vieille', { column: 'planned', updatedAt: MAINTENANT - 21 * JOUR }), false, MAINTENANT), false);
  assert.equal(estTacheEnCours(carte('c', { column: 'to_deploy', updatedAt: MAINTENANT - JOUR - 1 }), false, MAINTENANT), false);
});

test('une carte endormie reste si un agent y travaille ou si une réponse est attendue', () => {
  const vieille = carte('v', { column: 'running', updatedAt: MAINTENANT - 5 * JOUR });
  assert.equal(estTacheEnCours(vieille, true, MAINTENANT), true);
  assert.equal(estTacheEnCours(vieille, false, MAINTENANT, true), true);
  const vieilles = [carte('x', { updatedAt: MAINTENANT - 3 * JOUR }), carte('y', { updatedAt: MAINTENANT - 3 * JOUR })];
  assert.deepEqual(tachesEnCours(vieilles, new Set(), MAINTENANT, new Set(['y'])).map((c) => c.id), ['y']);
});

test('une rangée n’y entre pas, sauf si un agent y vit encore', () => {
  assert.equal(estTacheEnCours(carte('f', { column: 'archived' }), false, MAINTENANT), false);
  assert.equal(estTacheEnCours(carte('g', { column: 'archived' }), true, MAINTENANT), true);
});

test('une déployée reste tant qu’on ne l’a pas ouverte, même après 24 h (filet de 30 jours)', () => {
  const deployee = carte('h', { column: 'archived', deployedAt: MAINTENANT - 1000, lastReadAt: MAINTENANT - 2 * JOUR });
  assert.equal(deployeeNonVue(deployee, MAINTENANT), true);
  assert.equal(estTacheEnCours(deployee, false, MAINTENANT), true);
  assert.equal(deployeeNonVue({ ...deployee, lastReadAt: MAINTENANT }, MAINTENANT), false);
  // décision du 15/11/2026 : plus de borne de 24 h, seule l'ouverture la retire
  assert.equal(deployeeNonVue({ ...deployee, deployedAt: MAINTENANT - 2 * JOUR, lastReadAt: 0 }, MAINTENANT), true);
  assert.equal(estTacheEnCours({ ...deployee, deployedAt: MAINTENANT - 5 * JOUR, updatedAt: MAINTENANT - 5 * JOUR, lastReadAt: 0 }, false, MAINTENANT), true);
  const tresTard = MAINTENANT + DUREE_D_UNE_DEPLOYEE_A_OUVRIR_MS;
  assert.equal(deployeeNonVue({ ...deployee, lastReadAt: 0 }, tresTard), false);
  // une date de mise en ligne hors d'« Archivé » ne compte pas
  assert.equal(deployeeNonVue({ ...deployee, column: 'to_deploy' }, MAINTENANT), false);
});

test('la plus récente en tête, par la date que la ligne affiche', () => {
  const liste = tachesEnCours(
    [carte('vieille', { column: 'running', updatedAt: MAINTENANT - 3 * 60 * 60 * 1000 }), carte('neuve', { column: 'to_deploy', updatedAt: MAINTENANT - 1000 }), carte('rangee', { column: 'archived' })],
    new Set(),
    MAINTENANT,
  );
  assert.deepEqual(liste.map((c) => c.id), ['neuve', 'vieille']);
});
