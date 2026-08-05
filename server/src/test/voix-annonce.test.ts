import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VOIX_LONGUEUR_MAX,
  nettoyerPourVoix,
  phraseDecisionAttendue,
  phraseFinDeTache,
  phraseVocaleDeNotification,
} from '@haikodev/shared';

test('le titre lu perd son emoji de genre et ses guillemets', () => {
  assert.equal(nettoyerPourVoix('✅ Corriger le tableau'), 'Corriger le tableau');
  assert.equal(nettoyerPourVoix('« Corriger le tableau »'), 'Corriger le tableau');
});

test('la fin de tâche nomme la carte, ou reste générique sans titre', () => {
  assert.equal(phraseFinDeTache('✅ Voix proactive'), 'La tâche « Voix proactive » est terminée.');
  assert.equal(phraseFinDeTache(''), 'Une tâche est terminée.');
  assert.equal(phraseFinDeTache(), 'Une tâche est terminée.');
});

test('la décision attendue se dit au singulier ou au pluriel, jamais un chiffre récité', () => {
  assert.equal(phraseDecisionAttendue(1), 'Une décision attend votre réponse.');
  assert.equal(phraseDecisionAttendue(3), 'Plusieurs décisions attendent votre réponse.');
});

test('la décision attendue nomme la tâche, à défaut le projet', () => {
  // La tâche l'emporte sur le projet quand les deux sont connus.
  assert.equal(
    phraseDecisionAttendue(1, { projet: 'Root', tache: '✅ Corriger le tableau' }),
    'La tâche « Corriger le tableau » attend votre réponse.',
  );
  // Sans tâche, on nomme le projet.
  assert.equal(
    phraseDecisionAttendue(1, { projet: 'Root' }),
    'Le projet Root attend votre réponse.',
  );
  // Plusieurs décisions : tournure simple qui cite un repère.
  assert.equal(
    phraseDecisionAttendue(2, { tache: 'Voix proactive' }),
    'Plusieurs réponses vous attendent, dont la tâche « Voix proactive ».',
  );
  assert.equal(
    phraseDecisionAttendue(2, { projet: 'Root' }),
    'Plusieurs réponses vous attendent, dont le projet Root.',
  );
});

test('sans nom disponible, on retombe sur la phrase générique', () => {
  assert.equal(phraseDecisionAttendue(1, {}), 'Une décision attend votre réponse.');
  assert.equal(phraseDecisionAttendue(1, { projet: '', tache: '' }), 'Une décision attend votre réponse.');
});

test('un titre trop long ne fait pas déborder l’annonce', () => {
  const titre = 'T'.repeat(300);
  const phrase = phraseDecisionAttendue(1, { projet: 'Root', tache: titre });
  assert.ok(phrase.length <= VOIX_LONGUEUR_MAX);
  // On retombe alors sur le projet, plus court.
  assert.equal(phrase, 'Le projet Root attend votre réponse.');
});

test('seule la fin de tâche parle par la voie des notifications', () => {
  assert.equal(
    phraseVocaleDeNotification('tache-terminee', '✅ Voix proactive'),
    'La tâche « Voix proactive » est terminée.',
  );
  // La décision passe par le compte d'attention : elle ne se dit pas ici, sinon
  // on l'entendrait deux fois.
  assert.equal(phraseVocaleDeNotification('decision-attendue', 'X'), null);
  assert.equal(phraseVocaleDeNotification('publication-terminee', 'X'), null);
  assert.equal(phraseVocaleDeNotification(undefined), null);
});
