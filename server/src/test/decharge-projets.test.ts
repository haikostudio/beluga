import test from 'node:test';
import assert from 'node:assert/strict';
import { DELAI_DECHARGEMENT_MS, cartesARecharger, projetsADecharger } from '@haikodev/shared';

const MAINTENANT = 1_700_000_000_000;
const ilYA = (ms: number) => MAINTENANT - ms;

test('le délai est bien d’un quart d’heure', () => {
  assert.equal(DELAI_DECHARGEMENT_MS, 15 * 60 * 1000);
});

test('un projet quitté à l’instant garde ses cartes', () => {
  const oublies = projetsADecharger({
    vuA: { a: ilYA(60_000) },
    projetAffiche: 'b',
    maintenant: MAINTENANT,
  });
  assert.deepEqual(oublies, []);
});

test('un aller-retour entre deux projets ne décharge rien', () => {
  // Quitté il y a 14 minutes : encore dans le délai.
  const oublies = projetsADecharger({
    vuA: { a: ilYA(14 * 60_000) },
    projetAffiche: 'b',
    maintenant: MAINTENANT,
  });
  assert.deepEqual(oublies, []);
});

test('passé quinze minutes sans être consulté, un projet rend ses cartes', () => {
  const oublies = projetsADecharger({
    vuA: { a: ilYA(16 * 60_000), b: ilYA(60_000) },
    projetAffiche: 'c',
    maintenant: MAINTENANT,
  });
  assert.deepEqual(oublies, ['a']);
});

test('le projet AFFICHÉ n’est jamais déchargé, même après des heures', () => {
  const oublies = projetsADecharger({
    vuA: { a: ilYA(5 * 60 * 60_000) },
    projetAffiche: 'a',
    maintenant: MAINTENANT,
  });
  assert.deepEqual(oublies, []);
});

test('plusieurs projets oubliés sont rendus ensemble, dans un ordre stable', () => {
  const oublies = projetsADecharger({
    vuA: { zeta: ilYA(30 * 60_000), alpha: ilYA(20 * 60_000), recent: ilYA(1000) },
    projetAffiche: null,
    maintenant: MAINTENANT,
  });
  assert.deepEqual(oublies, ['alpha', 'zeta']);
});

test('un projet sans cartes en mémoire se recharge ; avec, non', () => {
  const enMemoire = [{ projectId: 'a' }, { projectId: 'a' }, { projectId: 'b' }];
  assert.equal(cartesARecharger('a', enMemoire), false);
  assert.equal(cartesARecharger('c', enMemoire), true);
  assert.equal(cartesARecharger('a', []), true);
});
