import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ECHECS_DE_LA_MISE_A_JOUR_AVANT_ABANDON,
  doitPublierLaMiseAJour,
  echecsDeLaCarte,
  tacheDeMiseAJourOuverte,
  type EtatDeLaTacheDeMiseAJour,
} from '@beluga/shared';

const MAINTENANT = 1_800_000_000_000;

function prete(patch: Partial<EtatDeLaTacheDeMiseAJour> = {}): EtatDeLaTacheDeMiseAJour {
  return { prete: true, attendUneDecision: false, agentsAuTravail: 0, publicationEnCours: false, echecs: 0, ...patch };
}

test('rendue sans blocage, la tâche de mise à jour part', () => {
  assert.equal(doitPublierLaMiseAJour(prete(), MAINTENANT).partir, true);
});

test('pas dans « À déployer » : rien ne part', () => {
  assert.equal(doitPublierLaMiseAJour(prete({ prete: false }), MAINTENANT).partir, false);
});

test('une question posée à l’utilisateur (conflit, tests en échec) retient la mise à jour', () => {
  const decision = doitPublierLaMiseAJour(prete({ attendUneDecision: true }), MAINTENANT);
  assert.equal(decision.partir, false);
  assert.match(decision.raison, /décision/);
});

test('un agent au travail ou une publication en cours retiennent la mise à jour', () => {
  assert.equal(doitPublierLaMiseAJour(prete({ agentsAuTravail: 1 }), MAINTENANT).partir, false);
  assert.equal(doitPublierLaMiseAJour(prete({ publicationEnCours: true }), MAINTENANT).partir, false);
});

test('après un échec, on attend avant de réessayer, puis on renonce', () => {
  assert.equal(doitPublierLaMiseAJour(prete({ echecs: 1, dernierEchecA: MAINTENANT - 1000 }), MAINTENANT).partir, false);
  assert.equal(doitPublierLaMiseAJour(prete({ echecs: 1, dernierEchecA: MAINTENANT - 10 * 60_000 }), MAINTENANT).partir, true);
  const abandon = doitPublierLaMiseAJour(prete({ echecs: ECHECS_DE_LA_MISE_A_JOUR_AVANT_ABANDON, dernierEchecA: 0 }), MAINTENANT);
  assert.equal(abandon.partir, false);
  assert.equal(abandon.abandon, true);
});

test('les échecs comptés sont ceux des publications qui portaient la carte', () => {
  const runs = [
    { state: 'failed', cardIds: ['autre'], endedAt: 5 },
    { state: 'failed', cardIds: ['maj'], endedAt: 3 },
    { state: 'success', cardIds: ['maj', 'autre'], endedAt: 4 },
    { state: 'failed', cardIds: ['maj'], endedAt: 7 },
  ];
  assert.deepEqual(echecsDeLaCarte(runs, 'maj'), { echecs: 2, dernierEchecA: 7 });
  assert.deepEqual(echecsDeLaCarte(runs, 'rien'), { echecs: 0, dernierEchecA: undefined });
});

test('seule la carte MARQUÉE est la tâche de mise à jour, et seulement tant qu’elle est ouverte', () => {
  type Essai = { id: string; miseAJourBeluga?: boolean; column: 'to_deploy' | 'archived' | 'running'; createdAt: number; deployedAt?: number };
  const cartes: Essai[] = [
    { id: 'a', miseAJourBeluga: undefined, column: 'to_deploy', createdAt: 1 },
    { id: 'b', miseAJourBeluga: true, column: 'archived', createdAt: 2 },
    { id: 'c', miseAJourBeluga: true, column: 'to_deploy', createdAt: 3, deployedAt: 9 },
    { id: 'd', miseAJourBeluga: true, column: 'running', createdAt: 4 },
  ];
  assert.equal(tacheDeMiseAJourOuverte(cartes)?.id, 'd');
  assert.equal(tacheDeMiseAJourOuverte(cartes.slice(0, 3)), null);
});
