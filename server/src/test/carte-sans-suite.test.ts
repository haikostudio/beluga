import assert from 'node:assert/strict';
import test from 'node:test';
import { DELAI_SANS_SUITE, mentionSansSuite, type CarteAJuger } from '@haikodev/shared';

const MAINTENANT = 1_800_000_000_000;
const HEURE = 60 * 60 * 1000;

/** Une carte en cours dont le tour s'est achevé il y a trois heures. */
const FIGEE: CarteAJuger = {
  column: 'running',
  finDuDernierTour: MAINTENANT - 3 * HEURE,
  agentActif: false,
};

test('une carte en cours sans agent depuis plus d’une heure le dit', () => {
  const mention = mentionSansSuite(FIGEE, MAINTENANT);
  assert.ok(mention);
  assert.match(mention, /3 h/);
  assert.match(mention, /aucun agent/);
});

test('le délai est bien d’une heure, pas moins', () => {
  assert.equal(DELAI_SANS_SUITE, HEURE);
  const juste = { ...FIGEE, finDuDernierTour: MAINTENANT - HEURE + 1 };
  assert.equal(mentionSansSuite(juste, MAINTENANT), null);
  const depasse = { ...FIGEE, finDuDernierTour: MAINTENANT - HEURE };
  assert.ok(mentionSansSuite(depasse, MAINTENANT));
});

test('au-delà d’un jour, la mention compte en jours', () => {
  const vieille = { ...FIGEE, finDuDernierTour: MAINTENANT - 50 * HEURE };
  assert.match(mentionSansSuite(vieille, MAINTENANT) ?? '', /2 jours/);
  const hier = { ...FIGEE, finDuDernierTour: MAINTENANT - 25 * HEURE };
  assert.match(mentionSansSuite(hier, MAINTENANT) ?? '', /1 jour —/);
});

test('un agent qui travaille : la roue le dit déjà', () => {
  assert.equal(mentionSansSuite({ ...FIGEE, agentActif: true }, MAINTENANT), null);
});

test('une décision en attente : le triangle dit mieux ce qui bloque', () => {
  assert.equal(mentionSansSuite({ ...FIGEE, decisionEnAttente: true }, MAINTENANT), null);
});

test('hors de « En cours », la colonne dit déjà où en est la carte', () => {
  for (const column of ['todo', 'validated', 'planned', 'done', 'to_deploy', 'archived']) {
    assert.equal(mentionSansSuite({ ...FIGEE, column }, MAINTENANT), null);
  }
});

test('une carte dont aucun tour n’a jamais fini ne dit rien', () => {
  assert.equal(mentionSansSuite({ column: 'running' }, MAINTENANT), null);
});
