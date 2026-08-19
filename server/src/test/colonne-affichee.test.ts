import assert from 'node:assert/strict';
import test from 'node:test';
import { colonneAffichee, type CartePourAffichage } from '@haikodev/shared';

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
  // Terminé, à déployer, en production, archivé : l'agent tourne, la carte se montre en cours.
  for (const column of ['done', 'to_deploy', 'in_production', 'archived'] as const) {
    assert.equal(colonneAffichee({ column, agentAuTravail: true }), 'running');
  }
});

test('sans agent au travail, ces colonnes restent inchangées', () => {
  for (const column of ['done', 'to_deploy', 'in_production', 'archived'] as const) {
    assert.equal(colonneAffichee({ column }), column);
  }
});
