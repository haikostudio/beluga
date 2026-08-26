import assert from 'node:assert/strict';
import test from 'node:test';
import { agentCompteCommeTravail, colonneAffichee, type CartePourAffichage } from '@haikodev/shared';

/** La carte du symptôme : rangée en « Planifié », son agent travaille. */
const RETOMBEE: CartePourAffichage = { column: 'planned', agentAuTravail: true };

test('une carte en « Planifié » dont un agent travaille se montre en « En cours »', () => {
  assert.equal(colonneAffichee(RETOMBEE), 'running');
});

test('une note dont un agent travaille se montre aussi en « En cours »', () => {
  assert.equal(colonneAffichee({ column: 'notes', agentAuTravail: true }), 'running');
});

test('sans agent au travail, la colonne enregistrée fait foi', () => {
  assert.equal(colonneAffichee({ column: 'planned' }), 'planned');
  assert.equal(colonneAffichee({ column: 'planned', agentAuTravail: false }), 'planned');
});

test('une carte déjà en « En cours » ne bouge pas : rien à corriger', () => {
  assert.equal(colonneAffichee({ column: 'running', agentAuTravail: true }), 'running');
});

test('une carte au travail se montre en « En cours » depuis n’importe quelle colonne', () => {
  // Terminé, à déployer, archivé : l'agent tourne, la carte se montre en cours.
  for (const column of ['done', 'to_deploy', 'archived'] as const) {
    assert.equal(colonneAffichee({ column, agentAuTravail: true }), 'running');
  }
});

test('sans agent au travail, ces colonnes restent inchangées', () => {
  for (const column of ['done', 'to_deploy', 'archived'] as const) {
    assert.equal(colonneAffichee({ column }), column);
  }
});

/* ------------------------------------------------------------------ */
/* Le CADRAGE n'est pas le travail de la carte                         */
/* ------------------------------------------------------------------ */

test('un agent de cadrage ne compte pas comme le travail de la carte', () => {
  // Discuter une carte n'est pas la faire : la carte-fil restait en
  // « Planifié » dans son tiroir, et sautait pourtant en « En cours » sur le
  // tableau à chaque réponse de cadrage.
  assert.equal(agentCompteCommeTravail('cadrage'), false);
});

test('tous les autres rôles comptent, comme avant', () => {
  for (const role of ['task', 'analysis', 'orchestrator', 'deploy', undefined]) {
    assert.equal(agentCompteCommeTravail(role), true);
  }
});
