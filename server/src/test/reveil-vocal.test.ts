import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFUS_MICRO,
  RELECTURE_MS,
  SILENCE_FIN_MS,
  assemblerDictee,
  contientLeReveil,
  contientUneAnnulation,
  finDuReveil,
  lireParole,
  normaliserParole,
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

test('une phrase ordinaire ne réveille rien', () => {
  for (const dit of [
    'Bonjour tout le monde',
    'Je regarde le tableau des tâches',
    'Il fait beau aujourd’hui',
    'discussion',
    'disque',
  ]) {
    assert.ok(!contientLeReveil(dit), `« ${dit} » ne doit pas réveiller`);
  }
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
