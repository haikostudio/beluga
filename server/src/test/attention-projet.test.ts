import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attentionDuGroupe,
  attentionParProjet,
  demandeOuverte,
  doitSecouer,
  type DemandeEnAttente,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Le décompte des décisions attendues                                  */
/* ------------------------------------------------------------------ */

test('une question sans réponse compte comme une action attendue', () => {
  const demandes: DemandeEnAttente[] = [{ projectId: 'p1', genre: 'question' }];
  assert.deepEqual(attentionParProjet(demandes), { p1: 1 });
});

test('une carte présentée à valider compte AUTANT qu’une question', () => {
  const demandes: DemandeEnAttente[] = [{ projectId: 'p1', genre: 'validation' }];
  assert.deepEqual(attentionParProjet(demandes), { p1: 1 });
});

test('les deux à la fois s’additionnent, projet par projet', () => {
  const demandes: DemandeEnAttente[] = [
    { projectId: 'p1', genre: 'question' },
    { projectId: 'p1', genre: 'validation' },
    { projectId: 'p2', genre: 'question' },
  ];
  assert.deepEqual(attentionParProjet(demandes), { p1: 2, p2: 1 });
});

test('plus rien en attente : aucun projet ne s’allume', () => {
  const demandes: DemandeEnAttente[] = [
    { projectId: 'p1', genre: 'question', reglee: true },
    { projectId: 'p1', genre: 'validation', reglee: true },
  ];
  assert.deepEqual(attentionParProjet(demandes), {});
  assert.equal(demandeOuverte({ projectId: 'p1', genre: 'question', reglee: true }), false);
  assert.equal(demandeOuverte({ projectId: 'p1', genre: 'question' }), true);
});

test('une liste vide ne réclame rien', () => {
  assert.deepEqual(attentionParProjet([]), {});
});

/* ------------------------------------------------------------------ */
/* Le groupe replié porte la somme de ses projets                       */
/* ------------------------------------------------------------------ */

test('replier un groupe ne cache pas l’attente de ses projets', () => {
  const parProjet = { p1: 2, p3: 1 };
  assert.equal(attentionDuGroupe(['p1', 'p2', 'p3'], parProjet), 3);
  assert.equal(attentionDuGroupe(['p2'], parProjet), 0);
  assert.equal(attentionDuGroupe([], parProjet), 0);
});

/* ------------------------------------------------------------------ */
/* La secousse signale, elle ne harcèle pas                             */
/* ------------------------------------------------------------------ */

test('seule une NOUVELLE demande secoue la ligne', () => {
  assert.equal(doitSecouer({ avant: 0, maintenant: 1 }), true);
  assert.equal(doitSecouer({ avant: 1, maintenant: 2 }), true);
  // Le même compte, tour après tour : l'icône suffit, on ne rejoue rien.
  assert.equal(doitSecouer({ avant: 2, maintenant: 2 }), false);
  // Une demande réglée fait baisser le compte : ce n'est pas un signal.
  assert.equal(doitSecouer({ avant: 2, maintenant: 1 }), false);
});

test('le projet déjà ouvert et regardé ne bouge jamais', () => {
  assert.equal(doitSecouer({ avant: 0, maintenant: 1, regarde: true }), false);
  assert.equal(doitSecouer({ avant: 0, maintenant: 3, regarde: true }), false);
});
