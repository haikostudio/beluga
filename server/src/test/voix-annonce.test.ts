import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NOM_UTILISATEUR,
  VOIX_LONGUEUR_MAX,
  nettoyerPourVoix,
  phraseDecisionAttendue,
  phraseDepuisReponse,
  phraseEchecDePublication,
  phraseFinDePublication,
  phraseFinDeTache,
  phraseVocaleDeNotification,
} from '@haikodev/shared';

test('la voix s’adresse à Chris par défaut, posé à un seul endroit', () => {
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

test('le prénom est réglable : un autre utilisateur est nommé', () => {
  const phrase = phraseFinDeTache('Voix proactive', { nom: 'Léa' });
  assert.ok(phrase.includes('Léa'), phrase);
  assert.ok(!phrase.includes('Chris'), phrase);
  // Un prénom vide retombe sur « Chris ».
  assert.ok(phraseFinDeTache('Voix proactive', { nom: '  ' }).includes('Chris'));
});

test('le soir, la voix se fait plus brève', () => {
  const jour = phraseFinDeTache('Voix proactive', { heure: 14 });
  const soir = phraseFinDeTache('Voix proactive', { heure: 22 });
  assert.notEqual(jour, soir);
  assert.ok(soir.length < jour.length, `${soir} / ${jour}`);
  // Sans titre non plus, le soir est plus court.
  assert.equal(phraseFinDeTache('', { heure: 23 }), "C'est fait, Chris.");
});

test('deux tâches différentes ne récitent pas le même modèle figé', () => {
  const a = phraseFinDeTache('Ajouter le module de voix');
  const b = phraseFinDeTache('Corriger la barre de quota');
  assert.ok(a.includes('Chris') && b.includes('Chris'));
  assert.notEqual(a, b);
});

test('la publication réussie ou en échec parle à Chris, et varie', () => {
  assert.ok(phraseFinDePublication('🚀 Root', { heure: 10 }).includes('Root'));
  assert.ok(phraseEchecDePublication('⛔ Root', { heure: 10 }).includes('coincé'));
  // La tournure change d'un projet à l'autre (variété, choix stable).
  const p1 = phraseFinDePublication('Root', { heure: 10 });
  const p2 = phraseFinDePublication('Comptabilité', { heure: 10 });
  assert.notEqual(p1, p2);
  // Le soir raccourcit aussi la publication.
  assert.equal(phraseFinDePublication('Root', { heure: 22 }), 'Chris, « Root » est en ligne.');
});

test('la décision attendue tutoie Chris, au singulier ou au pluriel', () => {
  assert.equal(phraseDecisionAttendue(1), "Chris, une décision t'attend.");
  assert.equal(phraseDecisionAttendue(3), "Chris, plusieurs décisions t'attendent.");
});

test('la décision attendue nomme la tâche, à défaut le projet, et varie', () => {
  const surTache = phraseDecisionAttendue(1, { projet: 'Root', tache: 'Corriger le tableau' }, { heure: 10 });
  assert.ok(surTache.includes('Corriger le tableau'), surTache);
  assert.ok(surTache.includes('Chris'), surTache);
  // Sans tâche, on nomme le projet.
  assert.ok(phraseDecisionAttendue(1, { projet: 'Root' }, { heure: 10 }).includes('Root'));
  // Deux tâches différentes n'ont pas toujours la même tournure.
  const d1 = phraseDecisionAttendue(1, { tache: 'Alpha la tâche' }, { heure: 10 });
  const d2 = phraseDecisionAttendue(1, { tache: 'Bêta la tâche' }, { heure: 10 });
  assert.notEqual(d1, d2);
  // Le soir, la tournure reste simple.
  assert.equal(
    phraseDecisionAttendue(1, { tache: 'Corriger le tableau' }, { heure: 23 }),
    'Chris, « Corriger le tableau » attend ta décision.',
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
  assert.ok(phrase.includes('Root'), phrase);
  const finLongue = phraseFinDeTache('T'.repeat(300));
  assert.ok(finLongue.length <= VOIX_LONGUEUR_MAX);
});

test('phraseDepuisReponse tire un résumé humain du vrai contenu', () => {
  const reponse = [
    '## 1. Analyse',
    'Blabla.',
    '',
    '## 2. Ce qui est fait',
    '',
    "- J'ai réécrit les phrases parlées pour nommer Chris.",
    '- Un autre point.',
    '',
    '## 3. Conséquences',
    'Suite.',
  ].join('\n');
  const phrase = phraseDepuisReponse(reponse, { heure: 10 });
  assert.ok(phrase, 'un résumé est attendu');
  assert.ok(phrase!.includes('Chris'), phrase!);
  assert.ok(phrase!.includes('réécrit les phrases parlées'), phrase!);
  // Le prénom réglé passe aussi dans le résumé.
  assert.ok(phraseDepuisReponse(reponse, { nom: 'Léa', heure: 10 })!.includes('Léa'));
  // Le soir, on préfère la brève phrase par titre : pas de résumé qui s'étire.
  assert.equal(phraseDepuisReponse(reponse, { heure: 22 }), null);
});

test('phraseDepuisReponse rend null quand rien de propre ne se dégage', () => {
  assert.equal(phraseDepuisReponse(undefined, { heure: 10 }), null);
  assert.equal(phraseDepuisReponse('', { heure: 10 }), null);
  assert.equal(phraseDepuisReponse('Aucune section ici.', { heure: 10 }), null);
  // Une section vide ne donne rien.
  assert.equal(phraseDepuisReponse('## Ce qui est fait\n\n## Suite', { heure: 10 }), null);
  // Un premier point trop long ne tiendrait pas dans une annonce.
  const trop = `## Ce qui est fait\n- ${'mot '.repeat(80)}.\n`;
  assert.equal(phraseDepuisReponse(trop, { heure: 10 }), null);
});

test('phraseDepuisReponse nettoie puce, gras et code pour l’oreille', () => {
  const reponse = '## Ce qui est fait\n- **Ajout** du champ `voixNom` dans les réglages.\n';
  const phrase = phraseDepuisReponse(reponse, { heure: 10 });
  assert.ok(phrase, 'un résumé est attendu');
  assert.ok(!phrase!.includes('*'), phrase!);
  assert.ok(!phrase!.includes('`'), phrase!);
  assert.ok(phrase!.includes('Ajout du champ voixNom'), phrase!);
});

test('la fin de tâche et la fin de publication parlent par la voie des notifications', () => {
  assert.equal(
    phraseVocaleDeNotification('tache-terminee', '✅ Voix proactive', { heure: 10 }),
    phraseFinDeTache('✅ Voix proactive', { heure: 10 }),
  );
  assert.ok(phraseVocaleDeNotification('publication-terminee', '🚀 Root', { heure: 10 })!.includes('Root'));
  assert.ok(phraseVocaleDeNotification('publication-echec', '⛔ Root', { heure: 10 })!.includes('coincé'));
  // La décision passe par le compte d'attention : elle ne se dit pas ici.
  assert.equal(phraseVocaleDeNotification('decision-attendue', 'X'), null);
  assert.equal(phraseVocaleDeNotification(undefined), null);
});
