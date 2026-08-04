import assert from 'node:assert/strict';
import test from 'node:test';
import {
  badgeTravailTermine,
  doitSecouerLigne,
  repereVisible,
  signalDuGroupe,
  signaleQuelqueChose,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Le badge bleu : du travail rendu, pas encore consulté                */
/* ------------------------------------------------------------------ */

test('un travail rendu et pas lu allume le badge', () => {
  assert.equal(badgeTravailTermine({ rendus: 1 }), true);
  assert.equal(badgeTravailTermine({ rendus: 3 }), true);
});

test('rien de rendu, ou tout déjà lu : le badge reste éteint', () => {
  assert.equal(badgeTravailTermine({}), false);
  assert.equal(badgeTravailTermine({ rendus: 0 }), false);
  // Une décision attendue, c'est le triangle — pas le badge bleu.
  assert.equal(badgeTravailTermine({ attention: 2 }), false);
});

test('le projet a quelque chose à dire dès que l’un des deux signaux parle', () => {
  assert.equal(signaleQuelqueChose({}), false);
  assert.equal(signaleQuelqueChose({ attention: 1 }), true);
  assert.equal(signaleQuelqueChose({ rendus: 1 }), true);
  assert.equal(signaleQuelqueChose({ attention: 0, rendus: 0 }), false);
});

/* ------------------------------------------------------------------ */
/* Un SEUL repère à l'écran, le plus urgent                             */
/* ------------------------------------------------------------------ */

test('une ligne sans rien à dire ne montre aucun repère', () => {
  assert.equal(repereVisible({}), null);
  assert.equal(repereVisible({ attention: 0, rendus: 0 }), null);
});

test('chaque signal seul montre le sien', () => {
  assert.equal(repereVisible({ attention: 2 }), 'attention');
  assert.equal(repereVisible({ rendus: 4 }), 'rendus');
});

test('la DÉCISION attendue l’emporte sur le travail rendu', () => {
  // Deux pastilles côte à côte ne se lisent plus : on montre celle qui demande
  // un geste, l'autre reparaîtra d'elle-même.
  assert.equal(repereVisible({ attention: 1, rendus: 9 }), 'attention');
});

test('la décision réglée, le point bleu revient tout seul', () => {
  assert.equal(repereVisible({ attention: 0, rendus: 9 }), 'rendus');
});

test('le calcul des deux comptes n’est pas touché par ce choix d’affichage', () => {
  // Le repère caché reste compté : c'est bien l'affichage seul qu'on tranche.
  assert.equal(badgeTravailTermine({ attention: 1, rendus: 2 }), true);
  assert.equal(signaleQuelqueChose({ attention: 1, rendus: 2 }), true);
});

/* ------------------------------------------------------------------ */
/* La secousse signale, elle ne harcèle pas                             */
/* ------------------------------------------------------------------ */

test('une NOUVELLE demande secoue la ligne', () => {
  assert.equal(doitSecouerLigne({ avant: {}, maintenant: { attention: 1 } }), true);
  assert.equal(doitSecouerLigne({ avant: { attention: 1 }, maintenant: { attention: 2 } }), true);
});

test('un travail qui vient d’être rendu secoue la ligne, lui AUSSI', () => {
  assert.equal(doitSecouerLigne({ avant: {}, maintenant: { rendus: 1 } }), true);
  assert.equal(doitSecouerLigne({ avant: { rendus: 1 }, maintenant: { rendus: 2 } }), true);
});

test('un compte inchangé ne rejoue rien : l’icône suffit', () => {
  assert.equal(
    doitSecouerLigne({ avant: { attention: 2, rendus: 1 }, maintenant: { attention: 2, rendus: 1 } }),
    false,
  );
});

test('un compte qui RETOMBE n’est pas un signal', () => {
  assert.equal(doitSecouerLigne({ avant: { attention: 2 }, maintenant: { attention: 1 } }), false);
  assert.equal(doitSecouerLigne({ avant: { rendus: 3 }, maintenant: {} }), false);
});

test('une demande réglée n’efface pas un travail rendu au même instant', () => {
  // Sur un total, les deux mouvements s'annuleraient et la ligne resterait
  // muette : les signaux se comparent donc un par un.
  assert.equal(
    doitSecouerLigne({ avant: { attention: 1, rendus: 0 }, maintenant: { attention: 0, rendus: 1 } }),
    true,
  );
});

test('la ligne déjà sous les yeux ne bouge jamais', () => {
  assert.equal(doitSecouerLigne({ avant: {}, maintenant: { attention: 3 }, regarde: true }), false);
  assert.equal(doitSecouerLigne({ avant: {}, maintenant: { rendus: 3 }, regarde: true }), false);
});

/* ------------------------------------------------------------------ */
/* Un groupe replié porte la somme de ses projets                       */
/* ------------------------------------------------------------------ */

test('replier un groupe ne cache ni l’attente ni le travail rendu', () => {
  const attention = { p1: 2, p3: 1 };
  const rendus = { p1: 1, p2: 4 };
  assert.deepEqual(signalDuGroupe(['p1', 'p2', 'p3'], attention, rendus), { attention: 3, rendus: 5 });
  assert.deepEqual(signalDuGroupe(['p3'], attention, rendus), { attention: 1, rendus: 0 });
  assert.deepEqual(signalDuGroupe([], attention, rendus), { attention: 0, rendus: 0 });
});
