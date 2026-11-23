import test from 'node:test';
import assert from 'node:assert/strict';
import { RAISON_PLAN_ATTENDU, raisonDAttendreLeLancement, suiteDuPlanAttendu } from '@beluga/shared';

const pret = {
  actif: true,
  tourReussi: true,
  comprehensionAt: 100,
  questionEnAttente: false,
  planSouhaite: false,
  planDemande: false,
  plansRendusA: [] as number[],
};

test('une compréhension prête part, interrupteur allumé', () => {
  assert.equal(raisonDAttendreLeLancement(pret), null);
});

test('rien ne part contre une décision qui attend', () => {
  assert.match(raisonDAttendreLeLancement({ ...pret, actif: false })!, /éteint/);
  assert.match(raisonDAttendreLeLancement({ ...pret, tourReussi: false })!, /normalement/);
  assert.match(raisonDAttendreLeLancement({ ...pret, comprehensionAt: undefined })!, /compréhension/);
  assert.match(raisonDAttendreLeLancement({ ...pret, questionEnAttente: true })!, /question/);
  assert.match(raisonDAttendreLeLancement({ ...pret, planDemande: true })!, /plan/);
});

test('avec le cahier des charges, il faut un plan rendu après la compréhension', () => {
  assert.match(raisonDAttendreLeLancement({ ...pret, planSouhaite: true, plansRendusA: [50] })!, /cahier/);
  assert.equal(raisonDAttendreLeLancement({ ...pret, planSouhaite: true, plansRendusA: [50, 150] }), null);
});

test('le plan manquant se réclame une fois par compréhension, puis le lancement est refusé', () => {
  const raison = raisonDAttendreLeLancement({ ...pret, planSouhaite: true });
  assert.equal(raison, RAISON_PLAN_ATTENDU);
  assert.equal(suiteDuPlanAttendu(raison, 100, undefined), 'reclamer');
  assert.equal(suiteDuPlanAttendu(raison, 100, 100), 'refuser');
  /* Une compréhension NEUVE rouvre la réclamation. */
  assert.equal(suiteDuPlanAttendu(raison, 200, 100), 'reclamer');
  /* Toute autre attente ne réclame rien. */
  assert.equal(suiteDuPlanAttendu('une question attend votre réponse', 100, undefined), null);
  assert.equal(suiteDuPlanAttendu(null, 100, undefined), null);
});
