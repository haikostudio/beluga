import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
