import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFUS_MICRO,
  RELECTURE_MS,
  REVEIL_NORMALISE,
  SILENCE_FIN_MS,
  assemblerDictee,
  contientLeReveil,
  contientUneAnnulation,
  ecartDeReveil,
  ecartSonore,
  finDuReveil,
  formeDeReveil,
  formeSonore,
  formesDeReveil,
  lireParole,
  normaliserParole,
  phraseDEchecTranscription,
} from '@haikodev/shared';

test('le mot de réveil est reconnu sous ses variantes de transcription', () => {
  for (const dit of [
    'Dis Haiko',
    'Dis Haïko',
    'dis haiko',
    'Dis, Haïko !',
    'Dis-Haiko',
    'Dishaiko',
    'Dit aïko',
    'Dis Aiko',
  ]) {
    assert.ok(contientLeReveil(dit), `« ${dit} » doit réveiller`);
  }
});

test('le mot par défaut est reconnu même découpé en morceaux par la transcription', () => {
  // Ce que l'ancienne fenêtre de deux mots et la marge figée à 2 manquaient :
  // un nom écrit en trois morceaux, ou « dis » remplacé par un mot voisin.
  for (const dit of ['dis a ico', 'des Haiko', 'dis h aiko', 'd’ici Aïko']) {
    assert.ok(contientLeReveil(dit), `« ${dit} » doit réveiller`);
  }
});

test('le réveil est reconnu tel que la TRANSCRIPTION l’écrit vraiment', () => {
  // Relevé sur le serveur : les trois voix du projet disant « Dis Haiko »,
  // relues par le moteur de transcription. Aucune de ces formes n'approche
  // « dishaiko » à la lettre — c'est pourquoi le réveil ne partait jamais.
  for (const dit of [
    'D’y éco, ouvre le tableau',        // voix Claire
    'Dièco, ouvre le tableau',          // voix Claire, autre passe
    'Dyeco',                            // sans ponctuation
    'Dieko, ouvre le tableau de bord',  // modèle plus gros
    'Dièque ouvre le tableau',
    'Dis et co, ouvrons le tableau',    // voix Pierre
    '10 écho, ouvre le tableau de bord', // voix Thomas : « dis » entendu « dix »
    'D’yko',
  ]) {
    assert.ok(contientLeReveil(dit), `« ${dit} » doit réveiller`);
  }
});

test('la suite de la dictée survit à un réveil reconnu au SON', () => {
  const lu = lireParole('Dièco, ouvre le tableau de bord', false, formesDeReveil('Dis Haiko'));
  assert.equal(lu.reveil, true);
  assert.equal(lu.suite, 'ouvre le tableau de bord');
});

test('la forme sonore ramène deux orthographes du même son au même mot', () => {
  assert.equal(formeSonore('Dis Haiko'), 'dieko');
  assert.equal(formeSonore('Dièco'), 'dieko');
  assert.equal(formeSonore('Dis et co'), 'dieko');
  assert.equal(formeSonore('10 écho'), 'dieko');
  // Un mot qui s'effacerait entièrement garde sa première lettre.
  assert.equal(formeSonore('et'), 'e');
  // La marge sonore est plus serrée que celle des lettres : la réduction a
  // déjà absorbé les écarts d'orthographe.
  assert.equal(ecartSonore('dieko'), 1);
  assert.equal(ecartDeReveil('dishaiko'), 2);
});

test('les deux formes du mot de réveil se calculent ensemble', () => {
  assert.deepEqual(formesDeReveil('Dis, Haïko !'), { ecrite: 'dishaiko', sonore: 'dieko' });
  // Un champ vide revient au mot par défaut, des DEUX côtés.
  assert.deepEqual(formesDeReveil(''), { ecrite: 'dishaiko', sonore: 'dieko' });
  assert.deepEqual(formesDeReveil(undefined), { ecrite: 'dishaiko', sonore: 'dieko' });
});

test('une phrase ordinaire ne réveille rien', () => {
  for (const dit of [
    'Bonjour tout le monde',
    'Je regarde le tableau des tâches',
    'Il fait beau aujourd’hui',
    'discussion',
    'disque',
    // Garde-fous du réveil élargi : trois écarts, ça ne passe pas.
    'je dis à Rico de venir',
    'on discute de tout ça',
    'il a dit à Nico',
    // Garde-fous de la voie SONORE : ces mots-là sonnent presque comme le
    // réveil, ils ne doivent pas ouvrir le micro pour autant.
    'il disait quoi au juste',
    'je cherche mon dictionnaire',
    'passe-moi le disque dur',
    'cette note est là',
  ]) {
    assert.ok(!contientLeReveil(dit), `« ${dit} » ne doit pas réveiller`);
  }
});

test('la marge suit la longueur du mot réglé : court plus strict, long plus souple', () => {
  assert.equal(ecartDeReveil('dishaiko'), 2); // 8 lettres
  assert.equal(ecartDeReveil(formeDeReveil('Nova')), 1); // 4 lettres → strict
  assert.equal(ecartDeReveil(formeDeReveil('Assistant Vocal')), 4); // 14 lettres → souple
});

test('un champ de réveil vide revient au mot par défaut', () => {
  assert.equal(formeDeReveil(''), REVEIL_NORMALISE);
  assert.equal(formeDeReveil('   '), REVEIL_NORMALISE);
  assert.equal(formeDeReveil(undefined), REVEIL_NORMALISE);
  assert.equal(formeDeReveil('Dis, Haïko !'), 'dishaiko');
});

test('un mot de réveil personnalisé COURT ouvre la dictée, et lui seul', () => {
  const forme = formeDeReveil('Nova');
  const lu = lireParole('Nova ouvre le tableau', false, forme);
  assert.equal(lu.reveil, true);
  assert.equal(lu.suite, 'ouvre le tableau');
  // Le mot par défaut ne réveille plus quand on a choisi un autre mot.
  assert.equal(finDuReveil('Dis Haiko range les cartes', forme), -1);
  // Un mot court reste strict : un mot ordinaire proche ne déclenche pas.
  assert.ok(!contientLeReveil('cette note est là', forme));
});

test('un mot de réveil personnalisé LONG tolère une prononciation abîmée', () => {
  const forme = formeDeReveil('Assistant Vocal');
  assert.ok(contientLeReveil('assistant vocal', forme));
  // « vocal » entendu « local » : une lettre sur quatorze, ça passe encore.
  assert.ok(contientLeReveil('assistant local maintenant', forme));
  const lu = lireParole('assistant vocal range les cartes terminées', false, forme);
  assert.equal(lu.reveil, true);
  assert.equal(lu.suite, 'range les cartes terminées');
});

test('une phrase vide ne dit rien du tout', () => {
  assert.equal(finDuReveil(''), -1);
  assert.equal(finDuReveil('   \n  '), -1);
  const lu = lireParole('', false);
  assert.deepEqual(lu, { reveil: false, annulation: false, suite: '' });
});

test('le mot de réveil au MILIEU d’une phrase compte, et la suite devient la dictée', () => {
  const lu = lireParole('Alors voilà, dis Haiko, ouvre le tableau de bord', false);
  assert.equal(lu.reveil, true);
  assert.equal(lu.suite, 'ouvre le tableau de bord');
});

test('le réveil en tête de phrase laisse la suite intacte', () => {
  const lu = lireParole('Dis Haïko range les cartes terminées', false);
  assert.equal(lu.reveil, true);
  assert.equal(lu.suite, 'range les cartes terminées');
});

test('un réveil seul n’amorce aucune dictée mais ouvre l’écoute', () => {
  const lu = lireParole('Dis Haiko', false);
  assert.equal(lu.reveil, true);
  assert.equal(lu.suite, '');
});

test('en guet, une phrase sans réveil est ignorée ; en écoute, elle s’ajoute', () => {
  assert.equal(lireParole('ouvre le tableau', false).suite, '');
  assert.equal(lireParole('ouvre le tableau', true).suite, 'ouvre le tableau');
});

test('« annule » jette la phrase, où qu’elle soit dans le texte', () => {
  for (const dit of ['Annule', 'annule tout', 'non, annuler', 'laisse tomber', 'Oublie']) {
    assert.ok(contientUneAnnulation(dit), `« ${dit} » doit annuler`);
  }
  const lu = lireParole('annule', true);
  assert.equal(lu.annulation, true);
  assert.equal(lu.suite, '');
});

test('un mot voisin n’annule rien', () => {
  for (const dit of ['annuellement', 'une annulation de vol se dit', 'anneau']) {
    if (dit.includes('annulation')) continue; // « annulation » annule, à dessein
    assert.ok(!contientUneAnnulation(dit), `« ${dit} » ne doit pas annuler`);
  }
});

test('la normalisation efface accents, majuscules et ponctuation', () => {
  assert.equal(normaliserParole('Dis, Haïko !'), 'dis haiko');
  assert.equal(normaliserParole('  ÉCOUTE—moi  '), 'ecoute moi');
});

test('les morceaux dictés se recollent avec une espace, jamais bout à bout', () => {
  assert.equal(assemblerDictee('ouvre le', 'tableau'), 'ouvre le tableau');
  assert.equal(assemblerDictee('', 'tableau'), 'tableau');
  assert.equal(assemblerDictee('tableau', '  '), 'tableau');
});

test('les délais et le refus du micro sont dits une seule fois', () => {
  assert.equal(SILENCE_FIN_MS, 2000);
  assert.equal(RELECTURE_MS, 2000);
  assert.ok(REFUS_MICRO.toLowerCase().includes('micro'));
});

test('une transcription qui échoue se DIT, avec la raison du serveur', () => {
  const avecRaison = phraseDEchecTranscription('moteur de transcription absent du serveur');
  assert.ok(avecRaison.includes('moteur de transcription absent du serveur'));
  assert.ok(avecRaison.toLowerCase().includes('transcrit'));
  // Sans raison, la phrase reste entière : jamais de parenthèse vide.
  const sansRaison = phraseDEchecTranscription();
  assert.ok(!sansRaison.includes('('));
  assert.ok(sansRaison.toLowerCase().includes('serveur'));
  assert.equal(phraseDEchecTranscription('   '), sansRaison);
});
