import assert from 'node:assert/strict';
import test from 'node:test';
import { avancementDeLaColonne, type CartePourAvancement } from '@haikodev/shared';

/** Les quatre cartes de la copie d'écran : 4/6, 3/6, 3/5 et 1/3 faites. */
const COLONNE: CartePourAvancement[] = [
  { agentActif: true, todos: { done: 4, total: 6 } },
  { agentActif: true, todos: { done: 3, total: 6 } },
  { agentActif: true, todos: { done: 3, total: 5 } },
  { agentActif: true, todos: { done: 1, total: 3 } },
];

test('la colonne additionne les étapes de toutes ses cartes', () => {
  const avancement = avancementDeLaColonne(COLONNE);
  assert.deepEqual(avancement, { done: 11, total: 20, pourcent: 55, termine: false });
});

test('aucune carte, ou aucune étape comptée : rien à afficher', () => {
  assert.equal(avancementDeLaColonne([]), null);
  assert.equal(avancementDeLaColonne([{ agentActif: true }]), null);
  assert.equal(avancementDeLaColonne([{ agentActif: true, todos: { done: 0, total: 0 } }]), null);
});

test('une carte sans agent au travail ne pèse pas : son avancement est figé', () => {
  assert.equal(avancementDeLaColonne([{ agentActif: false, todos: { done: 2, total: 4 } }]), null);
  const avancement = avancementDeLaColonne([
    { agentActif: false, todos: { done: 0, total: 10 } },
    { agentActif: true, todos: { done: 1, total: 2 } },
  ]);
  assert.equal(avancement?.pourcent, 50);
});

test('tout coché : la colonne est à 100 % et se dit terminée', () => {
  const avancement = avancementDeLaColonne([
    { agentActif: true, todos: { done: 3, total: 3 } },
    { agentActif: true, todos: { done: 2, total: 2 } },
  ]);
  assert.deepEqual(avancement, { done: 5, total: 5, pourcent: 100, termine: true });
});

test('les arrondis ne mentent pas aux deux bouts', () => {
  // 199/200 arrondirait à 100 % alors qu'il reste une étape.
  assert.equal(avancementDeLaColonne([{ agentActif: true, todos: { done: 199, total: 200 } }])?.pourcent, 99);
  // 1/300 arrondirait à 0 % alors que le travail a commencé.
  assert.equal(avancementDeLaColonne([{ agentActif: true, todos: { done: 1, total: 300 } }])?.pourcent, 1);
  // Rien de coché reste bien à 0 %.
  assert.equal(avancementDeLaColonne([{ agentActif: true, todos: { done: 0, total: 4 } }])?.pourcent, 0);
});

test('un décompte abîmé ne fait pas dépasser 100 %', () => {
  const avancement = avancementDeLaColonne([{ agentActif: true, todos: { done: 9, total: 4 } }]);
  assert.deepEqual(avancement, { done: 4, total: 4, pourcent: 100, termine: true });
});
