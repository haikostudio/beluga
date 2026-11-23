import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GESTES_QUI_ATTENDENT,
  TEXTE_DU_GESTE_ATTENDU,
  gesteEnAttente,
  gesteQuiAttend,
  iconeDeLAttention,
  iconeDuLot,
  natureDeLAttention,
  demandeAlerte,
  attentionParProjet,
  decisionSansIssue,
  gesteDuParcours,
  type DecisionAttendue,
} from '@beluga/shared';

/*
 * LE REPÈRE D'UNE CARTE QUI ATTEND UN GESTE — allumage, extinction, nature.
 *
 * Trois choses se vérifient ici, toutes sans base ni navigateur :
 *  1. quand le geste attendu s'allume, et quand il s'éteint ;
 *  2. qu'il ne double jamais une question déjà ouverte ;
 *  3. que la nature choisit bien son icône, sur la carte comme sur la ligne.
 */

const RENDU = 1_000;

test('un geste attendu s’allume quand le tour s’est tu et que la carte n’a pas été rouverte', () => {
  const etat = { geste: 'valider-et-lancer' as const, possible: true };
  assert.equal(gesteEnAttente({ etat, finDuTourA: RENDU, luA: 0 }), 'valider-et-lancer');
  assert.equal(gesteEnAttente({ etat, finDuTourA: RENDU, luA: RENDU - 1 }), 'valider-et-lancer');
});

test('…et il s’éteint dès que la carte est consultée après la fin du tour', () => {
  const etat = { geste: 'valider-et-lancer' as const, possible: true };
  assert.equal(gesteEnAttente({ etat, finDuTourA: RENDU, luA: RENDU }), null);
  assert.equal(gesteEnAttente({ etat, finDuTourA: RENDU, luA: RENDU + 1 }), null);
});

test('rien ne s’allume tant qu’un tour vit, ni sur un geste éteint, ni sans tour rendu', () => {
  const etat = { geste: 'lancer' as const, possible: true };
  assert.equal(gesteEnAttente({ etat, tourEnCours: true, finDuTourA: RENDU }), null);
  assert.equal(
    gesteEnAttente({ etat: { geste: 'lancer', possible: false }, finDuTourA: RENDU }),
    null,
  );
  // Une carte écrite à la main dont aucun tour n'a jamais rien rendu ne dit rien.
  assert.equal(gesteEnAttente({ etat, finDuTourA: 0 }), null);
  assert.equal(gesteEnAttente({ etat }), null);
});

test('seuls deux gestes se signalent : terminer, arrêter et reprendre n’allument rien', () => {
  assert.deepEqual([...GESTES_QUI_ATTENDENT], ['valider-et-lancer', 'lancer']);
  for (const geste of ['terminer', 'arreter', 'reprendre', 'aucun'] as const) {
    assert.equal(gesteQuiAttend(geste), false, geste);
    assert.equal(gesteEnAttente({ etat: { geste, possible: true }, finDuTourA: RENDU }), null, geste);
  }
});

test('chaque geste attendu dit en clair ce qu’il attend', () => {
  for (const geste of GESTES_QUI_ATTENDENT) {
    assert.ok(TEXTE_DU_GESTE_ATTENDU[geste].length > 5, geste);
  }
});

/* ------------------------------------------------------------------ */
/* La nature, et l'icône qu'elle choisit                               */
/* ------------------------------------------------------------------ */

test('la nature d’une attente se lit sur son genre et son geste', () => {
  assert.equal(natureDeLAttention({ genre: 'question' }), 'question');
  assert.equal(natureDeLAttention({ genre: 'validation' }), 'validation');
  assert.equal(natureDeLAttention({ genre: 'incident' }), 'incident');
  assert.equal(natureDeLAttention({ genre: 'action', geste: 'valider-et-lancer' }), 'plan');
  assert.equal(natureDeLAttention({ genre: 'action', geste: 'valider-et-lancer' }), 'plan');
  assert.equal(natureDeLAttention({ genre: 'action', geste: 'lancer' }), 'lancement');
});

test('une question se dessine en message, un plan en chemin, un incident en triangle', () => {
  assert.equal(iconeDeLAttention({ genre: 'question' }), 'message');
  assert.equal(iconeDeLAttention({ genre: 'action', geste: 'valider-et-lancer' }), 'plan');
  assert.equal(iconeDeLAttention({ genre: 'action', geste: 'lancer' }), 'plan');
  assert.equal(iconeDeLAttention({ genre: 'validation' }), 'triangle');
  assert.equal(iconeDeLAttention({ genre: 'incident' }), 'triangle');
});

test('un LOT ne montre qu’une icône, la question passant devant l’action', () => {
  assert.equal(iconeDuLot([]), null);
  assert.equal(iconeDuLot([{ genre: 'action', geste: 'valider-et-lancer' }]), 'plan');
  assert.equal(
    iconeDuLot([{ genre: 'action', geste: 'lancer' }, { genre: 'question' }]),
    'message',
  );
  assert.equal(
    iconeDuLot([{ genre: 'action', geste: 'valider-et-lancer' }, { genre: 'validation' }]),
    'triangle',
  );
});

/* ------------------------------------------------------------------ */
/* Le reste de la chaîne porte le nouveau genre sans être réécrit      */
/* ------------------------------------------------------------------ */

test('une action ALERTE comme une question, et compte pour son projet', () => {
  assert.equal(demandeAlerte({ projectId: 'p', genre: 'action' }), true);
  assert.equal(demandeAlerte({ projectId: 'p', genre: 'action', reglee: true }), false);
  assert.deepEqual(
    attentionParProjet([
      { projectId: 'p', genre: 'action' },
      { projectId: 'p', genre: 'question' },
      { projectId: 'p', genre: 'incident' },
    ]),
    { p: 2 },
  );
});

test('un geste de parcours garde son issue SANS message porteur : son bouton est sur la carte', () => {
  const decision: DecisionAttendue = {
    projectId: 'p',
    cardId: 'c',
    genre: 'action',
    geste: 'valider-et-lancer',
    source: 'geste-de-parcours',
  };
  assert.equal(decisionSansIssue(decision), false);
  assert.equal(decisionSansIssue(decision, { messages: new Set() }), false);
  // Une question, elle, garde l'exigence : sans sa bulle, rien à afficher.
  assert.equal(
    decisionSansIssue({ projectId: 'p', cardId: 'c', genre: 'question', source: 'question-outil' }),
    true,
  );
});

/* ------------------------------------------------------------------ */
/* Bout à bout : le parcours d'une carte de cadrage                    */
/* ------------------------------------------------------------------ */

const COMPRIS = {
  comprehension: { texte: 'J’ai compris.', at: 1, hypotheses: [], sujets: [] },
  plans: [],
};

test('une carte de cadrage dont le plan peut être généré attend un geste', () => {
  const etat = gesteDuParcours({
    colonne: 'planned',
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: [{ role: 'user', content: 'fais ceci' }],
    parcours: COMPRIS,
  });
  assert.equal(etat.geste, 'valider-et-lancer');
  assert.equal(etat.possible, true);
  assert.equal(gesteEnAttente({ etat, finDuTourA: RENDU, luA: 0 }), 'valider-et-lancer');
});

test('…mais pas tant que la compréhension n’est pas rendue : le bouton est éteint', () => {
  const etat = gesteDuParcours({
    colonne: 'planned',
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: [{ role: 'user', content: 'fais ceci' }],
    parcours: { plans: [] },
  });
  assert.equal(etat.possible, false);
  assert.equal(gesteEnAttente({ etat, finDuTourA: RENDU, luA: 0 }), null);
});

test('…ni quand une question de l’agent attend encore une réponse', () => {
  const etat = gesteDuParcours({
    colonne: 'planned',
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: [
      { role: 'user', content: 'fais ceci' },
      { role: 'assistant', content: 'et ceci ?', questions: [{}] },
    ],
    parcours: COMPRIS,
  });
  assert.equal(etat.possible, false);
  assert.equal(gesteEnAttente({ etat, finDuTourA: RENDU, luA: 0 }), null);
});
