import test from 'node:test';
import assert from 'node:assert/strict';
import { placeDuRepereDePlan } from '@haikodev/shared';

/*
 * Le repère de plan prend la place du dossier, à GAUCHE du nom — mais jamais
 * celle de la roue d'un agent au travail ni du nuage d'une publication : dans
 * ces deux cas il retourne à droite, où il vivait avant. Le signal ne disparaît
 * donc jamais, il change seulement de côté (`shared/src/place-repere-plan.ts`,
 * branché sur `RepereRobot` dans `web/src/components/sidebar.tsx`).
 */

test('aucun plan en attente : aucun repère', () => {
  assert.equal(placeDuRepereDePlan({}), 'aucune');
  assert.equal(placeDuRepereDePlan({ planEnAttente: false, running: 2 }), 'aucune');
});

test('emplacement libre : le repère prend la place du dossier', () => {
  assert.equal(placeDuRepereDePlan({ planEnAttente: true }), 'gauche');
  assert.equal(placeDuRepereDePlan({ planEnAttente: true, running: 0, publie: false }), 'gauche');
});

test('un agent au travail garde sa roue : le repère reste à droite', () => {
  assert.equal(placeDuRepereDePlan({ planEnAttente: true, running: 1 }), 'droite');
  assert.equal(placeDuRepereDePlan({ planEnAttente: true, running: 3 }), 'droite');
});

test('une publication en cours garde son nuage : le repère reste à droite', () => {
  assert.equal(placeDuRepereDePlan({ planEnAttente: true, publie: true }), 'droite');
  assert.equal(placeDuRepereDePlan({ planEnAttente: true, running: 2, publie: true }), 'droite');
});
