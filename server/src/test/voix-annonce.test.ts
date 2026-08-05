import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NOM_UTILISATEUR,
  VOIX_LONGUEUR_MAX,
  nettoyerPourVoix,
  phraseDecisionAttendue,
  phraseEchecDePublication,
  phraseFinDePublication,
  phraseFinDeTache,
  phraseVocaleDeNotification,
} from '@haikodev/shared';

test('la voix s’adresse à Chris, posé à un seul endroit', () => {
  assert.equal(NOM_UTILISATEUR, 'Chris');
});

test('le titre lu perd son emoji de genre et ses guillemets', () => {
  assert.equal(nettoyerPourVoix('✅ Corriger le tableau'), 'Corriger le tableau');
  assert.equal(nettoyerPourVoix('« Corriger le tableau »'), 'Corriger le tableau');
});

test('la fin de tâche nomme Chris et la carte, sans emoji', () => {
  const phrase = phraseFinDeTache('✅ Voix proactive');
  assert.ok(phrase.includes('Chris'), phrase);
  assert.ok(phrase.includes('Voix proactive'), phrase);
  assert.ok(!phrase.includes('✅'), phrase);
  // La même tâche redit toujours la même phrase (une réécoute ne surprend pas).
  assert.equal(phraseFinDeTache('✅ Voix proactive'), phrase);
});

test('sans titre, la fin de tâche reste humaine et nomme Chris', () => {
  assert.equal(phraseFinDeTache(''), "Voilà, Chris, c'est fini.");
  assert.equal(phraseFinDeTache(), "Voilà, Chris, c'est fini.");
});

test('deux tâches différentes ne récitent pas le même modèle figé', () => {
  const a = phraseFinDeTache('Ajouter le module de voix');
  const b = phraseFinDeTache('Corriger la barre de quota');
  // Chacune nomme Chris et sa carte, mais la tournure varie d'une tâche à l'autre.
  assert.ok(a.includes('Chris') && b.includes('Chris'));
  assert.notEqual(a, b);
});

test('la publication réussie ou en échec parle à Chris', () => {
  assert.equal(phraseFinDePublication('🚀 Root'), 'Ça y est, Chris : « Root » est en ligne.');
  assert.equal(
    phraseEchecDePublication('⛔ Root'),
    'Chris, la mise en ligne de « Root » a coincé, il faut y jeter un œil.',
  );
});

test('la décision attendue tutoie Chris, au singulier ou au pluriel', () => {
  assert.equal(phraseDecisionAttendue(1), "Chris, une décision t'attend.");
  assert.equal(phraseDecisionAttendue(3), "Chris, plusieurs décisions t'attendent.");
});

test('la décision attendue nomme la tâche, à défaut le projet', () => {
  // La tâche l'emporte sur le projet quand les deux sont connus.
  assert.equal(
    phraseDecisionAttendue(1, { projet: 'Root', tache: '✅ Corriger le tableau' }),
    "Chris, j'ai besoin de ton avis sur « Corriger le tableau ».",
  );
  // Sans tâche, on nomme le projet.
  assert.equal(
    phraseDecisionAttendue(1, { projet: 'Root' }),
    'Chris, le projet Root attend ta décision.',
  );
  // Plusieurs décisions : tournure simple qui cite un repère.
  assert.equal(
    phraseDecisionAttendue(2, { tache: 'Voix proactive' }),
    "Chris, plusieurs décisions t'attendent, dont la tâche « Voix proactive ».",
  );
  assert.equal(
    phraseDecisionAttendue(2, { projet: 'Root' }),
    "Chris, plusieurs décisions t'attendent, dont le projet Root.",
  );
});

test('sans nom disponible, on retombe sur la phrase générique', () => {
  assert.equal(phraseDecisionAttendue(1, {}), "Chris, une décision t'attend.");
  assert.equal(phraseDecisionAttendue(1, { projet: '', tache: '' }), "Chris, une décision t'attend.");
});

test('un titre trop long ne fait pas déborder l’annonce', () => {
  const titre = 'T'.repeat(300);
  const phrase = phraseDecisionAttendue(1, { projet: 'Root', tache: titre });
  assert.ok(phrase.length <= VOIX_LONGUEUR_MAX);
  // On retombe alors sur le projet, plus court.
  assert.equal(phrase, 'Chris, le projet Root attend ta décision.');
  // Même garde-fou côté fin de tâche : le repli court tient sous la borne.
  const finLongue = phraseFinDeTache('T'.repeat(300));
  assert.ok(finLongue.length <= VOIX_LONGUEUR_MAX);
});

test('la fin de tâche et la fin de publication parlent par la voie des notifications', () => {
  assert.equal(
    phraseVocaleDeNotification('tache-terminee', '✅ Voix proactive'),
    phraseFinDeTache('✅ Voix proactive'),
  );
  // La publication, réussie ou en échec, entre elle aussi dans la voix.
  assert.equal(
    phraseVocaleDeNotification('publication-terminee', '🚀 Root'),
    'Ça y est, Chris : « Root » est en ligne.',
  );
  assert.equal(
    phraseVocaleDeNotification('publication-echec', '⛔ Root'),
    'Chris, la mise en ligne de « Root » a coincé, il faut y jeter un œil.',
  );
  // La décision passe par le compte d'attention : elle ne se dit pas ici, sinon
  // on l'entendrait deux fois.
  assert.equal(phraseVocaleDeNotification('decision-attendue', 'X'), null);
  assert.equal(phraseVocaleDeNotification(undefined), null);
});
