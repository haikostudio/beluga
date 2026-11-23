import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTEURS, moteurDuTriAutomatique, ordreDeMoteursComplet, type MoteurCatalogue } from '@beluga/shared';

/*
 * QUEL MOTEUR REÇOIT UNE CARTE QUE PERSONNE N'A RÉGLÉE À LA MAIN.
 *
 * Règle pure, sans disque : elle ne connaît que le genre trouvé par Jev et
 * un catalogue de moteurs — jamais Cursor par bascule automatique (DEC-156),
 * jamais rien de cassé quand aucun moteur n'a de quota.
 */

function moteur(id: 'claude' | 'codex' | 'cursor', comptesDisponibles: number, installed = true): MoteurCatalogue {
  return { id, label: id, installed, comptesDisponibles, models: [] };
}

const CLAUDE_OK = moteur('claude', 2);
const CODEX_OK = moteur('codex', 1);
const CLAUDE_SATURE = moteur('claude', 0);
const CODEX_SATURE = moteur('codex', 0);
const CURSOR_OK = moteur('cursor', 5);

test('sans réglage, le premier moteur du registre reçoit la carte, quel que soit son genre', () => {
  for (const genre of ['programmation_avancee', 'administratif', 'indetermine'] as const) {
    assert.deepEqual(moteurDuTriAutomatique(genre, [CLAUDE_OK, CODEX_OK]), { engine: 'claude', bascule: false });
  }
});

test('l’ordre réglé par l’utilisateur décide : Codex en tête, Codex reçoit la carte', () => {
  const choix = moteurDuTriAutomatique('programmation_avancee', [CLAUDE_OK, CODEX_OK], ['codex', 'claude']);
  assert.deepEqual(choix, { engine: 'codex', bascule: false });
});

test('le moteur en tête sans quota laisse la place au suivant de la liste', () => {
  assert.deepEqual(moteurDuTriAutomatique('indetermine', [CLAUDE_OK, CODEX_SATURE], ['codex', 'claude']), {
    engine: 'claude',
    bascule: true,
  });
  assert.deepEqual(moteurDuTriAutomatique('indetermine', [CLAUDE_SATURE, CODEX_OK]), { engine: 'codex', bascule: true });
});

test('ni Claude ni Codex disponibles : jamais de bascule automatique vers Cursor', () => {
  const choix = moteurDuTriAutomatique('programmation_avancee', [CLAUDE_SATURE, CODEX_SATURE, CURSOR_OK]);
  assert.equal(choix.engine, 'claude');
  assert.notEqual(choix.engine, 'cursor');
});

test('Cursor rangé en tête de l’ordre n’est jamais choisi tout seul', () => {
  const choix = moteurDuTriAutomatique('indetermine', [CLAUDE_OK, CODEX_OK, CURSOR_OK], ['cursor', 'codex', 'claude']);
  assert.equal(choix.engine, 'codex');
  assert.deepEqual(ordreDeMoteursComplet(['cursor', 'codex']), ['codex', 'claude']);
});

test('un moteur de secours que l’ordre oublie reste atteignable, en fin de liste', () => {
  assert.deepEqual(ordreDeMoteursComplet(['codex']), ['codex', 'claude']);
  assert.deepEqual(ordreDeMoteursComplet([]), ['claude', 'codex']);
  assert.deepEqual(ordreDeMoteursComplet(['codex', 'codex', 'inconnu']), ['codex', 'claude']);
});

test('un moteur absent du catalogue compte comme sans quota', () => {
  const choix = moteurDuTriAutomatique('administratif', [CLAUDE_OK], ['codex', 'claude']);
  assert.deepEqual(choix, { engine: 'claude', bascule: true });
});

test('un moteur dont le registre refuse le secours automatique n’est jamais rendu', () => {
  const fiche = (MOTEURS as unknown as { id: string; secoursAutomatique: boolean }[]).find((m) => m.id === 'claude')!;
  const avant = fiche.secoursAutomatique;
  fiche.secoursAutomatique = false;
  try {
    for (const genre of ['programmation_avancee', 'administratif', 'indetermine'] as const) {
      const choix = moteurDuTriAutomatique(genre, [CLAUDE_OK, CODEX_OK]);
      assert.equal(choix.engine, 'codex');
    }
    // Codex sans quota : Claude, refusé par le registre, n'est pas rendu pour autant.
    assert.equal(moteurDuTriAutomatique('programmation_avancee', [CLAUDE_OK, CODEX_SATURE]).engine, 'codex');
  } finally {
    fiche.secoursAutomatique = avant;
  }
});
